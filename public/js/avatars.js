/**
 * Club Fortuna — avatars.
 *
 * Little chibi characters drawn with inline SVG + CSS (/css/avatars.css):
 *
 *   createAvatar(player, opts)   full-body character            (.avatar-char)
 *   createBust(player, opts)     head and shoulders in a circle (.avatar-bust)
 *   createParade(opts)           the lane where everybody walks (.parade)
 *   createLookEditor(opts)       the customisation UI           (.look-editor)
 *
 * player = { id, name, avatar, look, level, crown, connected, debt }
 *   avatar: 0..11, the player's colour = the SHIRT colour (ui.avatarColor)
 *   look:   { skin, hair, hairColor, pants, hat, glasses, neck, pet, aura }
 *
 * Rules this module keeps:
 *   - nothing touches the DOM at import time;
 *   - caller strings (names, emojis, catalog names) only ever become TEXT
 *     nodes or attribute values. The only innerHTML used is the artwork
 *     authored in this file, selected through validated table keys;
 *   - user-facing strings are in Spanish (rioplatense).
 */

import { el, svg, icon, avatarColor, formatChips, prefersReducedMotion, createButton } from './ui.js';

/* ==========================================================================
   Data model
   ========================================================================== */

export const LOOK_DEFAULT = Object.freeze({
  skin: 0, hair: 0, hairColor: 0, pants: 0,
  hat: 'none', glasses: 'none', neck: 'none', pet: 'none', aura: 'none',
});

/** Counts / names of the free options (the server validates ranges with it). */
export const LOOK_FREE = Object.freeze({
  skin: 6,
  hair: Object.freeze(['corto', 'largo', 'rulos', 'pelado', 'cresta', 'rodete']),
  hairColor: 8,
  pants: 6,
});

/** Every paid key this module knows how to draw, per slot. */
export const LOOK_PAID = Object.freeze({
  hat: Object.freeze(['cap', 'party', 'visor', 'fedora', 'cowboy', 'tophat', 'crown']),
  glasses: Object.freeze(['nerd', 'shades', 'monocle']),
  neck: Object.freeze(['bowtie', 'scarf', 'chain']),
  pet: Object.freeze(['dog', 'cat', 'parrot']),
  aura: Object.freeze(['sparkle', 'fire', 'gold']),
});

const SKIN = ['#fcd9bf', '#f1bf9b', '#dea47a', '#bf8055', '#96603f', '#6c442e'];
const HAIR = ['#2d2534', '#55372a', '#8a542e', '#e4b95c', '#c9582d', '#cfcbd6', '#ee74a8', '#41b8c8'];
const PANTS = ['#3f62a8', '#302c3c', '#bb9d6c', '#812536', '#2e7059', '#e6dfcf'];

const SKIN_NAMES = ['Piel muy clara', 'Piel clara', 'Piel trigueña', 'Piel canela', 'Piel morena', 'Piel oscura'];
const HAIR_LABELS = ['Corto', 'Largo', 'Rulos', 'Pelado', 'Cresta', 'Rodete'];
const HAIR_COLOR_NAMES = ['Negro', 'Castaño oscuro', 'Castaño', 'Rubio', 'Colorado', 'Canoso', 'Rosa', 'Turquesa'];
const SHIRT_NAMES = ['Rubí', 'Naranja', 'Ámbar', 'Lima', 'Turquesa', 'Celeste', 'Cobalto', 'Violeta', 'Fucsia', 'Rosa', 'Marfil', 'Grafito'];
const PANTS_NAMES = ['Jean', 'Negro', 'Caqui', 'Bordó', 'Verde', 'Blanco'];

/* ==========================================================================
   Small helpers
   ========================================================================== */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const r1 = (value) => Math.round(value * 10) / 10;
