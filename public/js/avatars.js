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
 *   avatar: 0..11, the player's colour (ui.avatarColor): the shirt, or the
 *           accent of an outfit (tie, bow, lining, pocket square)
 *   look:   free parts  { skin, hair, hairColor, pants, eyes, face }
 *           paid slots  { hat, glasses, neck, outfit, hand, pet, aura }
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
  skin: 0, hair: 0, hairColor: 0, pants: 0, eyes: 0, face: 0,
  hat: 'none', glasses: 'none', neck: 'none', outfit: 'none', hand: 'none', pet: 'none', aura: 'none',
});

/** Counts / names of the free options (the server validates ranges with it). */
export const LOOK_FREE = Object.freeze({
  skin: 6,
  hair: Object.freeze(['corto', 'largo', 'rulos', 'pelado', 'cresta', 'rodete', 'colita', 'flequillo', 'jopo', 'trenzas']),
  hairColor: 8,
  pants: 6,
  eyes: 6,
  face: Object.freeze(['nada', 'bigote', 'candado', 'barba', 'pecas']),
});

/** Every paid key this module knows how to draw, per slot. */
export const LOOK_PAID = Object.freeze({
  hat: Object.freeze(['cap', 'party', 'visor', 'fedora', 'cowboy', 'tophat', 'crown']),
  glasses: Object.freeze(['nerd', 'shades', 'monocle']),
  neck: Object.freeze(['bowtie', 'scarf', 'chain']),
  outfit: Object.freeze(['hoodie', 'tracksuit', 'suit', 'tux', 'cape']),
  hand: Object.freeze(['drink', 'cards', 'cane', 'moneybag']),
  pet: Object.freeze(['dog', 'cat', 'parrot', 'dragon']),
  aura: Object.freeze(['sparkle', 'fire', 'gold']),
});

const SKIN = ['#fcd9bf', '#f1bf9b', '#dea47a', '#bf8055', '#96603f', '#7a4e36'];
const HAIR = ['#2d2534', '#55372a', '#8a542e', '#e4b95c', '#c9582d', '#cfcbd6', '#ee74a8', '#41b8c8'];
const PANTS = ['#3f62a8', '#302c3c', '#bb9d6c', '#812536', '#2e7059', '#e6dfcf'];
const EYES = ['#70452f', '#c98a2c', '#3fa565', '#4a8fe2', '#93a2b8', '#9b6fe2'];

const SKIN_NAMES = ['Piel muy clara', 'Piel clara', 'Piel trigueña', 'Piel canela', 'Piel morena', 'Piel oscura'];
const HAIR_LABELS = ['Corto', 'Largo', 'Rulos', 'Pelado', 'Cresta', 'Rodete', 'Colita', 'Flequillo', 'Jopo', 'Trenzas'];
const HAIR_COLOR_NAMES = ['Negro', 'Castaño oscuro', 'Castaño', 'Rubio', 'Colorado', 'Canoso', 'Rosa', 'Turquesa'];
const SHIRT_NAMES = ['Rubí', 'Naranja', 'Ámbar', 'Lima', 'Turquesa', 'Celeste', 'Cobalto', 'Violeta', 'Fucsia', 'Rosa', 'Marfil', 'Grafito'];
const PANTS_NAMES = ['Jean', 'Negro', 'Caqui', 'Bordó', 'Verde', 'Blanco'];
const EYE_NAMES = ['Ojos café', 'Ojos miel', 'Ojos verdes', 'Ojos azules', 'Ojos grises', 'Ojos violetas'];
const FACE_LABELS = ['Nada', 'Bigote', 'Candado', 'Barba', 'Pecas'];

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
   soles on y = 96.8, top of the skull on y = 18, tall hats reach y = 0.
   Pets and auras overflow the box (the svg has overflow: visible).
   Colours come from CSS custom properties set by paint() on the element;
   the classes used here (av-o = outline, av-sk = skin, av-sh = player colour,
   av-coat = jacket ...) are defined at the top of avatars.css.
   The figure is a paper doll: legs, feet, arms and head are groups that the
   stylesheet rotates around their joints (walk cycle, moods, held items).
   ========================================================================== */

const SKULL_D = 'M32 18c11.5 0 18 7.5 18 17 0 10-7 16-18 16S14 45 14 35c0-9.5 6.5-17 18-17z';
/** Shirt tucked into the belt. */
const TORSO_D = 'M22.6 58c0-4.6 3.2-8 7.8-8h3.8c4.6 0 7.8 3.4 7.8 8l.6 13c0 1.2-.8 2-2 2H24c-1.2 0-2-.8-2-2z';
/** Hoodies and jackets hang over the hips. */
const COAT_D = 'M22.6 58c0-4.6 3.2-8 7.8-8h3.8c4.6 0 7.8 3.4 7.8 8l.7 15.4c.1 1.3-.8 2.2-2.1 2.2H24c-1.3 0-2.2-.9-2.1-2.2z';

/* ---- Legs, hips and shoes ------------------------------------------------- */

function legsArt(outfit) {
  let far = '';
  let near = '<path class="av-seam-p" d="M24.9 88.3h7.2"/>';
  if (outfit === 'tracksuit') {
    far = '<path class="av-stripe av-stripe--dim" d="M38.2 74v15"/>';
    near = '<path class="av-stripe" d="M25.8 74v15"/>';
  } else if (outfit === 'suit') {
    far = '<path class="av-seam-p" d="M35.6 81v8.4"/>';
    near += '<path class="av-seam-p" d="M28.5 81v7"/>';
  } else if (outfit === 'tux') {
    far = '<path class="av-satin" d="M38.3 74v15.4"/>';
    near += '<path class="av-satin" d="M25.7 74v14"/>';
  }
  return (
    '<g class="av-leg av-leg--far"><g class="av-lift">' +
      '<rect class="av-o av-pad" x="31.4" y="70" width="8.4" height="23" rx="3.8"/>' + far +
      '<g class="av-foot av-foot--far">' +
        '<path class="av-o av-shoe-d" d="M30.6 95.2v-2.6a3.2 3.2 0 0 1 3.2-3.2h4c4 0 7 2.2 7 5v.8z"/>' +
        '<path class="av-o av-sole" d="M30.2 94.6h15v.9a1.3 1.3 0 0 1-1.3 1.3H31.5a1.3 1.3 0 0 1-1.3-1.3z"/>' +
      '</g>' +
    '</g></g>' +
    '<g class="av-leg av-leg--near"><g class="av-lift">' +
      '<rect class="av-o av-pa" x="24.2" y="70" width="8.6" height="23" rx="3.8"/>' + near +
      '<g class="av-foot av-foot--near">' +
        '<path class="av-o av-shoe" d="M23.4 95.2v-2.6a3.2 3.2 0 0 1 3.2-3.2h4.2c4 0 7 2.2 7 5v.8z"/>' +
        '<path class="av-shoe-l" d="M32.9 91.3c1.5.3 2.7 1.1 3.3 2.2"/>' +
        '<path class="av-o av-sole" d="M23 94.6h15.2v.9a1.3 1.3 0 0 1-1.3 1.3H24.3a1.3 1.3 0 0 1-1.3-1.3z"/>' +
      '</g>' +
    '</g></g>'
  );
}

const HIPS =
  '<path class="av-o av-pa" d="M23.2 72.2h18.2l-1 6.8c-.2 1.2-1.2 2-2.4 2H26.6c-1.2 0-2.2-.8-2.4-2z"/>' +
  '<path class="av-seam-p" d="M32.4 77.4v3.4"/>';

/* ---- Arms ----------------------------------------------------------------- */

const HAND_NEAR =
  '<ellipse class="av-o av-sk" cx="26.6" cy="70.7" rx="1.5" ry="2.1" transform="rotate(-24 26.6 70.7)"/>' +
  '<circle class="av-o av-sk" cx="23.9" cy="71.3" r="3.3"/>';
const HAND_FAR =
  '<ellipse class="av-o av-skd" cx="44.2" cy="70.5" rx="1.5" ry="2.1" transform="rotate(-24 44.2 70.5)"/>' +
  '<circle class="av-o av-skd" cx="41.5" cy="71.1" r="3.2"/>';
/** The far hand again, lit, drawn over whatever it is holding. */
const HAND_GRIP =
  '<ellipse class="av-o av-sk" cx="44.2" cy="70.5" rx="1.5" ry="2.1" transform="rotate(-24 44.2 70.5)"/>' +
  '<circle class="av-o av-sk" cx="41.5" cy="71.1" r="3.2"/>';

const SLEEVE_NEAR = 'M20.3 56.2a3.6 3.6 0 0 1 7.2 0l-.3 11.6h-6.6z';
const SLEEVE_FAR = 'M38 56.2a3.5 3.5 0 0 1 7 0l-.3 11.4h-6.4z';
const CUFF_NEAR = (cls) => `<rect class="av-o ${cls}" x="20.1" y="65.6" width="7.6" height="3.4" rx="1.5"/>`;
const CUFF_FAR = (cls) => `<rect class="av-o ${cls}" x="37.8" y="65.4" width="7.4" height="3.4" rx="1.5"/>`;
const SHIRT_CUFF_NEAR = '<rect class="av-ot av-collar" x="20.6" y="66.9" width="6.6" height="2.5" rx="1"/>';
const SHIRT_CUFF_FAR = '<rect class="av-ot av-collar-d" x="38.3" y="66.7" width="6.4" height="2.5" rx="1"/>';

function armsArt(outfit) {
  let near = 'av-sh';
  let far = 'av-shd';
  let nearCuff = CUFF_NEAR('av-sh');
  let farCuff = CUFF_FAR('av-shd');
  if (outfit === 'hoodie') {
    nearCuff = CUFF_NEAR('av-shd') + '<path class="av-rib" d="M22.6 66.3v2M25.2 66.3v2"/>';
    farCuff = CUFF_FAR('av-shx');
  } else if (outfit === 'tracksuit') {
    nearCuff = '<path class="av-stripe" d="M21.9 55.6l-.2 9.6"/>' + CUFF_NEAR('av-shd');
    farCuff = '<path class="av-stripe av-stripe--dim" d="M43.5 55.6l.2 9.4"/>' + CUFF_FAR('av-shx');
  } else if (outfit === 'suit' || outfit === 'tux') {
    near = 'av-coat';
    far = 'av-coat-d';
    nearCuff = SHIRT_CUFF_NEAR + (outfit === 'tux' ? '<circle class="av-gold" cx="22.1" cy="68.2" r=".8"/>' : '');
    farCuff = SHIRT_CUFF_FAR;
  }
  return {
    far: `<g class="av-arm av-arm--far">${HAND_FAR}<path class="av-o ${far}" d="${SLEEVE_FAR}"/>${farCuff}</g>`,
    near: `<g class="av-arm av-arm--near">${HAND_NEAR}<path class="av-o ${near}" d="${SLEEVE_NEAR}"/>${nearCuff}</g>`,
  };
}

/* ---- Torso: the shirt and the paid outfits ------------------------------- */

const COLLAR =
  '<path class="av-ot av-collar" d="M28 50.7l5.3 4.9-4.9 1.7z"/>' +
  '<path class="av-ot av-collar" d="M38.6 50.7l-5.3 4.9 4.9 1.7z"/>';
