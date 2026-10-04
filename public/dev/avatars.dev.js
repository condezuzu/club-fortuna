// Dev gallery for /js/avatars.js — every option on a character, the parade with
// fake players and the look editor with a fake shop. Not part of the game.
import { el, createButton, createPanel, openModal, toast } from '/js/ui.js';
import {
  createAvatar, createBust, createParade, createLookEditor,
  LOOK_DEFAULT, LOOK_FREE, LOOK_PAID,
} from '/js/avatars.js';

const main = document.getElementById('avd');
const dock = document.getElementById('avd-dock');
const params = new URLSearchParams(location.search);

const look = (extra) => ({ ...LOOK_DEFAULT, ...extra });

/* The same catalogue the server sends (server/economy.js), plus one slot this
   client does not know, to prove that the editor copes with it. */
const cosmetic = (slot, key, name, price) => ({ id: `${slot}:${key}`, slot, key, name, price });
const CATALOG = [
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
  cosmetic('outfit', 'hoodie', 'Buzo con capucha', 800),
  cosmetic('outfit', 'tracksuit', 'Conjunto deportivo', 1200),
  cosmetic('outfit', 'suit', 'Traje', 3000),
  cosmetic('outfit', 'tux', 'Esmoquin', 8000),
  cosmetic('outfit', 'cape', 'Capa real', 40000),
  cosmetic('hand', 'drink', 'Trago', 900),
  cosmetic('hand', 'cards', 'Mazo de cartas', 1500),
  cosmetic('hand', 'cane', 'Bastón', 2500),
  cosmetic('hand', 'moneybag', 'Bolsa de plata', 20000),
  cosmetic('pet', 'dog', 'Perrito', 6000),
  cosmetic('pet', 'cat', 'Gato negro', 6000),
  cosmetic('pet', 'parrot', 'Loro', 15000),
  cosmetic('pet', 'dragon', 'Dragoncito', 60000),
  cosmetic('aura', 'sparkle', 'Brillos', 10000),
  cosmetic('aura', 'fire', 'En llamas', 25000),
  cosmetic('aura', 'gold', 'Aura dorada', 100000),
  cosmetic('shoes', 'gold', 'Zapatos de oro (ranura desconocida)', 1234),
];
const nameOf = (slot, key) => (key === 'none' ? 'Nada' : (CATALOG.find((item) => item.slot === slot && item.key === key) || { name: key }).name);

/* ---- gallery helpers ----------------------------------------------------- */

/* ?only=trajes shows just the sections whose title matches (a lighter page). */
const only = (params.get('only') || '').toLowerCase();

function section(title, eyebrow, ...content) {
  const panel = createPanel({ title, eyebrow, ornate: true, class: 'avd-section' });
  for (const node of content) panel.body.appendChild(node);
  if (!only || title.toLowerCase().includes(only)) main.appendChild(panel);
  return panel;
}

function row(label, ...nodes) {
  return el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, label), el('div', { class: 'avd-strip' }, nodes));
}

function wideRow(label, ...nodes) {
  return el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, label), el('div', { class: 'avd-strip avd-strip--wide' }, nodes));
}

function cell(name, node) {
  return el('div', { class: 'avd-cell' }, node, name ? el('div', { class: 'avd-cell__name' }, name) : null);
}

function figure(extra, avatar = 0, opts = {}) {
  return createAvatar({ name: 'Demo', avatar, look: look(extra) }, { size: 72, ...opts });
}

function matrix(columns, rows, draw) {
  const grid = el('div', { class: 'avd-matrix', style: { '--cols': String(columns.length) } });
  grid.appendChild(el('span'));
  for (const name of columns) grid.appendChild(el('div', { class: 'avd-matrix__head' }, name));
  rows.forEach((name, r) => {
    grid.appendChild(el('div', { class: 'avd-matrix__side' }, name));
    columns.forEach((_, c) => grid.appendChild(el('div', { class: 'avd-matrix__cell' }, draw(r, c))));
  });
  return el('div', { class: 'avd-scroll' }, grid);
}

/* ---- hero ---------------------------------------------------------------- */

