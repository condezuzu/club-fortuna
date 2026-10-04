'use strict';

/**
 * Minimal, safe static file server for the public/ folder.
 *
 *  - GET and HEAD only.
 *  - No path traversal: the URL is decoded once and every segment is vetted
 *    before it is joined to the root (see resolveSafe).
 *  - "Cache-Control: no-store" on everything: there is no build step, so a
 *    refresh must always pick up the latest files.
 *  - "/" serves index.html; so does any unknown path WITHOUT a file extension
 *    (so pretty invite links such as /sala/ABCD keep working).
 */

const fs = require('node:fs');
const path = require('node:path');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
});

// Scripts only from our own origin (no inline <script>, no CDNs); styles and
// fonts may also come from Google Fonts; websockets back to any host the page
// was loaded from.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * Map a URL pathname to a file inside `root`, or null when the path is not
 * acceptable. Rejected: undecodable escapes, NUL bytes, backslashes, "." and
 * ".." segments, dotfiles, drive letters / alternate data streams (":"),
 * segments ending in a dot or space and Windows device names.
 * @param {string} root absolute path of the public folder
 * @param {string} pathname still percent-encoded, as it appears in the URL
 * @returns {string|null}
 */
function resolveSafe(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment.startsWith('.')) return null; // ".", ".." and dotfiles
    if (segment.includes(':')) return null;
    if (/[. ]$/.test(segment)) return null;
    if (WINDOWS_DEVICE.test(segment)) return null;
  }
  const file = path.join(root, ...segments);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

function statFile(file) {
  return new Promise((resolve) => {
    fs.stat(file, (err, stat) => resolve(err ? null : stat));
  });
}

function sendText(res, status, body, extraHeaders) {
  const data = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    ...extraHeaders,
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : data);
}

function sendJson(res, status, value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': MIME['.json'],
    'Content-Length': data.length,
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : data);
}

function sendFile(req, res, file, stat) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': stat.size };
  if (ext === '.html') headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * @param {object} options
 * @param {string} options.root   folder to serve
 * @param {() => object} [options.health] extra fields for GET /healthz
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
function createStaticHandler({ root, health }) {
  const base = path.resolve(root);
  const startedAt = Date.now();

  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
      return;
    }

    // Only the path matters; the query string is for the client-side app.
    const rawUrl = typeof req.url === 'string' ? req.url : '/';
    const queryAt = rawUrl.indexOf('?');
    const pathname = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
    if (!pathname.startsWith('/')) {
      sendText(res, 400, 'Solicitud inválida');
      return;
    }

    if (pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        name: 'club-fortuna',
        uptime: Math.round((Date.now() - startedAt) / 1000),
        ...(health ? health() : {}),
      });
      return;
    }
    if (pathname === '/ws') {
      sendText(res, 426, 'Este punto es solo para WebSocket', { Upgrade: 'websocket' });
      return;
    }

    const target = resolveSafe(base, pathname);
    if (!target) {
      sendText(res, 404, 'No encontrado');
      return;
    }

    let file = target === base ? path.join(base, 'index.html') : target;
    let stat = await statFile(file);
    if ((!stat || !stat.isFile()) && path.extname(target) === '') {
      // Extension-less route: hand it to the single-page app.
      file = path.join(base, 'index.html');
      stat = await statFile(file);
    }
    if (!stat || !stat.isFile()) {
      if (pathname === '/favicon.ico') {
        res.writeHead(204, BASE_HEADERS);
        res.end();
        return;
      }
      sendText(res, 404, 'No encontrado');
      return;
    }
    sendFile(req, res, file, stat);
  };
}

module.exports = { createStaticHandler, resolveSafe, MIME, CONTENT_SECURITY_POLICY };
