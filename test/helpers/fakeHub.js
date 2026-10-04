'use strict';

/**
 * The real Hub (sessions, rooms, protocol) without sockets and without real
 * time: fake transports capture what the server would send, and a manual clock
 * drives every timer. Use it for room-level tests that need to "wait" 60 s or
 * 10 minutes deterministically.
 *
 *   const { createTestHub } = require('./helpers/fakeHub');
 *   const club = createTestHub();
 *   const ana = club.client({ name: 'Ana' });       // hello already exchanged
 *   ana.send({ t: 'createRoom' });
 *   ana.room().code;                                 // latest room snapshot
 *   club.clock.advance(60_000);                      // time travel
 */

const path = require('node:path');
const { Hub } = require('../../server/hub');
const { loadGames } = require('../../server/games');
const { createFakeClock } = require('./fakeClock');

const FIXTURE_GAMES = path.join(__dirname, '..', 'fixtures', 'games');

/** A logger that records instead of printing. */
function createSilentLog() {
  const log = {
    errors: [],
    warnings: [],
    info: () => {},
    warn: (...args) => log.warnings.push(args),
    error: (...args) => log.errors.push(args),
  };
  return log;
}

/**
 * @param {object} [options]
 * @param {object} [options.config]    config overrides (rate limits are wide open by default)
 * @param {object} [options.registry]  default: the fixture games in test/fixtures/games
 * @param {boolean} [options.realGames] use the real server/games instead of the fixtures
 * @param {object} [options.rng]       rng handed to games
 * @param {number} [options.timeScale] default 1
 */
function createTestHub(options = {}) {
  const clock = createFakeClock();
  const log = createSilentLog();
  const registry = options.registry || (options.realGames ? loadGames(undefined, log) : loadGames(FIXTURE_GAMES, log));
  const hub = new Hub({
    clock,
    log,
    registry,
    rng: options.rng,
    timeScale: options.timeScale || 1,
    config: { RATE_BURST: 1e9, RATE_PER_SECOND: 1e9, GIFT_COOLDOWN_MS: 0, RESCUE_MINIGAME: 0, ...options.config },
  });

  /**
   * A fake client. Pass `false` to skip the hello, or hello fields ({ name, avatar, token }).
   */
  function client(hello = {}) {
    const messages = [];
    // Latest state, tracked as messages arrive so that clear() does not lose it.
    const latest = { room: null, games: new Map() };
    const me = {
      /** Everything the server sent to this client, parsed, in order. */
      messages,
      closed: null,
      you: null,
      token: null,
      conn: null,

      /** Send a protocol message and run the end-of-tick flush. */
      send(message) {
        me.conn.receive(JSON.stringify(message), false);
        clock.flush();
        return me;
      },

      /** Send raw data (string / Buffer), optionally flagged as a binary frame. */
      raw(data, isBinary = false) {
        me.conn.receive(data, isBinary);
        clock.flush();
        return me;
      },

      /** The transport dropped. */
      disconnect() {
        me.conn.disconnect();
        clock.flush();
      },

      /** All messages of a type. */
      all: (type) => messages.filter((message) => message.t === type),

      /** Last message of a type (or undefined). */
      last(type) {
        for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].t === type) return messages[i];
        return undefined;
      },

      /** Forget the messages received so far (room() / game() keep the latest state). */
      clear() {
        messages.length = 0;
      },

      /** Latest room snapshot known to this client (null before joining and after `left`). */
      room: () => latest.room,

      /** My own entry in the latest room snapshot. */
      me() {
        const room = me.room();
        return room ? room.players.find((player) => player.id === me.you.id) : null;
      },

      /** Latest view received for a game (undefined if none since joining the room). */
      game: (id) => latest.games.get(id),

      /** Last error message (or undefined). */
      error: () => me.last('error'),
    };

    me.conn = hub.connect({
      send: (text) => {
        const message = JSON.parse(text);
        messages.push(message);
        if (message.t === 'room' || message.t === 'welcome') latest.room = message.room;
        else if (message.t === 'game') latest.games.set(message.game, message.state);
        else if (message.t === 'left') {
          latest.room = null;
          latest.games.clear();
        }
      },
      close: (code, reason) => {
        me.closed = { code, reason };
      },
    });
    if (hello !== false) {
      me.send({ t: 'hello', ...hello });
      const welcome = me.last('welcome');
      me.you = welcome.you;
      me.token = welcome.token;
    }
    return me;
  }

  /** Reconnect an identity with its token on a brand-new transport. */
  function reconnect(previous, extra = {}) {
    return client({ token: previous.token, ...extra });
  }

  return { hub, clock, log, registry, client, reconnect };
}

module.exports = { createTestHub, createSilentLog, FIXTURE_GAMES };