main.appendChild(el('header', { class: 'avd-hero' },
  el('div', { class: 'eyebrow' }, 'Club Fortuna · dev'),
  el('h1', { class: 'display text-brass' }, 'Avatares'),
  el('p', { class: 'avd-hero__lead' }, 'Personajes, bustos, el desfile del fondo de la pantalla y el editor de aspecto. Todo dibujado con SVG en línea y CSS.')));

/* ---- showcase: the sizes the app uses ------------------------------------ */

const STARS = [
  { avatar: 0, look: look({ hair: 0, hairColor: 1, skin: 1, eyes: 0, hat: 'fedora', neck: 'bowtie', outfit: 'suit', hand: 'cane', pet: 'dog' }) },
  { avatar: 8, look: look({ hair: 6, hairColor: 3, skin: 0, eyes: 3, face: 4, pants: 3, glasses: 'shades', neck: 'chain', hand: 'drink', aura: 'sparkle' }) },
  { avatar: 3, look: look({ hair: 2, hairColor: 0, skin: 4, eyes: 1, pants: 5, glasses: 'nerd', outfit: 'hoodie', hand: 'cards', pet: 'cat' }) },
  { avatar: 10, look: look({ hair: 0, hairColor: 5, skin: 5, eyes: 4, face: 3, pants: 4, hat: 'tophat', glasses: 'monocle', outfit: 'tux', hand: 'moneybag', pet: 'parrot', aura: 'gold' }) },
  { avatar: 6, look: look({ hair: 8, hairColor: 2, skin: 2, eyes: 2, face: 1, outfit: 'cape', hat: 'crown', pet: 'dragon' }) },
  { avatar: 4, look: look({ hair: 9, hairColor: 4, skin: 1, eyes: 5, face: 4, outfit: 'tracksuit' }) },
];

section('Vitrina', 'Los tamaños que usa la app',
  wideRow('Editor (200 px)', ...STARS.slice(0, 4).map((p) => createAvatar(p, { size: 200 }))),
  wideRow('Tarjeta de perfil (132 px) y bienvenida (116 px)',
    ...STARS.map((p) => createAvatar(p, { size: 132 })), ...STARS.slice(0, 3).map((p) => createAvatar(p, { size: 116, walking: true }))),
  wideRow('Desfile (72 / 56 / 45 px)',
    ...STARS.map((p) => createAvatar(p, { size: 72 })), ...STARS.map((p) => createAvatar(p, { size: 56 })), ...STARS.map((p) => createAvatar(p, { size: 45 }))));

/* ---- free options -------------------------------------------------------- */

section('Opciones gratis', 'Cuerpo y ropa',
  row('Piel (0..5)', ...Array.from({ length: LOOK_FREE.skin }, (_, i) => cell(String(i), figure({ skin: i, hair: i % 6, hairColor: (i * 3) % 8, eyes: i }, i)))),
  row('Peinado (0..9)', ...LOOK_FREE.hair.map((name, i) => cell(`${i} · ${name}`, figure({ hair: i, hairColor: 1, skin: 1 }, 5)))),
  row('Peinado, mirando a la izquierda', ...LOOK_FREE.hair.map((name, i) => cell(name, figure({ hair: i, hairColor: 3, skin: 2, eyes: 3 }, 7, { facing: 'left' })))),
  row('Peinados nuevos a 132 px', ...[6, 7, 8, 9].flatMap((hair, i) => [
    createAvatar({ avatar: [9, 4, 1, 3][i], look: look({ hair, hairColor: [4, 0, 2, 3][i], skin: [0, 3, 1, 2][i], eyes: [3, 0, 2, 5][i] }) }, { size: 132 }),
    createAvatar({ avatar: [2, 7, 11, 8][i], look: look({ hair, hairColor: [1, 6, 5, 7][i], skin: [4, 1, 5, 0][i], eyes: [1, 4, 0, 2][i] }) }, { size: 132, walking: true }),
  ])),
  row('Color de pelo (0..7)', ...Array.from({ length: LOOK_FREE.hairColor }, (_, i) => cell(String(i), figure({ hairColor: i, hair: [0, 1, 2, 5, 8, 7, 6, 9][i], skin: i % 6 }, 4)))),
  row('Ojos (0..5) a 132 px', ...Array.from({ length: LOOK_FREE.eyes }, (_, i) => cell(String(i), createAvatar({ avatar: 10, look: look({ eyes: i, hair: [0, 7, 3, 1, 8, 5][i], hairColor: [1, 0, 0, 3, 2, 5][i], skin: [1, 0, 4, 0, 2, 5][i] }) }, { size: 132 })))),
  row('Pantalón (0..5)', ...Array.from({ length: LOOK_FREE.pants }, (_, i) => cell(String(i), figure({ pants: i, hair: 0, hairColor: 2 }, 10)))),
  row('Camisa = color del jugador (0..11)', ...Array.from({ length: 12 }, (_, i) => cell(String(i), figure({ hair: i % 10, hairColor: i % 8, skin: i % 6, pants: i % 6, eyes: i % 6 }, i)))));