const BELT =
  '<rect class="av-o av-belt" x="22.3" y="70.6" width="20" height="3.8" rx="1.4"/>' +
  '<rect class="av-ot av-gold" x="31.6" y="70.3" width="4.2" height="4.4" rx="1"/>' +
  '<rect class="av-belt" x="32.8" y="71.6" width="1.8" height="1.8" rx=".3"/>';
const SIDE_SHADE = '<path class="av-shade" d="M21 49h5.8c-1.5 5.2-1.7 15.8-1 27H21z"/>';
const CHEST_LITE = '<ellipse class="av-lite" cx="38" cy="59.2" rx="1.9" ry="5"/>';
const CHIN_SHADE = '<ellipse class="av-shade" cx="32.8" cy="51.4" rx="7.4" ry="3.3"/>';

function shirtArt(uid) {
  return (
    `<path class="av-o av-sh" d="${TORSO_D}"/>` +
    `<g clip-path="url(#${uid}t)">` + SIDE_SHADE + CHEST_LITE + CHIN_SHADE +
      '<path class="av-seam" d="M33.5 56v17"/>' +
      '<circle class="av-btn" cx="33.5" cy="60" r=".9"/><circle class="av-btn" cx="33.5" cy="64.3" r=".9"/><circle class="av-btn" cx="33.5" cy="68.4" r=".9"/>' +
    '</g>' + COLLAR + BELT
  );
}

/**
 * What an outfit adds: `back` behind the legs, `torso` instead of the shirt,
 * `over` on the shoulders (hood, mantle). The player colour stays visible in
 * every one of them.
 */
const OUTFITS = {
  hoodie(uid) {
    return {
      back: '',
      torso:
        `<path class="av-o av-sh" d="${COAT_D}"/>` +
        `<g clip-path="url(#${uid}t)">` + SIDE_SHADE + CHEST_LITE +
          '<path class="av-shx" d="M21 71.8h23V77H21z"/>' +
          '<path class="av-rib" d="M25 72.6v2.6M28 72.6v2.6M31 72.6v2.6M34 72.6v2.6M37 72.6v2.6M40 72.6v2.6"/>' +
          '<path class="av-ot av-shd" d="M27 62.4h13l1.7 7.8H25.3z"/>' +
          CHIN_SHADE +
        '</g>' +
        `<path class="av-o av-nf" d="${COAT_D}"/>` +
        '<path class="av-string" d="M30.9 55.4v5.4M35.9 55.4v4.8"/>' +
        '<circle class="av-collar" cx="30.9" cy="61.3" r=".85"/><circle class="av-collar" cx="35.9" cy="60.7" r=".85"/>',
      over:
        '<path class="av-o av-shd" d="M18.8 55.8c-1-5.6 3.2-9 8-9.2h11.4c4.8.2 9 3.6 8 9.2-1.6 2.4-4.8 2.8-6.8 1.6l-6.8-3.2-6.8 3.2c-2 1.2-5.4.8-7-1.6z"/>' +
        '<path class="av-seam" d="M21.6 52.6c2-1.8 4.4-2.7 7-2.9M43.4 52.6c-2-1.8-4.4-2.7-7-2.9"/>',
    };
  },
  tracksuit(uid) {
    return {
      back: '',
      torso:
        `<path class="av-o av-sh" d="${COAT_D}"/>` +
        `<g clip-path="url(#${uid}t)">` + SIDE_SHADE + CHEST_LITE +
          '<path class="av-band" d="M21 60.4h23v3.4H21z"/>' +
          '<path class="av-shx" d="M21 72.4h23V77H21z"/>' +
          '<path class="av-zip" d="M33.5 54v23"/>' +
          CHIN_SHADE +
        '</g>' +
        `<path class="av-o av-nf" d="${COAT_D}"/>` +
        '<path class="av-o av-shd" d="M26.4 50.6c4.2-1.4 10-1.4 14 0l.3 4c-4.4-1.4-10.2-1.4-14.6 0z"/>' +
        '<path class="av-stripe" d="M27 52.4c4.2-1 9-1 13 0"/>' +
        '<rect class="av-ot av-gold" x="32.5" y="54.8" width="2" height="2.8" rx=".7"/>',
      over: '',
    };
  },
  suit(uid, look) {
    // a three-piece suit: the waistcoat, the tie and the pocket square carry the player colour
    const tie = look.neck === 'bowtie' || look.neck === 'scarf'
      ? ''
      : '<path class="av-ot av-sh" d="M32.2 55.2h2.6l-.5 2.2h-1.6z"/><path class="av-ot av-shd" d="M32.7 57.4h1.6l.8 5.6h-3.2z"/>';
    return {
      back: '',
      torso:
        `<path class="av-o av-coat" d="${COAT_D}"/>` +
        `<g clip-path="url(#${uid}t)">` +
          '<path class="av-collar" d="M27.6 49.4h11.8l-5.9 14z"/>' + tie +
          '<path class="av-ot av-sh" d="M27.6 56.4l5.9 6.8 5.9-6.8 1 21.4H26.6z"/>' +
          '<circle class="av-gold" cx="33.5" cy="66.4" r=".9"/><circle class="av-gold" cx="33.5" cy="69.8" r=".9"/><circle class="av-gold" cx="33.5" cy="73.2" r=".9"/>' +
          '<path class="av-coat" d="M20 50h7.6l2.6 9.8c-1 5.8-1.2 11.8-.6 18H20z"/>' +
          '<path class="av-coat" d="M47 50h-7.6l-2.6 9.8c1 5.8 1.2 11.8.6 18H47z"/>' +
          '<path class="av-seam-c" d="M30.2 59.8c-1 5.8-1.2 11.8-.6 18M36.8 59.8c1 5.8 1.2 11.8.6 18"/>' +
          SIDE_SHADE +
          '<path class="av-ot av-coat-l" d="M27.6 49.6l2.7 10.4-3.7-1.8 1.4-2-2.4-2z"/>' +
          '<path class="av-ot av-coat-l" d="M39.4 49.6l-2.7 10.4 3.7-1.8-1.4-2 2.4-2z"/>' +
          '<path class="av-ot av-sh" d="M38.3 65l.2-2 1.1.9.8-1.4.8 1.4.7-.7.2 1.8z"/>' +
          CHIN_SHADE +
        '</g>' +
        `<path class="av-o av-nf" d="${COAT_D}"/>` + COLLAR,
      over: '',
    };
  },
  tux(uid, look) {
    const bow = look.neck === 'bowtie' || look.neck === 'scarf'
      ? ''
      : '<path class="av-ot av-sh" d="M32.6 54.5l-4.6-2.4c-.8 1.6-.8 3.4 0 5z"/>' +
        '<path class="av-ot av-sh" d="M34.4 54.5l4.6-2.4c.8 1.6.8 3.4 0 5z"/>' +
        '<rect class="av-ot av-sh" x="32.1" y="53" width="2.8" height="3.1" rx=".9"/>';
    return {
      back: '',
      torso:
        `<path class="av-o av-coat" d="${COAT_D}"/>` +
        `<g clip-path="url(#${uid}t)">` + SIDE_SHADE +
          '<path class="av-collar" d="M26.8 49.4h13.4c.4 6.4-1.6 13.6-6.7 18.4-5.1-4.8-7.1-12-6.7-18.4z"/>' +
          '<circle class="av-eye" cx="33.5" cy="59.6" r=".7"/><circle class="av-eye" cx="33.5" cy="63" r=".7"/>' +
          '<path class="av-ot av-coat-l" d="M26.8 49.6c-.6 6.6 1.6 13.8 6.7 18.2-4-1.6-7.4-5-8.7-9.6z"/>' +
          '<path class="av-ot av-coat-l" d="M40.2 49.6c.6 6.6-1.6 13.8-6.7 18.2 4-1.6 7.4-5 8.7-9.6z"/>' +
          '<path class="av-ot av-sh" d="M21 67.6h23v4.4H21z"/>' +
          '<path class="av-seam" d="M21 69.1h23M21 70.5h23"/>' +
          '<circle class="av-ot av-sh" cx="39.8" cy="58" r="1.5"/><circle class="av-gold" cx="39.8" cy="58" r=".5"/>' +
          CHIN_SHADE +
        '</g>' +
        `<path class="av-o av-nf" d="${COAT_D}"/>` + COLLAR + bow,
      over: '',
    };
  },
  cape(uid) {
    return {
      back:
        '<g class="av-cape av-sway">' +
          '<path class="av-o" fill="#a3243a" d="M20.6 53.4C13.6 62.4 9 78.4 8 92.2c5.8 3 14 3.4 19.4 1.6l9.4 0c5.4 1.8 13.6 1.4 19.4-1.6-1-13.8-5.6-29.8-12.6-38.8z"/>' +
          '<path class="av-shd" d="M21.8 57.4c-5.8 8.4-9.4 21.6-10.2 32.6 5 2.2 11 2.4 15.4 1l10.2 0c4.4 1.4 10.4 1.2 15.4-1-.8-11-4.4-24.2-10.2-32.6z"/>' +
          '<path class="av-shade" d="M24 57.4h16.4L43 91H21.4z"/>' +
          '<path class="av-o av-collar" d="M8 92.2c5.8 3 14 3.4 19.4 1.6l9.4 0c5.4 1.8 13.6 1.4 19.4-1.6l-.4-4.2c-5.6 2.8-13.4 3.2-18.8 1.4l-9.8 0c-5.4 1.8-13.2 1.4-18.8-1.4z"/>' +
          '<path class="av-tick" d="M12.6 90.6l.5 1.9M17.4 91.9l.4 1.9M22.8 91.8l.3 1.9M41.4 91.8l-.3 1.9M46.8 91.9l-.4 1.9M51.6 90.6l-.5 1.9"/>' +
        '</g>',
      torso: shirtArt(uid),
      over:
        '<path class="av-o av-collar" d="M19.4 57.2c-.6-5.4 4-8.4 9-8.6h8.4c5 .2 9.6 3.2 9 8.6-1.4 3-5 4-8 2.6l-4.6-2.8-5 2.8c-3 1.4-7.4.4-8.8-2.6z"/>' +
        '<path class="av-tick" d="M22.4 53.6l.6 1.9M25.8 56.4l.6 1.9M29.4 52.2l.5 1.8M40.6 55.8l.6 1.9M43.6 52.8l.5 1.8M37.2 52.2l.5 1.8"/>' +
        '<circle class="av-o av-gold" cx="33.2" cy="57.2" r="2"/><circle fill="#fff6d6" cx="32.6" cy="56.6" r=".6"/>',
    };
  },
};

/* ---- Things held in the leading hand ------------------------------------- */
/* Drawn upright around the point (39.9, 71.1), which heldArt() moves onto the
   far hand; `hold` is the angle the arm takes to carry the thing and `tilt`
   how much the thing leans at that angle. */

