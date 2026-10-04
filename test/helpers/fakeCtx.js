'use strict';

/**
 * Deterministic stand-in for the room, for unit-testing game plugins.
 *
 * The `ctx` it produces is built by the REAL server/context.js on top of an
 * in-memory host, so wallet validation, stats, auto-announcements and timer
 * handling behave exactly as in production. Only three things are fake:
 *
 *   - players and balances live in memory,
 *   - time is a manual clock: nothing happens until you call advance(ms),
 *   - randomness is scripted: you decide every number the game draws.
 *
 * Quick tour (see docs/GAME_API.md, "Unit tests with fakeCtx"):
 *
 *   const { createTable, GameError } = require('./helpers/fakeCtx');
 *   const table = createTable(plugin, {
 *     players: [{ id: 'ana', balance: 500 }, { id: 'beto' }],   // added and seated
 *     ints: [17],                                               // rng.int() results, in order
 *   });
 *   table.act('ana', { type: 'bet', spot: 'red', amount: 50 });
 *   table.advance(30000);                 // fire ctx.after() timers
 *   table.view('ana');                    // JSON round-tripped, like on the wire
 *   table.balance('ana'); table.stake('ana'); table.emitted('spin');
 */

const { createContext, emptyStats, GameError } = require('../../server/context');
const realRng = require('../../server/rng');
const { validateInstance } = require('../../server/games');
const { createFakeClock } = require('./fakeClock');

/**
 * Scripted rng with the interface of server/rng.js.
 *
 * @param {object} [options]
 * @param {Array<number|((min: number, max: number) => number)>} [options.ints]
 *        results of successive int(min, maxExclusive) calls. pick() and the
 *        Fisher-Yates of an unscripted `shuffle: 'fisher-yates'` consume from here too.
 * @param {number[]} [options.floats]   results of successive float() calls
 * @param {Array<any[]|((array: any[]) => any[])>} [options.shuffles]
 *        results of successive shuffle() calls: either the exact array to
 *        return, or a function receiving a copy of the input.
 * @param {'identity'|'fisher-yates'} [options.shuffle]
 *        what shuffle() does once `shuffles` is exhausted. Default 'identity':
 *        a copy in the original order (so a shoe is just the decks in order).
 * @param {'throw'|'min'|'random'} [options.fallback]
 *        what int()/float() do when their queue is empty. Default 'throw', so a
 *        test never passes by accident on an unscripted draw. 'min' returns the
 *        lowest legal value, 'random' uses the real crypto rng.
 */
function createScriptedRng(options = {}) {
  const fallback = options.fallback || 'throw';
  const shuffleMode = options.shuffle || 'identity';
  const rng = {
    ints: [...(options.ints || [])],
    floats: [...(options.floats || [])],
    shuffles: [...(options.shuffles || [])],
    /** Every draw made so far: { fn, min?, max?, value }. */
    calls: [],

    int(min, maxExclusive) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= min) {
        throw new RangeError(`rng.int(${min}, ${maxExclusive}): invalid bounds`);
      }
      let value;
      if (rng.ints.length > 0) {
        value = rng.ints.shift();
        if (typeof value === 'function') value = value(min, maxExclusive);
        if (!Number.isInteger(value) || value < min || value >= maxExclusive) {
          throw new RangeError(`fake rng: scripted int ${value} is outside [${min}, ${maxExclusive})`);
        }
      } else if (fallback === 'min') {
        value = min;
      } else if (fallback === 'random') {
        value = realRng.int(min, maxExclusive);
      } else {
        throw new Error(`fake rng: int(${min}, ${maxExclusive}) was called but no scripted int is left`);
      }
      rng.calls.push({ fn: 'int', min, max: maxExclusive, value });
      return value;
    },

    float() {
      let value;
      if (rng.floats.length > 0) {
        value = rng.floats.shift();
        if (typeof value !== 'number' || !(value >= 0 && value < 1)) {
          throw new RangeError(`fake rng: scripted float ${value} is outside [0, 1)`);
        }
      } else if (fallback === 'min') {
        value = 0;
      } else if (fallback === 'random') {
        value = realRng.float();
      } else {
        throw new Error('fake rng: float() was called but no scripted float is left');
      }
      rng.calls.push({ fn: 'float', value });
      return value;
    },

    shuffle(array) {
      if (!Array.isArray(array)) throw new TypeError('rng.shuffle(array): expected an array');
      let out;
      if (rng.shuffles.length > 0) {
        const scripted = rng.shuffles.shift();
        out = typeof scripted === 'function' ? scripted(array.slice()) : scripted.slice();
        if (!Array.isArray(out)) throw new TypeError('fake rng: a scripted shuffle must produce an array');
      } else if (shuffleMode === 'fisher-yates') {
        out = realRng.createRng({ int: rng.int, float: rng.float }).shuffle(array);
      } else {
        out = array.slice();
      }
      rng.calls.push({ fn: 'shuffle', length: array.length });
      return out;
    },

    pick(array) {
      if (!Array.isArray(array) || array.length === 0) {
        throw new RangeError('rng.pick(array): expected a non-empty array');
      }
      return array[rng.int(0, array.length)];
    },
  };
  return rng;
}