section('Cara × piel', 'Bigote, candado, barba, pecas',
  matrix(Array.from({ length: LOOK_FREE.skin }, (_, i) => `piel ${i}`), LOOK_FREE.face,
    (face, skin) => createAvatar({ avatar: (skin * 2 + face) % 12, look: look({ face, skin, hair: [0, 3, 8, 0, 2, 4][skin], hairColor: [1, 0, 2, 4, 0, 5][(skin + face) % 6], eyes: skin }) }, { size: 96 })),
  wideRow('Con lentes, sombrero y cuello (132 px)',
    createAvatar({ avatar: 0, look: look({ face: 1, hair: 8, hairColor: 0, skin: 2, glasses: 'shades', neck: 'chain' }) }, { size: 132 }),
    createAvatar({ avatar: 5, look: look({ face: 2, hair: 3, hairColor: 2, skin: 1, glasses: 'nerd', neck: 'bowtie' }) }, { size: 132 }),
    createAvatar({ avatar: 11, look: look({ face: 3, hair: 0, hairColor: 5, skin: 0, hat: 'tophat', glasses: 'monocle', neck: 'scarf' }) }, { size: 132 }),
    createAvatar({ avatar: 2, look: look({ face: 3, hair: 1, hairColor: 4, skin: 4, hat: 'cowboy' }) }, { size: 132 }),
    createAvatar({ avatar: 7, look: look({ face: 4, hair: 9, hairColor: 4, skin: 0, eyes: 2, hat: 'cap' }) }, { size: 132 }),
    createAvatar({ avatar: 9, look: look({ face: 3, hair: 4, hairColor: 6, skin: 3 }) }, { size: 132 }).setMood('cheer'),
    createAvatar({ avatar: 3, look: look({ face: 2, hair: 0, hairColor: 1, skin: 5 }) }, { size: 132 }).setMood('sad')));

/* ---- hats on every hair style -------------------------------------------- */

section('Sombreros × peinados', 'Tienda',
  matrix(LOOK_FREE.hair, ['none', ...LOOK_PAID.hat].map((hat) => nameOf('hat', hat)),
    (r, hair) => figure({ hat: ['none', ...LOOK_PAID.hat][r], hair, hairColor: (hair + r) % 8, skin: (hair + r) % 6, eyes: (hair + r) % 6 }, (hair * 2 + r) % 12)));

/* ---- glasses, neck, pets, auras ------------------------------------------ */