const HANDS = {
  drink: {
    hold: -52, tilt: 0, box: '32 44 32 32',
    art:
      '<path class="av-ls" d="M39.9 61.2v10M36.8 74.2h6.2" stroke-width="2.9" stroke-linecap="round"/>' +
      '<path d="M39.9 61.2v10M36.8 74.2h6.2" stroke="#e8f1fa" stroke-width="1.3" stroke-linecap="round"/>' +
      '<path class="av-o" fill="#e8f1fa" fill-opacity=".3" d="M33.1 51.6h13.6l-6.8 9.8z"/>' +
      '<path fill="#f6a43c" d="M35.1 54.2h9.6l-4.8 7z"/>' +
      '<path d="M35.1 54.2h9.6" stroke="#ffe0a0" stroke-width=".9" stroke-linecap="round"/>' +
      '<path d="M36.4 55.8l1.7 2.5" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".75"/>' +
      '<circle class="av-ot" fill="#d43a4c" cx="44" cy="51.2" r="1.8"/><path d="M44 49.4c.4-1.4 1.2-2.2 2.4-2.6" stroke="#3fa34d" stroke-width=".9" stroke-linecap="round"/>',
  },
  cards: {
    hold: -48, tilt: 6, box: '32 45 32 32',
    art:
      '<g transform="rotate(-27 39.9 70.5)"><rect class="av-o" fill="#fbf5e6" x="36.3" y="54.4" width="7.2" height="10.6" rx="1.2"/><circle fill="#1c1a24" cx="38.4" cy="57" r="1.1"/></g>' +
      '<g transform="rotate(-2 39.9 70.5)"><rect class="av-o" fill="#fbf5e6" x="36.3" y="53.6" width="7.2" height="10.6" rx="1.2"/><path fill="#b3202f" d="M38.4 55.2l1.2 1.6-1.2 1.6-1.2-1.6z"/></g>' +
      '<g transform="rotate(24 39.9 70.5)"><rect class="av-o" fill="#fbf5e6" x="36.3" y="54.4" width="7.2" height="10.6" rx="1.2"/>' +
        '<path fill="#b3202f" d="M39.9 62.2c-1.9-1.3-2.6-2.2-2.6-3.2a1.3 1.3 0 0 1 2.6-.4 1.3 1.3 0 0 1 2.6.4c0 1-.7 1.9-2.6 3.2z"/>' +
        '<path fill="#b3202f" d="M37.9 55.2l.9 1.2-.9 1.2-.9-1.2z"/></g>',
  },
  cane: {
    hold: -16, tilt: -8, box: '26 58 40 40',
    art:
      '<path class="av-ls" d="M39.9 68v30" stroke-width="3.9" stroke-linecap="round"/>' +
      '<path d="M39.9 68v30" stroke="#4d3542" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M39.9 95.2v2.8" stroke="#e6c878" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle class="av-o" fill="#e6c878" cx="39.9" cy="66.2" r="2.6"/><circle fill="#fff6d6" cx="39.1" cy="65.4" r=".75"/>',
  },
  moneybag: {
    hold: -22, tilt: 0, box: '30 58 32 32',
    art:
      '<g class="av-bag">' +
        '<path class="av-o" fill="#dbb876" d="M37.3 74.8c-3.4 2.3-5.1 5.2-5.1 8 0 3.2 3 4.9 7.7 4.9s7.7-1.7 7.7-4.9c0-2.8-1.7-5.7-5.1-8z"/>' +
        '<path fill="#b9945c" d="M32.7 84.8c1.2 1.9 3.8 2.9 7.2 2.9s6-1 7.2-2.9c-1.6 1-4.2 1.5-7.2 1.5s-5.6-.5-7.2-1.5z"/>' +
        '<path class="av-o" fill="#dbb876" d="M36.3 71.6c1.1.9 2.4 1.3 3.6 1.3s2.5-.4 3.6-1.3l-.9 3.4h-5.4z"/>' +
        '<path d="M37.1 75h5.6" stroke="#8a5a2b" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M41.5 79.7c-.7-.8-2.3-1-3.1-.2-.9.8-.4 1.8 1.5 2.2 1.9.4 2.4 1.5 1.5 2.3-.9.8-2.6.5-3.3-.4M39.9 78.2v7" stroke="#6b4a1e" stroke-width="1.1" stroke-linecap="round"/>' +
      '</g>',
  },
};

function heldArt(key) {
  const item = HANDS[key];
  return `<g class="av-held"><g transform="rotate(${-item.hold + item.tilt} 41.5 71.1) translate(1.6 0)">${item.art}</g>${HAND_GRIP}</g>`;
}

/* ---- Head and face -------------------------------------------------------- */

const EAR =
  '<ellipse class="av-o av-sk" cx="15.2" cy="38.2" rx="3.1" ry="3.8"/>' +
  '<path class="av-ear-in" d="M14.4 36.6c1.3.5 1.7 1.8 1 3.2"/>';

const SKULL = `<path class="av-o av-sk" d="${SKULL_D}"/>`;

/** Soft form shadow on the back of the jaw (clipped to the skull). */
const JAW_SHADE = '<path class="av-shade av-shade--soft" d="M12 33c0 13.6 8 20.2 22 20.2-9.6-2.4-16.4-8-17.4-17.4z"/>';

const EYES_OPEN =
  '<g class="av-eyes">' +
    '<ellipse class="av-eye" cx="29" cy="37.8" rx="2.9" ry="3.8"/>' +
    '<ellipse class="av-eye" cx="41.8" cy="37.8" rx="2.6" ry="3.8"/>' +
    '<g class="av-look">' +
      '<ellipse class="av-iris" cx="29.1" cy="38.7" rx="2.1" ry="2.7"/><ellipse class="av-pupil" cx="29.2" cy="38.3" rx="1.15" ry="1.6"/>' +
      '<ellipse class="av-iris" cx="41.9" cy="38.7" rx="1.85" ry="2.7"/><ellipse class="av-pupil" cx="42" cy="38.3" rx="1.05" ry="1.6"/>' +
    '</g>' +
    '<circle class="av-glint" cx="30.2" cy="36.1" r="1.1"/><circle class="av-glint av-glint--dim" cx="28" cy="40.3" r=".5"/>' +
    '<circle class="av-glint" cx="42.8" cy="36.1" r="1"/><circle class="av-glint av-glint--dim" cx="40.9" cy="40.3" r=".45"/>' +
  '</g>';

const FACES =
  '<g class="av-f av-f--base">' + EYES_OPEN +
    '<g class="av-brows"><path class="av-brow" d="M26 31.7q3-1.7 6-.3"/><path class="av-brow" d="M39.2 31.4q2.8-1.4 5.4.3"/></g>' +
    '<path class="av-mouth" d="M32.9 44.3q2.9 2.8 5.8 0"/>' +
  '</g>' +
  '<g class="av-f av-f--happy">' +
    '<path class="av-eyeline" d="M26 39q3-4.3 6 0"/><path class="av-eyeline" d="M39.2 39q2.6-4.3 5.2 0"/>' +
    '<path class="av-brow" d="M25.9 30.5q3.1-2 6.2-.5"/><path class="av-brow" d="M39.1 30.2q2.9-1.7 5.6.1"/>' +
    '<path class="av-mouth-open" d="M31.5 43.2Q35.7 44.8 39.9 43.2C39.7 47.2 38.1 49.6 35.7 49.6C33.3 49.6 31.7 47.2 31.5 43.2Z"/>' +
    '<path class="av-tongue" d="M33.4 47.6Q35.7 45.9 38 47.6Q37.2 49.4 35.7 49.4Q34.2 49.4 33.4 47.6Z"/>' +
  '</g>' +
  '<g class="av-f av-f--love">' +
    '<g class="av-hearts">' +
      '<path class="av-heart" d="M29 41.9c-3.6-2.6-4.9-4.3-4.9-6.2a2.55 2.55 0 0 1 4.9-1 2.55 2.55 0 0 1 4.9 1c0 1.9-1.3 3.6-4.9 6.2z"/>' +
      '<path class="av-heart" d="M41.8 41.7c-3.3-2.4-4.4-4-4.4-5.8a2.3 2.3 0 0 1 4.4-.9 2.3 2.3 0 0 1 4.4.9c0 1.8-1.1 3.4-4.4 5.8z"/>' +
      '<circle class="av-glint" cx="27" cy="35.4" r=".8"/><circle class="av-glint" cx="40" cy="35.3" r=".7"/>' +
    '</g>' +
    '<path class="av-brow" d="M25.9 30.3q3.1-1.8 6.2-.3"/><path class="av-brow" d="M39.1 30q2.9-1.5 5.6.3"/>' +
    '<path class="av-mouth-open" d="M32.9 44.2Q35.7 45.2 38.5 44.2C38.3 47 37.3 48.5 35.7 48.5C34.1 48.5 33.1 47 32.9 44.2Z"/>' +
  '</g>' +
  '<g class="av-f av-f--hit">' +
    '<path class="av-eyeline" d="M26.1 35.1l4.4 2.7-4.4 2.7"/><path class="av-eyeline" d="M44.7 35.1l-4.2 2.7 4.2 2.7"/>' +
    '<path class="av-brow" d="M25.8 32.4q3-.1 5.9-2"/><path class="av-brow" d="M39.3 30.4q2.7 1.9 5.5 2"/>' +
    '<ellipse class="av-mouth-open" cx="35.7" cy="45.8" rx="2.1" ry="2.6"/>' +
  '</g>' +
  '<g class="av-f av-f--sad">' +
    '<g class="av-eyes av-eyes--low">' +
      '<ellipse class="av-eye" cx="29" cy="38.4" rx="2.8" ry="3.5"/><ellipse class="av-eye" cx="41.8" cy="38.4" rx="2.5" ry="3.5"/>' +
      '<ellipse class="av-iris" cx="29" cy="39.4" rx="2" ry="2.4"/><ellipse class="av-pupil" cx="29" cy="39.2" rx="1.1" ry="1.4"/>' +
      '<ellipse class="av-iris" cx="41.8" cy="39.4" rx="1.75" ry="2.4"/><ellipse class="av-pupil" cx="41.8" cy="39.2" rx="1" ry="1.4"/>' +
      '<circle class="av-glint" cx="30.1" cy="37.8" r=".9"/><circle class="av-glint" cx="42.7" cy="37.8" r=".85"/>' +
      '<circle class="av-glint av-glint--dim" cx="28.1" cy="40.7" r=".7"/><circle class="av-glint av-glint--dim" cx="41" cy="40.7" r=".65"/>' +
    '</g>' +
    '<path class="av-sk" d="M25.4 33.4h7.2l-.2 2.6q-3.6-.5-7 1.5z"/><path class="av-sk" d="M38.6 33.4h6.6v4.1q-3.2-1.8-6.6-1.5z"/>' +
    '<path class="av-eyeline av-eyeline--thin" d="M25.6 37.4q3.4-2 6.8-1.5"/><path class="av-eyeline av-eyeline--thin" d="M38.8 35.9q3.3-.3 6.3 1.5"/>' +
    '<path class="av-brow" d="M26 33.4q2.8-2.7 5.9-3.1"/><path class="av-brow" d="M39.3 30.3q3.1.4 5.5 3.1"/>' +
    '<path class="av-mouth" d="M33 46.8q1.4-1.8 2.8-.5 1.4-1.3 2.8.5"/>' +
    '<path class="av-tear av-tear--a" d="M26.3 42.2c-1.1 1.7-1.2 2.9-.2 3.6 1.1.6 2-.3 1.7-1.7-.3-.7-.8-1.3-1.5-1.9z"/>' +
    '<path class="av-tear av-tear--b" d="M44.3 42.2c-1 1.5-1.1 2.6-.2 3.2 1 .5 1.8-.3 1.5-1.5-.2-.6-.7-1.2-1.3-1.7z"/>' +
  '</g>';