const has = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return `#${A.map((c, i) => Math.round(clamp(c + (B[i] - c) * t, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let uidSeq = 0;
const nextUid = () => `av${(++uidSeq).toString(36)}`;

function intIn(value, count) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}

/** Scalloped outline through the points (clockwise): one bump per segment. */
function scallop(points, k = 0.6) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1];
    const b = points[i % points.length];
    const r = r1(Math.max(0.5, Math.hypot(b[0] - a[0], b[1] - a[1]) * k));
    d += `A${r} ${r} 0 0 1 ${b[0]} ${b[1]}`;
  }
  return `${d}Z`;
}

/* ==========================================================================
   Artwork
   --------------------------------------------------------------------------
   One character = one <svg viewBox="0 0 64 100">, drawn facing RIGHT:
   feet on y = 96.6, top of the skull on y = 18, tall hats reach y = 0.
   Pets and auras overflow the box (the svg has overflow: visible).
   Colours come from CSS custom properties set on the <svg> (see paint()).
   ========================================================================== */

const LEGS =
  '<g class="av-leg av-leg--far">' +
    '<rect class="av-o av-pad" x="31.6" y="69" width="8" height="24.4" rx="3.6"/>' +
    '<path class="av-o av-shoe-d" d="M31.2 96.6v-3.4a2.8 2.8 0 0 1 2.8-2.8h3.8c3.6 0 6 1.9 6 4.6v1.6z"/>' +
  '</g>' +
  '<g class="av-leg av-leg--near">' +
    '<rect class="av-o av-pa" x="24.4" y="69" width="8.2" height="24.4" rx="3.6"/>' +
    '<path class="av-o av-shoe" d="M24 96.6v-3.4a2.8 2.8 0 0 1 2.8-2.8h4c3.6 0 6 1.9 6 4.6v1.6z"/>' +
    '<path class="av-shoe-l" d="M32.3 92.3c1.3.3 2.3.9 2.8 1.8"/>' +
  '</g>';

const ARM_FAR =
  '<g class="av-arm av-arm--far">' +
    '<circle class="av-o av-skd" cx="39.9" cy="70.2" r="3.1"/>' +
    '<rect class="av-o av-shd" x="36.6" y="52.4" width="6.6" height="17" rx="3.3"/>' +
  '</g>';

const ARM_NEAR =
  '<g class="av-arm av-arm--near">' +
    '<circle class="av-o av-sk" cx="23.9" cy="70.4" r="3.2"/>' +
    '<rect class="av-o av-sh" x="20.5" y="52.4" width="6.8" height="17.2" rx="3.4"/>' +
  '</g>';

const TORSO =
  '<path class="av-o av-sh" d="M23.4 57c0-4.4 3-7 7-7h3.6c4 0 7 2.6 7 7l.9 15c.1 2-1.1 3.2-3.1 3.2H25.6c-2 0-3.2-1.2-3.1-3.2z"/>' +
  '<path class="av-shade" d="M22.6 70.6h19.2l.1 1.4c.1 2-1.1 3.2-3.1 3.2H25.6c-2 0-3.2-1.2-3.1-3.2z"/>' +
  '<ellipse class="av-shade" cx="32.8" cy="52.6" rx="6.2" ry="2.4"/>' +
  '<path class="av-ot av-collar" d="M28.2 50.9l4.9 4.5-4.6 1.5z"/>' +
  '<path class="av-ot av-collar" d="M38.2 50.9l-5.1 4.5 4.7 1.5z"/>';

const EAR =
  '<ellipse class="av-o av-sk" cx="15.2" cy="38.2" rx="3.1" ry="3.8"/>' +
  '<path class="av-ear-in" d="M14.4 36.6c1.3.5 1.7 1.8 1 3.2"/>';

const SKULL = '<path class="av-o av-sk" d="M32 18c11.5 0 18 7.5 18 17 0 10-7 16-18 16S14 45 14 35c0-9.5 6.5-17 18-17z"/>';

const FACE =
  '<ellipse class="av-blush" cx="25.4" cy="43.6" rx="2.9" ry="1.8"/>' +
  '<ellipse class="av-blush" cx="45.4" cy="43.4" rx="2.4" ry="1.7"/>' +
  '<g class="av-f av-f--base">' +
    '<g class="av-eyes">' +
      '<ellipse class="av-eye" cx="29" cy="37.8" rx="2.8" ry="3.7"/><circle class="av-glint" cx="30" cy="36.3" r="1.05"/>' +
      '<ellipse class="av-eye" cx="41.8" cy="37.8" rx="2.5" ry="3.7"/><circle class="av-glint" cx="42.7" cy="36.3" r="1"/>' +
    '</g>' +
    '<path class="av-brow" d="M26.1 32q2.9-1.5 5.8-.3"/><path class="av-brow" d="M39.3 31.7q2.7-1.2 5.2 .3"/>' +
    '<path class="av-mouth" d="M33 44.4q2.7 2.5 5.4 0"/>' +
  '</g>' +
  '<g class="av-f av-f--happy">' +
    '<path class="av-eyeline" d="M26.3 38.8q2.7-3.8 5.4 0"/><path class="av-eyeline" d="M39.4 38.8q2.4-3.8 4.8 0"/>' +
    '<path class="av-brow" d="M26.2 31.9q2.8-1.5 5.6-.3"/><path class="av-brow" d="M39.4 31.6q2.6-1.2 5 .3"/>' +
    '<path class="av-mouth-open" d="M32.4 43.6q3.3 5.8 6.6 0z"/>' +
  '</g>' +
  '<g class="av-f av-f--hit">' +
    '<path class="av-eyeline" d="M26.6 35.6l3.8 2.2-3.8 2.2"/><path class="av-eyeline" d="M44.2 35.6l-3.6 2.2 3.6 2.2"/>' +
    '<ellipse class="av-mouth-open" cx="35.7" cy="45.2" rx="1.8" ry="2.2"/>' +
  '</g>' +
  '<g class="av-f av-f--sad">' +
    '<ellipse class="av-eye" cx="29" cy="38.6" rx="2.7" ry="3.2"/><circle class="av-glint" cx="29.9" cy="37.5" r=".95"/>' +
    '<ellipse class="av-eye" cx="41.8" cy="38.6" rx="2.4" ry="3.2"/><circle class="av-glint" cx="42.6" cy="37.5" r=".9"/>' +
    '<path class="av-brow" d="M26.4 33.9q2.6-2.2 5.4-2.6"/><path class="av-brow" d="M39.4 31.3q2.8.2 5 2.4"/>' +
    '<path class="av-mouth" d="M33.2 46.3q2.5-2.5 5 0"/>' +
    '<path class="av-tear" d="M25.6 41.4c-1 1.5-1.1 2.6-.2 3.2 1 .5 1.8-.3 1.5-1.5-.2-.6-.6-1.2-1.3-1.7z"/>' +
  '</g>';

/* ---- Hair ---------------------------------------------------------------- */

const RULOS_OUT = [[9.2, 29], [11.2, 19.6], [19.6, 12.4], [30.5, 9.6], [41.5, 11.6], [50.4, 17.6], [54.4, 27]];
const RULOS_BACK = scallop([...RULOS_OUT, [53.4, 37], [49.5, 44.5], [17.5, 47.5], [10.4, 40]]);
const RULOS_FRONT = scallop([[14.6, 36.5], ...RULOS_OUT, [50.6, 33], [45.5, 28.2], [38.6, 26.8], [31.6, 27.6], [24.6, 29.4], [19, 32.4]]);
const RULOS_PUFF_L = scallop([[12.8, 27.4], [16.2, 30.6], [16.6, 37], [17.6, 43.6], [12.8, 46.2], [8.6, 40.6], [7.8, 33]]);
const RULOS_PUFF_R = scallop([[50.6, 27], [54.6, 30.4], [54.8, 36.8], [51.2, 40.8], [49.4, 35], [49.6, 30.6]]);

/** Whether the ear is drawn over the hair (short styles) or hidden under it. */
const EAR_ON_TOP = [true, false, false, true, true, true];
/** Highest point of each hair style (viewBox units). */
const HAIR_TOP = [10.6, 13.6, 8.4, 17, 5.6, 5.4];

function hairBack(style, hatted) {
  switch (style) {
    case 1:
      return '<path class="av-o av-ha" d="M11.6 33C10.6 21 19.5 14.6 32 14.6c13 0 21.4 7 20.4 20.4-.5 10 1 20.5-1.2 28.4-2.6 3-7.6 3.2-10.6.8l-16 .4c-4 3.4-11.2 2.8-13.6-2-1.8-8.6-.4-19.6.6-29.6z"/>' +
        '<path class="av-had-l" d="M14.2 50.5c-.7 4.6-.5 8.6.4 12.4M49.6 50c.5 4.4.3 8.2-.5 11.6"/>';
    case 2:
      return hatted ? '' : `<path class="av-o av-ha" d="${RULOS_BACK}"/>`;
    case 5:
      return hatted
        ? '<circle class="av-o av-ha" cx="11.4" cy="43.6" r="5.5"/><path class="av-hal" d="M8.6 41.6a3.6 3.6 0 0 1 4.4-1.4"/>'
        : '<circle class="av-o av-ha" cx="20.4" cy="13.2" r="7.3"/><path class="av-hal" d="M16.6 10.8a4.8 4.8 0 0 1 6.4-1.6"/>';
    default:
      return '';
  }
}

function hairFront(style, hatted) {
  switch (style) {
    case 0:
      return '<path class="av-o av-ha" d="M13 41.2C11.2 31 13.4 17.8 26.4 15.4c1-2.2 3-3.8 5.8-4-.6 1.5-.4 2.8.4 3.6 12 .2 19.7 7.6 18.7 17.4-2.3-4-5.1-6.8-8.7-7.8-6.1 4.8-14.8 5.6-20.2 3.3-.5 3.6-1 6.7-2 9.5-1.8-.8-2.8 1-3 3.6-1.6.8-3.2.8-4.4.2z"/>' +
        '<path class="av-hal" d="M37.6 18.7c4.4.9 7.6 3.3 9.3 6.7"/>';
    case 1:
      return '<path class="av-o av-ha" d="M12 39C10.2 24 19.5 14.6 32 14.6c13 0 21.2 7.4 20.3 20.9-.1 4-.4 7.5-1.1 10.9-1.4-4.9-2.4-10.9-5-16.8-2.4-3-5.2-4.8-7.6-5.4-4.1 4.4-12.8 7.6-18.3 8.1-.4 5.9-.7 11.9-1.9 17.7-3-1.6-5.6-5.4-6.4-11z"/>' +
        '<path class="av-hal" d="M36.6 18.3c4.6 1 8 3.6 9.8 7.2"/>';
    case 2:
      return hatted
        ? `<path class="av-o av-ha" d="${RULOS_PUFF_L}"/><path class="av-o av-ha" d="${RULOS_PUFF_R}"/>`
        : `<path class="av-o av-ha" d="${RULOS_FRONT}"/>` +
          '<path class="av-hal" d="M17 20.6a4.4 4.4 0 0 1 4.6-3.4M27.6 14.4a5 5 0 0 1 5.6-2M39.4 15.2a4.6 4.6 0 0 1 5 1.6M47.8 22a4 4 0 0 1 3 3.4"/>';
    case 3:
      return '<path class="av-shine" d="M38.6 21.5c3.8 1.2 6.3 3.4 7.6 6.5"/>';
    case 4:
      return '<path class="av-ha-tint" d="M14.5 37.4C13.4 26.6 20.2 18.8 32 18.8c10.4 0 16.8 5.8 17.5 14-2.6-4.1-6.2-7-10.5-8-6 3.6-13.4 4.6-18.3 3.4-.5 3.3-1.2 6.2-2.3 8.9z"/>' +
        (hatted ? '' : '<path class="av-o av-ha" d="M40.8 25.4l3.6-10-5.4 1.8-.4-8.8-5.2 6.4-2.8-8.4-3.4 8.4-4.6-6.2-1.2 8.8-6-3.6 1.6 9.2c5.2-3.4 16.4-3.9 23.8 2.4z"/>' +
          '<path class="av-hal" d="M36.4 12.8l-2.4 3.4M27.6 11.6l-1.4 3.6"/>');
    case 5:
      return '<path class="av-o av-ha" d="M13 40.6C11.3 28 17.5 15.6 32 15.6c12.5 0 20 7.2 19.2 17-2.8-4.6-6.8-8-11.6-9.2-6.1 3.2-13.6 5.2-19.6 5.4-.1 3.8-.5 7-1.2 9.8-1 0-1.4 1.2-1.5 2.4-1.5.6-3.1.4-4.3-.4z"/>' +
        '<path class="av-hal" d="M37 19c4.2 1 7.4 3.2 9.2 6.4"/>';
    default:
      return '';
  }
}

/* ---- Hats ---------------------------------------------------------------- */
/* cover: hides the hair above `line`; top: highest point of the hat. */

const HATS = {
  cap: {
    cover: true, line: 23.6, top: 9.4,
    art:
      '<path class="av-o" fill="#b93445" d="M11.6 27.8C10.4 17 20 11.4 31.5 11.4s20.3 5.4 19.9 15.6c-12.4-3.4-26.9-3-39.8.8z"/>' +
      '<path fill="#f4ecd8" d="M33.4 11.5c10.2.6 18.3 5.6 18 15.5-4.9-1.3-10.9-2-17-2.2.8-4.8.5-9.2-1-13.3z"/>' +
      '<path class="av-o av-nf" d="M11.6 27.8C10.4 17 20 11.4 31.5 11.4s20.3 5.4 19.9 15.6c-12.4-3.4-26.9-3-39.8.8z"/>' +
      '<path class="av-o" fill="#8f1f31" d="M35.4 24.9c9.1-.6 18.6.7 25.2 4.5 1.2 1.2.4 2.8-1.4 2.4-7.6-2.2-15.6-3-23.2-2.6z"/>' +
      '<circle class="av-ot" fill="#8f1f31" cx="31.6" cy="11.2" r="1.6"/>' +
      '<path fill="#d4af5a" d="M42.6 15.4l2.7 3.7-2.7 3.7-2.7-3.7z"/>',
  },
  party: {
    cover: false, top: -5,
    art:
      '<path class="av-o" fill="#7b4bd0" d="M23.6 22L35.8-.4l8 21c-6.3 3-14 3.4-20.2 1.4z"/>' +
      '<path fill="#f3dfa2" d="M27 15.7l2.2-4 10.9-.8 1.5 3.8c-4.6 1.5-10 1.9-14.6 1z"/>' +
      '<path fill="#f3dfa2" d="M31.6 7.2l2-3.6 3.6-.2 1.3 3.3c-2.2.8-4.8 1-6.9.5z"/>' +
      '<path class="av-o av-nf" d="M23.6 22L35.8-.4l8 21c-6.3 3-14 3.4-20.2 1.4z"/>' +
      '<circle class="av-ot" fill="#f4ecd8" cx="25.4" cy="22.3" r="2.1"/><circle class="av-ot" fill="#f4ecd8" cx="29.6" cy="23.2" r="2.1"/>' +
      '<circle class="av-ot" fill="#f4ecd8" cx="33.9" cy="23.4" r="2.1"/><circle class="av-ot" fill="#f4ecd8" cx="38.1" cy="22.8" r="2.1"/>' +
      '<circle class="av-ot" fill="#f4ecd8" cx="42" cy="21.4" r="2.1"/>' +
      '<circle class="av-o" fill="#f3dfa2" cx="35.8" cy="-1.4" r="3"/>',
  },
  visor: {
    cover: false, top: 21,
    art:
      '<path class="av-o" fill="#c9a148" d="M12.6 26.6C24 22.2 40.5 21.6 51.3 24.6l.1 3.6C40.5 25.4 24.5 26 13 30.2z"/>' +
      '<path class="av-o" fill="#2fb978" fill-opacity=".8" d="M32.6 25.2C43.5 24 55.5 26.5 62.2 32.6c1.2 1.8-.2 3.4-2.2 2.8-8-2.8-17-3.2-26.6-2.4z"/>' +
      '<path d="M37.6 27.2c6.8-.3 13.4 1 19 3.6" stroke="#c9f8de" stroke-width="1.1" stroke-linecap="round" opacity=".75"/>',
  },
  fedora: {
    cover: true, line: 22.6, top: 6.2,
    art:
      '<path class="av-o" fill="#5f556c" d="M6.8 27.2c.4-3.6 6.2-4.8 9.6-4C26.5 20.6 38 20.6 48 23c3.5-.8 10.6.2 11.6 3.8.6 2.8-3.2 3.6-6.8 2.6-12.3-3.4-28.3-3.2-39.8.4-3.4 1-6.6 0-6.2-2.6z"/>' +
      '<path class="av-o" fill="#7b7089" d="M16.4 23.6C15 15 18.6 7 26.4 7.4c3 .2 4.4 2 6 2s3.4-2.2 7-2c7.2.4 10.2 8.2 8.6 16.2-10-2.6-21.5-2.6-31.6 0z"/>' +
      '<path fill="#2b2230" d="M15.9 19.8c10.6-2.4 22.1-2.4 32.6-.2 0 1.4-.2 2.8-.5 4-10-2.6-21.5-2.6-31.6 0-.3-1.2-.5-2.6-.5-3.8z"/>' +
      '<path class="av-o av-nf" d="M16.4 23.6C15 15 18.6 7 26.4 7.4c3 .2 4.4 2 6 2s3.4-2.2 7-2c7.2.4 10.2 8.2 8.6 16.2-10-2.6-21.5-2.6-31.6 0z"/>' +
      '<path d="M32.4 9.8c-.4 2.2-.2 4.2.3 5.8" stroke="#5f556c" stroke-width="1.2" stroke-linecap="round"/>' +
      '<path class="av-ot" fill="#dc5a68" d="M19.2 19.2c-1.6-4-.8-7.4 1.8-9.4 1.4 3 1 6.4-.2 9.2z"/>',
  },
  cowboy: {
    cover: true, line: 21, top: 4.8,
    art:
      '<path class="av-o" fill="#c9995a" d="M2.4 20.6c-.8-2 1-2.8 2.4-1.4 3.8 3.6 9.8 3.8 15.2 2.6 8-1.8 17.5-1.8 25.6 0 5.2 1.2 11-.2 14.4-2.8 1.4-1.4 3.2-.4 2.4 1.6-2.4 6-9.8 7.6-17 6.4-7.9-1.4-17.4-1.4-25.4 0-7.2 1.2-15.4-.2-17.6-6.4z"/>' +
      '<path class="av-o" fill="#dcae6c" d="M19.6 22.4C18.2 13 21.4 5.6 27.4 6c2.6.2 3.6 2.4 5.1 2.4s2.9-2.4 5.9-2.2c6 .4 8.4 7.4 7.2 16.2-8.1-2-17.6-2-26 0z"/>' +
      '<path fill="#6b3f26" d="M19.3 18.8c8.7-2 18.1-2 26.6 0 0 1.2-.1 2.4-.3 3.6-8.1-2-17.6-2-26 0-.2-1.2-.3-2.4-.3-3.6z"/>' +
      '<path class="av-o av-nf" d="M19.6 22.4C18.2 13 21.4 5.6 27.4 6c2.6.2 3.6 2.4 5.1 2.4s2.9-2.4 5.9-2.2c6 .4 8.4 7.4 7.2 16.2-8.1-2-17.6-2-26 0z"/>' +
      '<path fill="#f3dfa2" d="M32.6 17.3l.9 1.7 1.9.3-1.4 1.3.3 1.9-1.7-.9-1.7.9.3-1.9-1.4-1.3 1.9-.3z"/>',
  },
  tophat: {
    cover: true, line: 22, top: -2.2,
    art:
      '<path class="av-o" fill="#37303f" d="M19.8 22.6L18.6 2C18.5 0 20-1 22-1h21c2 0 3.5 1 3.4 3l-1.2 20.6c-8.2 1-17.2 1-25.4 0z"/>' +
      '<path d="M22.8 2.4l.8 13" stroke="#5d5468" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path fill="#b93445" d="M19.4 16.4c8.6 1 17.6 1 26.2 0l-.4 6.2c-8.2 1-17.2 1-25.4 0z"/>' +
      '<rect class="av-ot" fill="#e6c878" x="29.9" y="17.3" width="5.4" height="5" rx=".9"/><rect fill="#b93445" x="31.4" y="18.7" width="2.4" height="2.2" rx=".4"/>' +
      '<path class="av-o av-nf" d="M19.8 22.6L18.6 2C18.5 0 20-1 22-1h21c2 0 3.5 1 3.4 3l-1.2 20.6c-8.2 1-17.2 1-25.4 0z"/>' +
      '<path class="av-o" fill="#37303f" d="M10.6 23.8c0-2.2 2.4-2.6 5-2.2 10.4 1.4 23.4 1.4 33.8 0 2.6-.4 5 0 5 2.2 0 2.6-3.4 3.2-6.6 2.6-10.3-1.6-20.3-1.6-30.6 0-3.2.6-6.6 0-6.6-2.6z"/>',
  },
  crown: {
    cover: false, top: 2.6,
    art:
      '<path class="av-o" fill="#e6c878" d="M19 23.4l-1.8-12.9 3.7 5.1 3.7-8.6 4.1 8 4.1-10.4 4.1 10.4 4.1-8 3.7 8.6 3.7-5.1-1.6 12.9c-8.8-2.2-18.8-2.2-27.8 0z"/>' +
      '<path fill="#c9a148" d="M18.5 19.6c9.5-2 19.5-2 28.8 0l-.5 3.8c-8.8-2.2-18.8-2.2-27.8 0z"/>' +
      '<path class="av-o av-nf" d="M19 23.4l-1.8-12.9 3.7 5.1 3.7-8.6 4.1 8 4.1-10.4 4.1 10.4 4.1-8 3.7 8.6 3.7-5.1-1.6 12.9c-8.8-2.2-18.8-2.2-27.8 0z"/>' +
      '<circle fill="#dc5a68" cx="32.8" cy="20" r="1.7"/><circle fill="#46a985" cx="25.4" cy="20.7" r="1.25"/><circle fill="#4aa8f0" cx="40.4" cy="20.7" r="1.25"/>' +
      '<circle class="av-ot" fill="#fffdf6" cx="17.2" cy="10.2" r="1.4"/><circle class="av-ot" fill="#fffdf6" cx="24.6" cy="6.6" r="1.4"/>' +
      '<circle class="av-ot" fill="#fffdf6" cx="32.8" cy="4.2" r="1.7"/><circle class="av-ot" fill="#fffdf6" cx="41" cy="6.6" r="1.4"/>' +
      '<circle class="av-ot" fill="#fffdf6" cx="48.4" cy="10.2" r="1.4"/>',
  },
};

/* ---- Glasses ------------------------------------------------------------- */

const GLASSES = {
  nerd:
    '<path d="M24.4 36.4l-8-1.2" stroke="#2b2230" stroke-width="1.5" stroke-linecap="round"/>' +
    '<rect x="24.2" y="33.1" width="9.4" height="9" rx="3.4" fill="#e2f0ff" fill-opacity=".36" stroke="#2b2230" stroke-width="1.7"/>' +
    '<rect x="37.8" y="33.1" width="8.6" height="9" rx="3.4" fill="#e2f0ff" fill-opacity=".36" stroke="#2b2230" stroke-width="1.7"/>' +
    '<path d="M33.6 36.5q2.1-1.3 4.2 0" stroke="#2b2230" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M26.3 35.9l1.7-1.3M39.8 35.9l1.6-1.3" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".85"/>',
  shades:
    '<path d="M24 34.6l-7.6-.5" stroke="#c9a148" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M23.8 34.3h10.4c.5 4.7-1.6 8.1-5 8.1-3.6 0-5.8-3.5-5.4-8.1z" fill="#1c1626" stroke="#c9a148" stroke-width="1" stroke-linejoin="round"/>' +
    '<path d="M37.4 34.3H47c.5 4.7-1.4 8.1-4.6 8.1-3.4 0-5.4-3.5-5-8.1z" fill="#1c1626" stroke="#c9a148" stroke-width="1" stroke-linejoin="round"/>' +
    '<path d="M34.2 35.2q1.6-.9 3.2 0" stroke="#c9a148" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M26 36.6l2.8-1.3M39.6 36.6l2.5-1.3" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".5"/>',
  monocle:
    '<path d="M24.6 40.9C21 45 22 50.6 26.6 53.6" stroke="#b8923f" stroke-width="1" stroke-dasharray="1.4 1" stroke-linecap="round"/>' +
    '<circle cx="29" cy="37.8" r="5.5" fill="#e2f0ff" fill-opacity=".24" stroke="#5a4320" stroke-width="2.4"/>' +
    '<circle cx="29" cy="37.8" r="5.5" stroke="#e6c878" stroke-width="1.3"/>' +
    '<path d="M26 35.6l2-1.7" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".85"/>',
};

/* ---- Neckwear ------------------------------------------------------------ */

const NECK = {
  bowtie:
    '<path class="av-o av-bow" d="M32.4 54.6L25 51c-1.1 2.3-1.1 5 0 7.2z"/>' +
    '<path class="av-o av-bow" d="M34.6 54.6l7.4-3.6c1.1 2.3 1.1 5 0 7.2z"/>' +
    '<rect class="av-o av-bow" x="31.6" y="52.5" width="3.8" height="4.2" rx="1.3"/>',
  scarf:
    '<path class="av-o" fill="#258a66" d="M24.8 56.6L23 69.6l5.8.6 1.4-12.4z"/>' +
    '<path d="M23.9 62.3l5.9.6M23.4 66l5.9.6" stroke="#f4ecd8" stroke-width="1.6"/>' +
    '<path class="av-o" fill="#258a66" d="M22.4 53.6C26 50.4 38.4 50.4 41.8 53c1 2 .6 4.4-1 5.6-5.6 1.6-12.6 1.4-17.2 0-1.6-1.2-2-3.2-1.2-5z"/>' +
    '<path d="M27.3 52l-.8 6.6M32.4 51.4v7.5M37.4 51.8l.8 6.6" stroke="#f4ecd8" stroke-width="1.6"/>' +
    '<path class="av-o av-nf" d="M22.4 53.6C26 50.4 38.4 50.4 41.8 53c1 2 .6 4.4-1 5.6-5.6 1.6-12.6 1.4-17.2 0-1.6-1.2-2-3.2-1.2-5z"/>',
  chain:
    '<path d="M26 52.4c.8 7.6 13.4 7.6 14.4 0" stroke="#5a4320" stroke-width="2.8" stroke-linecap="round"/>' +
    '<path d="M26 52.4c.8 7.6 13.4 7.6 14.4 0" stroke="#e6c878" stroke-width="1.5" stroke-dasharray="1.7 .9" stroke-linecap="round"/>' +
    '<circle fill="#e6c878" stroke="#5a4320" stroke-width="1" cx="33.2" cy="60.8" r="3.3"/>' +
    '<path fill="#b8923f" d="M33.2 58.9l1.4 1.9-1.4 1.9-1.4-1.9z"/>',
};

/* ---- Pets ---------------------------------------------------------------- */

const DOG =
  '<g class="av-pet av-pet--ground av-pet--dog"><g class="av-pet-bob">' +
    '<path class="av-o av-pet-tail" fill="#e3a55e" d="M-18.4 83.4c-3.4-.8-5.4-3.8-4.8-7.6 2.8.4 5.6 2.6 6.6 5.8z"/>' +
    '<rect class="av-o av-pleg av-pleg--b" fill="#c0843f" x="-16.4" y="88.2" width="3.8" height="8.6" rx="1.9"/>' +
    '<rect class="av-o av-pleg av-pleg--a" fill="#c0843f" x="-3" y="88.2" width="3.8" height="8.6" rx="1.9"/>' +
    '<path class="av-o" fill="#e3a55e" d="M-19.6 84.6c0-4.2 3.4-6.8 8.2-6.8h5.2c4.2 0 6.8 2.6 6.8 6.4 0 4-2.8 6.8-7.2 6.8h-5.4c-4.6 0-7.6-2.4-7.6-6.4z"/>' +
    '<path fill="#f8e6c9" d="M-16.6 88.4c3 1.5 9.4 1.6 13.2.2-.9 1.6-2.6 2.4-4.6 2.4h-5c-1.6 0-2.9-.9-3.6-2.6z"/>' +
    '<rect class="av-o av-pleg av-pleg--a" fill="#e3a55e" x="-18.6" y="88.6" width="3.9" height="8.2" rx="1.95"/>' +
    '<rect class="av-o av-pleg av-pleg--b" fill="#e3a55e" x="-5.4" y="88.6" width="3.9" height="8.2" rx="1.95"/>' +
    '<g class="av-pet-head">' +
      '<path class="av-o" fill="#e3a55e" d="M-8.4 76c0-4.6 3.4-7.8 7.8-7.8 4.2 0 7.2 2.8 7.4 6.8 1.6.5 2.6 1.7 2.6 3.2 0 2.6-2.4 4-5.4 4H-.8c-4.4 0-7.6-2-7.6-6.2z"/>' +
      '<path fill="#f8e6c9" d="M.8 78.2c1.8-1.6 4.6-2.2 6-3.2 1.6.5 2.6 1.7 2.6 3.2 0 2.6-2.4 4-5.4 4H1.4c-1.2-1.2-1.5-2.6-.6-4z"/>' +
      '<path class="av-o av-nf" d="M-8.4 76c0-4.6 3.4-7.8 7.8-7.8 4.2 0 7.2 2.8 7.4 6.8 1.6.5 2.6 1.7 2.6 3.2 0 2.6-2.4 4-5.4 4H-.8c-4.4 0-7.6-2-7.6-6.2z"/>' +
      '<ellipse fill="#2a1f2e" cx="7.7" cy="76.6" rx="1.6" ry="1.25"/>' +
      '<ellipse fill="#2a1f2e" cx="1.4" cy="74.6" rx="1.2" ry="1.55"/><circle fill="#fff" cx="1.8" cy="74" r=".45"/>' +
      '<path d="M4.4 80.3q1.3.9 2.6.1" stroke="#2a1f2e" stroke-width=".9" stroke-linecap="round"/>' +
      '<path class="av-o" fill="#a8652e" d="M-6.2 69.8c-3.2.4-4.8 3.6-3.8 8 2.6.6 5-1.2 5.6-4.2.3-1.6-.4-3-1.8-3.8z"/>' +
    '</g>' +
    '<path d="M-7.2 82c1.5 1.4 3.4 2 5.4 1.9" stroke="#dc5a68" stroke-width="1.9" stroke-linecap="round"/>' +
  '</g></g>';

const CAT =
  '<g class="av-pet av-pet--ground av-pet--cat"><g class="av-pet-bob">' +
    '<g class="av-pet-tail"><path d="M-17.6 86.4c-4.6-2-6.4-7.6-3.2-12.8" class="av-ls" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M-17.6 86.4c-4.6-2-6.4-7.6-3.2-12.8" stroke="#3d334c" stroke-width="2.6" stroke-linecap="round"/></g>' +
    '<rect class="av-o av-pleg av-pleg--b" fill="#2b2338" x="-15.6" y="89" width="3.4" height="7.8" rx="1.7"/>' +
    '<rect class="av-o av-pleg av-pleg--a" fill="#2b2338" x="-3.4" y="89" width="3.4" height="7.8" rx="1.7"/>' +
    '<path class="av-o" fill="#3d334c" d="M-19.4 85.6c0-3.8 3-6.2 7.4-6.2h5c3.8 0 6.2 2.4 6.2 5.8 0 3.8-2.6 6.2-6.6 6.2h-5c-4.2 0-7-2.2-7-5.8z"/>' +
    '<g class="av-pleg av-pleg--a"><rect class="av-o" fill="#3d334c" x="-17.8" y="89.4" width="3.6" height="7.4" rx="1.8"/><path fill="#f4ecd8" d="M-17.1 94.4h2.2v.6a1.1 1.1 0 0 1-2.2 0z"/></g>' +
    '<g class="av-pleg av-pleg--b"><rect class="av-o" fill="#3d334c" x="-5.8" y="89.4" width="3.6" height="7.4" rx="1.8"/><path fill="#f4ecd8" d="M-5.1 94.4h2.2v.6a1.1 1.1 0 0 1-2.2 0z"/></g>' +
    '<g class="av-pet-head">' +
      '<path class="av-o" fill="#3d334c" d="M-8.8 73.8l-.6-7 5.6 3.6z"/><path class="av-o" fill="#3d334c" d="M.6 70.2l5.2-3.6.4 7.2z"/>' +
      '<path class="av-o" fill="#3d334c" d="M-9.6 77.4c0-4.2 3.2-7 7.4-7s7.4 2.8 7.4 7c0 4-3.2 6.4-7.4 6.4s-7.4-2.4-7.4-6.4z"/>' +
      '<path fill="#f590ae" d="M-7.9 71.6l-.3-2.6 2.2 1.4zM2.4 70.3l2-1.4.1 2.8z"/>' +
      '<ellipse fill="#d9e44c" cx="-4" cy="76.6" rx="1.6" ry="1.9"/><ellipse fill="#1c1626" cx="-3.7" cy="76.6" rx=".55" ry="1.5"/>' +
      '<ellipse fill="#d9e44c" cx="1.6" cy="76.6" rx="1.6" ry="1.9"/><ellipse fill="#1c1626" cx="1.9" cy="76.6" rx=".55" ry="1.5"/>' +
      '<path fill="#f590ae" d="M-1.9 79.2h1.6l-.8 1z"/>' +
      '<path d="M1.4 80.2l4.4-.7M1.4 81l4.2.9M-4 80.2l-4.2-.7M-4 81l-4 .9" stroke="#f4ecd8" stroke-width=".55" stroke-linecap="round" opacity=".8"/>' +
    '</g>' +
    '<path fill="#f4ecd8" d="M-4.6 83.6c1.4.8 3 .8 4.4 0-.2 1.7-1.1 2.8-2.2 2.8s-2-1.1-2.2-2.8z"/>' +
  '</g></g>';

const PARROT =
  '<g class="av-pet av-pet--parrot"><g class="av-parrot-fly"><g transform="translate(2.6 2)">' +
    '<path class="av-o" fill="#e0483c" d="M10.4 50.2L5.8 61.4l3.6-1.8.8 3.8 4.4-11.8z"/>' +
    '<path class="av-o" fill="#3fbb5e" d="M5.4 40.4c0-5 3.2-8.2 7.2-8.2 4.4 0 7.2 3.2 7.2 7.8 0 6.4-3.4 11.4-8.4 13.4-3.8-2.6-6-7.4-6-13z"/>' +
    '<path fill="#93e37f" fill-opacity=".8" d="M14.8 41.6c1.8.2 3.4.8 4.6 1.8-.9 3.6-2.8 6.4-5.4 8.2-.4-3.4-.1-7 .8-10z"/>' +
    '<path fill="#e0483c" d="M7.2 36c1.2-2.4 3.2-3.8 5.4-3.8 2.6 0 4.8 1.2 6 3.2-3.6-1-7.6-.6-11.4.6z"/>' +
    '<path class="av-o av-nf" d="M5.4 40.4c0-5 3.2-8.2 7.2-8.2 4.4 0 7.2 3.2 7.2 7.8 0 6.4-3.4 11.4-8.4 13.4-3.8-2.6-6-7.4-6-13z"/>' +
    '<path class="av-o av-parrot-wing" fill="#2f86d6" d="M6.6 42c2.8-.8 6 1.2 6.6 5.6-1.2 3.2-3.2 4.8-5.2 5-1.2-3-1.8-7-1.4-10.6z"/>' +
    '<circle fill="#fff8e8" cx="14.6" cy="37.6" r="2.2"/><circle fill="#2a1f2e" cx="15" cy="37.6" r="1.05"/>' +
    '<path class="av-ot" fill="#f2b632" d="M18 36.2c3.2-.4 4.8 1.8 3.8 4.2-.6 1.2-1.6 1.8-2.8 2 .4-1.6 0-2.9-1.4-3.5z"/>' +
    '<path d="M10.6 53.2v1.8M13 53v1.8" stroke="#6b4a2a" stroke-width="1.3" stroke-linecap="round"/>' +
  '</g></g></g>';

const PETS = {
  dog: { ground: true, art: DOG, box: '-25.5 65 37 37' },
  cat: { ground: true, art: CAT, box: '-25 64 35 35' },
  parrot: { ground: false, art: PARROT, box: '-1 30.5 37 37' },
};

/* ---- Auras --------------------------------------------------------------- */

const SPARK = 'M0-4.6Q.7-.7 4.6 0 .7.7 0 4.6-.7.7-4.6 0-.7-.7 0-4.6z';

function sparkAt(x, y, scale, delay, tone) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path class="av-spark" fill="${tone}" style="animation-delay:${delay}s" d="${SPARK}"/></g>`;
}