{
  const pets = LOOK_PAID.pet.flatMap((pet, i) => [
    cell(`${nameOf('pet', pet)} · quieto`, figure({ pet, hair: i, hairColor: i + 1, skin: i }, i * 3 + 1, { size: 96 })),
    cell('caminando', figure({ pet, hair: i + 6, hairColor: i + 4, skin: i + 2 }, i * 3 + 2, { size: 96, walking: true })),
    cell('a la izquierda', figure({ pet, hair: i, hairColor: i, skin: (i + 3) % 6 }, (i * 3 + 6) % 12, { size: 96, walking: true, facing: 'left' })),
  ]);
  const auras = LOOK_PAID.aura.flatMap((aura, i) => [
    cell(nameOf('aura', aura), figure({ aura, hair: i * 2, hairColor: i * 2, skin: i }, [11, 0, 6][i])),
    cell('con traje y sombrero', figure({ aura, hair: i + 1, hairColor: 3 + i, skin: 3 + i, hat: ['tophat', 'cowboy', 'crown'][i], outfit: ['tux', 'hoodie', 'cape'][i] }, [2, 7, 10][i], { walking: true })),
  ]);
  section('Accesorios', 'Tienda',
    row('Lentes', ...LOOK_PAID.glasses.flatMap((glasses, i) => [
      cell(nameOf('glasses', glasses), figure({ glasses, hair: i, hairColor: i, skin: 0, eyes: 3 }, 1 + i)),
      cell('piel oscura', figure({ glasses, hair: 3 + i, hairColor: 0, skin: 5 }, 4 + i)),
      cell('con sombrero', figure({ glasses, hair: 1, hairColor: 2, skin: 2, hat: ['cap', 'fedora', 'tophat'][i] }, 8 + i)),
    ])),
    row('Cuello', ...LOOK_PAID.neck.flatMap((neck, i) => [
      cell(nameOf('neck', neck), figure({ neck, hair: 0, hairColor: 1 + i, skin: 1 }, [10, 5, 0][i])),
      cell('pelo largo', figure({ neck, hair: 1, hairColor: 3 + i, skin: 3 }, [11, 2, 7][i])),
      cell('con barba', figure({ neck, hair: 8, hairColor: i, skin: 2, face: 3 }, [4, 9, 6][i])),
    ])),
    wideRow('Mascotas (siguen al personaje)', ...pets),
    wideRow('Auras', ...auras));
}

/* ---- outfits ------------------------------------------------------------- */

section('Trajes', 'Tienda',
  matrix(['solo', 'gorra + bufanda', 'galera + moño', 'vaquero + cadena', 'corona', 'caminando', 'a la izquierda'], LOOK_PAID.outfit.map((key) => nameOf('outfit', key)),
    (r, c) => {
      const outfit = LOOK_PAID.outfit[r];
      const extra = [
        {}, { hat: 'cap', neck: 'scarf' }, { hat: 'tophat', neck: 'bowtie' }, { hat: 'cowboy', neck: 'chain' }, { hat: 'crown' }, {}, {},
      ][c];
      return createAvatar({ avatar: (r * 5 + c * 2) % 12, look: look({ outfit, hair: (r + c) % 10, hairColor: (r * 2 + c) % 8, skin: (r + c) % 6, pants: c % 6, eyes: c % 6, face: c === 2 ? 2 : 0, ...extra }) },
        { size: 96, walking: c === 5 || c === 6, facing: c === 6 ? 'left' : 'right' });
    }),
  row('El color del jugador siempre se ve (0..11)', ...Array.from({ length: 12 }, (_, i) => cell(String(i), figure({ outfit: LOOK_PAID.outfit[i % 5], hair: i % 10, hairColor: i % 8, skin: i % 6 }, i)))),
  wideRow('Grandes (132 px)', ...LOOK_PAID.outfit.map((outfit, i) => cell(nameOf('outfit', outfit),
    createAvatar({ avatar: [5, 1, 0, 8, 6][i], look: look({ outfit, hair: [0, 6, 8, 1, 2][i], hairColor: [1, 3, 0, 4, 0][i], skin: [1, 0, 2, 0, 4][i], eyes: [0, 3, 1, 2, 4][i], face: [0, 0, 1, 0, 3][i] }) }, { size: 132 })))));

/* ---- hand items ---------------------------------------------------------- */

section('En la mano', 'Tienda',
  matrix(['quieto', 'caminando', 'a la izquierda', 'con perrito', 'con dragón', 'festeja', 'triste', 'golpe'], LOOK_PAID.hand.map((key) => nameOf('hand', key)),
    (r, c) => {
      const hand = LOOK_PAID.hand[r];
      const pet = c === 3 ? 'dog' : c === 4 ? 'dragon' : 'none';
      const node = createAvatar({ avatar: (r * 3 + c) % 12, look: look({ hand, pet, hair: (r * 2 + c) % 10, hairColor: (r + c) % 8, skin: (r + c) % 6, outfit: ['none', 'suit', 'tux', 'none'][r], hat: r === 2 ? 'tophat' : 'none' }) },
        { size: 96, walking: c >= 1 && c <= 4, facing: c === 2 ? 'left' : 'right' });
      if (c >= 5) node.setMood(['cheer', 'sad', 'hit'][c - 5]);
      return node;
    }));

