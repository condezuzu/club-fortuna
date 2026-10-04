'use strict';

/**
 * A player's persistent profile: the wallet and everything that survives
 * leaving a room, closing the tab or a server restart (through a signed save,
 * see saves.js). Rooms hold records that point at a profile; the profile is
 * the single source of truth for the balance.
 */

const { ClubError } = require('./errors');
const economy = require('./economy');
const { sanitizeName } = require('./util');

const ID_PATTERN = /^p[0-9a-f]{12}$/;
const MAX_BALANCE = 1e12;
const SAVE_VERSION = 1;

function emptyStats() {
  return { rounds: 0, wagered: 0, won: 0, biggestWin: 0 };
}

function createProfile({ id, name, avatar, balance }) {
  return {
    id,
    name,
    avatar,
    look: { ...economy.LOOK_DEFAULT },
    balance,
    peak: balance, // the most this player was ever worth: chips in hand and at stake, minus debt
    debt: 0,
    stats: emptyStats(),
    owned: [],
    title: null,
    theme: economy.DEFAULT_THEME,
    history: [],
    tips: 0,
    seq: 0,
  };
}

function chipCount(value, max = MAX_BALANCE) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : 0;
}

/** Best-effort look from stored data: anything invalid falls back to the default part. */
function restoreLook(raw, owned) {
  const look = { ...economy.LOOK_DEFAULT };
  if (!raw || typeof raw !== 'object') return look;
  for (const [part, count] of Object.entries(economy.LOOK_FREE)) {
    if (Number.isInteger(raw[part]) && raw[part] >= 0 && raw[part] < count) look[part] = raw[part];
  }
  for (const slot of economy.LOOK_SLOTS) {
    if (typeof raw[slot] === 'string' && owned.includes(`${slot}:${raw[slot]}`)) look[slot] = raw[slot];
  }
  return look;
}

/**
 * Strict look from a client: every field must be valid and every paid part owned.
 * @throws {ClubError}
 */
function sanitizeLook(raw, owned) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ClubError('Ese avatar no es válido.', 'bad_look');
  const look = {};
  for (const [part, count] of Object.entries(economy.LOOK_FREE)) {
    const value = raw[part];
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new ClubError('Ese avatar no es válido.', 'bad_look');
    look[part] = value;
  }
  for (const slot of economy.LOOK_SLOTS) {
    const value = raw[slot] === undefined ? 'none' : raw[slot];
    if (value === 'none') {
      look[slot] = 'none';
      continue;
    }
    if (typeof value !== 'string' || !economy.ITEMS.has(`${slot}:${value}`)) {
      throw new ClubError('Ese accesorio no existe.', 'bad_look');
    }
    if (!owned.includes(`${slot}:${value}`)) throw new ClubError('Ese accesorio todavía no es tuyo.', 'not_owned');
    look[slot] = value;
  }
  return look;
}

/**
 * Rebuild a profile from an (authentic) save. Returns null when it is not a
 * save of this version; individual fields are sanitised defensively.
 */
function restoreProfile(raw, config) {
  if (!raw || raw.v !== SAVE_VERSION || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const owned = Array.isArray(raw.owned)
    ? [...new Set(raw.owned.filter((id) => typeof id === 'string' && economy.ITEMS.has(id)))]
    : [];
  const stats = emptyStats();
  if (raw.stats && typeof raw.stats === 'object') {
    for (const key of Object.keys(stats)) stats[key] = chipCount(raw.stats[key]);
  }
  const history = [];
  if (Array.isArray(raw.history)) {
    for (const entry of raw.history.slice(0, economy.HISTORY_MAX)) {
      if (!entry || typeof entry !== 'object' || typeof entry.g !== 'string') continue;
      history.push({
        t: Number.isFinite(entry.t) ? entry.t : 0,
        g: entry.g.slice(0, 40),
        w: chipCount(entry.w),
        r: chipCount(entry.r),
      });
    }
  }
  const title = typeof raw.title === 'string' && owned.includes(raw.title) && raw.title.startsWith('title:') ? raw.title : null;
  const theme =
    typeof raw.theme === 'string' && raw.theme.startsWith('theme:') && owned.includes(raw.theme) ? raw.theme : economy.DEFAULT_THEME;
  return {
    id: raw.id,
    name: sanitizeName(raw.name, config.NAME_MAX_LENGTH) || 'Invitado',
    avatar: Number.isInteger(raw.avatar) && raw.avatar >= 0 && raw.avatar < config.AVATARS ? raw.avatar : 0,
    look: restoreLook(raw.look, owned),
    balance: chipCount(raw.balance),
    peak: Math.max(chipCount(raw.peak), chipCount(raw.balance) - chipCount(raw.debt)),
    debt: chipCount(raw.debt),
    stats,
    owned,
    title,
    theme,
    history,
    tips: chipCount(raw.tips),
    seq: chipCount(raw.seq),
  };
}

/** What goes into a save. Chips at stake are saved as if returned: a restart must not eat a bet. */
function persistView(profile, stake) {
  return {
    v: SAVE_VERSION,
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    look: profile.look,
    balance: profile.balance + (stake || 0),
    peak: profile.peak,
    debt: profile.debt,
    stats: profile.stats,
    owned: profile.owned,
    title: profile.title,
    theme: profile.theme,
    history: profile.history,
    tips: profile.tips,
  };
}

module.exports = { createProfile, restoreProfile, restoreLook, sanitizeLook, persistView, emptyStats, ID_PATTERN };