const FLAME = 'M1.5 97C-3 82 2 70 7 62c-1-10 2-18 6.5-23-.5-9 3.5-19 9.5-25.5.5 5.5 2.5 8.5 4.5 10C28 14 31.5 5 36.5-2.5 38 6 42 13.5 45.5 18.5 47 16 48 12.5 48 9c5.5 8 8 18 6.5 27.5C58.5 41.5 61 50 59 59.5 63.5 68 66 82 62 97z';

const AURAS = {
  sparkle() {
    return {
      back:
        sparkAt(2, 30, 1.15, 0, '#f3dfa2') + sparkAt(61, 15, 0.9, -0.7, '#fffdf6') + sparkAt(63, 55, 1.25, -1.2, '#f3dfa2') +
        sparkAt(1, 66, 0.85, -0.4, '#fffdf6') + sparkAt(50, 2, 0.75, -1.5, '#f3dfa2') + sparkAt(11, 7, 1, -0.9, '#fbefc9'),
      front:
        sparkAt(7, 48, 0.6, -1.1, '#fffdf6') + sparkAt(58, 80, 0.75, -0.2, '#fbefc9') + sparkAt(18, 91, 0.55, -1.6, '#f3dfa2') +
        sparkAt(55, 36, 0.5, -0.5, '#fffdf6'),
    };
  },
  fire(uid, defs) {
    defs.push(
      `<linearGradient id="${uid}f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4a1c"/><stop offset=".55" stop-color="#ff9a2e"/><stop offset="1" stop-color="#ffe27a"/></linearGradient>` +
      `<linearGradient id="${uid}g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb02e"/><stop offset="1" stop-color="#fff3b0"/></linearGradient>`,
    );
    return {
      back:
        `<path class="av-flame av-flame--a" fill="url(#${uid}f)" d="${FLAME}"/>` +
        `<g transform="translate(5.8 17.5) scale(.82)"><path class="av-flame av-flame--b" fill="url(#${uid}g)" fill-opacity=".8" d="${FLAME}"/></g>` +
        '<circle class="av-ember" fill="#ffe27a" cx="6" cy="40" r="1.2" style="animation-delay:-.2s"/>' +
        '<circle class="av-ember" fill="#ffb02e" cx="58" cy="34" r="1" style="animation-delay:-.9s"/>' +
        '<circle class="av-ember" fill="#ffe27a" cx="52" cy="8" r="1.1" style="animation-delay:-1.4s"/>' +
        '<circle class="av-ember" fill="#ffb02e" cx="16" cy="14" r=".9" style="animation-delay:-.6s"/>',
      front:
        `<path class="av-flame av-flame--c" fill="url(#${uid}g)" fill-opacity=".92" d="M7.5 97c-2.2-4.6-.6-8.6 2.2-11.6.4 2.8 2.4 4.4 3.4 6.8.7 1.9.4 3.5-.5 4.8z"/>` +
        `<path class="av-flame av-flame--b" fill="url(#${uid}g)" fill-opacity=".92" d="M50.5 97c-1.4-3.8.2-7 2.8-9.4.2 2.4 1.8 3.8 2.6 5.8.5 1.5.2 2.7-.5 3.6z"/>`,
    };
  },
  gold(uid, defs) {
    defs.push(
      `<radialGradient id="${uid}a"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset=".5" stop-color="#e6c878" stop-opacity=".42"/><stop offset="1" stop-color="#e6c878" stop-opacity="0"/></radialGradient>`,
    );
    return {
      back:
        `<ellipse class="av-glow" fill="url(#${uid}a)" cx="32" cy="52" rx="42" ry="54"/>` +
        '<ellipse class="av-ring" cx="32" cy="96" rx="21" ry="4.2"/>',
      front:
        '<path class="av-mote" fill="#fff6d6" d="M8 84l1.2 1.8L8 87.6 6.8 85.8z" style="animation-delay:-.3s"/>' +
        '<path class="av-mote" fill="#f3dfa2" d="M56 88l1.2 1.8-1.2 1.8-1.2-1.8z" style="animation-delay:-1.2s"/>' +
        '<path class="av-mote" fill="#fff6d6" d="M2 70l1 1.5-1 1.5-1-1.5z" style="animation-delay:-2s"/>' +
        '<path class="av-mote" fill="#f3dfa2" d="M61 66l1 1.5-1 1.5-1-1.5z" style="animation-delay:-.8s"/>' +
        '<path class="av-mote" fill="#fff6d6" d="M48 92l.9 1.4-.9 1.4-.9-1.4z" style="animation-delay:-1.7s"/>',
    };
  },
};