const BLUSH =
  '<ellipse class="av-blush" cx="25.4" cy="43.6" rx="2.9" ry="1.8"/>' +
  '<ellipse class="av-blush" cx="45.4" cy="43.4" rx="2.4" ry="1.7"/>';

const NOSE = '<path class="av-nose" d="M36.9 41q1.2.6.3 1.6"/>';

/** face: 0 nada · 1 bigote · 2 candado · 3 barba · 4 pecas (drawn under the mouth). */
const FACE_PARTS = [
  '',
  '<path class="av-ot av-fh" d="M35.7 41.3c-2.1-.9-5.2-.3-6.7 2.1 2.3 1.1 5.1.8 6.7-.5 1.6 1.3 4.4 1.6 6.7.5-1.5-2.4-4.6-3-6.7-2.1z"/>',
  '<path class="av-ot av-fh" fill-rule="evenodd" d="M35.7 41.2c3.9-.8 6.9 1.4 6.9 5.2 0 3.5-2.8 5.7-6.9 5.7s-6.9-2.2-6.9-5.7c0-3.8 3-6 6.9-5.2zM35.7 43.4c-2.2 0-3.7 1-3.7 2.6s1.5 2.6 3.7 2.6 3.7-1 3.7-2.6-1.5-2.6-3.7-2.6z"/>',
  '<path class="av-ot av-fh" fill-rule="evenodd" d="M14.6 36.5C13.6 46.8 21 53.5 32.4 53.5c11 0 18.2-6.7 17.2-16.7-.8 3.8-2.4 6.4-4.8 7.4-1.8-2.6-5.4-3.8-9.1-2.9-3.7-.9-7.3.3-9.1 2.9-3.8-.6-9.4-2.8-12-7.7zM35.7 43.5c-2.1 0-3.5.9-3.5 2.4s1.4 2.4 3.5 2.4 3.5-.9 3.5-2.4-1.4-2.4-3.5-2.4z"/>',
  '<g class="av-freckle"><circle cx="23.8" cy="41.8" r=".6"/><circle cx="25.8" cy="42.7" r=".6"/><circle cx="23.4" cy="44" r=".6"/><circle cx="27.2" cy="41.4" r=".55"/>' +
    '<circle cx="44.2" cy="41.6" r=".6"/><circle cx="46.2" cy="42.6" r=".6"/><circle cx="44.6" cy="43.9" r=".6"/>' +
    '<circle cx="34.8" cy="40.6" r=".5"/><circle cx="38.6" cy="40.9" r=".5"/></g>',
];

/* ---- Hair ---------------------------------------------------------------- */
/* Styles 0..5 are the original six; 6..9 were added later. */

const RULOS_OUT = [[9.2, 29], [11.2, 19.6], [19.6, 12.4], [30.5, 9.6], [41.5, 11.6], [50.4, 17.6], [54.4, 27]];
const RULOS_BACK = scallop([...RULOS_OUT, [53.4, 37], [49.5, 44.5], [17.5, 47.5], [10.4, 40]]);
const RULOS_FRONT = scallop([[14.6, 36.5], ...RULOS_OUT, [50.6, 33], [45.5, 28.2], [38.6, 26.8], [31.6, 27.6], [24.6, 29.4], [19, 32.4]]);
const RULOS_PUFF_L = scallop([[12.8, 27.4], [16.2, 30.6], [16.6, 37], [17.6, 43.6], [12.8, 46.2], [8.6, 40.6], [7.8, 33]]);
const RULOS_PUFF_R = scallop([[50.6, 27], [54.6, 30.4], [54.8, 36.8], [51.2, 40.8], [49.4, 35], [49.6, 30.6]]);

/** Smooth hair pulled back (rodete, colita). */
const PULLED_BACK = 'M13 40.6C11.3 28 17.5 15.6 32 15.6c12.5 0 20 7.2 19.2 17-2.8-4.6-6.8-8-11.6-9.2-6.1 3.2-13.6 5.2-19.6 5.4-.1 3.8-.5 7-1.2 9.8-1 0-1.4 1.2-1.5 2.4-1.5.6-3.1.4-4.3-.4z';

/** A braid hanging from (x, y): knots, a band in the player colour, a tuft. */
function braid(x, y, lean) {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const cx = r1(x + lean * i * 0.12);
    const cy = r1(y + i * 4.1);
    out += `<ellipse class="av-o av-ha" cx="${cx}" cy="${cy}" rx="${r1(3.4 - i * 0.14)}" ry="2.7" transform="rotate(${(i % 2 ? -22 : 22) * lean} ${cx} ${cy})"/>`;
  }
  const bx = r1(x + lean * 0.6);
  const by = r1(y + 19.4);
  return (
    `<g class="av-sway">${out}` +
    `<path class="av-o av-ha" d="M${r1(bx - 1.9)} ${r1(by + 2)}c-.5 2.5.3 4.4 1.9 5.6 1.6-1.2 2.4-3.1 1.9-5.6z"/>` +
    `<rect class="av-ot av-sh" x="${r1(bx - 2.4)}" y="${by}" width="4.8" height="2.5" rx="1.1"/></g>`
  );
}

/** Whether the ear is drawn over the hair (short styles) or hidden under it. */
const EAR_ON_TOP = [true, false, false, true, true, true, true, false, true, false];
/** Highest point of each hair style (viewBox units). */
const HAIR_TOP = [10.6, 13.6, 8.4, 17, 5.6, 5.4, 15, 13.4, 5.4, 13.6];

