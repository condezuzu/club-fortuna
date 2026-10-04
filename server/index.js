'use strict';

/**
 * Club Fortuna server entry point.
 *
 *   node server/index.js          serves public/ and the websocket endpoint /ws
 *   PORT=8080 node server/index.js
 *
 * For tests and tooling:
 *
 *   const { start } = require('./server');
 *   const app = await start({ port: 0, quiet: true });   // ephemeral port
 *   ... app.port, app.server, app.hub ...
 *   await app.close();
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const { Hub } = require('./hub');
const { createStaticHandler } = require('./static');

const DEFAULT_PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function envPort() {
  const port = Number.parseInt(process.env.PORT, 10);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Every IPv4 address of this machine that other devices on the network can reach. */
function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      const isV4 = item.family === 'IPv4' || item.family === 4;
      if (isV4 && !item.internal && !item.address.startsWith('169.254.')) addresses.push(item.address);
    }
  }
  return addresses;
}

function makeLog(quiet) {
  return {
    info: quiet ? () => {} : (...args) => console.log(...args),
    warn: quiet ? () => {} : (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  };
}

function printBanner(port, addresses) {
  const lines = [
    '',
    '  Club Fortuna · casino cooperativo con fichas ficticias',
    '',
    `  En esta compu:  http://localhost:${port}`,
    ...addresses.map((address) => `  En tu red:      http://${address}:${port}`),
    '',
    addresses.length > 0
      ? '  Compartí la dirección "En tu red" con quienes estén en tu mismo Wi-Fi.'
      : '  No encontramos una red local: por ahora solo podés entrar desde esta compu.',
    '  Fichas ficticias · Sin dinero real · Solo por diversión',
    '  Ctrl+C para cerrar.',
    '',
  ];
  console.log(lines.join('\n'));
}

/**
 * Start the HTTP + WebSocket server.
 *
 * @param {object} [options]
 * @param {number} [options.port]       default: env PORT or 3000. Use 0 for an ephemeral port.
 * @param {string} [options.host]       default '0.0.0.0' (reachable from the LAN)
 * @param {string} [options.publicDir]  default: <repo>/public
 * @param {number} [options.timeScale]  game timer multiplier; default: env CASINO_TIME_SCALE or 1
 * @param {object} [options.config]     partial overrides of server/config.js
 * @param {object} [options.registry]   game registry (default: every plugin in server/games)
 * @param {object} [options.rng]        rng handed to games (default: crypto)
 * @param {boolean} [options.quiet]     no banner, no info logs (errors are still printed)
 * @param {object} [options.log]        custom { info, warn, error }
 * @returns {Promise<{ server: http.Server, port: number, hub: Hub, urls: string[], close: () => Promise<void> }>}
 */
async function start(options = {}) {
  const log = options.log || makeLog(Boolean(options.quiet));
  const port = options.port === undefined || options.port === null ? envPort() : options.port;
  const host = options.host || '0.0.0.0';

  const hub = new Hub({
    config: options.config,
    timeScale: options.timeScale,
    registry: options.registry,
    rng: options.rng,
    log,
  });
  const { config } = hub;

  const serveStatic = createStaticHandler({
    root: options.publicDir || PUBLIC_DIR,
    health: () => ({ ...hub.stats(), games: hub.registry.list.map((meta) => meta.id) }),
  });

  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch((err) => {
      log.error('[http] request failed:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error interno');
    });
  });
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: config.MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  // ws re-emits the errors of the http server; a failed listen() is reported
  // through the rejected start() promise instead of the log.
  let listening = false;
  wss.on('error', (err) => {
    if (listening) log.error('[ws] server error:', err);
  });

  wss.on('connection', (ws) => {
    // Protocol violations (oversized frames, invalid UTF-8...) end up here; ws
    // closes the socket by itself and 'close' follows. Without a listener the
    // 'error' event would take the whole process down.
    ws.on('error', (err) => log.warn('[ws] socket error:', err && err.message));
    if (wss.clients.size > config.MAX_CONNECTIONS) {
      ws.close(1013, 'busy');
      return;
    }
    ws.isAlive = true;
    const conn = hub.connect({
      send(text) {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > config.MAX_BUFFERED) {
          ws.terminate(); // a client that stopped reading must not grow our memory
          return;
        }
        ws.send(text);
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    });
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (data, isBinary) => conn.receive(data, isBinary));
    ws.on('close', () => conn.disconnect());
  });

  // Heartbeat: a socket that did not answer the previous ping is dead.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        ws.terminate();
      }
    }
  }, Math.max(10, config.HEARTBEAT_MS));
  heartbeat.unref();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (err) {
    clearInterval(heartbeat);
    hub.close();
    throw err;
  }
  listening = true;

  const actualPort = server.address().port;
  const addresses = host === '0.0.0.0' || host === '::' ? lanAddresses() : [];
  const urls = [`http://localhost:${actualPort}`, ...addresses.map((address) => `http://${address}:${actualPort}`)];

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = new Promise((resolve) => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      hub.close();
      wss.close(() => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    });
    return closing;
  }

  return { server, port: actualPort, hub, urls, addresses, close };
}

module.exports = { start, lanAddresses };

if (require.main === module) {
  start()
    .then((app) => {
      printBanner(app.port, app.addresses);
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        app.close().then(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(
          `\n  El puerto ${envPort()} ya está en uso. Cerrá el otro programa o elegí otro puerto,\n` +
            '  por ejemplo:  PORT=4000 npm start   (PowerShell:  $env:PORT=4000; npm start)\n'
        );
      } else {
        console.error('\n  No se pudo iniciar Club Fortuna:', err);
      }
      process.exit(1);
    });
}