/* ---- Assembly ------------------------------------------------------------ */

/** A full look with every field valid (unknown values become defaults). */
function normLook(look) {
  const src = look && typeof look === 'object' ? look : {};
  const key = (value, table) => (has(table, value) ? value : 'none');
  return {
    skin: intIn(src.skin, SKIN.length),
    hair: intIn(src.hair, HAIR_LABELS.length),
    hairColor: intIn(src.hairColor, HAIR.length),
    pants: intIn(src.pants, PANTS.length),
    hat: key(src.hat, HATS),
    glasses: key(src.glasses, GLASSES),
    neck: key(src.neck, NECK),
    pet: key(src.pet, PETS),
    aura: key(src.aura, AURAS),
  };
}

const normAvatar = (value) => intIn(value, 12);

const lookKey = (look) => `${look.skin}.${look.hair}.${look.hairColor}.${look.pants}.${look.hat}.${look.glasses}.${look.neck}.${look.pet}.${look.aura}`;

/** Highest drawn point of the figure, in viewBox units (0 = top of the box). */
function figureTop(look) {
  const hat = HATS[look.hat];
  if (hat && hat.cover) return hat.top;
  return Math.min(HAIR_TOP[look.hair], hat ? hat.top : 99);
}

/** Inner markup of the character <svg>. Everything here is authored above. */
function figureMarkup(look, uid, parts = {}) {
  const hat = HATS[look.hat] || null;
  const covered = !!(hat && hat.cover);
  const defs = [];
  let clip = '';
  if (covered) {
    defs.push(`<clipPath id="${uid}h"><rect x="-40" y="${hat.line}" width="144" height="140"/></clipPath>`);
    clip = ` clip-path="url(#${uid}h)"`;
  }
  const aura = parts.aura !== false && has(AURAS, look.aura) ? AURAS[look.aura](uid, defs) : null;
  const pet = parts.pet !== false && has(PETS, look.pet) ? PETS[look.pet] : null;
  const hair = look.hair;

  let out = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  if (aura) out += `<g class="av-aura av-aura--back">${aura.back}</g>`;
  out += '<ellipse class="av-shadow" cx="32" cy="96.8" rx="13.5" ry="2.5"/>';
  out += '<g class="av-flip">';
  if (pet && pet.ground) out += pet.art;
  out += `<g class="av-body">${LEGS}<g class="av-upper">`;
  out += `<g class="av-hairback"${clip}>${hairBack(hair, covered)}</g>`;
  out += ARM_FAR + TORSO;
  if (has(NECK, look.neck)) out += `<g class="av-neckwear">${NECK[look.neck]}</g>`;
  out += ARM_NEAR;
  out += '<g class="av-head">';
  if (!EAR_ON_TOP[hair]) out += EAR;
  out += SKULL + FACE;
  out += `<g class="av-hair"${clip}>${hairFront(hair, covered)}</g>`;
  if (EAR_ON_TOP[hair]) out += EAR;
  if (has(GLASSES, look.glasses)) out += `<g class="av-glasses">${GLASSES[look.glasses]}</g>`;
  if (hat) out += `<g class="av-hat">${hat.art}</g>`;
  out += '</g>';
  if (pet && !pet.ground) out += pet.art;
  out += '</g></g></g>';
  if (aura) out += `<g class="av-aura av-aura--front">${aura.front}</g>`;
  return out;
}

/** Set the colour custom properties of a look on an element. */
function paint(node, look, avatarIndex) {
  const skin = SKIN[look.skin];
  const hair = HAIR[look.hairColor];
  const pants = PANTS[look.pants];
  const shirt = avatarColor(avatarIndex);
  const set = (name, value) => node.style.setProperty(name, value);
  set('--av-skin', skin);
  set('--av-skin-d', mix(skin, '#5a2430', 0.22));
  set('--av-blush', mix(skin, '#e8404f', 0.4));
  set('--av-mouth', mix(skin, '#3a0c14', 0.74));
  set('--av-hair', hair);
  set('--av-hair-l', mix(hair, '#ffffff', 0.34));
  set('--av-hair-d', mix(hair, '#120a18', 0.34));
  set('--av-brow', mix(hair, '#1a1020', 0.4));
  set('--av-shirt', shirt);
  set('--av-shirt-d', mix(shirt, '#1a0f22', 0.3));
  set('--av-pants', pants);
  set('--av-pants-d', mix(pants, '#120a18', 0.3));
  set('--av-bow', luminance(shirt) < 0.09 ? '#b93445' : '#2b2230');
}

/** Square viewBox for a head-and-shoulders crop of the look. */
function bustBox(look) {
  const top = Math.min(figureTop(look), 15) - 2.5;
  const size = clamp(58.5 - top, 46, 66);
  return `${r1(33 - size / 2)} ${r1(top)} ${r1(size)} ${r1(size)}`;
}

/** A static (non-animated) drawing of a look with the given viewBox. */
function staticFigure(look, avatarIndex, viewBox, parts) {
  const node = svg('svg', { class: 'av-svg av-static', viewBox, focusable: 'false', 'aria-hidden': 'true' });
  node.innerHTML = figureMarkup(look, nextUid(), parts);
  paint(node, look, avatarIndex);
  return node;
}

/** A pet on its own (shop thumbnails). */
function petFigure(key) {
  const pet = PETS[key];
  const node = svg('svg', { class: 'av-svg av-static', viewBox: pet ? pet.box : '0 0 36 36', focusable: 'false', 'aria-hidden': 'true' });
  if (pet) node.innerHTML = pet.art;
  return node;
}

const MOODS = ['cheer', 'love', 'hit', 'sad'];

function setMood(node, mood) {
  for (const name of MOODS) node.classList.toggle(`mood-${name}`, name === mood);
}

/* ==========================================================================
   createAvatar — the full-body character
   ========================================================================== */

/**
 * createAvatar(player, opts) -> <span class="avatar-char">
 * opts: { size (height in px, default 72 — omit to size it with the CSS
 *         variable --av-size), walking = false, facing = 'right',
 *         pet = true, aura = true (draw those parts or not) }
 * The box is size * 0.64 wide; pets and auras overflow it.
 * Methods (all return the element): update(player), setWalking(bool),
 * setFacing('left' | 'right'), setMood('cheer' | 'love' | 'hit' | 'sad' | null).
 */
export function createAvatar(player, opts = {}) {
  const art = svg('svg', { class: 'av-svg', viewBox: '0 0 64 100', focusable: 'false', 'aria-hidden': 'true' });
  const node = el('span', { class: 'avatar-char', attrs: { role: 'img' } }, art);
  const uid = nextUid();
  const parts = { pet: opts.pet !== false, aura: opts.aura !== false };
  let drawn = '';

  if (Number.isFinite(opts.size)) node.style.setProperty('--av-size', `${opts.size}px`);
  node.style.setProperty('--av-seed', Math.random().toFixed(3));

  node.update = (next) => {
    const data = next || {};
    const look = normLook(data.look);
    const key = lookKey(look);
    if (key !== drawn) {
      drawn = key;
      art.innerHTML = figureMarkup(look, uid, parts);
      node.style.setProperty('--av-top', String(r1(figureTop(look)) / 100));
      node.dataset.pet = parts.pet ? look.pet : 'none';
    }
    paint(node, look, normAvatar(data.avatar));
    node.setAttribute('aria-label', data.name ? `Avatar de ${data.name}` : 'Avatar');
    node.classList.toggle('is-offline', data.connected === false);
    return node;
  };

  node.setWalking = (flag) => {
    node.classList.toggle('is-walking', !!flag);
    return node;
  };

  node.setFacing = (dir) => {
    node.classList.toggle('is-left', dir === 'left');
    return node;
  };

  node.setMood = (mood) => {
    setMood(node, mood);
    return node;
  };

  node.update(player);
  node.setWalking(opts.walking);
  node.setFacing(opts.facing);
  return node;
}