/* ---- sizes, moods, on felt ----------------------------------------------- */

{
  const full = look({ hair: 2, hairColor: 6, skin: 3, pants: 5, glasses: 'nerd', neck: 'scarf' });
  const dandy = look({ hair: 0, hairColor: 5, skin: 5, pants: 4, hat: 'tophat', glasses: 'monocle', outfit: 'tux', hand: 'cane' });
  const sizes = [40, 45, 56, 64, 72, 96];
  const moods = [null, 'cheer', 'love', 'hit', 'sad'];
  const felt = el('div', { class: 'felt felt--flat avd-felt' },
    el('div', { class: 'avd-strip' }, [0, 3, 4, 6, 10, 11].map((avatar, i) => createAvatar({ avatar, look: look({ hair: i + 3, hairColor: [0, 3, 0, 5, 1, 0][i], skin: i, pants: [1, 0, 5, 3, 2, 1][i], hat: i === 5 ? 'tophat' : 'none', outfit: i === 5 ? 'tux' : i === 2 ? 'hoodie' : 'none' }) }, { size: 64 }))));
  section('Tamaños y estados', 'Personaje',
    row('Altura en px', ...sizes.flatMap((size) => [
      cell(`${size}`, createAvatar({ avatar: 3, look: full }, { size })),
      cell(`${size} · camina`, createAvatar({ avatar: 6, look: dandy }, { size, walking: true })),
    ])),
    wideRow('Ánimos (setMood) a 132 px', ...moods.map((mood) => cell(mood || 'normal', createAvatar({ avatar: 8, look: look({ hair: 1, hairColor: 4, skin: 1, eyes: 2 }) }, { size: 132 }).setMood(mood))),
      ...moods.map((mood) => cell(mood || 'normal', createAvatar({ avatar: 4, look: look({ hair: 3, skin: 5, pants: 2, face: 3, hairColor: 0 }) }, { size: 132 }).setMood(mood)))),
    row('Ánimos a 56 px', ...moods.map((mood) => cell(mood || 'normal', createAvatar({ avatar: 1, look: look({ hair: 0, hairColor: 2, skin: 2 }) }, { size: 56 }).setMood(mood)))),
    el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, 'Sobre el paño'), felt));
}

/* ---- busts --------------------------------------------------------------- */

