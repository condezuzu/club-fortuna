'use strict';

const crypto = require('node:crypto');

// Control characters and line/paragraph separators become a plain space...
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
// ...while invisible format characters (zero-width, bidi overrides), private-use
// code points and lone surrogates are dropped: they are only useful to spoof or
// break the layout of somebody else's screen.
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cs}]/gu;
// "Zalgo" text: keep at most two combining marks in a row.
const MARK_RUN = /(\p{M}{2})\p{M}+/gu;

/**
 * Normalise a user-provided string: NFC, no control / invisible characters,
 * whitespace collapsed and trimmed. Returns '' for anything that is not a string.
 * @param {unknown} value
 * @param {number} hardLimit Upper bound (UTF-16 units) examined, to bound the work.
 */
function cleanText(value, hardLimit) {
  if (typeof value !== 'string') return '';
  const bounded = value.length > hardLimit ? value.slice(0, hardLimit) : value;
  return bounded
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(MARK_RUN, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {unknown} value
 * @param {number} [maxLength] in code points
 * @returns {string} 0..maxLength characters; '' when nothing usable is left.
 */
function sanitizeName(value, maxLength = 16) {
  const clean = cleanText(value, maxLength * 16);
  return Array.from(clean).slice(0, maxLength).join('').trim();
}

/**
 * @param {unknown} value
 * @param {number} [maxLength] in code points
 * @returns {string|null} the cleaned message, or null when empty or too long.
 */
function sanitizeChat(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const clean = cleanText(value, maxLength * 16);
  const length = Array.from(clean).length;
  if (length < 1 || length > maxLength) return null;
  return clean;
}

/** 12500 -> "12.500" (es-AR thousands separator, no ICU dependency). */
function formatChips(n) {
  const value = Number.isFinite(n) ? Math.trunc(n) : 0;
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1 ficha" / "2.500 fichas" */
function chipsText(n) {
  return `${formatChips(n)} ${Math.abs(n) === 1 ? 'ficha' : 'fichas'}`;
}

/** 128-bit secret that identifies a returning player. Never sent to other players. */
function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** Public player id: safe to show to everybody, useless to impersonate anybody. */
function newPlayerId() {
  return `p${crypto.randomBytes(6).toString('hex')}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  cleanText,
  sanitizeName,
  sanitizeChat,
  formatChips,
  chipsText,
  newToken,
  newPlayerId,
  isPlainObject,
  TOKEN_PATTERN,
};