/* ==========================================================================
   createBust — head and shoulders in a circle
   ========================================================================== */

/**
 * createBust(player, opts) -> <span class="avatar-bust">
 * opts: { size (px, default 36 — omit to size it with --bust-size) }
 * Exposes element.update(player).
 */
export function createBust(player, opts = {}) {
  const node = el('span', { class: 'avatar-bust', attrs: { role: 'img' } });
  if (Number.isFinite(opts.size)) node.style.setProperty('--bust-size', `${opts.size}px`);
  let drawn = '';

  node.update = (next) => {
    const data = next || {};
    const look = normLook(data.look);
    const index = normAvatar(data.avatar);
    const key = `${lookKey(look)}.${index}`;
    if (key !== drawn) {
      drawn = key;
      const shirt = avatarColor(index);
      while (node.firstChild) node.removeChild(node.firstChild);
      node.appendChild(staticFigure(look, index, bustBox(look), { pet: false, aura: false }));
      node.style.setProperty('--bust-a', mix(shirt, '#1c1226', 0.5));
      node.style.setProperty('--bust-b', mix(shirt, '#0e0814', 0.8));
      node.dataset.aura = look.aura;
    }
    node.setAttribute('aria-label', data.name ? `Avatar de ${data.name}` : 'Avatar');
    node.classList.toggle('is-offline', data.connected === false);
    return node;
  };

  node.update(player);
  return node;
}

/* ==========================================================================
   Parade — effects artwork
   ========================================================================== */

const FX_LINE = '#3b2a49';

const SHOTS = {
  tomato:
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="18" r="11" fill="#e5383b" stroke="' + FX_LINE + '" stroke-width="1.6"/>' +
    '<path d="M9 14c1.8-2.2 4.2-3.4 6.8-3.4" stroke="#ff9a8f" stroke-width="2" stroke-linecap="round" fill="none"/>' +
    '<path d="M16 10l-4-3.4 4.6.6L18 3l1.8 4 4.2-.6-3.2 3.4z" fill="#3fa34d" stroke="' + FX_LINE + '" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  cake:
    '<svg viewBox="0 0 32 32"><path d="M5 17h22v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="#f2d3a0" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M5 22h22" stroke="#d99a5b" stroke-width="2"/>' +
    '<path d="M3.6 17.4c0-5 5.4-8.4 12.4-8.4s12.4 3.4 12.4 8.4c-1.6 2-3.4 2-4.8 0-1.6 2.2-3.6 2.2-5.2 0-1.6 2.2-3.4 2.2-5 0-1.4 2.2-3.4 2.2-5 0-1.4 2-3.2 2-4.8 0z" fill="#fff3dc" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="16" cy="7.4" r="3.4" fill="#d43a4c" stroke="' + FX_LINE + '" stroke-width="1.4"/></svg>',
  rose:
    '<svg viewBox="0 0 32 32"><path d="M16 17v13" stroke="#2f8f4e" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M16 24c2.8-3 6-2.8 7.6-1-1.6 2.8-4.8 3.2-7.6 1z" fill="#3fa34d" stroke="' + FX_LINE + '" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M16 2.6c3 1.6 7.4 2.6 7.4 8.4 0 4.6-3.2 7.8-7.4 7.8S8.6 15.6 8.6 11c0-5.8 4.4-6.8 7.4-8.4z" fill="#d43a4c" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M16 7c2.4.4 3.8 2 3.6 4.2-.2 2.4-2.4 3.8-4.6 3.2-2.4-.6-3.4-3-2.4-5.2" stroke="#8f1f31" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
  water:
    '<svg viewBox="0 0 32 32"><path d="M16 3c5.6 6.2 9.8 10.8 9.8 16.2A9.8 9.8 0 0 1 6.2 19.2C6.2 13.8 10.4 9.2 16 3z" fill="#4aa8f0" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M10.6 19.4c0-2.8 1.4-5 3.2-7" stroke="#d8efff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
};

const BLOB = 'M20 5c2.4 3.6 6 3.2 9.2 1.6-1 3.4.8 6.2 4.4 7-3 2.2-3.2 5.4-1 8-3.6.4-5.6 2.8-5.4 6.2-3.2-1.8-6-.8-7.2 2.4-1.4-3.2-4.4-4-7.2-2.2.2-3.4-1.8-5.6-5.4-6 2.2-2.8 1.8-5.8-1.2-8 3.6-1 5-3.6 4.4-7.2 3.4 1.6 7 1.8 9.4-1.8z';

const SPLATS = {
  tomato:
    `<svg viewBox="0 0 40 40"><path d="${BLOB}" fill="#e5383b" stroke="#a61f2b" stroke-width="1"/>` +
    '<path d="M13 29v6.5a1.8 1.8 0 0 0 3.6 0V30M25 29.5v4a1.5 1.5 0 0 0 3 0v-3.5" fill="#e5383b"/>' +
    '<circle cx="17" cy="16" r="1.3" fill="#ffd166"/><circle cx="23.5" cy="20" r="1.2" fill="#ffd166"/><circle cx="19" cy="23" r="1.1" fill="#ffd166"/>' +
    '<path d="M14 13c2-1.8 4.4-2.4 6.6-2" stroke="#ff8f84" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  cake:
    `<svg viewBox="0 0 40 40"><path d="${BLOB}" fill="#fff3dc" stroke="#e2c79a" stroke-width="1"/>` +
    '<path d="M12 28.5v6a1.8 1.8 0 0 0 3.6 0v-5M26 29v4.5a1.6 1.6 0 0 0 3.2 0V30" fill="#fff3dc"/>' +
    '<circle cx="15" cy="16" r="3" fill="#f590ae"/><circle cx="26" cy="21" r="2.4" fill="#f590ae"/>' +
    '<circle cx="21.5" cy="13" r="3" fill="#d43a4c" stroke="#8f1f31" stroke-width=".8"/><circle cx="18" cy="24" r="1.6" fill="#d99a5b"/></svg>',
  rose:
    '<svg viewBox="0 0 40 40"><path d="M20 34.5C10 27 6 22 6 16.5 6 12 9.4 9 13.2 9c2.8 0 5.2 1.4 6.8 4 1.6-2.6 4-4 6.8-4C30.6 9 34 12 34 16.5 34 22 30 27 20 34.5z" fill="#e5596a" stroke="#8f1f31" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M11.5 16c.4-2.2 1.8-3.4 3.6-3.6" stroke="#ffc2c9" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  water:
    '<svg viewBox="0 0 40 40"><g fill="#4aa8f0" fill-opacity=".9" stroke="#2b7bc4" stroke-width=".8">' +
    '<path d="M20 4c3 3.6 5.4 6.4 5.4 9.6a5.4 5.4 0 0 1-10.8 0C14.6 10.4 17 7.6 20 4z"/>' +
    '<path d="M9 14c2 2.4 3.6 4.2 3.6 6.4a3.6 3.6 0 0 1-7.2 0C5.4 18.2 7 16.4 9 14z"/>' +
    '<path d="M31 15c2 2.4 3.6 4.2 3.6 6.4a3.6 3.6 0 0 1-7.2 0c0-2.2 1.6-4 3.6-6.4z"/>' +
    '<path d="M15 25c1.8 2.2 3.2 3.8 3.2 5.8a3.2 3.2 0 0 1-6.4 0c0-2 1.4-3.6 3.2-5.8z"/>' +
    '<path d="M26 26c1.6 2 2.8 3.4 2.8 5.2a2.8 2.8 0 0 1-5.6 0c0-1.8 1.2-3.2 2.8-5.2z"/></g>' +
    '<path d="M18 11.5c0-1.4.6-2.6 1.4-3.6" stroke="#d8efff" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
};

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21C5.5 16 2.5 12.6 2.5 8.6 2.5 5.6 4.8 3.4 7.6 3.4c1.9 0 3.5 1 4.4 2.6.9-1.6 2.5-2.6 4.4-2.6 2.8 0 5.1 2.2 5.1 5.2 0 4-3 7.4-9.5 12.4z" fill="#e5596a" stroke="#8f1f31" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const STAR = '<svg viewBox="-6 -6 12 12"><path d="M0-5.4Q.8-.8 5.4 0 .8.8 0 5.4-.8.8-5.4 0-.8-.8 0-5.4z" fill="#f3dfa2" stroke="#b8923f" stroke-width=".6"/></svg>';
const CLOUD =
  '<svg viewBox="0 0 44 40"><path d="M11 21a7 7 0 0 1 1.6-13.8A9.5 9.5 0 0 1 30.8 6 7.6 7.6 0 0 1 33 21z" fill="#8a8198" stroke="#3b2a49" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 12.5a5 5 0 0 1 4.6-3.5" stroke="#b9b1c6" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
  '<g fill="#6fb6f2"><path class="parade__drop" style="animation-delay:0s" d="M14 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/>' +
  '<path class="parade__drop" style="animation-delay:-.25s" d="M22 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/>' +
  '<path class="parade__drop" style="animation-delay:-.5s" d="M30 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/></g></svg>';
const CROWN_MINI = '<svg viewBox="0 0 16 12"><path d="M1.5 10.5L.8 3.2l3.7 3L8 1l3.5 5.2 3.7-3-.7 7.3z" fill="#e6c878" stroke="#6e5320" stroke-width="1" stroke-linejoin="round"/></svg>';
const MARKER = '<svg viewBox="0 0 14 10"><path d="M1.6 1.2h10.8L7 8.8z" fill="#f3dfa2" stroke="#6e5320" stroke-width="1.2" stroke-linejoin="round"/></svg>';

const THROWS = {
  tomato: { burst: ['#e5383b', '#ff6b5e', '#b3202f', '#ffd166'], mood: 'hit' },
  cake: { burst: ['#fff3dc', '#f590ae', '#d99a5b', '#fffdf6'], mood: 'hit' },
  rose: { burst: ['#e5596a', '#d43a4c', '#f590ae', '#ffc2c9'], mood: 'love', petals: true },
  water: { burst: ['#4aa8f0', '#9ad2ff', '#d8efff', '#6fb6f2'], mood: 'hit' },
};

function setArt(node, markup) {
  node.innerHTML = markup; // artwork authored in this file
  return node;
}

/* ==========================================================================
   createParade — the walking lane
   ========================================================================== */

/**
 * createParade(opts) -> <div class="parade">
 * opts: { onPick(playerId), reducedMotion (force it on / off; default: the OS setting) }
 * Methods: sync(players, meId), emote(id, emoji), throwAt(fromId, toId, item, opts),
 * cheer(id), sad(id), position(id) -> { x, y } | null, destroy().
 * The lane fills its container's width; its height is --parade-h (96px).
 */