const PLAYERS = [
  { id: 'p1', name: 'Agus', avatar: 0, level: 7, crown: true, connected: true, debt: 0, look: look({ skin: 1, hair: 0, hairColor: 1, pants: 0, eyes: 0, hat: 'fedora', neck: 'bowtie', outfit: 'suit', hand: 'cane', pet: 'dog' }) },
  { id: 'p2', name: 'Valentina', avatar: 8, level: 12, crown: false, connected: true, debt: 0, look: look({ skin: 0, hair: 6, hairColor: 3, pants: 3, eyes: 3, face: 4, glasses: 'shades', neck: 'chain', hand: 'drink', aura: 'sparkle' }) },
  { id: 'p3', name: 'Beto', avatar: 5, level: 3, crown: false, connected: true, debt: 500, look: look({ skin: 3, hair: 3, hairColor: 0, pants: 1, face: 3, hat: 'cap', outfit: 'tracksuit' }) },
  { id: 'p4', name: 'Maru', avatar: 3, level: 5, crown: false, connected: true, debt: 0, look: look({ skin: 4, hair: 2, hairColor: 0, pants: 5, eyes: 1, glasses: 'nerd', neck: 'scarf', outfit: 'hoodie', hand: 'cards', pet: 'cat' }) },
  { id: 'p5', name: 'El Tano', avatar: 11, level: 21, crown: false, connected: true, debt: 0, look: look({ skin: 2, hair: 4, hairColor: 6, pants: 1, face: 2, neck: 'chain', aura: 'fire' }) },
  { id: 'p6', name: 'Sofi', avatar: 9, level: 2, crown: false, connected: false, debt: 0, look: look({ skin: 1, hair: 9, hairColor: 4, pants: 2, eyes: 2, hat: 'party' }) },
  { id: 'p7', name: 'Don Pepe', avatar: 10, level: 34, crown: false, connected: true, debt: 0, look: look({ skin: 5, hair: 0, hairColor: 5, pants: 4, eyes: 4, face: 1, hat: 'tophat', glasses: 'monocle', outfit: 'tux', hand: 'moneybag', pet: 'parrot', aura: 'gold' }) },
  { id: 'p8', name: 'Lucho', avatar: 6, level: 1, crown: false, connected: true, debt: 1200, look: look({ skin: 0, hair: 8, hairColor: 2, pants: 0, hat: 'cowboy' }) },
];
const SPARE = [
  { id: 'p9', name: 'Carmencita', avatar: 7, level: 9, crown: false, connected: true, debt: 0, look: look({ skin: 2, hair: 7, hairColor: 7, pants: 5, eyes: 5, hat: 'crown', outfit: 'cape', pet: 'dragon' }) },
  { id: 'p10', name: 'Nacho', avatar: 2, level: 4, crown: false, connected: true, debt: 300, look: look({ skin: 4, hair: 2, hairColor: 2, pants: 0, face: 1, hat: 'visor', glasses: 'shades' }) },
  { id: 'p11', name: 'La Colo', avatar: 4, level: 15, crown: false, connected: true, debt: 0, look: look({ skin: 0, hair: 5, hairColor: 4, pants: 3, face: 4, neck: 'scarf', pet: 'cat' }) },
  { id: 'p12', name: 'Maximiliano', avatar: 1, level: 6, crown: false, connected: true, debt: 0, look: look({ skin: 3, hair: 4, hairColor: 0, pants: 1, face: 3, glasses: 'nerd', pet: 'dog' }) },
];
const ME = 'p1';

section('Bustos', 'Listas y chat',
  row('26 / 30 / 36 / 48 / 64 px', ...[26, 30, 36, 48, 64].flatMap((size) => PLAYERS.slice(0, 4).map((p) => createBust(p, { size })))),
  row('Todos a 44 px', ...[...PLAYERS, ...SPARE].map((p) => cell(p.name, createBust(p, { size: 44 })))),
  row('Cara, ojos y trajes a 56 px',
    ...LOOK_FREE.face.map((_, face) => createBust({ avatar: face * 2, look: look({ face, hair: [0, 8, 3, 2, 9][face], hairColor: face, skin: (face * 2) % 6, eyes: face }) }, { size: 56 })),
    ...LOOK_PAID.outfit.map((outfit, i) => createBust({ avatar: i * 2 + 1, look: look({ outfit, hair: i + 5, hairColor: i + 2, skin: i, eyes: i + 1, neck: i === 3 ? 'none' : ['none', 'chain', 'none', 'none', 'none'][i] }) }, { size: 56 }))),
  row('Todos los sombreros a 36 px', ...['none', ...LOOK_PAID.hat].flatMap((hat, i) => [0, 1, 2].map((hair) => createBust({ avatar: (i + hair * 4) % 12, look: look({ hat, hair: (hair * 3 + i) % 10, hairColor: (i + hair) % 8, skin: (i + hair) % 6 }) }, { size: 36 })))));

/* ---- look editor --------------------------------------------------------- */

const shop = { owned: new Set(['hat:fedora', 'neck:bowtie', 'pet:dog', 'hat:cap', 'glasses:nerd', 'outfit:suit', 'hand:cane']), balance: 6200, canBuy: true };
const editors = [];
const me = () => PLAYERS.find((p) => p.id === ME);

function editorState() {
  return {
    player: me(), owned: [...shop.owned], balance: shop.balance, canBuy: shop.canBuy,
    lockedReason: 'Con deuda no hay compras: primero pagale al prestamista.',
  };
}

function refreshEditors() {
  for (const editor of editors) editor.refresh(editorState());
}

