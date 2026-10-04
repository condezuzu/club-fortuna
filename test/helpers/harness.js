'use strict';

/**
 * End-to-end harness: the REAL server on an ephemeral port plus websocket
 * test clients.
 *
 *   const { startServer } = require('./helpers/harness');
 *
 *   const server = await startServer();              // port 0, 127.0.0.1, tiny time scale
 *   const ana = await server.join('Ana');            // connected + hello done
 *   ana.send({ t: 'createRoom' });
 *   const room = await ana.waitForRoom();
 *   ...
 *   await server.close();                            // closes every client and the server
 *
 * Game timers run CASINO_TIME_SCALE times faster (default 0.02: a 30 s betting
 * window lasts 600 ms). Room timers (seat timeout, rescue cooldown...) are not
 * scaled; override them through `startServer({ config: { ... } })`.
 *
 * Two kinds of waiting:
 *   - waitFor(match)            one-shot messages (error, event, pong, celebrate, left, chat):
 *                               consumes the first unconsumed message that matches.
 *   - waitForRoom / waitForGame snapshots: resolve when the LATEST state satisfies the predicate.
 */

const http = require('node:http');
const WebSocket = require('ws');
const { start } = require('../../server');

const DEFAULT_TIME_SCALE = 0.02;
const DEFAULT_TIMEOUT = 5000;

function describe(message) {
  if (!message || typeof message !== 'object') return String(message);
  if (message.t === 'error') return `error(${message.code}: ${message.message})`;
  if (message.t === 'event') return `event(${message.name})`;
  return String(message.t);
}

/**
 * Open a websocket to `url` and wrap it with test helpers.
 * @param {string} url
 * @param {object} [wsOptions] passed to the `ws` client (e.g. { autoPong: false })
 * @returns {Promise<object>} resolves once the socket is open
 */
function connectClient(url, wsOptions) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOptions);
    const inbox = [];
    const log = [];
    const waiters = new Set();
    let closeInfo = null;

    // Message waiters consume one matching message from the inbox; state
    // waiters read the latest room / game snapshot and consume nothing.
    function pump() {
      for (const waiter of [...waiters]) {
        let found;
        if (waiter.read) {
          found = waiter.read();
          if (found === undefined) continue;
        } else {
          const index = inbox.findIndex(waiter.test);
          if (index === -1) continue;
          [found] = inbox.splice(index, 1);
        }
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(found);
      }
    }

    function wait(waiter, label, timeout = DEFAULT_TIMEOUT) {
      return new Promise((resolveWait, rejectWait) => {
        if (closeInfo) {
          rejectWait(new Error(`waitFor(${label}): the socket is already closed (${closeInfo.code})`));
          return;
        }
        waiter.label = label;
        waiter.resolve = resolveWait;
        waiter.reject = rejectWait;
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          const recent = log.slice(-8).map(describe).join(', ') || 'none';
          rejectWait(new Error(`waitFor(${label}) timed out after ${timeout} ms. Last messages: ${recent}`));
        }, timeout);
        waiters.add(waiter);
        pump();
      });
    }

    const client = {
      ws,
      /** Every message received, in order. */
      log,
      /** Messages not yet consumed by waitFor(). */
      inbox,
      /** Set by the welcome (and by `you` messages). */
      you: null,
      token: null,
      /** Latest room snapshot (null before joining and after `left`), kept up to date automatically. */
      room: null,
      /** Latest game views by game id (cleared by `left`). */
      games: {},

      /** Send a protocol message (object -> JSON). */
      send(message) {
        ws.send(JSON.stringify(message));
        return client;
      },

      /** Send raw data exactly as given (string or Buffer), for hostile-input tests. */
      sendRaw(data, options) {
        ws.send(data, options);
        return client;
      },

      /**
       * For one-shot messages (errors, events, pong, celebrate, left, chat...).
       * Resolves with the first not-yet-consumed message matching `match` and
       * consumes it. `match` is a predicate or a message type such as 'left'.
       * Messages that arrived before the call count too, so there is no race
       * between sending and waiting. Rejects after `timeout` ms (default 5000).
       *
       * For room snapshots and game views use waitForRoom / waitForGame: an
       * old snapshot still sitting in the inbox would match by accident.
       */
      waitFor(match, options = {}) {
        const test = typeof match === 'function' ? match : (message) => message.t === match;
        const label = options.label || (typeof match === 'string' ? `t=${match}` : 'predicate');
        return wait({ test }, label, options.timeout);
      },

      /** Wait for an error message, optionally with a given code. */
      waitForError(code, options = {}) {
        return client.waitFor((message) => message.t === 'error' && (!code || message.code === code), {
          label: `error ${code || ''}`,
          ...options,
        });
      },

      /** Wait for a table event by name; resolves with its payload. */
      waitForEvent(name, options = {}) {
        return client
          .waitFor((message) => message.t === 'event' && message.name === name, { label: `event ${name}`, ...options })
          .then((message) => message.payload);
      },

      /**
       * Resolves with the LATEST room snapshot as soon as it satisfies the
       * predicate (immediately, if it already does). Without a predicate: as
       * soon as this client is in a room.
       */
      waitForRoom(predicate, options = {}) {
        const read = () => (client.room && (!predicate || predicate(client.room)) ? client.room : undefined);
        return wait({ read }, options.label || 'room', options.timeout);
      },

      /**
       * Resolves with the LATEST view of `game` as soon as it satisfies the
       * predicate (immediately, if it already does).
       */
      waitForGame(game, predicate, options = {}) {
        const read = () => {
          const state = client.games[game];
          return state !== undefined && state !== null && (!predicate || predicate(state)) ? state : undefined;
        };
        return wait({ read }, options.label || `game ${game}`, options.timeout);
      },

      /** Forget unconsumed messages; returns them. */
      drain() {
        return inbox.splice(0, inbox.length);
      },

      /** Send hello and wait for the welcome (which sets client.you / client.token / client.room). */
      async hello(fields = {}) {
        client.send({ t: 'hello', ...fields });
        return client.waitFor('welcome');
      },

      /** Round-trip a ping: resolves once the server has processed everything sent before it. */
      async settle() {
        const c = `settle-${Math.random()}`;
        client.send({ t: 'ping', c });
        await client.waitFor((message) => message.t === 'pong' && message.c === c, { label: 'settle' });
      },

      /** My entry in the latest room snapshot. */
      me() {
        return client.room ? client.room.players.find((player) => player.id === client.room.you) : null;
      },

      /** Resolves with { code, reason } when the socket closes. */
      closed: new Promise((resolveClosed) => {
        ws.once('close', (code, reason) => {
          closeInfo = { code, reason: reason.toString() };
          for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error(`waitFor(${waiter.label}) aborted: socket closed (${code})`));
          }
          waiters.clear();
          resolveClosed(closeInfo);
        });
      }),

      get isOpen() {
        return ws.readyState === WebSocket.OPEN;
      },

      /** Close the socket and wait until it is really closed. */
      close() {
        if (closeInfo) return Promise.resolve(closeInfo);
        if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
        else ws.close();
        return client.closed;
      },

      /** Drop the connection abruptly (no close handshake), like a dead network. */
      terminate() {
        ws.terminate();
        return client.closed;
      },
    };

    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (err) {
        message = { t: '(unparseable)', raw: data.toString() };
      }
      log.push(message);
      if (message.t === 'welcome') {
        client.you = message.you;
        client.token = message.token;
        client.room = message.room;
      } else if (message.t === 'room') {
        client.room = message.room;
      } else if (message.t === 'left') {
        client.room = null;
        client.games = {};
      } else if (message.t === 'game') {
        client.games[message.game] = message.state;
      } else if (message.t === 'you') {
        client.you = message.you;
      }
      inbox.push(message);
      pump();
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
    ws.on('error', () => {}); // later errors surface as a close
  });
}

