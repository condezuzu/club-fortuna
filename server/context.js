'use strict';

/**
 * Builds the `ctx` object handed to every game instance (see docs/GAME_API.md).
 *
 * The context is the ONLY door between a game plugin and the rest of the club:
 * wallet, randomness, timers, pushes to clients, stats and the activity feed.
 * It talks to its surroundings through a small `host` interface, implemented
 * by the Room in production and by test/helpers/fakeCtx.js in unit tests, so
 * plugins meet exactly the same validation and bookkeeping in both worlds.
 *
 * host = {
 *   seated()                       -> player records seated at this table, in sit order
 *   find(id)                       -> player record of the room, or null
 *   touch()                        -> a balance / stat changed: refresh the room snapshot
 *   sync()                         -> push view(playerId) to every seated player (coalesced)
 *   emit(name, payload, toId|null) -> one-shot table event
 *   announce({ kind, text, playerId, amount }) -> line in the room activity feed
 * }
 * player record = { id, name, avatar, balance, connected, stats: { rounds, wagered, won, biggestWin } }
 */

const { GameError } = require('./errors');
const { formatChips } = require('./util');

/** When does a resolved bet deserve a line in the room feed? */
const NOTABLE = Object.freeze({
  net: 500, // net win of at least this many chips...
  multiple: 10, // ...or a payout of at least 10x the wager
  multipleMinNet: 50, // (ignoring pocket-change long shots)
  bigNet: 5000, // from here on it is announced as a big win
});

const FEED_KIND = /^[a-z]{1,16}$/;
const EVENT_NAME = /^[A-Za-z][\w:.-]{0,39}$/;
const FEED_TEXT_MAX = 200;

function isChipCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function publicPlayer(record) {
  return {
    id: record.id,
    name: record.name,
    avatar: record.avatar,
    balance: record.balance,
    connected: record.connected,
  };
}

function emptyStats() {
  return { rounds: 0, wagered: 0, won: 0, biggestWin: 0 };
}

/**
 * @param {object} options
 * @param {object} options.meta       the plugin meta (id and name are used in logs and feed lines)
 * @param {object} options.host       see the interface above
 * @param {object} options.clock      { now, setTimeout, clearTimeout }
 * @param {object} options.rng        { int, shuffle, pick, float }
 * @param {number} [options.timeScale] multiplier applied to after() / deadline()
 * @param {object} [options.log]      { error }
 * @returns {{ ctx: object, dispose: () => void }}
 */