function makeEditor() {
  const editor = createLookEditor({
    ...editorState(),
    catalog: CATALOG,
    onChange(nextLook, avatar) {
      const p = me();
      p.look = nextLook;
      p.avatar = avatar;
      syncParade();
      refreshEditors();
      log(`onChange → avatar ${avatar}, look ${JSON.stringify(nextLook)}`);
    },
    onBuy(itemId) {
      log(`onBuy → ${itemId} (el servidor falso responde en 600 ms)`);
      setTimeout(() => {
        const item = CATALOG.find((entry) => entry.id === itemId);
        if (!item || shop.balance < item.price) return;
        shop.balance -= item.price;
        shop.owned.add(item.id);
        me().look = { ...me().look, [item.slot]: item.key };
        syncParade();
        refreshEditors();
        toast(`Compraste ${item.name}`, { kind: 'win' });
      }, 600);
    },
  });
  editors.push(editor);
  return editor;
}

const logLine = el('div', { class: 'avd-log' });
function log(text) {
  logLine.textContent = text;
}

section('Editor de aspecto', 'createLookEditor',
  el('div', { class: 'avd-row' },
    el('div', { class: 'avd-strip' },
      createButton('Abrir en un modal', { variant: 'primary', size: 'sm', onClick: () => openEditorModal() }),
      createButton('Sumar 50.000 fichas', { size: 'sm', onClick: () => { shop.balance += 50000; refreshEditors(); } }),
      createButton('Dejar en 100 fichas', { size: 'sm', onClick: () => { shop.balance = 100; refreshEditors(); } }),
      createButton('canBuy sí / no', { size: 'sm', onClick: () => { shop.canBuy = !shop.canBuy; refreshEditors(); } })),
    logLine),
  el('div', { class: 'avd-editors' },
    el('div', { class: 'avd-modal', id: 'avd-editor-wide' }, makeEditor()),
    el('div', { class: 'avd-modal avd-modal--phone', id: 'avd-editor-phone' }, makeEditor())));

function openEditorModal() {
  const editor = makeEditor();
  openModal({
    title: 'Vestuario',
    size: 'lg',
    content: editor,
    actions: [{ label: 'Listo', variant: 'primary' }],
    onClose: () => {
      editors.splice(editors.indexOf(editor), 1);
      editor.destroy();
    },
  });
}

/* ---- parade -------------------------------------------------------------- */

const dealer = el('div', { class: 'avd-dealer', id: 'avd-dealer' }, 'la mascota va acá');
const lane = el('div', { class: 'avd-dock__lane' });
dock.appendChild(el('div', { class: 'avd-dock__mascot' }, dealer));
dock.appendChild(lane);

let active = PLAYERS.slice(0, Number(params.get('n')) || 8);
let reduced = params.get('still') === '1';
let parade = null;

function mountParade() {
  if (parade) parade.destroy();
  parade = createParade({
    reducedMotion: reduced ? true : undefined,
    onPick(id) {
      target.value = id;
      const p = active.find((entry) => entry.id === id);
      toast(`onPick → ${p ? p.name : id}`);
    },
  });
  lane.appendChild(parade);
  syncParade();
  window.__parade = parade;
}

function syncParade() {
  if (parade) parade.sync(active, ME);
  fillTargets();
}

const target = el('select', { class: 'avd-select', attrs: { 'aria-label': 'Jugador' } });
function fillTargets() {
  const current = target.value;
  while (target.firstChild) target.removeChild(target.firstChild);
  for (const p of active) target.appendChild(el('option', { value: p.id }, p.name));
  if (active.some((p) => p.id === current)) target.value = current;
  else if (active.length > 1) target.value = active[1].id;
}

const pick = () => target.value;
const other = () => {
  const rest = active.filter((p) => p.id !== pick());
  return rest.length ? rest[Math.floor(Math.random() * rest.length)].id : 'nadie';
};
/* The real mascot paints its own reaction in onImpact; this one just flinches. */
const hitDealer = (item) => {
  dealer.classList.remove('is-hit');
  void dealer.offsetWidth;
  dealer.classList.add('is-hit');
  log(`onImpact en la mascota (${item}): la mascota dibuja su propia reacción`);
};

