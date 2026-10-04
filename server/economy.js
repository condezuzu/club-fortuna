'use strict';

/**
 * Personal progression and money sinks: player levels, loans, the title shop,
 * emotes and the rescue minigame parameters.
 */

/** A player's level grows with everything wagered: level L needs XP_BASE * L^2 chips wagered. */
const XP_BASE = 200;
function levelFor(wagered) {
  return Math.floor(Math.sqrt(Math.max(0, wagered) / XP_BASE));
}

const RANKS = ['Novato', 'Aficionado', 'Timbero', 'Habitué', 'Apostador', 'Tahúr', 'Tiburón', 'Crack', 'Maestro', 'Leyenda'];
function rankFor(level) {
  return RANKS[Math.min(RANKS.length - 1, Math.floor(level / 3))];
}

/** Loans: the house lends up to a limit that grows with the level, at a fixed interest. */
const LOAN_INTEREST = 0.2;
const LOAN_MIN = 100;
const GARNISH = 0.3; // share of every net win that goes straight to the debt
function loanLimit(level) {
  return 1200 + 600 * level;
}

/** Titles bought with chips: pure status, shown next to the name. */
const TITLES = Object.freeze([
  { id: 'timbero', name: 'Timbero de ley', price: 1500 },
  { id: 'suertudo', name: 'Suertudo profesional', price: 4000 },
  { id: 'tiburon', name: 'Tiburón de mesa', price: 10000 },
  { id: 'ballena', name: 'Ballena', price: 30000 },
  { id: 'magnate', name: 'Magnate', price: 80000 },
  { id: 'dueno', name: 'Dueño del casino', price: 250000 },
]);
const VIP = Object.freeze({ id: 'vip', name: 'Emotes VIP', price: 3000 });

const EMOTES = Object.freeze(['😂', '😭', '😎', '🤡', '👏', '🔥', '🐔', '💀']);
const VIP_EMOTES = Object.freeze(['👑', '🤑', '🐋', '🥱', '🎻', '🧂']);
const EMOTE_COOLDOWN_MS = 700;

const RESCUE_GAME = Object.freeze({ length: 6, symbols: 4, showMs: 650, ttlMs: 90000, failCooldownMs: 8000 });

module.exports = {
  XP_BASE,
  levelFor,
  rankFor,
  LOAN_INTEREST,
  LOAN_MIN,
  GARNISH,
  loanLimit,
  TITLES,
  VIP,
  EMOTES,
  VIP_EMOTES,
  EMOTE_COOLDOWN_MS,
  RESCUE_GAME,
};