function createContext({ meta, host, clock, rng, timeScale = 1, log = console }) {
  let disposed = false;
  const timers = new Set();
  const tag = `[${meta.id}]`;

  function scaled(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`ctx: duration must be a non-negative number of milliseconds (got ${ms})`);
    }
    return Math.round(ms * timeScale);
  }

  const ctx = {
    rng,

    seated() {
      return host.seated().map(publicPlayer);
    },

    player(id) {
      const record = host.find(id);
      return record ? publicPlayer(record) : null;
    },

    balance(id) {
      const record = host.find(id);
      return record ? record.balance : 0;
    },

    debit(id, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new RangeError(`ctx.debit: amount must be a positive integer (got ${amount})`);
      }
      const record = host.find(id);
      if (!record || record.balance < amount) return false;
      record.balance -= amount;
      host.touch();
      return true;
    },

    credit(id, amount) {
      if (!isChipCount(amount)) {
        throw new RangeError(`ctx.credit: amount must be a non-negative integer (got ${amount})`);
      }
      const record = host.find(id);
      if (!record) {
        log.error(`${tag} ctx.credit: unknown player "${id}", ${amount} chips dropped`);
        return;
      }
      if (amount === 0) return;
      if (!Number.isSafeInteger(record.balance + amount)) {
        throw new RangeError('ctx.credit: balance overflow');
      }
      record.balance += amount;
      host.touch();
    },

    sync() {
      if (!disposed) host.sync();
    },

    emit(name, payload, toPlayerId) {
      if (disposed) return;
      if (typeof name !== 'string' || !EVENT_NAME.test(name)) {
        throw new TypeError(`ctx.emit: invalid event name "${name}"`);
      }
      // Snapshot the payload now: the event must describe this instant even if
      // the plugin keeps mutating its state before the tick is flushed.
      const frozen = payload === undefined ? null : JSON.parse(JSON.stringify(payload));
      host.emit(name, frozen, toPlayerId === undefined || toPlayerId === null ? null : toPlayerId);
    },

    after(ms, fn) {
      if (typeof fn !== 'function') throw new TypeError('ctx.after(ms, fn): fn must be a function');
      const delay = scaled(ms);
      const timer = { handle: null, done: disposed };
      const controller = {
        cancel() {
          if (timer.done) return;
          timer.done = true;
          timers.delete(timer);
          clock.clearTimeout(timer.handle);
        },
      };
      if (disposed) return controller;
      timer.handle = clock.setTimeout(() => {
        if (timer.done) return;
        timer.done = true;
        timers.delete(timer);
        try {
          fn();
        } catch (err) {
          log.error(`${tag} timer callback failed:`, err);
        }
        // Safety net: whatever the timer changed reaches the clients even if
        // the plugin forgot to call ctx.sync().
        if (!disposed) host.sync();
      }, delay);
      timers.add(timer);
      return controller;
    },

    deadline(ms) {
      return clock.now() + scaled(ms);
    },

    now() {
      return clock.now();
    },

    report(playerId, result) {
      const wagered = result ? result.wagered : undefined;
      const won = result ? result.won : undefined;
      if (!isChipCount(wagered) || !isChipCount(won)) {
        log.error(`${tag} ctx.report: wagered and won must be non-negative integers`, result);
        return;
      }
      const record = host.find(playerId);
      if (!record) {
        log.error(`${tag} ctx.report: unknown player "${playerId}"`);
        return;
      }
      const stats = record.stats;
      const net = won - wagered;
      stats.rounds += 1;
      stats.wagered += wagered;
      stats.won += won;
      if (net > stats.biggestWin) stats.biggestWin = net;
      host.touch();
      if (typeof host.settled === 'function') host.settled(record, { wagered, won, net });

      const longShot = wagered > 0 && won >= wagered * NOTABLE.multiple && net >= NOTABLE.multipleMinNet;
      if (disposed || (net < NOTABLE.net && !longShot)) return;
      const big = net >= NOTABLE.bigNet;
      host.announce({
        kind: big ? 'bigwin' : 'win',
        text: big
          ? `¡${record.name} la rompió en ${meta.name}: +${formatChips(net)} fichas!`
          : `${record.name} ganó ${formatChips(net)} fichas en ${meta.name}`,
        playerId: record.id,
        amount: net,
      });
    },

    announce(text, options) {
      if (disposed) return;
      const opts = options || {};
      const kind = opts.kind === undefined ? 'info' : opts.kind;
      if (typeof text !== 'string' || text.trim() === '' || typeof kind !== 'string' || !FEED_KIND.test(kind)) {
        log.error(`${tag} ctx.announce: invalid text or kind`, text, kind);
        return;
      }
      host.announce({
        kind,
        text: text.trim().slice(0, FEED_TEXT_MAX),
        playerId: typeof opts.playerId === 'string' ? opts.playerId : null,
        amount: Number.isSafeInteger(opts.amount) ? opts.amount : null,
      });
    },

    error(message) {
      return new GameError(typeof message === 'string' && message ? message : 'Jugada inválida.');
    },
  };

  return {
    ctx: Object.freeze(ctx),
    /** Cancels every pending timer and silences sync / emit / announce. */
    dispose() {
      disposed = true;
      for (const timer of timers) {
        timer.done = true;
        clock.clearTimeout(timer.handle);
      }
      timers.clear();
    },
  };
}

module.exports = { createContext, publicPlayer, emptyStats, GameError, NOTABLE };