const ITEMS = { tomato: 'Tomate', cake: 'Torta', rose: 'Rosa', water: 'Agua' };
const small = (label, onClick, variant) => createButton(label, { size: 'sm', variant, onClick });

section('Desfile', 'createParade',
  el('p', { class: 'avd-log' }, 'El carril está fijo al pie de la página. Tocá a un personaje para elegirlo (onPick). En la URL: ?n=4 arranca con menos jugadores, ?still=1 fuerza el movimiento reducido.'),
  el('div', { class: 'avd-controls' },
    el('div', { class: 'avd-strip' }, el('span', { class: 'avd-label' }, 'Jugador'), target,
      ...['😂', '😎', '😭', '🔥', '👏', '🤑', 'GG'].map((emoji) => small(emoji, () => parade.emote(pick(), emoji))),
      small('Festejar', () => parade.cheer(pick())),
      small('Triste', () => parade.sad(pick())),
      small('position()', () => {
        const point = parade.position(pick());
        log(point ? `position → x ${Math.round(point.x)}, y ${Math.round(point.y)}` : 'position → null');
      })),
    el('div', { class: 'avd-strip' }, el('span', { class: 'avd-label' }, 'Le tiran al jugador'),
      ...Object.keys(ITEMS).map((item) => small(ITEMS[item], () => parade.throwAt(other(), pick(), item, { onImpact: () => log(`onImpact (${item})`) }))),
      small('Desde el borde', () => parade.throwAt('fantasma', pick(), 'tomato'))),
    el('div', { class: 'avd-strip' }, el('span', { class: 'avd-label' }, 'El jugador le tira al crupier'),
      ...Object.keys(ITEMS).map((item) => small(ITEMS[item], () => parade.throwAt(pick(), 'dealer', item, { target: dealer, onImpact: () => hitDealer(item) })))),
    el('div', { class: 'avd-strip' }, el('span', { class: 'avd-label' }, 'Sala'),
      small('Sumar jugador', () => {
        const next = [...PLAYERS, ...SPARE].find((p) => !active.includes(p));
        if (next) active = [...active, next];
        syncParade();
      }),
      small('Sacar jugador', () => {
        if (active.length > 1) active = active.filter((p) => p.id !== pick() || p.id === ME);
        if (active.length > 1 && pick() === ME) active = active.slice(0, -1);
        syncParade();
      }),
      small('Conectado sí / no', () => {
        const p = active.find((entry) => entry.id === pick());
        if (p) p.connected = !p.connected;
        syncParade();
      }),
      small('Deuda sí / no', () => {
        const p = active.find((entry) => entry.id === pick());
        if (p) p.debt = p.debt > 0 ? 0 : 800;
        syncParade();
      }),
      small('Corona', () => {
        const id = pick();
        for (const p of active) p.crown = p.id === id;
        syncParade();
      }),
      small('Subir de nivel', () => {
        const p = active.find((entry) => entry.id === pick());
        if (p) p.level += 9;
        syncParade();
      }),
      small('Movimiento reducido sí / no', () => {
        reduced = !reduced;
        mountParade();
      }),
      small('Lío general', () => {
        const items = Object.keys(ITEMS);
        active.forEach((p, i) => setTimeout(() => parade.throwAt(p.id, active[(i + 3) % active.length].id, items[i % items.length]), i * 180));
      }, 'danger'))));

mountParade();

/* ---- a magnifier for the console: avatarLab.show([{ hair: 6, outfit: 'tux', size: 300 }]) */

window.avatarLab = {
  show(specs, size = 220) {
    this.clear();
    const box = el('div', { id: 'avd-lab', class: 'avd-lab', onClick: (ev) => ev.target === box && this.clear() });
    for (const spec of specs) {
      const node = createAvatar({ avatar: spec.avatar || 0, look: look(spec) }, { size: spec.size || size, walking: !!spec.walking, facing: spec.facing });
      if (spec.mood) node.setMood(spec.mood);
      if (spec.gap) node.style.marginLeft = `${spec.gap}px`;
      box.appendChild(node);
    }
    document.body.appendChild(box);
    return box;
  },
  clear() {
    const old = document.getElementById('avd-lab');
    if (old) old.remove();
  },
};
