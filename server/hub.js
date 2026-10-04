'use strict';

/**
 * Hub: identities, rooms and the wire protocol.
 *
 * The hub is transport-agnostic. `server/index.js` feeds it websocket frames;
 * the unit tests feed it strings through fake transports and a manual clock.
 *
 *   const conn = hub.connect({ send(text), close(code, reason) });
 *   conn.receive(data, isBinary);   // every inbound frame
 *   conn.disconnect();              // the transport went away
 *
 * Everything a client sends is untrusted: each handler validates types and
 * ranges before touching any state, a per-connection token bucket limits the
 * message rate, and no inbound message can throw out of `receive()`.
 */

const crypto = require('node:crypto');

const { ClubError } = require('./errors');
const { resolveConfig, resolveTimeScale } = require('./config');
const { realClock } = require('./clock');
const cryptoRng = require('./rng');
const { loadGames } = require('./games');
const { Room, generateRoomCode, normalizeRoomCode } = require('./rooms');
const { sanitizeName, sanitizeChat, newToken, newPlayerId, isPlainObject, TOKEN_PATTERN } = require('./util');
const saves = require('./saves');
const economy = require('./economy');
const { createProfile, restoreProfile, sanitizeLook, persistView } = require('./profile');

const DEFAULT_NAME = 'Invitado';
const ACTION_TYPE_MAX = 40;
const SWEEP_EVERY_MS = 60_000;

/** WebSocket close codes used by the server. */
const CLOSE = Object.freeze({
  REPLACED: 4001, // the same identity connected from another tab / device
  FLOOD: 1008, // rate limit abuse
});

const consoleLog = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

class Connection {
  constructor(hub, transport) {
    this.hub = hub;
    this.transport = transport;
    this.session = null;
    this.open = true;
    // Token bucket (see Hub._allow)
    this.tokens = hub.config.RATE_BURST;
    this.strikes = 0;
    this.refilledAt = hub.clock.now();
    this.noticedAt = -Infinity;
  }

  /** Serialise and send one protocol message. Never throws. */
  send(message) {
    if (!this.open) return;
    let data;
    try {
      data = JSON.stringify(message);
    } catch (err) {
      this.hub.log.error('[hub] dropped a message that is not JSON-serialisable:', err);
      return;
    }
    try {
      this.transport.send(data);
    } catch (err) {
      this.hub.log.warn('[hub] send failed:', err && err.message);
    }
  }

  sendError(message, code) {
    this.send({ t: 'error', message, code });
  }

  /** One inbound frame from the transport. Never throws. */
  receive(data, isBinary) {
    if (!this.open) return;
    try {
      this.hub._receive(this, data, isBinary);
    } catch (err) {
      this.hub.log.error('[hub] unexpected failure while handling a message:', err);
      this.sendError('Algo salió mal. Probá de nuevo.', 'internal');
    }
  }

  /** Close from the server side (the transport still reports the disconnect afterwards). */
  close(code, reason) {
    if (!this.open) return;
    this.open = false;
    try {
      this.transport.close(code, reason);
    } catch (err) {
      this.hub.log.warn('[hub] close failed:', err && err.message);
    }
  }

  /** The transport is gone. */
  disconnect() {
    this.open = false;
    this.hub._detach(this);
  }
}

