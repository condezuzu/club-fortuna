'use strict';

/**
 * Personal progression and money sinks: player levels, loans, the shop
 * (titles, cosmetics, themes, emotes), throwables, tips and the rescue
 * minigame parameters. Everything a client may buy is listed here; ids are
 * "<category>:<key>".
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

/** Titles: pure status, shown next to the name. */
const TITLES = Object.freeze([
  { id: 'title:timbero', name: 'Timbero de ley', price: 1500 },
  { id: 'title:suertudo', name: 'Suertudo profesional', price: 4000 },
  { id: 'title:tiburon', name: 'Tiburón de mesa', price: 10000 },
  { id: 'title:ballena', name: 'Ballena', price: 30000 },
  { id: 'title:magnate', name: 'Magnate', price: 80000 },
  { id: 'title:dueno', name: 'Dueño del casino', price: 250000 },
]);

const VIP = Object.freeze({ id: 'emotes:vip', name: 'Emotes VIP', price: 3000 });
const EMOTES = Object.freeze(['😂', '😭', '😎', '🤡', '👏', '🔥', '🐔', '💀']);
const VIP_EMOTES = Object.freeze(['👑', '🤑', '🐋', '🥱', '🎻', '🧂']);
const EMOTE_COOLDOWN_MS = 700;

/** Avatar look. Free parts are indexes; paid parts are keys of COSMETICS ('none' when empty). */
const LOOK_FREE = Object.freeze({ skin: 6, hair: 6, hairColor: 8, pants: 6 });
const LOOK_SLOTS = Object.freeze(['hat', 'glasses', 'neck', 'pet', 'aura']);
const LOOK_DEFAULT = Object.freeze({
  skin: 0,
  hair: 0,
  hairColor: 0,
  pants: 0,
  hat: 'none',
  glasses: 'none',
  neck: 'none',
  pet: 'none',
  aura: 'none',
});

function cosmetic(slot, key, name, price) {
  return Object.freeze({ id: `${slot}:${key}`, slot, key, name, price });
}
const COSMETICS = Object.freeze([
  cosmetic('hat', 'party', 'Bonete', 300),
  cosmetic('hat', 'cap', 'Gorra', 400),
  cosmetic('hat', 'visor', 'Visera de crupier', 800),
  cosmetic('hat', 'fedora', 'Fedora', 1500),
  cosmetic('hat', 'cowboy', 'Sombrero vaquero', 2500),
  cosmetic('hat', 'tophat', 'Galera', 4000),
  cosmetic('hat', 'crown', 'Corona', 50000),
  cosmetic('glasses', 'nerd', 'Anteojos', 400),
  cosmetic('glasses', 'shades', 'Lentes de sol', 700),
  cosmetic('glasses', 'monocle', 'Monóculo', 2500),
  cosmetic('neck', 'bowtie', 'Moño', 500),
  cosmetic('neck', 'scarf', 'Bufanda', 700),
  cosmetic('neck', 'chain', 'Cadena de oro', 6000),
  cosmetic('pet', 'dog', 'Perrito', 6000),
  cosmetic('pet', 'cat', 'Gato negro', 6000),
  cosmetic('pet', 'parrot', 'Loro', 15000),
  cosmetic('aura', 'sparkle', 'Brillos', 10000),
  cosmetic('aura', 'fire', 'En llamas', 25000),
  cosmetic('aura', 'gold', 'Aura dorada', 100000),
]);

/** Felt colour of your own tables. The first one is free and always owned. */
const DEFAULT_THEME = 'theme:emerald';
const THEMES = Object.freeze([
  { id: DEFAULT_THEME, name: 'Paño esmeralda', price: 0 },
  { id: 'theme:crimson', name: 'Paño carmesí', price: 2500 },
  { id: 'theme:royal', name: 'Paño azul real', price: 2500 },
  { id: 'theme:purple', name: 'Paño púrpura', price: 4000 },
  { id: 'theme:midnight', name: 'Paño medianoche', price: 6000 },
]);

/** Things to throw at a teammate (or at the dealer). Single use. */
const THROWABLES = Object.freeze([
  { id: 'tomato', name: 'Tomate', price: 50 },
  { id: 'rose', name: 'Rosa', price: 100 },
  { id: 'cake', name: 'Torta', price: 150 },
  { id: 'water', name: 'Baldazo de agua', price: 300 },
]);
const THROW_COOLDOWN_MS = 900;

/** "Lluvia de fichas": the big spender pays, everybody else collects. */
const RAIN = Object.freeze({ cost: 1000, each: 100 });

/** Tips for the dealer. */
const TIPS = Object.freeze([100, 500, 2000]);
const TIP_MAX = 100000;

const HISTORY_MAX = 30;

/** Everything with a price and an owner, by id. */
const ITEMS = new Map();
for (const item of TITLES) ITEMS.set(item.id, { ...item, kind: 'title' });
for (const item of COSMETICS) ITEMS.set(item.id, { ...item, kind: 'cosmetic' });
for (const item of THEMES) ITEMS.set(item.id, { ...item, kind: 'theme' });
ITEMS.set(VIP.id, { ...VIP, kind: 'emotes' });

const RESCUE_GAME = Object.freeze({ length: 6, symbols: 4, showMs: 650, ttlMs: 90000, failCooldownMs: 8000 });

/** The static catalogue sent once in `welcome`. */
function catalogView() {
  return {
    xpBase: XP_BASE,
    ranks: RANKS,
    loanInterest: LOAN_INTEREST,
    loanMin: LOAN_MIN,
    garnish: GARNISH,
    titles: TITLES,
    cosmetics: COSMETICS,
    themes: THEMES,
    vip: VIP,
    emotes: EMOTES,
    vipEmotes: VIP_EMOTES,
    throwables: THROWABLES,
    rain: RAIN,
    tips: TIPS,
    lookFree: LOOK_FREE,
  };
}

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
  LOOK_FREE,
  LOOK_SLOTS,
  LOOK_DEFAULT,
  COSMETICS,
  DEFAULT_THEME,
  THEMES,
  THROWABLES,
  THROW_COOLDOWN_MS,
  RAIN,
  TIPS,
  TIP_MAX,
  HISTORY_MAX,
  ITEMS,
  RESCUE_GAME,
  catalogView,
};
