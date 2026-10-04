'use strict';

/**
 * Room: one private club shared by a group of friends.
 *
 * A room owns its players (wallets, stats), the team goal, the activity feed,
 * the chat and one lazily created table per game. It knows nothing about
 * sockets: every member has a `conn` with a `send(object)` method (or null
 * while disconnected) that the Hub plugs in.
 *
 * Outbound traffic is coalesced: anything that changes the room calls
 * `touch()`, and one flush per tick sends, in this order,
 *   1. the room snapshot (only if it actually changed),
 *   2. per-viewer game views of tables that asked for a sync,
 *   3. one-shot table events emitted during the tick,
 *   4. a `celebrate` message when the team reached a new level.
 */

const { ClubError, GameError } = require('./errors');
const { createContext, emptyStats } = require('./context');
const { validateInstance } = require('./games');
const goal = require('./goal');
const { formatChips, chipsText } = require('./util');

// No I, L or O: they are the letters people confuse when reading a code aloud
// or copying it from a screenshot.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;
const CODE_PATTERN = /^[A-Z]{4}$/;
// Four random letters occasionally spell something nobody wants as an invite.
const CODE_BLOCKLIST = new Set([
  'PUTA', 'PUTE', 'CACA', 'CAGA', 'TETA', 'PAJA', 'PETE', 'MEAR', 'GAGA',
  'FUCK', 'SHAT', 'CUNT', 'DAMN', 'DUMB', 'ARSE', 'CRAP', 'WANK', 'TWAT', 'RAPE', 'KKKK',
]);

/**
 * @param {{ int: (min: number, max: number) => number }} rng
 * @param {(code: string) => boolean} isTaken
 * @returns {string|null} a free 4-letter code, or null if none was found
 */
function generateRoomCode(rng, isTaken) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[rng.int(0, CODE_ALPHABET.length)];
    if (!CODE_BLOCKLIST.has(code) && !isTaken(code)) return code;
  }
  return null;
}