class Hub {
  /**
   * @param {object} [options]
   * @param {object} [options.config]    partial overrides of server/config.js
   * @param {number} [options.timeScale] game timer multiplier (default: env CASINO_TIME_SCALE or 1)
   * @param {object} [options.clock]     see server/clock.js
   * @param {object} [options.rng]       rng handed to games (default: crypto-backed server/rng.js)
   * @param {object} [options.registry]  result of loadGames() (default: server/games)
   * @param {object} [options.log]       { info, warn, error }
   */
  constructor(options = {}) {
    this.config = resolveConfig(options.config);
    this.timeScale = resolveTimeScale(options.timeScale);
    this.clock = options.clock || realClock;
    this.rng = options.rng || cryptoRng;
    this.log = options.log || consoleLog;
    this.registry = options.registry || loadGames(undefined, this.log);

    /** @type {Map<string, any>} secret token -> session */
    this.sessions = new Map();
    /** @type {Map<string, any>} public player id -> session */
    this.sessionsById = new Map();
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Set<Connection>} */
    this.connections = new Set();
    this._sweptAt = this.clock.now();
    this._closed = false;
  }

  /** Register a new transport. */
  connect(transport) {
    const conn = new Connection(this, transport);
    this.connections.add(conn);
    return conn;
  }

  stats() {
    let connected = 0;
    for (const conn of this.connections) if (conn.session) connected += 1;
    return { rooms: this.rooms.size, players: connected, connections: this.connections.size };
  }

  /** Destroy every room (cancelling all timers). The hub is unusable afterwards. */
  close() {
    this._closed = true;
    for (const session of this.sessions.values()) this._cancelSave(session);
    for (const room of [...this.rooms.values()]) room.destroy();
    this.rooms.clear();
    this.sessions.clear();
    this.sessionsById.clear();
    this.connections.clear();
  }

  // ───────────────────────────── inbound ─────────────────────────────

  _receive(conn, data, isBinary) {
    if (this._closed || !this._allow(conn)) return;
    if (isBinary) {
      conn.sendError('Mensaje inválido.', 'bad_message');
      return;
    }

    let text;
    if (typeof data === 'string') text = data;
    else if (Buffer.isBuffer(data)) text = data.toString('utf8');
    else if (Array.isArray(data)) text = Buffer.concat(data).toString('utf8');
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString('utf8');
    else text = '';
    if (text.length === 0 || text.length > this.config.MAX_PAYLOAD) {
      conn.sendError('Mensaje inválido.', 'bad_message');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      conn.sendError('Mensaje inválido.', 'bad_message');
      return;
    }
    if (!isPlainObject(msg) || typeof msg.t !== 'string') {
      conn.sendError('Mensaje inválido.', 'bad_message');
      return;
    }

    const handler = HANDLERS.get(msg.t);
    if (!handler) {
      conn.sendError('Mensaje desconocido.', 'unknown_message');
      return;
    }
    if (!conn.session && msg.t !== 'hello' && msg.t !== 'ping') {
      conn.sendError('La conexión todavía no se inició.', 'hello_required');
      return;
    }

    try {
      handler.call(this, conn, msg, conn.session);
    } catch (err) {
      if (err instanceof ClubError) {
        conn.sendError(err.message, err.code);
        return;
      }
      this.log.error(`[hub] handler "${msg.t}" failed:`, err);
      conn.sendError('Algo salió mal. Probá de nuevo.', 'internal');
    }
  }

  /**
   * Token bucket: RATE_BURST messages at once, RATE_PER_SECOND sustained.
   * Excess messages are dropped (with at most one notice per second); a client
   * that keeps flooding accumulates strikes and gets disconnected.
   */
  _allow(conn) {
    const { RATE_BURST, RATE_PER_SECOND, RATE_KICK_STRIKES } = this.config;
    const now = this.clock.now();
    const refill = (Math.max(0, now - conn.refilledAt) / 1000) * RATE_PER_SECOND;
    conn.refilledAt = now;
    conn.tokens = Math.min(RATE_BURST, conn.tokens + refill);
    conn.strikes = Math.max(0, conn.strikes - refill);
    if (conn.tokens >= 1) {
      conn.tokens -= 1;
      return true;
    }
    conn.strikes += 1;
    if (conn.strikes >= RATE_KICK_STRIKES) {
      conn.sendError('Demasiados mensajes. Te desconectamos.', 'rate_limited');
      conn.close(CLOSE.FLOOD, 'rate limit');
      return false;
    }
    if (now - conn.noticedAt >= 1000) {
      conn.noticedAt = now;
      conn.sendError('Vas demasiado rápido. Esperá un segundo.', 'rate_limited');
    }
    return false;
  }

  _detach(conn) {
    this.connections.delete(conn);
    const session = conn.session;
    if (!session) return;
    conn.session = null;
    if (session.conn !== conn) return;
    session.conn = null;
    session.seenAt = this.clock.now();
    const room = this._roomOf(session);
    if (room) room.setConnection(session.id, null);
  }

  // ───────────────────────────── sessions ─────────────────────────────

  /** @param {object} [profile] a profile restored from a save; a fresh one is created otherwise */
  _createSession(profile) {
    let token = newToken();
    while (this.sessions.has(token)) token = newToken();
    let id = profile ? profile.id : newPlayerId();
    while (!profile && this.sessionsById.has(id)) id = newPlayerId();
    const avatar = profile ? profile.avatar : crypto.randomInt(0, this.config.AVATARS);
    const session = {
      token,
      id,
      name: profile ? profile.name : DEFAULT_NAME,
      avatar,
      profile: profile || createProfile({ id, name: DEFAULT_NAME, avatar, balance: this.config.START_BALANCE }),
      roomCode: null,
      conn: null,
      seenAt: this.clock.now(),
      chatTimes: [],
      saveTimer: null,
      savedJson: null,
    };
    this.sessions.set(token, session);
    this.sessionsById.set(id, session);
    return session;
  }

  // ───────────────────────────── saves ─────────────────────────────

  /** The signed save of a session as of right now (chips at stake count as returned). */
  _packSave(session) {
    const room = this._roomOf(session);
    const view = persistView(session.profile, room ? room.stakeOf(session.id) : 0);
    session.savedJson = JSON.stringify(view);
    session.profile.seq += 1;
    return saves.pack({ ...view, seq: session.profile.seq });
  }

  /** Send the save if the profile changed since the last one. */
  _sendSave(session) {
    if (!session.conn) return;
    const room = this._roomOf(session);
    const json = JSON.stringify(persistView(session.profile, room ? room.stakeOf(session.id) : 0));
    if (json === session.savedJson) return;
    session.conn.send({ t: 'save', save: this._packSave(session) });
  }

  /** Coalesce saves: at most one per SAVE_INTERVAL_MS and session. */
  _scheduleSave(session) {
    const interval = this.config.SAVE_INTERVAL_MS;
    if (!interval || session.saveTimer || this._closed) return;
    session.saveTimer = this.clock.setTimeout(() => {
      session.saveTimer = null;
      this._sendSave(session);
    }, interval);
    if (session.saveTimer && typeof session.saveTimer.unref === 'function') session.saveTimer.unref();
  }

  _cancelSave(session) {
    if (!session.saveTimer) return;
    this.clock.clearTimeout(session.saveTimer);
    session.saveTimer = null;
  }

  /** What a player sees of the own profile outside a room. */
  _profileView(session) {
    const profile = session.profile;
    const level = economy.levelFor(profile.stats.wagered);
    return {
      balance: profile.balance,
      peak: profile.peak,
      debt: profile.debt,
      level,
      rank: economy.rankFor(level),
      title: profile.title ? (economy.ITEMS.get(profile.title) || {}).name || null : null,
      look: profile.look,
      owned: profile.owned,
      theme: profile.theme,
      stats: { ...profile.stats },
    };
  }

  _identity(session) {
    return { id: session.id, name: session.name, avatar: session.avatar, profile: session.profile };
  }

  /** Forget identities that are offline, in no live room and idle for SESSION_TTL_MS. */
  _sweepSessions() {
    const now = this.clock.now();
    if (now - this._sweptAt < SWEEP_EVERY_MS) return;
    this._sweptAt = now;
    for (const session of [...this.sessions.values()]) {
      if (session.conn || this._roomOf(session)) continue;
      if (now - session.seenAt < this.config.SESSION_TTL_MS) continue;
      this._cancelSave(session);
      this.sessions.delete(session.token);
      this.sessionsById.delete(session.id);
    }
  }

  _isAvatar(value) {
    return Number.isInteger(value) && value >= 0 && value < this.config.AVATARS;
  }

  _you(session) {
    return { id: session.id, name: session.name, avatar: session.avatar };
  }

  /** The live room this session belongs to, healing stale references. */
  _roomOf(session) {
    if (!session.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    if (!room || !room.has(session.id)) {
      session.roomCode = null;
      return null;
    }
    return room;
  }

  _requireRoom(session) {
    const room = this._roomOf(session);
    if (!room) throw new ClubError('No estás en ninguna sala.', 'not_in_room');
    return room;
  }

  _openRoom() {
    if (this.rooms.size >= this.config.MAX_ROOMS) {
      throw new ClubError('El club está completo en este momento. Probá de nuevo en unos minutos.', 'club_full');
    }
    const code = generateRoomCode(cryptoRng, (candidate) => this.rooms.has(candidate));
    if (!code) throw new ClubError('No pudimos crear la sala. Probá de nuevo.', 'internal');
    const room = new Room({
      code,
      registry: this.registry,
      clock: this.clock,
      rng: this.rng,
      config: this.config,
      timeScale: this.timeScale,
      log: this.log,
      onDestroyed: (destroyed) => {
        if (this.rooms.get(destroyed.code) === destroyed) this.rooms.delete(destroyed.code);
        for (const id of destroyed.players.keys()) {
          const session = this.sessionsById.get(id);
          if (session && session.roomCode === destroyed.code) {
            session.roomCode = null;
            session.seenAt = this.clock.now();
          }
        }
      },
      onFlushed: (flushed) => {
        for (const [id, player] of flushed.players) {
          if (!player.present || !player.conn) continue;
          const session = this.sessionsById.get(id);
          if (session) this._scheduleSave(session);
        }
      },
      onMemberDropped: (from, id) => {
        const session = this.sessionsById.get(id);
        if (session && session.roomCode === from.code) {
          session.roomCode = null;
          session.seenAt = this.clock.now();
        }
      },
    });
    this.rooms.set(code, room);
    return room;
  }

  // ───────────────────────────── handlers ─────────────────────────────
  // Signature: (conn, msg, session). `session` is null only for hello / ping.

  _hello(conn, msg) {
    if (conn.session) throw new ClubError('La sesión ya está iniciada.', 'already_hello');
    this._sweepSessions();

    let session = null;
    if (typeof msg.token === 'string' && TOKEN_PATTERN.test(msg.token)) {
      session = this.sessions.get(msg.token) || null;
    }
    if (!session && typeof msg.save === 'string') {
      const profile = restoreProfile(saves.unpack(msg.save), this.config);
      // The same identity may still be alive in memory (another tab, a lost token): memory wins over the save.
      if (profile) session = this.sessionsById.get(profile.id) || this._createSession(profile);
    }
    if (session) {
      const previous = session.conn;
      if (previous && previous !== conn) {
        // Same identity opened somewhere else: the newest connection wins.
        previous.session = null;
        previous.sendError('Abriste el club en otra pestaña o dispositivo. Esta conexión se cerró.', 'replaced');
        previous.close(CLOSE.REPLACED, 'replaced');
        this.connections.delete(previous);
      }
    } else {
      session = this._createSession();
    }

    const name = sanitizeName(msg.name, this.config.NAME_MAX_LENGTH);
    if (name) session.name = name;
    if (this._isAvatar(msg.avatar)) session.avatar = msg.avatar;
    session.profile.name = session.name;
    session.profile.avatar = session.avatar;
    session.conn = conn;
    session.seenAt = this.clock.now();
    conn.session = session;

    const room = this._roomOf(session);
    if (room) {
      room.setProfile(session.id, session.name, session.avatar);
      room.setConnection(session.id, conn);
    }
    conn.send({
      t: 'welcome',
      you: this._you(session),
      token: session.token,
      serverNow: this.clock.now(),
      games: this.registry.list,
      catalog: economy.catalogView(),
      profile: this._profileView(session),
      save: this._packSave(session),
      room: room ? room.snapshot(session.id) : null,
    });
    if (room) room.pushView(session.id);
  }

  _profile(conn, msg, session) {
    const hasName = msg.name !== undefined;
    const hasAvatar = msg.avatar !== undefined;
    if (!hasName && !hasAvatar) throw new ClubError('Faltan los datos del perfil.', 'bad_profile');
    let { name, avatar } = session;
    if (hasName) {
      name = sanitizeName(msg.name, this.config.NAME_MAX_LENGTH);
      if (!name) {
        throw new ClubError(`Elegí un nombre de 1 a ${this.config.NAME_MAX_LENGTH} caracteres.`, 'bad_name');
      }
    }
    if (hasAvatar) {
      if (!this._isAvatar(msg.avatar)) throw new ClubError('Elegí uno de los avatares disponibles.', 'bad_avatar');
      avatar = msg.avatar;
    }
    session.name = name;
    session.avatar = avatar;
    session.profile.name = name;
    session.profile.avatar = avatar;
    const room = this._roomOf(session);
    if (room) room.setProfile(session.id, name, avatar);
    conn.send({ t: 'you', you: this._you(session), profile: this._profileView(session) });
    this._scheduleSave(session);
  }

  _createRoom(conn, msg, session) {
    const current = this._roomOf(session);
    if (current) {
      current.resend(session.id); // double click on "Crear sala": answer with the room you are in
      return;
    }
    const room = this._openRoom();
    try {
      room.join(this._identity(session), conn);
    } catch (err) {
      room.destroy();
      throw err;
    }
    session.roomCode = room.code;
  }

  _joinRoom(conn, msg, session) {
    const code = normalizeRoomCode(msg.code);
    if (!code) throw new ClubError('El código de sala son 4 letras.', 'bad_code');
    const room = this.rooms.get(code);
    if (!room) throw new ClubError('No encontramos esa sala. Revisá el código.', 'room_not_found');
    const current = this._roomOf(session);
    if (current === room) {
      room.resend(session.id);
      return;
    }
    if (!room.canJoin(session.id)) {
      throw new ClubError(`La sala está llena (máximo ${this.config.MAX_PLAYERS} jugadores).`, 'room_full');
    }
    if (current) {
      // Following an invite while sitting in another room: switch rooms.
      current.leave(session.id);
      session.roomCode = null;
      conn.send({ t: 'left' });
    }
    room.join(this._identity(session), conn);
    session.roomCode = room.code;
  }

  _leaveRoom(conn, msg, session) {
    const room = this._roomOf(session);
    if (room) room.leave(session.id);
    session.roomCode = null;
    session.seenAt = this.clock.now();
    conn.send({ t: 'left' });
  }

  _sit(conn, msg, session) {
    const room = this._requireRoom(session);
    if (typeof msg.game !== 'string') throw new ClubError('Ese juego no existe.', 'unknown_game');
    room.sit(session.id, msg.game);
  }

  _stand(conn, msg, session) {
    this._requireRoom(session).stand(session.id);
  }

  _action(conn, msg, session) {
    const room = this._requireRoom(session);
    const action = msg.action;
    if (
      !isPlainObject(action) ||
      typeof action.type !== 'string' ||
      action.type.length === 0 ||
      action.type.length > ACTION_TYPE_MAX
    ) {
      throw new ClubError('Jugada inválida.', 'bad_action');
    }
    // The sender's identity comes from the connection, never from the payload.
    room.action(session.id, action);
  }

  _chat(conn, msg, session) {
    const room = this._requireRoom(session);
    const text = sanitizeChat(msg.text, this.config.CHAT_MAX_LENGTH);
    if (text === null) {
      throw new ClubError(`Los mensajes tienen entre 1 y ${this.config.CHAT_MAX_LENGTH} caracteres.`, 'bad_chat');
    }
    const now = this.clock.now();
    session.chatTimes = session.chatTimes.filter((at) => now - at < this.config.CHAT_WINDOW_MS);
    if (session.chatTimes.length >= this.config.CHAT_BURST) {
      throw new ClubError('Estás escribiendo muy rápido. Esperá un momento.', 'chat_rate');
    }
    session.chatTimes.push(now);
    room.say(session.id, text);
  }

  _gift(conn, msg, session) {
    this._requireRoom(session).gift(session.id, msg.to, msg.amount);
  }

  _rescue(conn, msg, session) {
    const room = this._requireRoom(session);
    if (!this.config.RESCUE_MINIGAME) {
      room.rescue(session.id);
      return;
    }
    if (msg.answer === undefined) {
      conn.send({ t: 'rescueChallenge', ...room.rescueChallenge(session.id) });
      return;
    }
    room.rescueAnswer(session.id, msg.answer);
  }

  _loan(conn, msg, session) {
    this._requireRoom(session).loan(session.id, msg.amount);
  }

  _repay(conn, msg, session) {
    this._requireRoom(session).repay(session.id, msg.amount);
  }

  _buy(conn, msg, session) {
    this._requireRoom(session).buy(session.id, msg.item);
  }

  _equip(conn, msg, session) {
    this._requireRoom(session).equip(session.id, msg.item === null ? null : String(msg.item));
  }

  _emote(conn, msg, session) {
    this._requireRoom(session).emote(session.id, msg.emote);
  }

  /** Change the avatar: free parts and owned accessories (works inside and outside a room). */
  _look(conn, msg, session) {
    const look = sanitizeLook(msg.look, session.profile.owned);
    if (msg.avatar !== undefined) {
      if (!this._isAvatar(msg.avatar)) throw new ClubError('Elegí uno de los colores disponibles.', 'bad_avatar');
      session.avatar = msg.avatar;
      session.profile.avatar = msg.avatar;
    }
    session.profile.look = look;
    const room = this._roomOf(session);
    if (room) {
      room.setProfile(session.id, session.name, session.avatar);
      room.touch();
    }
    conn.send({ t: 'you', you: this._you(session), profile: this._profileView(session) });
    this._scheduleSave(session);
  }

  _throw(conn, msg, session) {
    this._requireRoom(session).throwItem(session.id, msg.to, msg.item);
  }

  _rain(conn, msg, session) {
    this._requireRoom(session).rain(session.id);
  }

  _tip(conn, msg, session) {
    this._requireRoom(session).tip(session.id, msg.amount);
  }

  _repayFor(conn, msg, session) {
    this._requireRoom(session).repayFor(session.id, msg.to, msg.amount);
  }

  _profileOf(conn, msg, session) {
    conn.send({ t: 'profileOf', player: this._requireRoom(session).profileOf(session.id, msg.id) });
  }

  _ping(conn, msg) {
    const c = msg.c;
    const echo =
      typeof c === 'number' && Number.isFinite(c) ? c : typeof c === 'string' && c.length <= 64 ? c : null;
    conn.send({ t: 'pong', c: echo, s: this.clock.now() });
  }
}