/**
 * Start the real server for a test.
 * @param {object} [options] forwarded to start(); defaults: port 0, host 127.0.0.1, quiet,
 *        timeScale = env CASINO_TIME_SCALE or 0.02
 */
async function startServer(options = {}) {
  const envScale = Number(process.env.CASINO_TIME_SCALE);
  const timeScale = options.timeScale || (envScale > 0 ? envScale : DEFAULT_TIME_SCALE);
  const app = await start({ port: 0, host: '127.0.0.1', quiet: true, ...options, timeScale });
  const origin = `http://127.0.0.1:${app.port}`;
  const wsUrl = `ws://127.0.0.1:${app.port}/ws`;
  const clients = new Set();

  const server = {
    app,
    hub: app.hub,
    port: app.port,
    origin,
    wsUrl,
    timeScale,

    /** A raw connected client (no hello sent). */
    async connect(wsOptions) {
      const client = await connectClient(wsUrl, wsOptions);
      clients.add(client);
      return client;
    },

    /** A connected client that already said hello. `fields` may carry { token, avatar }. */
    async join(name, fields = {}) {
      const client = await server.connect();
      await client.hello({ name, ...fields });
      return client;
    },

    /** HTTP request against the server. Resolves with { status, headers, body (Buffer), text }. */
    request(pathname, requestOptions = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: app.port, path: pathname, method: 'GET', agent: false, ...requestOptions },
          (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const body = Buffer.concat(chunks);
              resolve({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf8') });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    },

    /** Close every client and the server. Always call it (e.g. in `after` or `finally`). */
    async close() {
      await Promise.all([...clients].map((client) => client.close().catch(() => {})));
      await app.close();
    },
  };
  return server;
}

/** Promise-based sleep in real milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { startServer, connectClient, sleep, DEFAULT_TIME_SCALE };
