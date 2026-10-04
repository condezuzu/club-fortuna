'use strict';

/**
 * Signed saves.
 *
 * The server keeps no database: a player's persistent profile travels to the
 * browser as "<base64url json>.<hmac>" and comes back in `hello`. The HMAC
 * makes it tamper-proof (a client cannot edit its balance); it does not stop a
 * client from presenting an older save after the server restarted.
 *
 * Signing keys, best first:
 *   1. CLUB_SECRET          set it in production (render.yaml generates one).
 *   2. RENDER_SERVICE_ID    on Render: stable across deploys and not public,
 *                           so saves survive without any dashboard setup.
 *   3. a development key    that is in the source: fine on localhost only.
 * New saves are signed with the best key available; saves signed with any of
 * the available keys are accepted, so adding CLUB_SECRET later does not wipe
 * the profiles that were signed before.
 */

const crypto = require('node:crypto');

const DEV_SECRET = 'club-fortuna-dev-secret';
const MAX_LENGTH = 12000;

function secrets() {
  const list = [];
  if (process.env.CLUB_SECRET) list.push(process.env.CLUB_SECRET);
  if (process.env.RENDER_SERVICE_ID) list.push(`club-fortuna:${process.env.RENDER_SERVICE_ID}`);
  if (list.length === 0) list.push(DEV_SECRET);
  return list;
}

/** Is a key in use that is not written in the source code? */
function isSecured() {
  return secrets()[0] !== DEV_SECRET;
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/** @param {object} value JSON-serialisable */
function pack(value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${data}.${sign(data, secrets()[0])}`;
}

/** @returns {object|null} the saved object, or null when missing, malformed or forged. */
function unpack(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LENGTH) return null;
  const dot = text.indexOf('.');
  if (dot < 1 || dot === text.length - 1) return null;
  const data = text.slice(0, dot);
  const given = Buffer.from(text.slice(dot + 1));
  const authentic = secrets().some((secret) => {
    const expected = Buffer.from(sign(data, secret));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!authentic) return null;
  try {
    const value = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (err) {
    return null;
  }
}

module.exports = { pack, unpack, isSecured, MAX_LENGTH };