/**
 * @param {object} [options]
 * @param {object} [options.meta]        plugin meta (id and name appear in announcements)
 * @param {Array<{ id: string, name?: string, avatar?: number, balance?: number, connected?: boolean, seated?: boolean }>} [options.players]
 *        players of the room; all of them are in ctx.seated() unless `seated: false`
 * @param {number} [options.timeScale]   default 1: advance() uses the plugin's nominal milliseconds
 * @param {number} [options.now]         starting epoch ms of the manual clock
 * @param {object} [options.rng]         a ready-made rng; otherwise built from ints / floats / shuffles / shuffle / fallback
 * @param {boolean} [options.strictErrors] default true: advance() rethrows exceptions that a
 *        ctx.after() callback threw (the real ctx logs them and carries on)
 */
function createFakeCtx(options = {}) {
  const clock = createFakeClock(options.now);
  const rng = options.rng || createScriptedRng(options);
  const meta = options.meta || { id: 'test', name: 'Mesa de prueba' };
  const strictErrors = options.strictErrors !== false;

  const players = new Map();
  const seated = [];
  const emits = [];
  const announcements = [];
  const reports = [];
  const ledger = [];
  const errors = [];
  let syncs = 0;
  let errorsSeen = 0;

  const host = {
    seated: () => seated.map((id) => players.get(id)),
    find: (id) => players.get(id) || null,
    touch: () => {},
    sync: () => {
      syncs += 1;
    },
    emit: (name, payload, to) => {
      emits.push({ name, payload, to });
    },
    announce: (entry) => {
      announcements.push(entry);
    },
  };
  const log = { error: (...args) => errors.push(args) };
  const real = createContext({ meta, host, clock, rng, timeScale: options.timeScale || 1, log });

  // Same ctx as production, plus a paper trail of every chip movement.
  const ctx = Object.freeze({
    ...real.ctx,
    debit(id, amount) {
      const ok = real.ctx.debit(id, amount);
      if (ok) ledger.push({ type: 'debit', id, amount });
      return ok;
    },
    credit(id, amount) {
      real.ctx.credit(id, amount);
      if (players.has(id) && amount > 0) ledger.push({ type: 'credit', id, amount });
    },
    report(playerId, result) {
      reports.push({ playerId, ...result });
      real.ctx.report(playerId, result);
    },
  });

  function requirePlayer(id) {
    const player = players.get(id);
    if (!player) throw new Error(`fakeCtx: unknown player "${id}"`);
    return player;
  }

  function throwNewErrors() {
    if (!strictErrors || errors.length === errorsSeen) return;
    const fresh = errors.slice(errorsSeen);
    errorsSeen = errors.length;
    const cause = fresh.flat().find((item) => item instanceof Error);
    throw cause || new Error(`fakeCtx: the context logged an error: ${fresh.map((args) => args.join(' ')).join('; ')}`);
  }

  const fake = {
    ctx,
    clock,
    rng,
    meta,
    players,

    /** Add a player to the room. Seated at the table unless `seated: false`. */
    addPlayer(spec) {
      if (!spec || typeof spec.id !== 'string') throw new Error('fakeCtx.addPlayer: { id } required');
      if (players.has(spec.id)) throw new Error(`fakeCtx.addPlayer: duplicate id "${spec.id}"`);
      players.set(spec.id, {
        id: spec.id,
        name: spec.name === undefined ? spec.id : spec.name,
        avatar: spec.avatar === undefined ? 0 : spec.avatar,
        balance: spec.balance === undefined ? 1000 : spec.balance,
        connected: spec.connected !== false,
        stats: emptyStats(),
      });
      if (spec.seated !== false) seated.push(spec.id);
      return fake;
    },

    /** Put a player in ctx.seated() WITHOUT calling the plugin (createTable().sit does both). */
    seat(id) {
      requirePlayer(id);
      if (!seated.includes(id)) seated.push(id);
    },

    /** Remove a player from ctx.seated() WITHOUT calling the plugin. */
    unseat(id) {
      const index = seated.indexOf(id);
      if (index !== -1) seated.splice(index, 1);
    },

    isSeated: (id) => seated.includes(id),
    seatedIds: () => seated.slice(),

    setConnected(id, connected) {
      requirePlayer(id).connected = Boolean(connected);
    },

    balance: (id) => requirePlayer(id).balance,

    setBalance(id, amount) {
      requirePlayer(id).balance = amount;
    },

    stats: (id) => ({ ...requirePlayer(id).stats }),

    /** Sum of every player's balance. */
    totalBalance() {
      let total = 0;
      for (const player of players.values()) total += player.balance;
      return total;
    },

    now: () => clock.now(),

    /** Move the manual clock; due ctx.after() callbacks run in order. */
    advance(ms) {
      clock.advance(ms);
      throwNewErrors();
    },

    /** Captured ctx.emit() calls: [{ name, payload, to }] (to is null for "everybody seated"). */
    emits,
    /** Payloads of the captured events with this name. */
    emitted: (name) => emits.filter((event) => event.name === name).map((event) => event.payload),
    /** Captured feed lines (ctx.announce and automatic win announcements): [{ kind, text, playerId, amount }]. */
    announcements,
    /** Captured ctx.report() calls: [{ playerId, wagered, won }]. */
    reports,
    /** Every successful chip movement: [{ type: 'debit'|'credit', id, amount }]. */
    ledger,
    /** Everything the context logged as an error (bad report(), credit to nobody, timer exceptions). */
    errors,
    /** How many times a state push was requested. */
    get syncs() {
      return syncs;
    },

    /** Forget captured emits / announcements / reports / ledger / syncs (not balances or time). */
    clearLog() {
      emits.length = 0;
      announcements.length = 0;
      reports.length = 0;
      ledger.length = 0;
      syncs = 0;
    },

    /** Cancel pending timers, like a room being destroyed. */
    dispose() {
      real.dispose();
    },
  };

  for (const spec of options.players || []) fake.addPlayer(spec);
  return fake;
}