/** Uppercases and trims what a user typed; returns null unless it looks like a room code. */
function normalizeRoomCode(value) {
  if (typeof value !== 'string' || value.length > 32) return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

class Room {
  /**
   * @param {object} options
   * @param {string} options.code
   * @param {{ games: Map<string, object>, list: object[] }} options.registry
   * @param {object} options.clock     see server/clock.js
   * @param {object} options.rng       see server/rng.js
   * @param {object} options.config    see server/config.js
   * @param {number} options.timeScale multiplier for game timers
   * @param {object} options.log       { info, warn, error }
   * @param {(room: Room) => void} [options.onDestroyed]
   * @param {(room: Room, playerId: string) => void} [options.onMemberDropped]
   *        called when a member is removed by the room itself (absent for too long)
   */
  constructor({ code, registry, clock, rng, config, timeScale, log, onDestroyed, onMemberDropped }) {
    this.code = code;
    this.registry = registry;
    this.clock = clock;
    this.rng = rng;
    this.config = config;
    this.timeScale = timeScale;
    this.log = log;
    this.onDestroyed = onDestroyed || (() => {});
    this.onMemberDropped = onMemberDropped || (() => {});

    /** @type {Map<string, any>} everybody who has ever been in the room, in join order */
    this.players = new Map();
    /** @type {Map<string, any>} gameId -> table (created on first sit) */
    this.tables = new Map();
    this.level = 0;
    this.archivedNet = 0; // balance - buyIns of records that were pruned
    this.feed = [];
    this.chat = [];
    this.feedSeq = 0;
    this.chatSeq = 0;
    this.createdAt = clock.now();
    this.destroyed = false;

    this._flushScheduled = false;
    this._flushing = false;
    this._lastBaseJson = null;
    this._idleTimer = null;
    this._refreshIdleTimer();
  }

  // ───────────────────────────── queries ─────────────────────────────

  /** Is this id a member currently in the room (connected or not)? */
  has(id) {
    const player = this.players.get(id);
    return Boolean(player && player.present);
  }

  presentCount() {
    let count = 0;
    for (const player of this.players.values()) if (player.present) count += 1;
    return count;
  }

  connectedCount() {
    let count = 0;
    for (const player of this.players.values()) if (player.present && player.connected) count += 1;
    return count;
  }

  /** Could this identity join right now? (already a member, or there is a free slot) */
  canJoin(id) {
    return this.has(id) || this.presentCount() < this.config.MAX_PLAYERS;
  }

  /** Chips a player has at risk across every table of the room. */
  stakeOf(id) {
    let total = 0;
    for (const table of this.tables.values()) total += this._tableStake(table, id);
    return total;
  }

  /** Team profit: sum(balance + stake) - sum(buyIns) over everybody who has ever been here. */
  profit() {
    let profit = this.archivedNet;
    for (const player of this.players.values()) {
      profit += player.balance + this.stakeOf(player.id) - player.buyIns;
    }
    return profit;
  }

  // ──────────────────────────── membership ────────────────────────────

  /**
   * Adds (or brings back) a member. A returning player gets the old wallet and
   * stats back; only a brand-new player receives the starting balance.
   * @param {{ id: string, name: string, avatar: number }} identity
   * @param {{ send: (message: object) => void }|null} conn
   */
  join(identity, conn) {
    let player = this.players.get(identity.id);
    if (player && player.present) {
      this.setConnection(player.id, conn);
      return player;
    }
    if (this.presentCount() >= this.config.MAX_PLAYERS) {
      throw new ClubError(`La sala está llena (máximo ${this.config.MAX_PLAYERS} jugadores).`, 'room_full');
    }
    const returning = Boolean(player);
    if (!player) {
      this._makeRoomForRecord();
      player = {
        id: identity.id,
        name: identity.name,
        avatar: identity.avatar,
        balance: this.config.START_BALANCE,
        buyIns: this.config.START_BALANCE,
        table: null,
        present: false,
        connected: false,
        conn: null,
        stats: emptyStats(),
        rescueAt: 0, // epoch ms from which the next rescue is allowed
        giftAt: 0,
        seatTimer: null,
        absentTimer: null,
        needsRoom: false,
      };
      this.players.set(player.id, player);
    }
    player.name = identity.name;
    player.avatar = identity.avatar;
    player.present = true;
    player.conn = conn || null;
    player.connected = Boolean(conn);
    player.needsRoom = true;
    this.addFeed('join', returning ? `${player.name} volvió a la sala` : `${player.name} se unió a la sala`, {
      playerId: player.id,
    });
    this._refreshIdleTimer();
    this.touch();
    return player;
  }

  /**
   * The member walks out. The record stays (chips still at stake are paid into
   * it, and the team profit keeps counting it), but the slot is freed.
   */
  leave(id) {
    const player = this.players.get(id);
    if (!player || !player.present) return false;
    if (player.table) this.stand(id);
    this._clearPlayerTimers(player);
    player.present = false;
    player.connected = false;
    player.conn = null;
    this.addFeed('leave', `${player.name} salió de la sala`, { playerId: id });
    this._refreshIdleTimer();
    this.touch();
    return true;
  }

  /** Plug (reconnect) or unplug (disconnect) the transport of a member. */
  setConnection(id, conn) {
    const player = this.players.get(id);
    if (!player || !player.present) return;
    player.conn = conn || null;
    player.connected = Boolean(conn);
    if (conn) {
      this._clearPlayerTimers(player);
    } else {
      if (player.table && !player.seatTimer) {
        player.seatTimer = this.clock.setTimeout(() => {
          player.seatTimer = null;
          if (!player.connected && player.table) this.stand(player.id);
        }, this.config.SEAT_TIMEOUT_MS);
      }
      if (!player.absentTimer) {
        player.absentTimer = this.clock.setTimeout(() => {
          player.absentTimer = null;
          if (player.connected || !player.present) return;
          this.leave(player.id);
          this.onMemberDropped(this, player.id);
        }, this.config.ABSENT_TIMEOUT_MS);
      }
    }
    this._refreshIdleTimer();
    this.touch();
  }

  setProfile(id, name, avatar) {
    const player = this.players.get(id);
    if (!player || !player.present) return;
    if (player.name === name && player.avatar === avatar) return;
    player.name = name;
    player.avatar = avatar;
    for (const table of this.tables.values()) {
      if (table.seated.length > 0) table.dirty = true; // views usually carry names
    }
    this.touch();
  }

  // ────────────────────────────── tables ──────────────────────────────

  /** Sit at a game table (standing up from the previous one, if any). */
  sit(id, gameId) {
    const player = this._member(id);
    const plugin = typeof gameId === 'string' ? this.registry.games.get(gameId) : undefined;
    if (!plugin) throw new ClubError('Ese juego no existe.', 'unknown_game');
    if (player.table === gameId) {
      this.pushView(id); // already there: just show the table again
      return;
    }
    if (player.table) this.stand(id);

    const table = this._ensureTable(plugin);
    // The player is already part of ctx.seated() when onSit runs.
    table.seated.push(id);
    player.table = table.id;
    try {
      table.instance.onSit(id);
    } catch (err) {
      const index = table.seated.indexOf(id);
      if (index !== -1) table.seated.splice(index, 1);
      player.table = null;
      table.dirty = true;
      this.touch();
      if (err instanceof GameError) throw err;
      this.log.error(`[${table.id}] onSit failed:`, err);
      throw new ClubError('No pudimos sentarte en esa mesa. Probá de nuevo.', 'internal');
    }
    table.dirty = true;
    this.touch();
  }

  /** Stand up. Chips still at stake stay on the table and resolve normally. */
  stand(id) {
    const player = this.players.get(id);
    if (!player || !player.table) return false;
    const table = this.tables.get(player.table);
    player.table = null;
    if (player.seatTimer) {
      this.clock.clearTimeout(player.seatTimer);
      player.seatTimer = null;
    }
    if (table) {
      // The player is no longer part of ctx.seated() when onLeave runs.
      const index = table.seated.indexOf(id);
      if (index !== -1) table.seated.splice(index, 1);
      try {
        table.instance.onLeave(id);
      } catch (err) {
        this.log.error(`[${table.id}] onLeave failed:`, err);
      }
      table.dirty = true;
    }
    this.touch();
    return true;
  }

  /** Route an untrusted client action to the table where the player is seated. */
  action(id, action) {
    const player = this._member(id);
    const table = player.table ? this.tables.get(player.table) : null;
    if (!table) throw new ClubError('No estás sentado en ninguna mesa.', 'not_seated');
    try {
      table.instance.onAction(id, action);
    } catch (err) {
      if (err instanceof GameError) throw err;
      this.log.error(`[${table.id}] onAction failed:`, err);
      table.dirty = true;
      this.touch();
      throw new ClubError('Algo salió mal en la mesa. Probá de nuevo.', 'internal');
    }
    table.dirty = true;
    this.touch();
  }

  /** Send the current view of the player's table to that player right now. */
  pushView(id) {
    const player = this.players.get(id);
    if (!player || !player.table) return;
    const table = this.tables.get(player.table);
    if (table) this._sendView(table, player);
  }

  // ────────────────────────────── social ──────────────────────────────

  /** `text` must already be sanitised (see util.sanitizeChat). */
  say(id, text) {
    const player = this._member(id);
    const msg = {
      id: (this.chatSeq += 1),
      from: player.id,
      name: player.name,
      avatar: player.avatar,
      text,
      ts: this.clock.now(),
    };
    this.chat.push(msg);
    if (this.chat.length > this.config.CHAT_MAX) this.chat.splice(0, this.chat.length - this.config.CHAT_MAX);
    this._broadcast({ t: 'chat', msg });
    return msg;
  }

  /** Move chips from one member to another. Pure transfer: the team profit is unaffected. */
  gift(fromId, toId, amount) {
    const from = this._member(fromId);
    const to = typeof toId === 'string' ? this.players.get(toId) : undefined;
    if (!to || !to.present) throw new ClubError('Ese jugador no está en la sala.', 'bad_target');
    if (to === from) throw new ClubError('No podés regalarte fichas a vos mismo.', 'bad_target');
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new ClubError('El regalo tiene que ser una cantidad entera de fichas.', 'bad_amount');
    }
    if (amount > from.balance) throw new ClubError('No tenés tantas fichas para regalar.', 'insufficient');
    const now = this.clock.now();
    if (now < from.giftAt) throw new ClubError('Esperá un momento antes de regalar de nuevo.', 'gift_cooldown');
    from.giftAt = now + this.config.GIFT_COOLDOWN_MS;
    from.balance -= amount;
    to.balance += amount;
    this.addFeed('gift', `${from.name} le regaló ${chipsText(amount)} a ${to.name}`, {
      playerId: from.id,
      targetId: to.id,
      amount,
    });
    this.touch();
  }

  /** "Rescate": a broke player gets a fresh stack, booked as a buy-in. */
  rescue(id) {
    const player = this._member(id);
    const { RESCUE_AMOUNT, RESCUE_THRESHOLD, RESCUE_COOLDOWN_MS } = this.config;
    if (player.balance + this.stakeOf(id) >= RESCUE_THRESHOLD) {
      throw new ClubError(
        `El rescate es para cuando te quedás con menos de ${RESCUE_THRESHOLD} fichas.`,
        'rescue_not_needed'
      );
    }
    const now = this.clock.now();
    if (now < player.rescueAt) {
      const seconds = Math.ceil((player.rescueAt - now) / 1000);
      throw new ClubError(`Esperá ${seconds} s para pedir otro rescate.`, 'rescue_cooldown');
    }
    player.rescueAt = now + RESCUE_COOLDOWN_MS;
    player.balance += RESCUE_AMOUNT;
    player.buyIns += RESCUE_AMOUNT;
    this.addFeed('rescue', `${player.name} pidió un rescate: +${formatChips(RESCUE_AMOUNT)} fichas`, {
      playerId: id,
      amount: RESCUE_AMOUNT,
    });
    this.touch();
  }

  /** Append a line to the activity feed (last FEED_MAX entries are kept, oldest first). */
  addFeed(kind, text, extra) {
    const more = extra || {};
    const entry = {
      id: (this.feedSeq += 1),
      ts: this.clock.now(),
      kind,
      text,
      playerId: more.playerId === undefined ? null : more.playerId,
      amount: Number.isSafeInteger(more.amount) ? more.amount : null,
      targetId: more.targetId === undefined ? null : more.targetId,
    };
    this.feed.push(entry);
    if (this.feed.length > this.config.FEED_MAX) this.feed.splice(0, this.feed.length - this.config.FEED_MAX);
    this.touch();
    return entry;
  }

  // ────────────────────────────── output ──────────────────────────────

  /** Full snapshot as seen by one member (see docs/GAME_API.md, "Room snapshot"). */
  snapshot(viewerId) {
    const stakes = this._stakeMap();
    const base = this._base(stakes, this._profitFrom(stakes));
    return this._personal(base, this.players.get(viewerId) || { id: viewerId, rescueAt: 0 });
  }

  /** Make sure this member receives a room snapshot on the next flush, changed or not. */
  resend(id) {
    const player = this.players.get(id);
    if (!player) return;
    player.needsRoom = true;
    this.touch();
  }

  /** Something changed: schedule one flush for the end of the current tick. */
  touch() {
    // Changes made by the flush itself (level-up bonus) are part of that flush.
    if (this._flushScheduled || this._flushing || this.destroyed) return;
    this._flushScheduled = true;
    this.clock.defer(() => this.flush());
  }

  flush() {
    this._flushScheduled = false;
    if (this.destroyed) return;

    const stakes = this._stakeMap();
    const profit = this._profitFrom(stakes);
    this._flushing = true;
    let celebration = null;
    try {
      celebration = this._levelUp(profit);
    } finally {
      this._flushing = false;
    }

    // 1. Room snapshot, skipped when nothing in it changed.
    const base = this._base(stakes, profit);
    const json = JSON.stringify(base);
    const changed = json !== this._lastBaseJson;
    this._lastBaseJson = json;
    for (const player of this.players.values()) {
      if (!player.present) continue;
      if (player.conn && (changed || player.needsRoom)) {
        player.conn.send({ t: 'room', room: this._personal(base, player) });
      }
      player.needsRoom = false;
    }

    // 2 + 3. Table views, then the events of this tick.
    for (const table of this.tables.values()) {
      if (table.dirty) {
        table.dirty = false;
        for (const id of table.seated) this._sendView(table, this.players.get(id));
      }
      if (table.outbox.length > 0) {
        const events = table.outbox;
        table.outbox = [];
        for (const event of events) {
          for (const id of table.seated) {
            if (event.to !== null && event.to !== id) continue;
            const player = this.players.get(id);
            if (player && player.conn) {
              player.conn.send({ t: 'event', game: table.id, name: event.name, payload: event.payload });
            }
          }
        }
      }
    }

    // 4. Team celebration.
    if (celebration) this._broadcast(celebration);
  }

  /** Tear everything down: timers, tables, game instances. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._idleTimer) {
      this.clock.clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    for (const player of this.players.values()) this._clearPlayerTimers(player);
    for (const table of this.tables.values()) {
      table.context.dispose();
      if (typeof table.instance.dispose === 'function') {
        try {
          table.instance.dispose();
        } catch (err) {
          this.log.error(`[${table.id}] dispose failed:`, err);
        }
      }
    }
    this.tables.clear();
    this.onDestroyed(this);
  }

  // ───────────────────────────── internals ─────────────────────────────

  _member(id) {
    const player = this.players.get(id);
    if (!player || !player.present) throw new ClubError('No estás en esta sala.', 'not_in_room');
    return player;
  }

  _clearPlayerTimers(player) {
    if (player.seatTimer) {
      this.clock.clearTimeout(player.seatTimer);
      player.seatTimer = null;
    }
    if (player.absentTimer) {
      this.clock.clearTimeout(player.absentTimer);
      player.absentTimer = null;
    }
  }

  /** A room nobody is connected to is destroyed after ROOM_TTL_MS. */
  _refreshIdleTimer() {
    if (this.destroyed) return;
    if (this.connectedCount() > 0) {
      if (this._idleTimer) {
        this.clock.clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      return;
    }
    if (!this._idleTimer) {
      this._idleTimer = this.clock.setTimeout(() => {
        this._idleTimer = null;
        if (this.connectedCount() === 0) this.destroy();
      }, this.config.ROOM_TTL_MS);
    }
  }

  /**
   * Records are kept after a player leaves so late payouts have somewhere to
   * land. To keep a long-lived room bounded, the oldest departed records with
   * nothing at stake are folded into `archivedNet` (the team profit is unchanged).
   */
  _makeRoomForRecord() {
    if (this.players.size < this.config.MAX_RECORDS) return;
    for (const [id, player] of this.players) {
      if (player.present || this.stakeOf(id) > 0) continue;
      this.archivedNet += player.balance - player.buyIns;
      this.players.delete(id);
      if (this.players.size < this.config.MAX_RECORDS) return;
    }
    throw new ClubError('Esta sala ya recibió demasiados invitados. Creá una nueva.', 'room_full');
  }

  _ensureTable(plugin) {
    const id = plugin.meta.id;
    const existing = this.tables.get(id);
    if (existing) return existing;

    const table = { id, meta: plugin.meta, seated: [], dirty: false, outbox: [], context: null, instance: null };
    const host = {
      seated: () => table.seated.map((playerId) => this.players.get(playerId)).filter(Boolean),
      find: (playerId) => this.players.get(playerId) || null,
      touch: () => this.touch(),
      sync: () => {
        table.dirty = true;
        this.touch();
      },
      emit: (name, payload, to) => {
        table.outbox.push({ name, payload, to });
        this.touch();
      },
      announce: (entry) => {
        this.addFeed(entry.kind, entry.text, { playerId: entry.playerId, amount: entry.amount });
      },
    };
    table.context = createContext({
      meta: plugin.meta,
      host,
      clock: this.clock,
      rng: this.rng,
      timeScale: this.timeScale,
      log: this.log,
    });
    try {
      table.instance = plugin.create(table.context.ctx);
      validateInstance(table.instance, id);
    } catch (err) {
      table.context.dispose();
      this.log.error(`[${id}] create(ctx) failed:`, err);
      throw new ClubError('No pudimos abrir esa mesa. Probá de nuevo más tarde.', 'internal');
    }
    this.tables.set(id, table);
    return table;
  }

  /** stakeOf() of one table, distrusting the plugin: never throws, always a non-negative integer. */
  _tableStake(table, id) {
    try {
      const stake = table.instance.stakeOf(id);
      if (Number.isSafeInteger(stake) && stake > 0) return stake;
      if (stake !== 0 && stake !== undefined && stake !== null) {
        this.log.error(`[${table.id}] stakeOf("${id}") returned ${stake}; expected a non-negative integer`);
      }
    } catch (err) {
      this.log.error(`[${table.id}] stakeOf failed:`, err);
    }
    return 0;
  }

  _stakeMap() {
    const stakes = new Map();
    if (this.tables.size === 0) return stakes;
    for (const id of this.players.keys()) {
      let total = 0;
      for (const table of this.tables.values()) total += this._tableStake(table, id);
      if (total > 0) stakes.set(id, total);
    }
    return stakes;
  }

  _profitFrom(stakes) {
    let profit = this.archivedNet;
    for (const player of this.players.values()) {
      profit += player.balance + (stakes.get(player.id) || 0) - player.buyIns;
    }
    return profit;
  }

  /**
   * Levels never go back down. On level-up every member receives a bonus that
   * is added to the balance AND to the buy-ins, so the profit does not move.
   * @returns {object|null} the `celebrate` message to broadcast, if any
   */
  _levelUp(profit) {
    const reached = goal.levelFor(profit, this.level);
    if (reached <= this.level) return null;
    let bonus = 0;
    for (let level = this.level + 1; level <= reached; level += 1) {
      const levelBonus = goal.bonusFor(level);
      bonus += levelBonus;
      this.addFeed(
        'level',
        `¡Nivel ${level}: ${goal.titleFor(level)}! Bono de ${formatChips(levelBonus)} fichas para cada uno`,
        { amount: levelBonus }
      );
    }
    for (const player of this.players.values()) {
      if (!player.present) continue;
      player.balance += bonus;
      player.buyIns += bonus;
    }
    this.level = reached;
    return { t: 'celebrate', kind: 'level', level: reached, title: goal.titleFor(reached), bonus, profit };
  }

  /** The part of the snapshot that is identical for every viewer. */
  _base(stakes, profit) {
    const players = [];
    for (const player of this.players.values()) {
      if (!player.present) continue;
      players.push({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        balance: player.balance,
        stake: stakes.get(player.id) || 0,
        table: player.table,
        connected: player.connected,
        stats: { ...player.stats },
      });
    }
    const tables = {};
    for (const meta of this.registry.list) {
      const table = this.tables.get(meta.id);
      tables[meta.id] = { seated: table ? table.seated.slice() : [] };
    }
    return {
      code: this.code,
      players,
      tables,
      goal: goal.goalView(this.level, profit),
      feed: this.feed,
      chat: this.chat,
    };
  }

  _personal(base, viewer) {
    return {
      code: base.code,
      you: viewer.id,
      players: base.players,
      tables: base.tables,
      goal: base.goal,
      feed: base.feed,
      chat: base.chat,
      rescue: {
        amount: this.config.RESCUE_AMOUNT,
        threshold: this.config.RESCUE_THRESHOLD,
        cooldownMs: this.config.RESCUE_COOLDOWN_MS,
        availableAt: viewer.rescueAt || 0,
      },
    };
  }

  _sendView(table, player) {
    if (!player || !player.conn) return;
    let state;
    try {
      state = table.instance.view(player.id);
    } catch (err) {
      this.log.error(`[${table.id}] view failed:`, err);
      return;
    }
    player.conn.send({ t: 'game', game: table.id, state: state === undefined ? null : state });
  }

  _broadcast(message) {
    for (const player of this.players.values()) {
      if (player.present && player.conn) player.conn.send(message);
    }
  }
}

module.exports = { Room, generateRoomCode, normalizeRoomCode, CODE_ALPHABET, CODE_BLOCKLIST };