export function createParade(opts = {}) {
  const floor = el('div', { class: 'parade__floor', attrs: { 'aria-hidden': 'true' } });
  const root = el('div', { class: 'parade', attrs: { role: 'group', 'aria-label': 'Jugadores en la sala' } }, floor);

  const walkers = new Map();
  const timers = new Set();
  const shots = [];
  let meId = null;
  let destroyed = false;
  let placedOnce = false;
  let raf = 0;
  let wake = 0;
  let lastTs = 0;
  let lastTagLayout = 0;
  let width = 0;
  let height = 0;
  let fxLayer = null;
  let observer = null;
  const m = { compact: false, rows: 1, rowH: 18, tagsH: 21, charH: 64, charW: 41 };

  const still = () => (opts.reducedMotion != null ? !!opts.reducedMotion : prefersReducedMotion());
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function cancel(id) {
    clearTimeout(id);
    timers.delete(id);
  }

  /* ---- geometry ---------------------------------------------------------- */

  function measure() {
    width = root.clientWidth;
    height = root.clientHeight;
    if (!width || !height) return false;
    const count = Math.max(1, walkers.size);
    m.compact = width < 560;
    m.rows = count * (m.compact ? 74 : 98) > width * 0.9 ? 2 : 1;
    m.rowH = m.compact ? 15 : 18;
    m.tagsH = m.rows * m.rowH + 3;
    m.charH = Math.round(clamp(height - m.tagsH - 3, 34, m.compact ? 56 : 72));
    m.charW = m.charH * 0.64;
    root.classList.toggle('parade--compact', m.compact);
    root.style.setProperty('--pw-char', `${m.charH}px`);
    root.style.setProperty('--pw-row', `${m.rowH}px`);
    root.style.setProperty('--pw-tags', `${m.tagsH}px`);
    for (const w of walkers.values()) w.tagW = w.tag.offsetWidth || w.tagW;
    return true;
  }

  function range(w) {
    const pad = m.charW / 2 + 6 + (w && w.petRoom ? m.charH * 0.26 : 0);
    const min = Math.min(pad, width / 2);
    return [min, Math.max(min, width - pad)];
  }

  function place(w) {
    const half = w.tagW / 2;
    const shift = half * 2 + 4 >= width ? 0 : clamp(w.x, half + 2, width - half - 2) - w.x;
    w.node.style.transform = `translate3d(${w.x.toFixed(1)}px,0,0)`;
    if (shift !== w.tagShift) {
      w.tagShift = shift;
      w.node.style.setProperty('--pw-shift', `${shift.toFixed(1)}px`);
    }
  }

  function setRow(w, row) {
    if (w.row === row) return;
    w.row = row;
    w.node.style.setProperty('--pw-rowi', String(row));
  }

  /** Two label rows on crowded lanes: neighbours take turns so names stay readable. */
  function layoutTags() {
    lastTagLayout = now();
    const list = [...walkers.values()].filter((w) => w.x != null && !w.leaving).sort((a, b) => a.x - b.x);
    if (m.rows < 2) {
      for (const w of list) setRow(w, 0);
      return;
    }
    const right = [-1e9, -1e9];
    const gap = 3;
    for (const w of list) {
      const half = w.tagW / 2;
      const cx = clamp(w.x, half + 2, Math.max(half + 2, width - half - 2));
      const left = cx - half;
      const fits = [left >= right[0] + gap, left >= right[1] + gap];
      let row;
      if (fits[w.row]) row = w.row;
      else if (fits[1 - w.row]) row = 1 - w.row;
      else row = right[0] <= right[1] ? 0 : 1;
      if (row === 1 && left >= right[0] + gap + 8) row = 0;
      right[row] = cx + half;
      setRow(w, row);
    }
  }

  /** Random spot that keeps away from where the others are (or are going). */
  function pickTarget(w) {
    const [min, max] = range(w);
    let best = w.x;
    let bestScore = -1;
    for (let i = 0; i < 7; i++) {
      const x = min + Math.random() * (max - min);
      let score = 1e9;
      for (const other of walkers.values()) {
        if (other === w || other.x == null) continue;
        score = Math.min(score, Math.abs(x - (other.state === 'walk' ? other.target : other.x)));
      }
      score = Math.min(score, Math.abs(x - w.x) * 1.4 + 6);
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  function spread() {
    const list = [...walkers.values()].filter((w) => !w.leaving);
    list.forEach((w, i) => {
      const [min, max] = range(w);
      w.x = min + ((i + 0.5) * (max - min)) / list.length;
      w.target = w.x;
      w.state = 'idle';
      face(w, 'right');
      walkAnim(w, false);
      place(w);
    });
  }

  /* ---- walker state ------------------------------------------------------ */

  function face(w, dir) {
    if (w.facing === dir) return;
    w.facing = dir;
    w.avatar.setFacing(dir);
  }

  function walkAnim(w, flag) {
    if (w.walking === flag) return;
    w.walking = flag;
    w.avatar.setWalking(flag);
    w.node.classList.toggle('is-walking', flag);
  }

  function hold(w, ms) {
    w.holdUntil = Math.max(w.holdUntil, now() + ms);
    walkAnim(w, false);
    ensureLoop();
  }

  function rest(w, t) {
    w.state = 'idle';
    w.idleUntil = t + 1000 + Math.random() * 3000;
    walkAnim(w, false);
  }

  function pulse(node, cls, ms) {
    node.classList.remove(cls);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(cls);
    return later(() => node.classList.remove(cls), ms);
  }

  function mood(w, name, ms) {
    cancel(w.moodTimer);
    w.avatar.setMood(name);
    w.moodTimer = later(() => w.avatar.setMood(null), ms);
  }

  function alive(w) {
    return !destroyed && walkers.get(w.id) === w && !w.leaving;
  }

  /* ---- loop -------------------------------------------------------------- */

  function tick(ts) {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    const t = now();
    const frozen = still();
    let active = false;
    let next = Infinity;

    for (const w of walkers.values()) {
      if (w.x == null || w.leaving) continue;
      const free = Math.max(w.holdUntil, 0);
      if (w.state === 'walk') {
        if (frozen || w.player.connected === false) {
          rest(w, t);
          continue;
        }
        if (t < free) {
          walkAnim(w, false);
          next = Math.min(next, free);
          continue;
        }
        const delta = w.target - w.x;
        face(w, delta >= 0 ? 'right' : 'left');
        walkAnim(w, true);
        const step = m.charH * 0.6 * w.pace * dt;
        if (Math.abs(delta) <= step) {
          w.x = w.target;
          rest(w, t);
          next = Math.min(next, w.idleUntil);
        } else {
          w.x += Math.sign(delta) * step;
          active = true;
        }
        place(w);
      } else if (!frozen && w.player.connected !== false) {
        const at = Math.max(w.idleUntil, free);
        if (t >= at) {
          w.target = pickTarget(w);
          if (Math.abs(w.target - w.x) > 4) {
            w.state = 'walk';
            active = true;
          } else {
            rest(w, t);
            next = Math.min(next, w.idleUntil);
          }
        } else {
          next = Math.min(next, at);
        }
      }
    }

    for (let i = shots.length - 1; i >= 0; i--) stepShot(shots[i], t);
    if (shots.length) active = true;

    if (active && t - lastTagLayout > 140) layoutTags();

    if (active) {
      raf = requestAnimationFrame(tick);
    } else {
      lastTs = 0;
      layoutTags();
      if (next < Infinity) {
        clearTimeout(wake);
        wake = setTimeout(ensureLoop, Math.max(30, next - t));
      }
    }
  }

  function ensureLoop() {
    if (destroyed || raf) return;
    clearTimeout(wake);
    wake = 0;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }

  /* ---- walkers ----------------------------------------------------------- */

  function describe(p, isMe) {
    const bits = [p.name ? String(p.name) : 'Jugador'];
    if (isMe) bits[0] += ' (vos)';
    bits.push(`nivel ${levelOf(p)}`);
    if (p.crown) bits.push('con corona');
    if (Number(p.debt) > 0) bits.push('debe fichas');
    if (p.connected === false) bits.push('sin conexión');
    return bits.join(', ');
  }

  function levelOf(p) {
    const n = Math.trunc(Number(p.level));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function paintWalker(w, p) {
    w.player = p;
    const look = normLook(p.look);
    const color = avatarColor(normAvatar(p.avatar));
    const isMe = w.id === meId;
    w.avatar.update(p);
    w.petRoom = PETS[look.pet] ? PETS[look.pet].ground : false;
    w.name.textContent = p.name ? String(p.name) : 'Jugador';
    w.level.textContent = `Nv ${levelOf(p)}`;
    w.crown.hidden = !p.crown;
    w.debt.hidden = !(Number(p.debt) > 0);
    w.marker.hidden = !isMe;
    w.node.classList.toggle('is-me', isMe);
    w.node.classList.toggle('is-offline', p.connected === false);
    w.node.style.setProperty('--pw-color', color);
    w.node.style.setProperty('--pw-ink', luminance(color) > 0.36 ? '#1c1a24' : '#fffdf6');
    w.node.style.setProperty('--pw-top', String(r1(figureTop(look)) / 100));
    w.node.setAttribute('aria-label', describe(p, isMe));
    w.tagW = w.tag.offsetWidth || w.tagW;
  }

  function addWalker(p) {
    const id = p.id;
    const avatar = createAvatar(p, { facing: 'right' });
    avatar.removeAttribute('role');
    avatar.setAttribute('aria-hidden', 'true');
    const marker = setArt(el('span', { class: 'parade__marker', attrs: { 'aria-hidden': 'true' } }), MARKER);
    const body = el('span', { class: 'parade__body' }, avatar);
    const level = el('span', { class: 'parade__lvl' });
    const crown = setArt(el('span', { class: 'parade__crown' }), CROWN_MINI);
    const name = el('span', { class: 'parade__name' });
    const debt = el('span', { class: 'parade__debt' }, 'debe');
    const tag = el('span', { class: 'parade__tag', attrs: { 'aria-hidden': 'true' } }, level, crown, name, debt);
    const node = el('button', { type: 'button', class: 'parade__walker' }, body, marker, tag);
    const w = {
      id, node, body, avatar, marker, tag, level, crown, name, debt,
      player: p, x: null, target: 0, state: 'idle', facing: 'right', walking: false,
      idleUntil: 0, holdUntil: 0, row: 0, tagW: 60, tagShift: 0, petRoom: false,
      pace: 0.88 + Math.random() * 0.3, leaving: false, moodTimer: 0, bubble: null, bubbleTimer: 0, stain: null, cloud: null,
    };
    node.addEventListener('click', () => {
      if (typeof opts.onPick === 'function') opts.onPick(id);
    });
    walkers.set(id, w);
    root.appendChild(node);
    paintWalker(w, p);
    return w;
  }

  function enter(w, fresh) {
    const [min, max] = range(w);
    const t = now();
    if (still()) return;
    if (fresh) {
      w.x = min + Math.random() * (max - min);
      for (let i = 0; i < 6; i++) {
        const x = min + Math.random() * (max - min);
        let near = 1e9;
        let nearX = 1e9;
        for (const other of walkers.values()) {
          if (other === w || other.x == null) continue;
          near = Math.min(near, Math.abs(w.x - other.x));
          nearX = Math.min(nearX, Math.abs(x - other.x));
        }
        if (nearX > near) w.x = x;
      }
      w.target = w.x;
      w.idleUntil = t + 300 + Math.random() * 2600;
      face(w, Math.random() < 0.5 ? 'left' : 'right');
    } else {
      const fromLeft = Math.random() < 0.5;
      w.x = fromLeft ? m.charW / 2 : width - m.charW / 2;
      w.target = pickTarget(w);
      w.state = 'walk';
      face(w, fromLeft ? 'right' : 'left');
      pulse(w.node, 'is-entering', 500);
    }
    place(w);
  }

  function dropWalker(w) {
    w.leaving = true;
    walkers.delete(w.id);
    cancel(w.moodTimer);
    cancel(w.bubbleTimer);
    w.node.classList.add('is-leaving');
    w.node.disabled = true;
    later(() => w.node.remove(), still() ? 0 : 320);
  }

  function sync(players, me) {
    if (destroyed) return root;
    meId = me == null ? null : me;
    const list = Array.isArray(players) ? players.filter((p) => p && p.id != null) : [];
    const seen = new Set();
    const added = [];
    for (const p of list) {
      seen.add(p.id);
      const existing = walkers.get(p.id);
      if (existing) paintWalker(existing, p);
      else added.push(addWalker(p));
    }
    for (const w of [...walkers.values()]) if (!seen.has(w.id)) dropWalker(w);

    if (measure()) {
      if (still()) {
        spread();
      } else {
        for (const w of added) enter(w, !placedOnce);
        for (const w of walkers.values()) {
          if (w.x == null) enter(w, true);
          const [min, max] = range(w);
          w.target = clamp(w.target, min, max);
        }
      }
      placedOnce = placedOnce || walkers.size > 0;
      layoutTags();
    }
    ensureLoop();
    return root;
  }

  function onResize() {
    if (destroyed) return;
    const before = width;
    if (!measure()) return;
    if (still()) {
      spread();
    } else {
      // keep everybody's relative place when the lane changes width
      const ratio = before > 0 ? width / before : 1;
      for (const w of walkers.values()) {
        const [min, max] = range(w);
        if (w.x == null) {
          enter(w, !placedOnce);
        } else {
          w.x = clamp(w.x * ratio, m.charW / 2, Math.max(m.charW / 2, width - m.charW / 2));
          w.target = clamp(w.target * ratio, min, max);
          place(w);
        }
      }
      placedOnce = placedOnce || walkers.size > 0;
    }
    layoutTags();
    ensureLoop();
  }

  /* ---- effects ----------------------------------------------------------- */

  function fx() {
    if (!fxLayer) fxLayer = el('div', { class: 'parade-fx', attrs: { 'aria-hidden': 'true' } });
    if (!fxLayer.isConnected) document.body.appendChild(fxLayer);
    return fxLayer;
  }

  function headOf(w) {
    const rect = w.avatar.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.36 };
  }

  function position(id) {
    const w = walkers.get(id);
    if (!w || w.x == null || !root.isConnected) return null;
    return headOf(w);
  }

  function burst(point, colors, count, petals) {
    if (still()) return;
    const layer = fx();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = 18 + Math.random() * 34;
      const size = 3 + Math.random() * 5;
      const bit = el('span', { class: petals ? 'parade-fx__bit parade-fx__bit--petal' : 'parade-fx__bit' });
      bit.style.cssText =
        `left:${point.x.toFixed(1)}px;top:${point.y.toFixed(1)}px;width:${size.toFixed(1)}px;height:${(petals ? size * 1.5 : size).toFixed(1)}px;` +
        `background:${colors[i % colors.length]};--dx:${(Math.cos(angle) * reach).toFixed(1)}px;--dy:${(Math.sin(angle) * reach - 10).toFixed(1)}px;` +
        `--rot:${Math.round(Math.random() * 540 - 270)}deg;animation-delay:${Math.round(Math.random() * 60)}ms`;
      layer.appendChild(bit);
      later(() => bit.remove(), 900);
    }
  }

  function splatAt(point, kind, ms) {
    const node = setArt(el('span', { class: `parade-fx__splat parade-fx__splat--${kind}` }), SPLATS[kind]);
    node.style.left = `${point.x.toFixed(1)}px`;
    node.style.top = `${point.y.toFixed(1)}px`;
    fx().appendChild(node);
    later(() => node.classList.add('is-fading'), Math.max(0, ms - 500));
    later(() => node.remove(), ms);
  }

  function floaters(w, markup, count, cls) {
    if (still()) return;
    for (let i = 0; i < count; i++) {
      const bit = setArt(el('span', { class: `parade__floater ${cls}` }), markup);
      bit.style.setProperty('--fx', `${Math.round((Math.random() - 0.5) * 34)}px`);
      bit.style.setProperty('--fr', `${Math.round((Math.random() - 0.5) * 50)}deg`);
      bit.style.animationDelay = `${i * 110}ms`;
      w.body.appendChild(bit);
      later(() => bit.remove(), 1500 + i * 110);
    }
  }

  function stain(w, kind) {
    if (w.stain) w.stain.remove();
    const node = setArt(el('span', { class: `parade__stain parade__stain--${kind}` }), SPLATS[kind]);
    w.stain = node;
    w.body.appendChild(node);
    later(() => node.classList.add('is-fading'), 3900);
    later(() => {
      node.remove();
      if (w.stain === node) w.stain = null;
    }, 4600);
  }

  function react(w, kind, dir) {
    const def = THROWS[kind];
    stain(w, kind);
    if (def.mood === 'love') {
      mood(w, 'love', 2400);
      pulse(w.body, 'is-happy', 1000);
      floaters(w, HEART, 4, 'parade__floater--heart');
      hold(w, 1300);
    } else {
      w.body.style.setProperty('--hit', String(dir >= 0 ? 1 : -1));
      mood(w, 'hit', 1500);
      pulse(w.body, 'is-hit', 800);
      hold(w, 1200);
    }
  }

  function stepShot(shot, t) {
    if (shot.done) return;
    const k = clamp((t - shot.t0) / shot.dur, 0, 1);
    const to = shot.aim() || shot.last;
    shot.last = to;
    const x = shot.from.x + (to.x - shot.from.x) * k;
    const y = shot.from.y + (to.y - shot.from.y) * k - 4 * shot.arc * k * (1 - k);
    shot.node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${(shot.spin * k).toFixed(1)}deg)`;
    if (k >= 1) landShot(shot);
  }

  function landShot(shot) {
    if (shot.done) return;
    shot.done = true;
    cancel(shot.timer);
    shot.node.remove();
    const index = shots.indexOf(shot);
    if (index >= 0) shots.splice(index, 1);
    shot.land(shot.last, Math.sign(shot.last.x - shot.from.x) || 1);
  }

  /**
   * throwAt(fromId, toId, item, opts)
   * item: 'tomato' | 'cake' | 'rose' | 'water'. toId may be 'dealer' with
   * opts.target = the element to aim at. opts.onImpact() fires on impact.
   */
  function throwAt(fromId, toId, item, o = {}) {
    if (destroyed || !root.isConnected) return root;
    const kind = has(THROWS, item) ? item : 'tomato';
    const def = THROWS[kind];
    const lane = root.getBoundingClientRect();
    const thrower = walkers.get(fromId);
    const victim = toId === 'dealer' ? null : walkers.get(toId);
    const targetEl = toId === 'dealer' && o.target && typeof o.target.getBoundingClientRect === 'function' ? o.target : null;
    if (toId !== 'dealer' && (!victim || victim.x == null)) return root;

    const aim = () => {
      if (victim) return alive(victim) ? headOf(victim) : null;
      if (targetEl && targetEl.isConnected) {
        const rect = targetEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.42 };
      }
      return { x: lane.left - 40, y: lane.top + lane.height * 0.3 };
    };
    const end = aim();
    if (!end) return root;

    let from = null;
    if (thrower && thrower.x != null && thrower !== victim) {
      const head = headOf(thrower);
      if (head) from = { x: head.x, y: head.y + m.charH * 0.12 };
      if (!still()) {
        face(thrower, end.x >= (head ? head.x : 0) ? 'right' : 'left');
        pulse(thrower.body, 'is-throwing', 420);
        hold(thrower, 650);
      }
    }
    if (!from) {
      const fromRight = end.x < lane.left + lane.width / 2;
      from = { x: fromRight ? lane.right - 6 : lane.left + 6, y: lane.top + lane.height * 0.35 };
    }

    const land = (point, dir) => {
      burst(point, def.burst, def.petals ? 9 : 12, !!def.petals);
      if (victim && alive(victim)) {
        if (!still()) splatAt(point, kind, 520);
        react(victim, kind, dir);
      } else {
        splatAt(point, kind, 2600);
      }
      if (typeof o.onImpact === 'function') {
        try {
          o.onImpact();
        } catch (err) {
          console.error(err);
        }
      }
    };

    if (still()) {
      land(end, Math.sign(end.x - from.x) || 1);
      return root;
    }

    const dist = Math.hypot(end.x - from.x, end.y - from.y);
    const node = setArt(el('span', { class: `parade-fx__shot parade-fx__shot--${kind}` }), SHOTS[kind]);
    fx().appendChild(node);
    const shot = {
      node, from, aim, land, last: end, done: false, t0: now(),
      dur: clamp(380 + dist * 0.9, 480, 1150),
      arc: clamp(dist * 0.34, 46, 200),
      spin: (kind === 'rose' ? 200 : 420 + Math.random() * 300) * (end.x >= from.x ? 1 : -1),
      timer: 0,
    };
    shot.timer = later(() => landShot(shot), shot.dur + 150);
    shots.push(shot);
    stepShot(shot, shot.t0);
    ensureLoop();
    return root;
  }

  /** Speech-bubble emoji above a walker for ~2.5 s, with a little hop. */
  function emote(id, emoji) {
    const w = walkers.get(id);
    if (!w || destroyed) return root;
    if (w.bubble) w.bubble.remove();
    cancel(w.bubbleTimer);
    const bubble = el('span', { class: 'parade__bubble', attrs: { 'aria-hidden': 'true' } }, el('span', { class: 'parade__bubble-text' }, String(emoji == null ? '' : emoji)));
    w.bubble = bubble;
    w.node.appendChild(bubble);
    pulse(w.body, 'is-hop', 520);
    hold(w, 700);
    w.bubbleTimer = later(() => {
      bubble.classList.add('is-leaving');
      later(() => {
        bubble.remove();
        if (w.bubble === bubble) w.bubble = null;
      }, 220);
    }, 2500);
    return root;
  }

  function cheer(id) {
    const w = walkers.get(id);
    if (!w || destroyed) return root;
    mood(w, 'cheer', 1500);
    pulse(w.body, 'is-cheer', 1250);
    floaters(w, STAR, 6, 'parade__floater--star');
    hold(w, 1400);
    return root;
  }

  function sad(id) {
    const w = walkers.get(id);
    if (!w || destroyed) return root;
    mood(w, 'sad', 3000);
    pulse(w.body, 'is-sad', 3000);
    if (w.cloud) w.cloud.remove();
    const cloud = setArt(el('span', { class: 'parade__cloud', attrs: { 'aria-hidden': 'true' } }), CLOUD);
    w.cloud = cloud;
    w.node.appendChild(cloud);
    later(() => cloud.classList.add('is-leaving'), 2700);
    later(() => {
      cloud.remove();
      if (w.cloud === cloud) w.cloud = null;
    }, 3000);
    hold(w, 3000);
    return root;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(wake);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (observer) observer.disconnect();
    else if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    observer = null;
    shots.length = 0;
    if (fxLayer) fxLayer.remove();
    fxLayer = null;
    for (const w of walkers.values()) w.node.remove();
    walkers.clear();
    root.remove();
  }

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(onResize);
    observer.observe(root);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  root.sync = sync;
  root.emote = emote;
  root.throwAt = throwAt;
  root.cheer = cheer;
  root.sad = sad;
  root.position = position;
  root.destroy = destroy;
  return root;
}

/* ==========================================================================
   createLookEditor — the customisation UI
   ========================================================================== */

const EDITOR_TABS = [
  { id: 'body', label: 'Cuerpo' },
  { id: 'clothes', label: 'Ropa' },
  { id: 'hat', label: 'Sombreros', slot: 'hat' },
  { id: 'glasses', label: 'Lentes', slot: 'glasses' },
  { id: 'neck', label: 'Cuello', slot: 'neck' },
  { id: 'pet', label: 'Mascotas', slot: 'pet' },
  { id: 'aura', label: 'Auras', slot: 'aura' },
];

const SLOT_BOX = { glasses: '17.5 20 35 35', neck: '14 39.5 37 37', aura: '-24 -8 112 112' };

/** Arrow keys move the selection inside a radio group / tab list. */
function roving(group, buttons, choose) {
  group.addEventListener('keydown', (ev) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    buttons[next].focus();
    choose(next);
  });
}

function empty(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * createLookEditor(opts) -> <div class="look-editor">
 * opts: { player: { avatar, look, name }, catalog, owned, balance, canBuy,
 *         lockedReason, onChange(look, avatar), onBuy(itemId) }
 * Methods: refresh({ player, owned, balance, canBuy, lockedReason, catalog }), destroy().
 */
export function createLookEditor(opts = {}) {
  const st = {
    name: '', avatar: 0, look: normLook(null), catalog: [], owned: new Set(),
    balance: 0, canBuy: true, lockedReason: '', tab: 'body', trying: null, pending: null, facing: 'right',
  };
  let pendingTimer = 0;
  let observer = null;

  function absorb(src) {
    if (!src || typeof src !== 'object') return;
    if (src.player && typeof src.player === 'object') {
      st.name = src.player.name ? String(src.player.name) : '';
      st.avatar = normAvatar(src.player.avatar);
      st.look = normLook(src.player.look);
    }
    if (Array.isArray(src.catalog)) {
      st.catalog = src.catalog
        .filter((item) => item && has(LOOK_PAID, item.slot) && item.id != null && item.key != null)
        .map((item) => ({
          id: String(item.id), slot: item.slot, key: String(item.key),
          name: item.name ? String(item.name) : String(item.key),
          price: Math.max(0, Math.trunc(Number(item.price) || 0)),
        }));
    }
    if (Array.isArray(src.owned)) st.owned = new Set(src.owned.map(String));
    if (src.balance != null && Number.isFinite(Number(src.balance))) st.balance = Number(src.balance);
    if (src.canBuy != null) st.canBuy = !!src.canBuy;
    if (src.lockedReason != null) st.lockedReason = String(src.lockedReason);
  }

  absorb({ player: opts.player || {}, catalog: opts.catalog || [], owned: opts.owned || [], balance: opts.balance, canBuy: opts.canBuy, lockedReason: opts.lockedReason });

  const shown = () => (st.trying ? { ...st.look, [st.trying.slot]: st.trying.key } : st.look);
  const bare = () => ({ ...st.look, hat: 'none', glasses: 'none', neck: 'none', pet: 'none', aura: 'none' });

  /* ---- preview column ---------------------------------------------------- */

  const figure = createAvatar({ avatar: st.avatar, look: shown(), name: st.name }, { size: 168 });
  const stage = el('button', {
    type: 'button', class: 'look-editor__stage',
    attrs: { 'aria-label': 'Girar el personaje', title: 'Tocá para girarlo' },
    onClick: () => {
      st.facing = st.facing === 'right' ? 'left' : 'right';
      figure.setFacing(st.facing);
    },
  }, el('span', { class: 'look-editor__rays', attrs: { 'aria-hidden': 'true' } }), el('span', { class: 'look-editor__podium', attrs: { 'aria-hidden': 'true' } }), figure,
  el('span', { class: 'look-editor__turn', attrs: { 'aria-hidden': 'true' } }, icon('refresh'), 'Girar'));

  const purseValue = el('span', { class: 'look-editor__purse-value' });
  const purse = el('div', { class: 'look-editor__purse' }, el('span', { class: 'look-editor__purse-label' }, 'Tus fichas'), el('span', { class: 'look-editor__purse-amount' }, icon('chip'), purseValue));

  const tryName = el('strong', { class: 'look-try__name' });
  const tryHint = el('span', { class: 'look-try__hint' });
  const tryBuy = createButton('Comprar', { variant: 'primary', size: 'sm', icon: 'chip', onClick: () => st.trying && buy(st.trying) });
  const tryStop = createButton('Sacar', { variant: 'ghost', size: 'sm', onClick: () => tryOn(null) });
  const tryBar = el('div', { class: 'look-try', attrs: { 'aria-live': 'polite' } },
    el('div', { class: 'look-try__text' }, el('span', { class: 'look-try__label' }, 'Te estás probando'), tryName, tryHint),
    el('div', { class: 'look-try__actions' }, tryBuy, tryStop));

  const preview = el('div', { class: 'look-editor__preview' }, purse, stage, tryBar);

  /* ---- pickers ----------------------------------------------------------- */

  const tabButtons = [];
  const tabs = el('div', { class: 'look-editor__tabs', attrs: { role: 'tablist', 'aria-label': 'Secciones' } });
  const panelHost = el('div', { class: 'look-editor__panel', attrs: { role: 'tabpanel' } });
  const panels = new Map();

  for (const tab of EDITOR_TABS) {
    const button = el('button', { type: 'button', class: 'look-tab', attrs: { role: 'tab' }, onClick: () => openTab(tab.id) }, tab.label);
    tabButtons.push(button);
    tabs.appendChild(button);
  }
  roving(tabs, tabButtons, (index) => openTab(EDITOR_TABS[index].id));

  function changed() {
    render();
    if (typeof opts.onChange === 'function') opts.onChange({ ...st.look }, st.avatar);
  }

  function setFree(field, value) {
    if (st.look[field] === value) return;
    st.look = { ...st.look, [field]: value };
    changed();
  }

  function swatches(cfg) {
    const group = el('div', { class: 'look-swatches', attrs: { role: 'radiogroup', 'aria-label': cfg.label } });
    const buttons = cfg.colors.map((color, i) => {
      const button = el('button', {
        type: 'button', class: 'look-swatch', style: { '--swatch': color },
        attrs: { role: 'radio', 'aria-label': cfg.names[i], title: cfg.names[i] },
        onClick: () => cfg.set(i),
      });
      group.appendChild(button);
      return button;
    });
    roving(group, buttons, (i) => cfg.set(i));
    const node = el('div', { class: 'look-field' },
      el('div', { class: 'look-field__head' }, el('span', { class: 'look-field__label' }, cfg.label), cfg.hint ? el('span', { class: 'look-field__hint' }, cfg.hint) : null),
      group);
    return {
      node,
      paint() {
        const current = cfg.get();
        buttons.forEach((button, i) => {
          const on = current === i;
          button.classList.toggle('is-active', on);
          button.setAttribute('aria-checked', on ? 'true' : 'false');
          button.tabIndex = on ? 0 : -1;
        });
      },
    };
  }

  function hairStyles() {
    const group = el('div', { class: 'look-styles', attrs: { role: 'radiogroup', 'aria-label': 'Peinado' } });
    const thumbs = [];
    const buttons = HAIR_LABELS.map((label, i) => {
      const thumb = el('span', { class: 'look-style__art' });
      thumbs.push(thumb);
      const button = el('button', { type: 'button', class: 'look-style', attrs: { role: 'radio' }, onClick: () => setFree('hair', i) },
        thumb, el('span', { class: 'look-style__name' }, label));
      group.appendChild(button);
      return button;
    });
    roving(group, buttons, (i) => setFree('hair', i));
    let drawn = '';
    return {
      node: el('div', { class: 'look-field' }, el('div', { class: 'look-field__head' }, el('span', { class: 'look-field__label' }, 'Peinado')), group),
      paint() {
        const key = `${st.look.skin}.${st.look.hairColor}.${st.avatar}`;
        if (key !== drawn) {
          drawn = key;
          thumbs.forEach((thumb, i) => {
            empty(thumb).appendChild(staticFigure({ ...bare(), hair: i }, st.avatar, '5 3 56 56', { pet: false, aura: false }));
          });
        }
        buttons.forEach((button, i) => {
          const on = st.look.hair === i;
          button.classList.toggle('is-active', on);
          button.setAttribute('aria-checked', on ? 'true' : 'false');
          button.tabIndex = on ? 0 : -1;
        });
      },
    };
  }

  function freePanel(parts) {
    const node = el('div', { class: 'look-free' }, parts.map((part) => part.node));
    return { node, paint: () => parts.forEach((part) => part.paint()) };
  }

  function itemArt(item) {
    if (!LOOK_PAID[item.slot].includes(item.key)) return el('span', { class: 'look-card__unknown' }, icon('sparkle'));
    if (item.slot === 'pet') return petFigure(item.key);
    const look = { ...bare(), [item.slot]: item.key };
    const box = item.slot === 'hat' ? bustBox(look) : SLOT_BOX[item.slot];
    return staticFigure(look, st.avatar, box, { pet: false, aura: item.slot === 'aura' });
  }

  function paidPanel(slot) {
    const items = st.catalog.filter((item) => item.slot === slot);
    const lockNote = el('p', { class: 'look-note look-note--lock' }, icon('lock'), el('span', { class: 'look-note__text' }));
    const tip = el('p', { class: 'look-note' }, 'Tocá un accesorio para probártelo antes de comprar.');
    const grid = el('div', { class: 'look-cards' });
    const cards = items.map((item) => {
      const art = el('span', { class: 'look-card__art' });
      const badge = el('span', { class: 'look-card__badge' }, 'Probando');
      const pick = el('button', { type: 'button', class: 'look-card__pick', onClick: () => pickItem(item) },
        art, el('span', { class: 'look-card__name' }, item.name), badge);
      const actionLabel = el('span', { class: 'look-card__action-label' });
      const actionIcon = el('span', { class: 'look-card__action-icon' });
      const action = el('button', { type: 'button', class: 'look-card__action', onClick: () => actItem(item) }, actionIcon, actionLabel);
      const hint = el('span', { class: 'look-card__hint' });
      const node = el('div', { class: 'look-card' }, pick, action, hint);
      grid.appendChild(node);
      return { item, node, art, pick, action, actionIcon, actionLabel, hint, drawn: '' };
    });
    if (!cards.length) grid.appendChild(el('p', { class: 'look-note' }, 'Pronto vas a encontrar novedades acá.'));
    const node = el('div', { class: 'look-paid' }, lockNote, cards.length ? tip : null, grid);

    return {
      node,
      paint() {
        const anyShop = cards.some((card) => !st.owned.has(card.item.id));
        lockNote.hidden = st.canBuy || !anyShop;
        lockNote.lastChild.textContent = st.lockedReason || 'Ahora no podés comprar.';
        const base = `${st.look.skin}.${st.look.hair}.${st.look.hairColor}.${st.look.pants}.${st.avatar}`;
        for (const card of cards) {
          const { item } = card;
          if (card.drawn !== base) {
            card.drawn = base;
            empty(card.art).appendChild(itemArt(item));
          }
          const owned = st.owned.has(item.id);
          const equipped = st.look[item.slot] === item.key;
          const trying = !!st.trying && st.trying.id === item.id;
          const pending = st.pending === item.id;
          const missing = Math.max(0, item.price - st.balance);
          const state = equipped ? 'equipped' : owned ? 'owned' : 'shop';
          card.node.dataset.state = state;
          card.node.classList.toggle('is-trying', trying);
          card.pick.setAttribute('aria-pressed', equipped || trying ? 'true' : 'false');
          card.pick.setAttribute('aria-label',
            equipped ? `${item.name}: puesto. Tocá para sacártelo`
              : owned ? `${item.name}: tocá para usarlo`
                : trying ? `${item.name}: dejar de probártelo` : `${item.name}: probátelo`);
          empty(card.actionIcon);
          card.action.disabled = false;
          card.action.removeAttribute('title');
          if (equipped) {
            card.actionIcon.appendChild(icon('check'));
            card.actionLabel.textContent = 'Puesto';
            card.action.setAttribute('aria-label', `Sacarte ${item.name}`);
            card.hint.textContent = 'Tocá para sacártelo';
          } else if (owned) {
            card.actionLabel.textContent = 'Usar';
            card.action.setAttribute('aria-label', `Usar ${item.name}`);
            card.hint.textContent = 'Es tuyo';
          } else {
            card.actionIcon.appendChild(icon('chip'));
            card.actionLabel.textContent = formatChips(item.price);
            card.action.setAttribute('aria-label', `Comprar ${item.name} por ${formatChips(item.price)} fichas`);
            const blocked = pending || !st.canBuy || missing > 0;
            card.action.disabled = blocked;
            let hint = trying ? 'Te lo estás probando' : 'Probátelo';
            if (pending) hint = 'Comprando…';
            else if (!st.canBuy) hint = 'No disponible ahora';
            else if (missing > 0) hint = `Te faltan ${formatChips(missing)}`;
            card.hint.textContent = hint;
            if (blocked && !pending) card.action.title = !st.canBuy ? (st.lockedReason || 'Ahora no podés comprar.') : `Te faltan ${formatChips(missing)} fichas`;
          }
          card.node.classList.toggle('is-short', state === 'shop' && (missing > 0 || !st.canBuy));
        }
      },
    };
  }

  function buildPanel(id) {
    if (id === 'body') {
      return freePanel([
        swatches({ label: 'Piel', colors: SKIN, names: SKIN_NAMES, get: () => st.look.skin, set: (i) => setFree('skin', i) }),
        hairStyles(),
        swatches({ label: 'Color de pelo', colors: HAIR, names: HAIR_COLOR_NAMES, get: () => st.look.hairColor, set: (i) => setFree('hairColor', i) }),
      ]);
    }
    if (id === 'clothes') {
      const shirts = SHIRT_NAMES.map((_, i) => avatarColor(i));
      return freePanel([
        swatches({
          label: 'Camisa', hint: 'Es tu color en las mesas', colors: shirts, names: SHIRT_NAMES,
          get: () => st.avatar,
          set: (i) => {
            if (st.avatar === i) return;
            st.avatar = i;
            changed();
          },
        }),
        swatches({ label: 'Pantalón', colors: PANTS, names: PANTS_NAMES, get: () => st.look.pants, set: (i) => setFree('pants', i) }),
      ]);
    }
    return paidPanel(id);
  }

  function openTab(id) {
    if (st.tab === id) return;
    st.tab = id;
    render();
  }

  /* ---- paid items -------------------------------------------------------- */

  function tryOn(item) {
    st.trying = item;
    render();
  }

  function pickItem(item) {
    if (st.owned.has(item.id) || st.look[item.slot] === item.key) {
      equip(item);
      return;
    }
    tryOn(st.trying && st.trying.id === item.id ? null : item);
  }

  function equip(item) {
    const on = st.look[item.slot] === item.key;
    st.look = { ...st.look, [item.slot]: on ? 'none' : item.key };
    if (st.trying && st.trying.slot === item.slot) st.trying = null;
    changed();
  }

  function affordable(item) {
    return st.canBuy && st.balance >= item.price;
  }

  function buy(item) {
    if (st.pending || st.owned.has(item.id) || !affordable(item)) return;
    st.pending = item.id;
    st.trying = item;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      st.pending = null;
      render();
    }, 8000);
    render();
    if (typeof opts.onBuy === 'function') opts.onBuy(item.id);
  }

  function actItem(item) {
    if (st.owned.has(item.id) || st.look[item.slot] === item.key) equip(item);
    else buy(item);
  }

  /* ---- render ------------------------------------------------------------ */

  function render() {
    figure.update({ avatar: st.avatar, look: shown(), name: st.name });
    purseValue.textContent = formatChips(st.balance);

    const trying = st.trying;
    tryBar.hidden = !trying;
    if (trying) {
      const missing = Math.max(0, trying.price - st.balance);
      const pending = st.pending === trying.id;
      tryName.textContent = trying.name;
      tryBuy.setLabel(pending ? 'Comprando…' : `Comprar · ${formatChips(trying.price)}`);
      tryBuy.disabled = pending || !affordable(trying);
      tryHint.textContent = !st.canBuy ? (st.lockedReason || 'Ahora no podés comprar.') : missing > 0 ? `Te faltan ${formatChips(missing)} fichas` : '';
      tryHint.hidden = !tryHint.textContent;
    }

    EDITOR_TABS.forEach((tab, i) => {
      const on = tab.id === st.tab;
      const button = tabButtons[i];
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      button.classList.toggle('has-dot', !!tab.slot && !!trying && trying.slot === tab.slot);
    });

    let panel = panels.get(st.tab);
    if (!panel) {
      panel = buildPanel(st.tab);
      panels.set(st.tab, panel);
    }
    if (panelHost.firstChild !== panel.node) {
      empty(panelHost).appendChild(panel.node);
      const label = EDITOR_TABS.find((tab) => tab.id === st.tab);
      panelHost.setAttribute('aria-label', label ? label.label : '');
    }
    panel.paint();
  }

  const root = el('div', { class: 'look-editor' }, preview, el('div', { class: 'look-editor__main' }, tabs, panelHost));

  root.refresh = (next) => {
    const hadCatalog = st.catalog;
    absorb(next);
    st.pending = null;
    clearTimeout(pendingTimer);
    if (st.trying && (st.owned.has(st.trying.id) || !st.catalog.some((item) => item.id === st.trying.id))) st.trying = null;
    if (st.catalog !== hadCatalog) {
      for (const tab of EDITOR_TABS) if (tab.slot) panels.delete(tab.slot);
    }
    render();
    return root;
  };

  root.destroy = () => {
    clearTimeout(pendingTimer);
    if (observer) observer.disconnect();
    observer = null;
  };

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      if (box && box.width) root.classList.toggle('look-editor--narrow', box.width < 500);
    });
    observer.observe(root);
  }

  render();
  return root;
}