/**
 * A plugin instance wired to a fake ctx, driven the way the room drives it.
 *
 * @param {{ meta: object, create: Function }} plugin
 * @param {object} [options] same as createFakeCtx(); `players` are added and seated
 *        through onSit (use `seated: false` to only add them to the room)
 */
function createTable(plugin, options = {}) {
  const fake = createFakeCtx({ ...options, meta: plugin.meta, players: [] });
  const game = plugin.create(fake.ctx);
  validateInstance(game, plugin.meta.id);

  const table = {
    ...fake,
    get syncs() {
      return fake.syncs;
    },
    fake,
    game,
    plugin,

    /** Like the room: the player joins ctx.seated(), then onSit runs; a throw rolls the seat back. */
    sit(id) {
      if (fake.isSeated(id)) throw new Error(`createTable.sit: "${id}" is already seated`);
      fake.seat(id);
      try {
        game.onSit(id);
      } catch (err) {
        fake.unseat(id);
        throw err;
      }
    },

    /** Like the room: the player leaves ctx.seated(), then onLeave runs. */
    leave(id) {
      if (!fake.isSeated(id)) throw new Error(`createTable.leave: "${id}" is not seated`);
      fake.unseat(id);
      game.onLeave(id);
    },

    /** Send an action as it would arrive from the wire (JSON round trip). Throws what the plugin throws. */
    act(id, action) {
      if (!fake.isSeated(id)) throw new Error(`createTable.act: "${id}" is not seated (the room never routes those)`);
      game.onAction(id, JSON.parse(JSON.stringify(action)));
    },

    /** The view of one player, JSON round-tripped exactly like on the wire. */
    view(id) {
      return JSON.parse(JSON.stringify(game.view(id)));
    },

    stake: (id) => game.stakeOf(id),

    /** Balances plus stakes of everybody: constant between resolutions if chips are conserved. */
    chips() {
      let total = 0;
      for (const player of fake.players.values()) total += player.balance + game.stakeOf(player.id);
      return total;
    },

    /**
     * Assert that an action is rejected with a GameError and that it moved no chips.
     * @returns {string} the Spanish message, for further assertions
     */
    rejects(id, action, pattern) {
      const before = table.chips();
      const balance = fake.balance(id);
      let error = null;
      try {
        table.act(id, action);
      } catch (err) {
        error = err;
      }
      if (!error) throw new Error(`expected ${JSON.stringify(action)} to be rejected, but it was accepted`);
      if (!(error instanceof GameError)) throw error;
      if (pattern && !pattern.test(error.message)) {
        throw new Error(`rejection message "${error.message}" does not match ${pattern}`);
      }
      if (fake.balance(id) !== balance || table.chips() !== before) {
        throw new Error(`rejected action ${JSON.stringify(action)} still moved chips`);
      }
      return error.message;
    },
  };

  for (const spec of options.players || []) {
    fake.addPlayer({ ...spec, seated: false });
    if (spec.seated !== false) table.sit(spec.id);
  }
  return table;
}

module.exports = { createFakeCtx, createTable, createScriptedRng, createFakeClock, GameError };
