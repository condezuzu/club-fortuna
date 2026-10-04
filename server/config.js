'use strict';

/**
 * Every tunable of the club in one place.
 *
 * `start({ config })` and `new Hub({ config })` accept partial overrides, which
 * is how the tests shrink timeouts or widen rate limits. Room timers are NOT
 * affected by CASINO_TIME_SCALE: that variable only scales game timers
 * (ctx.after / ctx.deadline).
 */
const DEFAULTS = Object.freeze({
  // Wallet
  START_BALANCE: 1000, // chips handed on first join; counts as a buy-in
  RESCUE_AMOUNT: 500, // chips handed by a rescue; counts as a buy-in
  RESCUE_THRESHOLD: 10, // rescue allowed while balance + stake < threshold
  RESCUE_COOLDOWN_MS: 30_000,
  RESCUE_MINIGAME: 1, // the rescue must be earned by repeating a sequence (tests switch it off)
  GIFT_COOLDOWN_MS: 1_000,

  // Rooms
  MAX_PLAYERS: 8, // members present in a room at the same time
  MAX_RECORDS: 40, // player records kept per room (members + people who left)
  MAX_ROOMS: 500,
  SEAT_TIMEOUT_MS: 60_000, // a disconnected player keeps the seat this long
  ABSENT_TIMEOUT_MS: 10 * 60_000, // a disconnected player keeps the room slot this long
  ROOM_TTL_MS: 10 * 60_000, // a room nobody is connected to lives this long
  SESSION_TTL_MS: 10 * 60_000, // idle identities that are in no room
  FEED_MAX: 50,
  CHAT_MAX: 50,

  // Profile / chat
  NAME_MAX_LENGTH: 16,
  AVATARS: 12,
  CHAT_MAX_LENGTH: 200,
  CHAT_BURST: 5, // messages allowed per CHAT_WINDOW_MS
  CHAT_WINDOW_MS: 8_000,

  // Transport
  MAX_PAYLOAD: 16 * 1024, // bytes per websocket message
  MAX_CONNECTIONS: 500,
  MAX_BUFFERED: 1024 * 1024, // bytes queued towards a slow client before it is dropped
  RATE_BURST: 40, // messages a connection may send in a burst
  RATE_PER_SECOND: 20, // sustained messages per second
  RATE_KICK_STRIKES: 400, // dropped messages (decaying) before the socket is closed
  HEARTBEAT_MS: 30_000,
});

/**
 * Merge overrides into the defaults. Unknown keys and non-numeric values are
 * rejected loudly: a typo in a test must not silently fall back to 60 s.
 * @param {Partial<typeof DEFAULTS>} [overrides]
 */
function resolveConfig(overrides) {
  const config = { ...DEFAULTS };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        throw new Error(`Unknown config key "${key}"`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Config "${key}" must be a non-negative number`);
      }
      config[key] = value;
    }
  }
  return Object.freeze(config);
}

/**
 * Game timers are multiplied by this factor (tests use something tiny).
 * An explicit option wins over the CASINO_TIME_SCALE environment variable.
 * @param {number} [explicit]
 * @returns {number}
 */
function resolveTimeScale(explicit) {
  const raw = explicit !== undefined && explicit !== null ? Number(explicit) : Number(process.env.CASINO_TIME_SCALE);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(Math.max(raw, 0.0005), 100);
}

module.exports = { DEFAULTS, resolveConfig, resolveTimeScale };