function hairBack(style, hatted) {
  switch (style) {
    case 1:
      return '<g class="av-sway"><path class="av-o av-ha" d="M11.6 33C10.6 21 19.5 14.6 32 14.6c13 0 21.4 7 20.4 20.4-.5 10 1 20.5-1.2 28.4-2.6 3-7.6 3.2-10.6.8l-16 .4c-4 3.4-11.2 2.8-13.6-2-1.8-8.6-.4-19.6.6-29.6z"/>' +
        '<path class="av-had-l" d="M14.2 50.5c-.7 4.6-.5 8.6.4 12.4M49.6 50c.5 4.4.3 8.2-.5 11.6"/></g>';
    case 2:
      return hatted ? '' : `<path class="av-o av-ha" d="${RULOS_BACK}"/>`;
    case 5:
      return hatted
        ? '<circle class="av-o av-ha" cx="11.4" cy="43.6" r="5.5"/><path class="av-hal" d="M8.6 41.6a3.6 3.6 0 0 1 4.4-1.4"/>'
        : '<circle class="av-o av-ha" cx="20.4" cy="13.2" r="7.3"/><path class="av-hal" d="M16.6 10.8a4.8 4.8 0 0 1 6.4-1.6"/>';
    case 6:
      return '<g class="av-sway av-sway--tail">' +
        '<path class="av-o av-ha" d="M15 21.6C7.4 21.8 3 29.4 3.6 38.6c.4 6.4 2.6 12.4 6.2 16.4.8-5.4 2.4-10.2 4.4-14 1.8-6 2.6-13.2.8-19.4z"/>' +
        '<path class="av-hal" d="M7.2 30.4c-1 4.8-.5 9.6 1.3 14"/>' +
        '<rect class="av-ot av-sh" x="10.2" y="21.6" width="5" height="3.4" rx="1.5" transform="rotate(-24 12.7 23.3)"/></g>';
    case 7:
      return '<path class="av-o av-ha" d="M11 43.6C8.8 29.6 14 14.4 32 14.4s23.2 15.2 21 29.2c-.6 4.4-5.6 5.2-8.6 3.8l-24.4.2c-3.2 1.4-8.4.6-9-4z"/>';
    case 9:
      return braid(49.8, 43.6, 1);
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
      return `<path class="av-o av-ha" d="${PULLED_BACK}"/><path class="av-hal" d="M37 19c4.2 1 7.4 3.2 9.2 6.4"/>`;
    case 6:
      return `<path class="av-o av-ha" d="${PULLED_BACK}"/><path class="av-hal" d="M37 19c4.2 1 7.4 3.2 9.2 6.4"/>` +
        '<path class="av-had-l" d="M18.6 22.6c3.8-3.4 8.6-5 13.6-5"/>';
    case 7:
      return '<path class="av-o av-ha" d="M11 43.6C8.8 29.6 14 14.4 32 14.4s23.2 15.2 21 29.2c-.3 2.2-2 3.2-3.8 2.6.6-5.4.4-10.6-.6-15.4-10.4-1.5-21.8-1.3-28.4.2-.6 5-.6 10.2-.2 15.2-1.8 1.4-8.4.6-9-2.6z"/>' +
        '<path class="av-had-l" d="M26 22.6c-.4 2.8-.2 5.6.4 8.2M32.6 21.6c-.1 3 0 6 .4 9M39.4 22.2c.6 2.8.8 5.8.6 8.6"/>' +
        '<path class="av-hal" d="M38.6 17.6c5 1.4 8.4 4.8 9.8 9.4"/>';
    case 8:
      return '<path class="av-o av-ha" d="M13.2 40.8C11.6 31 13 21.4 20.4 16.8 22 10.2 30 5.6 38.6 6.4c7.4.6 13 6.2 12.4 13.6 1.2 4 1 8.4.2 12-1.8-3.6-4.4-6-7.8-6.8-6.4 3.6-15.8 4.2-21.2 2.4-.4 3.8-1 7-2 9.8-1.8-.8-2.8 1-3 3.6-1.4.8-2.8.6-4-.2z"/>' +
        '<path class="av-hal" d="M26.6 13.8c4.2-3.6 9.8-4.8 15-3.2M29.6 19.6c4.8-2.8 10.2-3.2 15-1.2"/>';
    case 9:
      return braid(15.2, 44.4, -1) +
        '<path class="av-o av-ha" d="M12 39C10.2 24 19.5 14.6 32 14.6c13 0 21.2 7.4 20.3 20.9-.1 2-.3 3.9-.6 5.7-1.6-4-3-8-5.5-11.6-2.4-3-5.2-4.8-7.6-5.4-4.1 4.4-12.8 7.6-18.3 8.1-.3 3.6-.6 7.2-1.1 10.7-3-1-6.4-3.4-7.2-4z"/>' +
        '<path class="av-hal" d="M36.6 18.3c4.6 1 8 3.6 9.8 7.2"/>';
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
    '<path d="M24 36.2l-7.6-1" stroke="#2b2230" stroke-width="1.5" stroke-linecap="round"/>' +
    '<rect x="23.8" y="32.6" width="10.2" height="10.2" rx="3.8" fill="#e2f0ff" fill-opacity=".34" stroke="#2b2230" stroke-width="1.7"/>' +
    '<rect x="37.4" y="32.6" width="9.4" height="10.2" rx="3.8" fill="#e2f0ff" fill-opacity=".34" stroke="#2b2230" stroke-width="1.7"/>' +
    '<path d="M34 36.3q1.7-1.2 3.4 0" stroke="#2b2230" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M25.8 35.6l1.8-1.4M39.3 35.6l1.7-1.4" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".85"/>',
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

const DRAGON_WING = 'M-11.4 47.4c-3.1-6.4-8.1-10.2-14.1-11 .9 3.2 2.5 5.2 4.7 6.2-1.2 1-1.4 2.6-.6 4 2.2-1 4-.8 5.2.4 1.2.6 3.2.8 4.8.4z';

const DRAGON =
  '<g class="av-pet av-pet--back av-pet--dragon"><g class="av-dragon-fly"><g transform="translate(-15 47) scale(1.22) translate(11 -49)">' +
    '<g class="av-dragon-tail">' +
      '<path class="av-ls" d="M-16.5 56c-5.5 2.2-9.4-1.6-7.6-6" stroke-width="4.8" stroke-linecap="round"/>' +
      '<path d="M-16.5 56c-5.5 2.2-9.4-1.6-7.6-6" stroke="#8b63e6" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="av-ot" fill="#fbe7b0" d="M-26.8 50.2l2.2-5.2 2.6 4.8z"/>' +
    '</g>' +
    `<g transform="translate(2.8 -2)"><path class="av-o av-dragon-wing av-dragon-wing--far" fill="#6f4bc4" d="${DRAGON_WING}"/></g>` +
    '<ellipse class="av-o" fill="#8b63e6" cx="-14.4" cy="60.6" rx="2.1" ry="1.5"/>' +
    '<path class="av-o" fill="#8b63e6" d="M-18.4 53.4c0-4.8 3.2-7.8 7.2-7.8s6.6 3 6.6 7c0 4.6-3 7.8-7 7.8s-6.8-2.8-6.8-7z"/>' +
    '<path fill="#fbe7b0" d="M-10.2 50.4c2.8.4 4.6 2.6 4.4 5-.8 2.6-3 4.2-5.6 4.2 1.8-2.6 2.2-6.2 1.2-9.2z"/>' +
    '<path d="M-9.3 53.2h3.3M-9.5 55.6h3.5M-10.2 57.9h3.1" stroke="#dcbb6e" stroke-width=".8" stroke-linecap="round"/>' +
    '<path class="av-ot" fill="#fbe7b0" d="M-16.8 47.6l-2.6-2 .8 3.4zM-18.4 51.2l-2.8-1 1.6 2.8z"/>' +
    '<ellipse class="av-o" fill="#8b63e6" cx="-9.4" cy="61" rx="2.1" ry="1.5"/>' +
    `<g class="av-dragon-wing"><path class="av-o" fill="#c3a9fa" d="${DRAGON_WING}"/>` +
      '<path d="M-11.8 47c-3.2-4.2-7.2-7.4-12.6-9.8M-12 47.2c-3-1.6-5.8-2.8-8.4-4.4" stroke="#8b63e6" stroke-width=".9" stroke-linecap="round"/></g>' +
    '<g class="av-pet-head">' +
      '<path class="av-ot" fill="#fbe7b0" d="M-10.6 38.2l-1.6-4.8 3.8 2.8z"/><path class="av-ot" fill="#fbe7b0" d="M-5.6 36.8l.6-4.8 2.4 4.2z"/>' +
      '<path class="av-o" fill="#8b63e6" d="M-13 43.4c0-4 3-6.8 6.6-6.8 3.8 0 6.6 2.6 6.6 6.2 1.6.4 2.6 1.6 2.4 3.2-.2 2-2.2 3.2-5 3.2h-4.8c-3.4 0-5.8-2.2-5.8-5.8z"/>' +
      '<ellipse fill="#f590ae" fill-opacity=".7" cx="-6.8" cy="45.8" rx="1.4" ry=".9"/>' +
      '<ellipse fill="#2a1f2e" cx="-4" cy="42.4" rx="1.5" ry="1.9"/><circle fill="#fff" cx="-3.5" cy="41.7" r=".6"/>' +
      '<circle fill="#2a1f2e" cx="1" cy="45.2" r=".5"/>' +
      '<path d="M-2.2 47.3q1.8 1 3.6-.3" stroke="#2a1f2e" stroke-width=".9" stroke-linecap="round"/>' +
      '<g class="av-dragon-fire">' +
        '<path fill="#ff8a2e" d="M3.4 46.8c2.6-2 5.8-1.8 7.8.2-1.6.2-2.6.8-3 1.8 1.4.2 2.2.8 2.6 1.8-2.8.8-6-.2-7.4-3.8z"/>' +
        '<path fill="#ffe27a" d="M4.4 47c1.8-1 3.4-.8 4.8.2-1.4.4-2 1.2-2.2 2.2-1.1-.4-2-1.2-2.6-2.4z"/>' +
      '</g>' +
    '</g>' +
  '</g></g></g>';

/** back: drawn behind the walker; room: how far it trails outside the box, as a
    fraction of the character height (the parade keeps that much off the lane edge). */
const PETS = {
  dog: { back: true, room: 0.27, art: DOG, box: '-25.5 65 37 37' },
  cat: { back: true, room: 0.27, art: CAT, box: '-25 64 35 35' },
  parrot: { back: false, room: 0, art: PARROT, box: '-1 30.5 37 37' },
  dragon: { back: true, room: 0.36, art: DRAGON, box: '-36.5 20.5 49 49' },
};

/* ---- Auras --------------------------------------------------------------- */

const SPARK = 'M0-4.6Q.7-.7 4.6 0 .7.7 0 4.6-.7.7-4.6 0-.7-.7 0-4.6z';

function sparkAt(x, y, scale, phase, tone) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path class="av-spark av-p${phase}" fill="${tone}" d="${SPARK}"/></g>`;
}

const FLAME = 'M1.5 97C-3 82 2 70 7 62c-1-10 2-18 6.5-23-.5-9 3.5-19 9.5-25.5.5 5.5 2.5 8.5 4.5 10C28 14 31.5 5 36.5-2.5 38 6 42 13.5 45.5 18.5 47 16 48 12.5 48 9c5.5 8 8 18 6.5 27.5C58.5 41.5 61 50 59 59.5 63.5 68 66 82 62 97z';

const AURAS = {
  sparkle() {
    return {
      back:
        sparkAt(2, 30, 1.15, 0, '#f3dfa2') + sparkAt(61, 15, 0.9, 3, '#fffdf6') + sparkAt(63, 55, 1.25, 6, '#f3dfa2') +
        sparkAt(1, 66, 0.85, 2, '#fffdf6') + sparkAt(50, 2, 0.75, 8, '#f3dfa2') + sparkAt(11, 7, 1, 5, '#fbefc9'),
      front:
        sparkAt(7, 48, 0.6, 6, '#fffdf6') + sparkAt(58, 80, 0.75, 1, '#fbefc9') + sparkAt(18, 91, 0.55, 8, '#f3dfa2') +
        sparkAt(55, 36, 0.5, 3, '#fffdf6'),
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
        '<circle class="av-ember av-p1" fill="#ffe27a" cx="6" cy="40" r="1.2"/>' +
        '<circle class="av-ember av-p5" fill="#ffb02e" cx="58" cy="34" r="1"/>' +
        '<circle class="av-ember av-p7" fill="#ffe27a" cx="52" cy="8" r="1.1"/>' +
        '<circle class="av-ember av-p3" fill="#ffb02e" cx="16" cy="14" r=".9"/>',
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
        '<path class="av-mote av-p1" fill="#fff6d6" d="M8 84l1.2 1.8L8 87.6 6.8 85.8z"/>' +
        '<path class="av-mote av-p6" fill="#f3dfa2" d="M56 88l1.2 1.8-1.2 1.8-1.2-1.8z"/>' +
        '<path class="av-mote av-p10" fill="#fff6d6" d="M2 70l1 1.5-1 1.5-1-1.5z"/>' +
        '<path class="av-mote av-p4" fill="#f3dfa2" d="M61 66l1 1.5-1 1.5-1-1.5z"/>' +
        '<path class="av-mote av-p9" fill="#fff6d6" d="M48 92l.9 1.4-.9 1.4-.9-1.4z"/>',
    };
  },
};

/* ---- Assembly ------------------------------------------------------------ */

const LOOK_KEYS = Object.keys(LOOK_DEFAULT);

/** A full look with every field valid (unknown values become defaults). */
function normLook(look) {
  const src = look && typeof look === 'object' ? look : {};
  const key = (value, table) => (has(table, value) ? value : 'none');
  return {
    skin: intIn(src.skin, SKIN.length),
    hair: intIn(src.hair, HAIR_LABELS.length),
    hairColor: intIn(src.hairColor, HAIR.length),
    pants: intIn(src.pants, PANTS.length),
    eyes: intIn(src.eyes, EYES.length),
    face: intIn(src.face, FACE_PARTS.length),
    hat: key(src.hat, HATS),
    glasses: key(src.glasses, GLASSES),
    neck: key(src.neck, NECK),
    outfit: key(src.outfit, OUTFITS),
    hand: key(src.hand, HANDS),
    pet: key(src.pet, PETS),
    aura: key(src.aura, AURAS),
  };
}

/**
 * The look as the editor keeps it: free parts validated, every other string
 * field kept as the server sent it (a key or a slot this version cannot draw
 * is simply not drawn, but it is never dropped from what onChange reports).
 */
function keepLook(look) {
  const src = look && typeof look === 'object' ? look : {};
  const out = normLook(src);
  for (const slot of Object.keys(src)) {
    if (has(LOOK_FREE, slot) || slot === '__proto__') continue;
    if (typeof src[slot] === 'string' && src[slot]) out[slot] = src[slot];
  }
  return out;
}

/** Same rule as ui.avatarColor: out-of-range indexes wrap. */
function normAvatar(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(Math.trunc(n)) % 12 : 0;
}

const lookKey = (look) => LOOK_KEYS.map((key) => look[key]).join('.');

/** Highest drawn point of the figure, in viewBox units (0 = top of the box). */
function figureTop(look) {
  const hat = has(HATS, look.hat) ? HATS[look.hat] : null;
  if (hat && hat.cover) return hat.top;
  return Math.min(HAIR_TOP[look.hair], hat ? hat.top : 99);
}

/** The shadow a brim casts on the forehead (clipped to the skull). */
const HAT_SHADE = {
  cap: 'M11.6 27.8c12.9-3.8 27.4-4.2 39.8-.8v3.4c-12.4-3.4-26.9-3-39.8.8z',
  visor: 'M13 30.2c11.5-4.2 27.5-4.8 38.4-2v2.6c-10.9-2.8-26.9-2.2-38.4 2z',
  fedora: 'M13 29.8c11.5-3.6 27.5-3.8 39.8-.4V32c-12.3-3.4-28.3-3.2-39.8.4z',
  cowboy: 'M16 27.4c9.4-1.8 23.2-1.8 32.6 0v2.8c-9.4-1.8-23.2-1.8-32.6 0z',
  tophat: 'M15 26.6c11.2-1.8 23.8-1.8 35 0v2.6c-11.2-1.8-23.8-1.8-35 0z',
};

/** Three little stars that circle over the head while the mood is "hit"
    (the bare circle keeps the group's box centred on the orbit). */
const DIZZY = '<circle r="14"/>' + [20, 140, 260].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return `<g transform="translate(${r1(13 * Math.cos(a))} ${r1(13 * Math.sin(a))}) scale(.8 2)"><path class="av-star" d="${SPARK}"/></g>`;
}).join('');

/** Inner markup of the character <svg>. Everything here is authored above. */
function figureMarkup(look, uid, parts = {}) {
  const hat = has(HATS, look.hat) ? HATS[look.hat] : null;
  const covered = !!(hat && hat.cover);
  const outfit = has(OUTFITS, look.outfit) ? look.outfit : 'none';
  const wear = outfit === 'none' ? { back: '', torso: shirtArt(uid), over: '' } : OUTFITS[outfit](uid, look);
  const long = outfit !== 'none' && outfit !== 'cape';
  const held = parts.hand !== false && has(HANDS, look.hand) ? look.hand : '';
  const defs = [
    `<clipPath id="${uid}k"><path d="${SKULL_D}"/></clipPath>`,
    `<clipPath id="${uid}t"><path d="${long ? COAT_D : TORSO_D}"/></clipPath>`,
  ];
  let clip = '';
  if (covered) {
    defs.push(`<clipPath id="${uid}h"><rect x="-40" y="${hat.line}" width="144" height="140"/></clipPath>`);
    clip = ` clip-path="url(#${uid}h)"`;
  }
  const aura = parts.aura !== false && has(AURAS, look.aura) ? AURAS[look.aura](uid, defs) : null;
  const pet = parts.pet !== false && has(PETS, look.pet) ? PETS[look.pet] : null;
  const hair = look.hair;
  const arms = armsArt(outfit);
  const front = hairFront(hair, covered);
  const bearded = look.face === 2 || look.face === 3;

  let out = `<defs>${defs.join('')}</defs>`;
  if (aura) out += `<g class="av-aura av-aura--back">${aura.back}</g>`;
  out += '<ellipse class="av-shadow" cx="32" cy="96.8" rx="14.5" ry="2.6"/>';
  out += '<g class="av-flip">';
  if (pet && pet.back) out += pet.art;
  out += `<g class="av-body">${wear.back}${legsArt(outfit)}${HIPS}`;
  out += `<g class="av-upper${held ? ` av-hold av-hold--${held}` : ''}">`;
  out += `<g class="av-hairback"${clip}>${hairBack(hair, covered)}</g>`;
  out += arms.far + wear.torso + arms.near + wear.over;
  if (has(NECK, look.neck)) out += `<g class="av-neckwear">${NECK[look.neck]}</g>`;
  if (held) out += heldArt(held);
  out += `<g class="av-head${bearded ? ' av-bearded' : ''}">`;
  if (!EAR_ON_TOP[hair]) out += EAR;
  out += SKULL;
  out += `<g clip-path="url(#${uid}k)">${JAW_SHADE}<g class="av-cast" transform="translate(0 1.9)"${clip}>${front}</g>`;
  if (hat && has(HAT_SHADE, look.hat)) out += `<path class="av-shade" d="${HAT_SHADE[look.hat]}"/>`;
  out += '</g>';
  out += BLUSH + NOSE + FACE_PARTS[look.face] + FACES;
  out += `<g class="av-hair"${clip}>${front}</g>`;
  if (EAR_ON_TOP[hair]) out += EAR;
  if (has(GLASSES, look.glasses)) out += `<g class="av-glasses">${GLASSES[look.glasses]}</g>`;
  if (hat) out += `<g class="av-hat">${hat.art}</g>`;
  out += `<g class="av-fx av-fx--hit" transform="translate(32 ${r1(figureTop(look) - 1.5)}) scale(1 .4)"><g class="av-dizzy">${DIZZY}</g></g>`;
  out += '</g>';
  if (pet && !pet.back) out += pet.art;
  out += '</g></g></g>';
  if (aura) out += `<g class="av-aura av-aura--front">${aura.front}</g>`;
  return out;
}

/* Shoes: upper, far upper, sole, highlight. */
const SHOES = ['#7a4f38', '#5c3a29', '#eadfc8', '#bd9170'];
const SNEAKERS = ['#f6efdd', '#cfc6b2', '#ffffff', '#ffffff'];
const DRESS_SHOES = ['#2f2937', '#211c28', '#4d4559', '#8f85a2'];

/** Set the colour custom properties of a look on an element. */
function paint(node, look, avatarIndex) {
  const skin = SKIN[look.skin];
  const hair = HAIR[look.hairColor];
  const shirt = avatarColor(avatarIndex);
  let pants = PANTS[look.pants];
  let coat = '#3b4466';
  let shoes = SHOES;
  if (look.outfit === 'hoodie') {
    shoes = SNEAKERS;
  } else if (look.outfit === 'tracksuit') {
    pants = mix(shirt, '#1a0f22', 0.16);
    shoes = SNEAKERS;
  } else if (look.outfit === 'suit') {
    pants = '#333b5a';
    shoes = DRESS_SHOES;
  } else if (look.outfit === 'tux') {
    coat = '#2c2735';
    pants = '#25212d';
    shoes = DRESS_SHOES;
  }
  const set = (name, value) => node.style.setProperty(name, value);
  set('--av-skin', skin);
  set('--av-skin-d', mix(skin, '#5a2430', 0.22));
  set('--av-blush', mix(skin, '#e8404f', 0.4));
  set('--av-mouth', mix(skin, '#3a0c14', 0.74));
  set('--av-lip', mix(skin, '#c2444c', 0.6));
  set('--av-freckle', mix(skin, '#8a3d1c', 0.55));
  set('--av-iris', EYES[look.eyes]);
  set('--av-hair', hair);
  set('--av-hair-l', mix(hair, '#ffffff', 0.34));
  set('--av-hair-d', mix(hair, '#120a18', 0.34));
  set('--av-brow', mix(hair, '#1a1020', 0.4));
  set('--av-beard', mix(hair, '#1a1020', 0.16));
  set('--av-shirt', shirt);
  set('--av-shirt-d', mix(shirt, '#1a0f22', 0.3));
  set('--av-shirt-x', mix(shirt, '#1a0f22', 0.48));
  set('--av-pants', pants);
  set('--av-pants-d', mix(pants, '#120a18', 0.3));
  set('--av-coat', coat);
  set('--av-coat-d', mix(coat, '#0d0812', 0.32));
  set('--av-coat-l', mix(coat, '#ffffff', 0.17));
  set('--av-shoe', shoes[0]);
  set('--av-shoe-d', shoes[1]);
  set('--av-sole', shoes[2]);
  set('--av-shoe-l', shoes[3]);
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
  const pet = has(PETS, key) ? PETS[key] : null;
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
 *         pet = true, aura = true, hand = true (draw those parts or not) }
 * The box is size * 0.64 wide and keeps head room for hats (a bare-headed
 * character is about 0.84 * size tall, feet on the bottom edge). Pets trail
 * up to 0.36 * size behind the box, a cape or something held in the hand
 * sticks out a little at the sides and auras spill around it.
 * Methods (all return the element): update(player), setWalking(bool),
 * setFacing('left' | 'right') — mirrors the drawing only —,
 * setMood('cheer' | 'love' | 'hit' | 'sad' | null).
 */
export function createAvatar(player, opts = {}) {
  const art = svg('svg', { class: 'av-svg', viewBox: '0 0 64 100', focusable: 'false', 'aria-hidden': 'true' });
  const node = el('span', { class: 'avatar-char', attrs: { role: 'img' } }, art);
  const uid = nextUid();
  const parts = { pet: opts.pet !== false, aura: opts.aura !== false, hand: opts.hand !== false };
  let drawn = '';
  let painted = '';

  if (Number.isFinite(opts.size)) node.style.setProperty('--av-size', `${opts.size}px`);
  node.style.setProperty('--av-seed', Math.random().toFixed(3));

  node.update = (next) => {
    const data = next || {};
    const look = normLook(data.look);
    const index = normAvatar(data.avatar);
    const key = lookKey(look);
    if (key !== drawn) {
      drawn = key;
      art.innerHTML = figureMarkup(look, uid, parts);
      node.style.setProperty('--av-top', (figureTop(look) / 100).toFixed(3));
      node.dataset.pet = parts.pet ? look.pet : 'none';
    }
    const colors = `${look.skin}.${look.hairColor}.${look.pants}.${look.eyes}.${look.outfit}.${index}`;
    if (colors !== painted) {
      painted = colors;
      paint(node, look, index);
    }
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
      node.appendChild(staticFigure(look, index, bustBox(look), { pet: false, aura: false, hand: false }));
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
    '<svg viewBox="0 0 32 32"><path d="M3.6 19.6h24.8l-3.2 7.2a2 2 0 0 1-1.8 1.2H8.6a2 2 0 0 1-1.8-1.2z" fill="#cfc8d6" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M4.4 19.6c-.6-6.2 4.6-10.8 11.6-10.8s12.2 4.6 11.6 10.8z" fill="#fff3dc" stroke="' + FX_LINE + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M9.4 16.6c1.4-2.8 3.8-4.4 6.6-4.4M19.4 13.4c1.6.8 2.8 2 3.4 3.6" stroke="#e8cf9e" stroke-width="1.4" stroke-linecap="round" fill="none"/>' +
    '<circle cx="16" cy="7.2" r="3.3" fill="#d43a4c" stroke="' + FX_LINE + '" stroke-width="1.4"/><path d="M14.8 6.2c.4-.6 1-.9 1.6-.9" stroke="#ff9aa6" stroke-width="1" stroke-linecap="round" fill="none"/></svg>',
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
  '<g fill="#6fb6f2"><path class="parade__drop" d="M14 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/>' +
  '<path class="parade__drop" d="M22 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/>' +
  '<path class="parade__drop" d="M30 25c1.2 1.8 2 2.8 2 3.8a2 2 0 0 1-4 0c0-1 .8-2 2-3.8z"/></g></svg>';
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
 * Characters and name tags size themselves from the lane: 72 px characters and
 * one row of tags on a roomy lane, 56 px and two rows on a phone. Only the
 * walkers take pointer events; bubbles and hats overflow the top of the lane.
 * Flying things live in a fixed layer appended to <body> (.parade-fx).
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
  let width = 0;
  let height = 0;
  let fxLayer = null;
  let observer = null;
  const m = { compact: false, rows: 1, rowH: 18, tagsH: 21, charH: 64, charW: 41, gap: 5 };

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
    m.compact = width < 560;
    root.classList.toggle('parade--compact', m.compact);
    root.classList.toggle('parade--still', still());
    m.gap = m.compact ? 3 : 5;
    let total = 0;
    for (const w of walkers.values()) {
      w.tagW = w.tag.offsetWidth || w.tagW;
      total += w.tagW + m.gap;
    }
    // one row of name tags while they fit side by side, two (or three) on crowded lanes
    if (total <= width * (m.compact ? 0.94 : 0.8)) m.rows = 1;
    else m.rows = total <= width * (m.compact ? 2.3 : 1.9) ? 2 : 3;
    m.rowH = m.compact ? 15 : 18;
    m.tagsH = m.rows * m.rowH + 3;
    m.charH = Math.round(clamp(height - m.tagsH - 3, 34, m.compact ? 56 : 72));
    m.charW = m.charH * 0.64;
    root.style.setProperty('--pw-char', `${m.charH}px`);
    root.style.setProperty('--pw-row', `${m.rowH}px`);
    root.style.setProperty('--pw-tags', `${m.tagsH}px`);
    return true;
  }

  function range(w) {
    const pad = m.charW / 2 + 6 + (w ? m.charH * w.petRoom : 0);
    const min = Math.min(pad, width / 2);
    return [min, Math.max(min, width - pad)];
  }

  function place(w) {
    w.node.style.transform = `translate3d(${w.x.toFixed(1)}px,0,0)`;
    if (!w.shown) {
      w.shown = true;
      w.node.style.visibility = '';
    }
  }

  function setRow(w, row) {
    if (w.row === row) return;
    w.row = row;
    w.node.style.setProperty('--pw-rowi', String(row));
  }

  function setShift(w, value) {
    if (w.tagShift === value) return;
    w.tagShift = value;
    w.tag.style.transform = `translateX(calc(-50% + ${value.toFixed(1)}px))`;
  }

  /** Where a group of touching tags goes: the average of where each wants to be, inside the lane. */
  function fitBlock(block) {
    if (block.width >= width - 4) return (width - block.width) / 2;
    return clamp(block.sum / block.n, 2, width - block.width - 2);
  }

  /**
   * Name tags never cover each other: each one picks the row with room for it
   * (staying where it is when it can) and tags that would touch slide apart.
   * dt = null applies the result at once; otherwise the tags glide to it.
   * Returns true while a tag is still on its way.
   */
  function layoutTags(dt) {
    const list = [...walkers.values()].filter((w) => w.x != null && !w.leaving).sort((a, b) => a.x - b.x);
    const gap = m.gap;
    const rows = Array.from({ length: m.rows }, () => []);
    const edge = new Array(m.rows).fill(-1e9);
    const used = new Array(m.rows).fill(0);
    for (const w of list) {
      const left = w.x - w.tagW / 2;
      let best = 0;
      let bestCost = Infinity;
      for (let r = 0; r < m.rows; r++) {
        const room = left - edge[r] - gap; // space left of this tag on that row
        const spill = Math.max(0, used[r] + w.tagW + gap - (width - 4)); // the row would not fit in the lane
        const cost = Math.max(0, -room) + spill * 3 + (r === w.row || room > 12 ? 0 : 14) + r * 0.5;
        if (cost < bestCost) {
          bestCost = cost;
          best = r;
        }
      }
      edge[best] = Math.max(edge[best] + gap, left) + w.tagW;
      used[best] += w.tagW + gap;
      rows[best].push(w);
      setRow(w, best);
    }

    for (const row of rows) {
      const blocks = [];
      for (const w of row) {
        let block = { items: [w], width: w.tagW, sum: w.x - w.tagW / 2, n: 1, left: 0 };
        block.left = fitBlock(block);
        while (blocks.length && blocks[blocks.length - 1].left + blocks[blocks.length - 1].width + gap > block.left) {
          const prev = blocks.pop();
          prev.sum += block.sum - (prev.width + gap) * block.n;
          prev.n += block.n;
          prev.width += gap + block.width;
          prev.items.push(...block.items);
          prev.left = fitBlock(prev);
          block = prev;
        }
        blocks.push(block);
      }
      for (const block of blocks) {
        let x = block.left;
        for (const w of block.items) {
          w.tagGoal = x + w.tagW / 2 - w.x;
          x += w.tagW + gap;
        }
      }
    }

    const k = dt == null ? 1 : Math.min(1, dt * 14);
    let gliding = false;
    for (const w of list) {
      const diff = w.tagGoal - w.tagShift;
      if (k >= 1 || Math.abs(diff) < 0.4) {
        setShift(w, w.tagGoal);
      } else {
        setShift(w, w.tagShift + diff * k);
        gliding = true;
      }
    }
    return gliding;
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
      face(w, 'right', true);
      walkAnim(w, false);
      place(w);
    });
  }

  /* ---- walker state ------------------------------------------------------ */

  /** snap = no turning animation (first placement, entering from an edge). */
  function face(w, dir, snap) {
    if (w.facing === dir) return;
    w.facing = dir;
    if (snap) w.avatar.classList.add('is-snap');
    w.avatar.setFacing(dir);
    if (snap) {
      void w.avatar.offsetWidth; // apply the new facing while transitions are off
      w.avatar.classList.remove('is-snap');
    }
  }

  /** Lay the name tags out at once (no gliding, no row animation). */
  function settleTags() {
    root.classList.add('parade--snap');
    layoutTags(null);
    void root.offsetWidth;
    root.classList.remove('parade--snap');
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
    w.gait = 0.3;
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
        // ease into the walk and slow down on arrival
        w.gait = Math.min(1, w.gait + dt * 4);
        const arriving = clamp(Math.abs(delta) / (m.charH * 0.2), 0.45, 1);
        const step = m.charH * 0.6 * w.pace * w.gait * arriving * dt;
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

    if (layoutTags(frozen ? null : dt)) active = true;

    if (active) {
      raf = requestAnimationFrame(tick);
    } else {
      lastTs = 0;
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
    return Number.isFinite(n) && n > 0 ? n : 0; // personal levels start at 0, like everywhere else in the club
  }

  function paintWalker(w, p) {
    w.player = p;
    const look = normLook(p.look);
    const color = avatarColor(normAvatar(p.avatar));
    const isMe = w.id === meId;
    const label = describe(p, isMe);
    const top = (figureTop(look) / 100).toFixed(3);
    w.avatar.update(p);
    w.petRoom = has(PETS, look.pet) ? PETS[look.pet].room : 0;
    const sig = `${label}|${color}|${top}`;
    if (sig === w.sig) return; // sync() is called often: only touch the DOM when something changed
    w.sig = sig;
    w.name.textContent = p.name ? String(p.name) : 'Jugador';
    w.level.textContent = `Nv ${levelOf(p)}`;
    w.crown.hidden = !p.crown;
    w.debt.hidden = !(Number(p.debt) > 0);
    w.marker.hidden = !isMe;
    w.node.classList.toggle('is-me', isMe);
    w.node.classList.toggle('is-offline', p.connected === false);
    w.node.style.setProperty('--pw-color', color);
    w.node.style.setProperty('--pw-ink', luminance(color) > 0.36 ? '#1c1a24' : '#fffdf6');
    w.node.style.setProperty('--pw-top', top);
    w.node.setAttribute('aria-label', label);
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
    const tag = el('span', { class: 'parade__tag' }, level, crown, name, debt);
    const tagRow = el('span', { class: 'parade__tagrow', attrs: { 'aria-hidden': 'true' } }, tag);
    const node = el('button', { type: 'button', class: 'parade__walker' }, body, marker, tagRow);
    const w = {
      id, node, body, avatar, marker, tag, level, crown, name, debt,
      player: p, x: null, target: 0, state: 'idle', facing: 'right', walking: false,
      idleUntil: 0, holdUntil: 0, gait: 0.3, row: 0, tagW: 60, tagShift: 0, tagGoal: 0, petRoom: 0,
      pace: 0.88 + Math.random() * 0.3, leaving: false, shown: false, sig: '', moodTimer: 0, bubble: null, bubbleTimer: 0, stain: null, cloud: null,
    };
    node.style.visibility = 'hidden'; // until the lane is measured and the walker has a place
    avatar.style.setProperty('--av-pace', w.pace.toFixed(2));
    node.addEventListener('click', () => {
      if (typeof opts.onPick === 'function') opts.onPick(id);
    });
    walkers.set(id, w);
    root.appendChild(node);
    paintWalker(w, p);
    return w;
  }

  /** First placement: everybody already in the room, spread along the lane. */
  function scatter(list) {
    const t = now();
    const order = list.slice().sort(() => Math.random() - 0.5);
    order.forEach((w, i) => {
      const [min, max] = range(w);
      w.x = min + ((i + 0.2 + Math.random() * 0.6) / order.length) * (max - min);
      w.target = w.x;
      w.state = 'idle';
      w.idleUntil = t + 300 + Math.random() * 2600;
      face(w, Math.random() < 0.5 ? 'left' : 'right', true);
      place(w);
    });
  }

  /** Somebody joins: they come in from one edge of the lane and walk to a free spot. */
  function enter(w) {
    const fromLeft = Math.random() < 0.5;
    w.x = fromLeft ? m.charW / 2 : width - m.charW / 2;
    w.target = pickTarget(w);
    w.state = 'walk';
    face(w, fromLeft ? 'right' : 'left', true);
    pulse(w.node, 'is-entering', 500);
    place(w);
  }

  /** Give a place to every walker that does not have one yet. */
  function settle() {
    if (still()) {
      spread();
      return;
    }
    const waiting = [...walkers.values()].filter((w) => w.x == null);
    if (!placedOnce) scatter(waiting);
    else for (const w of waiting) enter(w);
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
    for (const p of list) {
      seen.add(p.id);
      const existing = walkers.get(p.id);
      if (existing) paintWalker(existing, p);
      else addWalker(p);
    }
    for (const w of [...walkers.values()]) if (!seen.has(w.id)) dropWalker(w);

    if (measure()) {
      const first = !placedOnce;
      settle();
      for (const w of walkers.values()) {
        const [min, max] = range(w);
        w.target = clamp(w.target, min, max);
      }
      placedOnce = placedOnce || walkers.size > 0;
      if (still() || first) settleTags();
      else layoutTags(0);
    }
    ensureLoop();
    return root;
  }

  function onResize() {
    if (destroyed) return;
    const before = width;
    if (!measure()) return;
    if (!still()) {
      // keep everybody's relative place when the lane changes width
      const ratio = before > 0 ? width / before : 1;
      for (const w of walkers.values()) {
        if (w.x == null) continue;
        const [min, max] = range(w);
        w.x = clamp(w.x * ratio, m.charW / 2, Math.max(m.charW / 2, width - m.charW / 2));
        w.target = clamp(w.target * ratio, min, max);
        place(w);
      }
    }
    settle();
    placedOnce = placedOnce || walkers.size > 0;
    settleTags();
    ensureLoop();
  }

  /* ---- effects ----------------------------------------------------------- */

  function fx() {
    if (!fxLayer) fxLayer = el('div', { class: 'parade-fx', attrs: { 'aria-hidden': 'true' } });
    if (!fxLayer.isConnected) document.body.appendChild(fxLayer);
    fxLayer.classList.toggle('parade-fx--still', still());
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
   * opts.target = the mascot element: the throw aims at its face and nothing
   * is painted on it (the mascot reacts by itself in opts.onImpact, which
   * fires on impact).
   */
  function throwAt(fromId, toId, item, o = {}) {
    if (destroyed) return root;
    const kind = has(THROWS, item) ? item : 'tomato';
    const def = THROWS[kind];
    const thrower = walkers.get(fromId);
    const victim = toId === 'dealer' ? null : walkers.get(toId);
    const targetEl = toId === 'dealer' && o.target && typeof o.target.getBoundingClientRect === 'function' ? o.target : null;
    if (toId !== 'dealer' && !victim) return root;

    const impacted = () => {
      if (typeof o.onImpact !== 'function') return;
      try {
        o.onImpact();
      } catch (err) {
        console.error(err);
      }
    };

    const lane = root.isConnected ? root.getBoundingClientRect() : null;
    if (!lane || !lane.width || !lane.height) {
      impacted(); // the lane is not on screen: nothing to show
      return root;
    }

    const aim = () => {
      if (victim) return alive(victim) && victim.x != null ? headOf(victim) : null;
      if (targetEl && targetEl.isConnected) {
        const rect = targetEl.getBoundingClientRect();
        if (rect.width || rect.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.24 };
      }
      return { x: lane.left - 40, y: lane.top + lane.height * 0.3 };
    };
    const end = aim();
    if (!end) {
      impacted();
      return root;
    }

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
      if (victim) {
        burst(point, def.burst, def.petals ? 9 : 12, !!def.petals);
        if (!still()) splatAt(point, kind, 520);
        if (alive(victim)) react(victim, kind, dir);
      } else if (!targetEl) {
        // no mascot element to hit: leave a mark where the throw lands
        burst(point, def.burst, def.petals ? 9 : 12, !!def.petals);
        splatAt(point, kind, 2600);
      }
      impacted();
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

/** slot '*' gathers every catalogue slot this version does not know. */
const EDITOR_TABS = [
  { id: 'body', label: 'Cuerpo' },
  { id: 'clothes', label: 'Ropa' },
  { id: 'outfit', label: 'Trajes', slot: 'outfit' },
  { id: 'hat', label: 'Sombreros', slot: 'hat' },
  { id: 'glasses', label: 'Lentes', slot: 'glasses' },
  { id: 'neck', label: 'Cuello', slot: 'neck' },
  { id: 'hand', label: 'En la mano', slot: 'hand' },
  { id: 'pet', label: 'Mascotas', slot: 'pet' },
  { id: 'aura', label: 'Auras', slot: 'aura' },
  { id: 'other', label: 'Otros', slot: '*' },
];

const SLOT_BOX = { glasses: '17.5 20 35 35', neck: '14 39.5 37 37', outfit: '3 43 58 58', aura: '-24 -8 112 112' };
const NO_EXTRAS = { pet: false, aura: false, hand: false };

/** A catalogue slot name the editor can safely use as a key of the look. */
function slotOk(slot) {
  return typeof slot === 'string' && /^[a-z][\w-]{0,30}$/i.test(slot) && !(slot in {}) && !has(LOOK_FREE, slot);
}

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
 * A paid section only shows when the catalogue has items for it; items of a
 * slot this version cannot draw are listed under "Otros" and still work.
 */
export function createLookEditor(opts = {}) {
  const st = {
    name: '', avatar: 0, look: keepLook(null), catalog: [], owned: new Set(),
    balance: 0, canBuy: true, lockedReason: '', tab: 'body', trying: null, pending: null, facing: 'right',
  };
  let pendingTimer = 0;
  let observer = null;

  function absorb(src) {
    if (!src || typeof src !== 'object') return;
    if (src.player && typeof src.player === 'object') {
      st.name = src.player.name ? String(src.player.name) : '';
      st.avatar = normAvatar(src.player.avatar);
      st.look = keepLook(src.player.look);
    }
    if (Array.isArray(src.catalog)) {
      st.catalog = src.catalog
        .filter((item) => item && slotOk(item.slot) && item.id != null && item.key != null)
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
  const bare = () => ({ ...st.look, hat: 'none', glasses: 'none', neck: 'none', outfit: 'none', hand: 'none', pet: 'none', aura: 'none' });
  const drawKey = () => `${st.look.skin}.${st.look.hair}.${st.look.hairColor}.${st.look.pants}.${st.look.eyes}.${st.look.face}.${st.avatar}`;

  /* ---- preview column ---------------------------------------------------- */

  const figure = createAvatar({ avatar: st.avatar, look: shown(), name: st.name });
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
  const tryBuy = createButton('Comprar', { variant: 'primary', size: 'sm', icon: 'chip', block: true, onClick: () => st.trying && buy(st.trying) });
  const tryStop = createButton(null, { variant: 'ghost', size: 'sm', icon: 'close', ariaLabel: 'Dejar de probártelo', class: 'look-try__stop', onClick: () => tryOn(null) });
  const tryBar = el('div', { class: 'look-try', attrs: { 'aria-live': 'polite' } },
    el('div', { class: 'look-try__head' }, el('span', { class: 'look-try__label' }, 'Te estás probando'), tryStop),
    tryName, tryHint, tryBuy);

  const nameEl = el('strong', { class: 'look-editor__name' });
  const caption = el('div', { class: 'look-editor__caption' }, nameEl, el('span', { class: 'look-editor__sub' }, 'Así te ven en la sala'));

  const preview = el('div', { class: 'look-editor__preview' }, purse, stage, caption, tryBar);

  /* ---- pickers ----------------------------------------------------------- */

  const tabButtons = [];
  const tabDefs = [];
  const tabs = el('div', { class: 'look-editor__tabs', attrs: { role: 'tablist', 'aria-label': 'Secciones' } });
  const panelHost = el('div', { class: 'look-editor__panel', attrs: { role: 'tabpanel' } });
  const panels = new Map();

  const itemsOf = (slot) => st.catalog.filter((item) => (slot === '*' ? !has(LOOK_PAID, item.slot) : item.slot === slot));

  /** The free sections, plus one tab per paid slot that has something to offer. */
  function buildTabs() {
    tabDefs.length = 0;
    tabButtons.length = 0;
    empty(tabs);
    for (const tab of EDITOR_TABS) {
      if (tab.slot && !itemsOf(tab.slot).length) continue;
      const button = el('button', { type: 'button', class: 'look-tab', attrs: { role: 'tab' }, onClick: () => openTab(tab.id) }, tab.label);
      tabDefs.push(tab);
      tabButtons.push(button);
      tabs.appendChild(button);
    }
    if (!tabDefs.some((tab) => tab.id === st.tab)) st.tab = 'body';
  }
  buildTabs();
  roving(tabs, tabButtons, (index) => openTab(tabDefs[index].id));

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
    const hint = el('span', { class: 'look-field__hint' });
    const node = el('div', { class: 'look-field' },
      el('div', { class: 'look-field__head' }, el('span', { class: 'look-field__label' }, cfg.label), hint),
      group);
    return {
      node,
      paint() {
        const current = cfg.get();
        hint.textContent = (typeof cfg.hint === 'function' ? cfg.hint() : cfg.hint) || '';
        buttons.forEach((button, i) => {
          const on = current === i;
          button.classList.toggle('is-active', on);
          button.setAttribute('aria-checked', on ? 'true' : 'false');
          button.tabIndex = on ? 0 : -1;
        });
      },
    };
  }

  /** A free part chosen from little portraits (hair style, facial hair). */
  function portraits(cfg) {
    const group = el('div', { class: 'look-styles', attrs: { role: 'radiogroup', 'aria-label': cfg.label } });
    const thumbs = [];
    const buttons = cfg.labels.map((label, i) => {
      const thumb = el('span', { class: 'look-style__art' });
      thumbs.push(thumb);
      const button = el('button', { type: 'button', class: 'look-style', attrs: { role: 'radio' }, onClick: () => setFree(cfg.field, i) },
        thumb, el('span', { class: 'look-style__name' }, label));
      group.appendChild(button);
      return button;
    });
    roving(group, buttons, (i) => setFree(cfg.field, i));
    let drawn = '';
    return {
      node: el('div', { class: 'look-field' }, el('div', { class: 'look-field__head' }, el('span', { class: 'look-field__label' }, cfg.label)), group),
      paint() {
        const key = drawKey();
        if (key !== drawn) {
          drawn = key;
          thumbs.forEach((thumb, i) => {
            empty(thumb).appendChild(staticFigure({ ...bare(), [cfg.field]: i }, st.avatar, cfg.box, NO_EXTRAS));
          });
        }
        buttons.forEach((button, i) => {
          const on = st.look[cfg.field] === i;
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
    if (!has(LOOK_PAID, item.slot) || !LOOK_PAID[item.slot].includes(item.key)) return el('span', { class: 'look-card__unknown' }, icon('sparkle'));
    if (item.slot === 'pet') return petFigure(item.key);
    const look = { ...bare(), [item.slot]: item.key };
    let box = SLOT_BOX[item.slot];
    if (item.slot === 'hat') box = bustBox(look);
    else if (item.slot === 'hand') box = HANDS[item.key].box;
    return staticFigure(look, st.avatar, box, { pet: false, aura: item.slot === 'aura' });
  }

  function paidPanel(slot) {
    const items = itemsOf(slot);
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
        const base = drawKey();
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
        portraits({ label: 'Peinado', labels: HAIR_LABELS, field: 'hair', box: '5 3 56 56' }),
        swatches({ label: 'Color de pelo', colors: HAIR, names: HAIR_COLOR_NAMES, get: () => st.look.hairColor, set: (i) => setFree('hairColor', i) }),
        swatches({ label: 'Ojos', colors: EYES, names: EYE_NAMES, get: () => st.look.eyes, set: (i) => setFree('eyes', i) }),
        portraits({ label: 'Cara', labels: FACE_LABELS, field: 'face', box: '12 18 42 42' }),
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
        swatches({
          label: 'Pantalón', colors: PANTS, names: PANTS_NAMES,
          hint: () => (['tracksuit', 'suit', 'tux'].includes(shown().outfit) ? 'El traje que tenés puesto trae su pantalón' : ''),
          get: () => st.look.pants,
          set: (i) => setFree('pants', i),
        }),
      ]);
    }
    const tab = EDITOR_TABS.find((entry) => entry.id === id);
    return paidPanel(tab && tab.slot ? tab.slot : id);
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
    caption.hidden = !!trying;
    nameEl.textContent = st.name;
    nameEl.hidden = !st.name;
    if (trying) {
      const missing = Math.max(0, trying.price - st.balance);
      const pending = st.pending === trying.id;
      tryName.textContent = trying.name;
      tryBuy.setLabel(pending ? 'Comprando…' : `Comprar · ${formatChips(trying.price)}`);
      tryBuy.disabled = pending || !affordable(trying);
      tryHint.textContent = !st.canBuy ? (st.lockedReason || 'Ahora no podés comprar.') : missing > 0 ? `Te faltan ${formatChips(missing)} fichas` : '';
      tryHint.hidden = !tryHint.textContent;
    }

    tabDefs.forEach((tab, i) => {
      const on = tab.id === st.tab;
      const button = tabButtons[i];
      const holdsTry = !!tab.slot && !!trying && (tab.slot === '*' ? !has(LOOK_PAID, trying.slot) : trying.slot === tab.slot);
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
      button.classList.toggle('has-dot', holdsTry);
    });

    let panel = panels.get(st.tab);
    if (!panel) {
      panel = buildPanel(st.tab);
      panels.set(st.tab, panel);
    }
    if (panelHost.firstChild !== panel.node) {
      empty(panelHost).appendChild(panel.node);
      const label = tabDefs.find((tab) => tab.id === st.tab);
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
      for (const tab of EDITOR_TABS) if (tab.slot) panels.delete(tab.id);
      buildTabs();
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
      if (!box || !box.width) return;
      root.classList.toggle('look-editor--narrow', box.width < 500);
      root.classList.toggle('look-editor--tiny', box.width < 290);
    });
    observer.observe(root);
  }

  render();
  return root;
}