/** Message type -> handler. A Map, so "constructor" or "__proto__" are just unknown messages. */
const HANDLERS = new Map([
  ['hello', Hub.prototype._hello],
  ['profile', Hub.prototype._profile],
  ['createRoom', Hub.prototype._createRoom],
  ['joinRoom', Hub.prototype._joinRoom],
  ['leaveRoom', Hub.prototype._leaveRoom],
  ['sit', Hub.prototype._sit],
  ['stand', Hub.prototype._stand],
  ['action', Hub.prototype._action],
  ['chat', Hub.prototype._chat],
  ['gift', Hub.prototype._gift],
  ['rescue', Hub.prototype._rescue],
  ['loan', Hub.prototype._loan],
  ['repay', Hub.prototype._repay],
  ['buy', Hub.prototype._buy],
  ['equip', Hub.prototype._equip],
  ['emote', Hub.prototype._emote],
  ['look', Hub.prototype._look],
  ['throw', Hub.prototype._throw],
  ['rain', Hub.prototype._rain],
  ['tip', Hub.prototype._tip],
  ['repayFor', Hub.prototype._repayFor],
  ['profileOf', Hub.prototype._profileOf],
  ['ping', Hub.prototype._ping],
]);

module.exports = { Hub, Connection, CLOSE, DEFAULT_NAME };
