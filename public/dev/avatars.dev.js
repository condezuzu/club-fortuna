// Dev gallery for /js/avatars.js — every option on a character, the parade with
// fake players and the look editor with a fake shop. Not part of the game.
import { el, createButton, createPanel, openModal, toast, formatChips } from '/js/ui.js';
import {
  createAvatar, createBust, createParade, createLookEditor,
  LOOK_DEFAULT, LOOK_FREE, LOOK_PAID,
} from '/js/avatars.js';

const main = document.getElementById('avd');
const dock = document.getElementById('avd-dock');
const params = new URLSearchParams(location.search);

const look = (extra) => ({ ...LOOK_DEFAULT, ...extra });

const HAT_NAMES = { none: 'Sin sombrero', cap: 'Gorra', party: 'Bonete', visor: 'Visera de crupier', fedora: 'Fedora', cowboy: 'Sombrero vaquero', tophat: 'Galera', crown: 'Corona' };
const ITEM_NAMES = {
  hat: HAT_NAMES,
  glasses: { nerd: 'Lentes nerd', shades: 'Lentes de sol', monocle: 'Monóculo' },
  neck: { bowtie: 'Moño', scarf: 'Bufanda', chain: 'Cadena de oro' },
  pet: { dog: 'Perrito', cat: 'Gato negro', parrot: 'Loro' },
  aura: { sparkle: 'Brillos', fire: 'En llamas', gold: 'Aura dorada' },
};
const PRICES = {
  cap: 300, party: 450, visor: 600, fedora: 1200, cowboy: 1500, tophat: 2500, crown: 10000,
  nerd: 400, shades: 800, monocle: 2000,
  bowtie: 500, scarf: 700, chain: 3000,
  dog: 4000, cat: 4000, parrot: 6000,
  sparkle: 5000, fire: 8000, gold: 15000,
};

const CATALOG = [];
for (const slot of Object.keys(LOOK_PAID)) {
  for (const key of LOOK_PAID[slot]) CATALOG.push({ id: `${slot}:${key}`, slot, key, name: ITEM_NAMES[slot][key], price: PRICES[key] });
}

/* ---- gallery helpers ----------------------------------------------------- */

function section(title, eyebrow, ...content) {
  const panel = createPanel({ title, eyebrow, ornate: true, class: 'avd-section' });
  for (const node of content) panel.body.appendChild(node);
  main.appendChild(panel);
  return panel;
}

function row(label, ...nodes) {
  return el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, label), el('div', { class: 'avd-strip' }, nodes));
}

function cell(name, node) {
  return el('div', { class: 'avd-cell' }, node, name ? el('div', { class: 'avd-cell__name' }, name) : null);
}

function figure(extra, avatar = 0, opts = {}) {
  return createAvatar({ name: 'Demo', avatar, look: look(extra) }, { size: 72, ...opts });
}

/* ---- hero ---------------------------------------------------------------- */

main.appendChild(el('header', { class: 'avd-hero' },
  el('div', { class: 'eyebrow' }, 'Club Fortuna · dev'),
  el('h1', { class: 'display text-brass' }, 'Avatares'),
  el('p', { class: 'avd-hero__lead' }, 'Personajes, bustos, el desfile del fondo de la pantalla y el editor de aspecto. Todo dibujado con SVG en línea y CSS.')));

/* ---- free options -------------------------------------------------------- */

section('Opciones gratis', 'Cuerpo y ropa',
  row('Piel (0..5)', ...Array.from({ length: LOOK_FREE.skin }, (_, i) => cell(String(i), figure({ skin: i, hair: i % 6, hairColor: (i * 3) % 8 }, i)))),
  row('Peinado (0..5)', ...LOOK_FREE.hair.map((name, i) => cell(`${i} · ${name}`, figure({ hair: i, hairColor: 1, skin: 1 }, 5)))),
  row('Peinado, mirando a la izquierda', ...LOOK_FREE.hair.map((name, i) => cell(name, figure({ hair: i, hairColor: 3, skin: 2 }, 7, { facing: 'left' })))),
  row('Color de pelo (0..7)', ...Array.from({ length: LOOK_FREE.hairColor }, (_, i) => cell(String(i), figure({ hairColor: i, hair: [0, 1, 2, 5, 4, 0, 1, 2][i], skin: i % 6 }, 4)))),
  row('Pantalón (0..5)', ...Array.from({ length: LOOK_FREE.pants }, (_, i) => cell(String(i), figure({ pants: i, hair: 0, hairColor: 2 }, 10)))),
  row('Camisa = color del jugador (0..11)', ...Array.from({ length: 12 }, (_, i) => cell(String(i), figure({ hair: i % 6, hairColor: i % 8, skin: i % 6, pants: i % 6 }, i)))));

/* ---- hats on every hair style -------------------------------------------- */

{
  const grid = el('div', { class: 'avd-matrix' });
  grid.appendChild(el('span'));
  for (const name of LOOK_FREE.hair) grid.appendChild(el('div', { class: 'avd-matrix__head' }, name));
  ['none', ...LOOK_PAID.hat].forEach((hat, r) => {
    grid.appendChild(el('div', { class: 'avd-matrix__side' }, HAT_NAMES[hat]));
    LOOK_FREE.hair.forEach((_, hair) => {
      grid.appendChild(el('div', { class: 'avd-matrix__cell' }, figure({ hat, hair, hairColor: (hair + r) % 8, skin: (hair + r) % 6 }, (hair * 2 + r) % 12)));
    });
  });
  section('Sombreros × peinados', 'Tienda', el('div', { class: 'avd-scroll' }, grid));
}

/* ---- glasses, neck, pets, auras ------------------------------------------ */

{
  const walkers = [];
  const pets = LOOK_PAID.pet.flatMap((pet, i) => {
    const idle = figure({ pet, hair: i, hairColor: i + 1, skin: i }, i * 3 + 1);
    const walk = figure({ pet, hair: i + 3, hairColor: i + 4, skin: i + 2 }, i * 3 + 2, { walking: true });
    const left = figure({ pet, hair: i, hairColor: i, skin: i + 3 }, i * 3 + 6, { walking: true, facing: 'left' });
    walkers.push(walk, left);
    return [cell(`${ITEM_NAMES.pet[pet]} · quieto`, idle), cell('caminando', walk), cell('a la izquierda', left)];
  });
  const auras = LOOK_PAID.aura.flatMap((aura, i) => [
    cell(ITEM_NAMES.aura[aura], figure({ aura, hair: i * 2, hairColor: i * 2, skin: i }, [11, 0, 6][i])),
    cell('con sombrero', figure({ aura, hair: i + 1, hairColor: 3 + i, skin: 3 + i, hat: ['tophat', 'cowboy', 'crown'][i] }, [2, 7, 10][i], { walking: true })),
  ]);
  section('Accesorios', 'Tienda',
    row('Lentes', ...LOOK_PAID.glasses.flatMap((glasses, i) => [
      cell(ITEM_NAMES.glasses[glasses], figure({ glasses, hair: i, hairColor: i, skin: 0 }, 1 + i)),
      cell('piel oscura', figure({ glasses, hair: 3 + i, hairColor: 0, skin: 5 }, 4 + i)),
      cell('con sombrero', figure({ glasses, hair: 1, hairColor: 2, skin: 2, hat: ['cap', 'fedora', 'tophat'][i] }, 8 + i)),
    ])),
    row('Cuello', ...LOOK_PAID.neck.flatMap((neck, i) => [
      cell(ITEM_NAMES.neck[neck], figure({ neck, hair: 0, hairColor: 1 + i, skin: 1 }, [10, 5, 0][i])),
      cell('pelo largo', figure({ neck, hair: 1, hairColor: 3 + i, skin: 3 }, [11, 2, 7][i])),
    ])),
    el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, 'Mascotas (siguen al personaje)'), el('div', { class: 'avd-strip avd-strip--wide' }, pets)),
    el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, 'Auras'), el('div', { class: 'avd-strip avd-strip--wide' }, auras)));
}

/* ---- sizes, moods, on felt ----------------------------------------------- */

{
  const full = look({ hair: 2, hairColor: 6, skin: 3, pants: 5, hat: 'none', glasses: 'nerd', neck: 'scarf' });
  const dandy = look({ hair: 0, hairColor: 5, skin: 5, pants: 4, hat: 'tophat', glasses: 'monocle', neck: 'bowtie' });
  const sizes = [40, 56, 64, 72, 96, 144];
  const moods = [null, 'cheer', 'love', 'hit', 'sad'];
  const felt = el('div', { class: 'felt felt--flat avd-felt' },
    el('div', { class: 'avd-strip' }, [0, 3, 4, 6, 10, 11].map((avatar, i) => createAvatar({ avatar, look: look({ hair: i, hairColor: [0, 3, 0, 5, 1, 0][i], skin: i, pants: [1, 0, 5, 3, 2, 1][i], hat: i === 5 ? 'tophat' : 'none' }) }, { size: 64 }))));
  section('Tamaños y estados', 'Personaje',
    row('Altura en px', ...sizes.flatMap((size) => [
      cell(`${size}`, createAvatar({ avatar: 3, look: full }, { size })),
      cell(`${size} · camina`, createAvatar({ avatar: 6, look: dandy }, { size, walking: true })),
    ])),
    row('Ánimos (setMood)', ...moods.map((mood) => cell(mood || 'normal', createAvatar({ avatar: 8, look: look({ hair: 1, hairColor: 4, skin: 1 }) }, { size: 96 }).setMood(mood))),
      ...moods.map((mood) => cell(mood || 'normal', createAvatar({ avatar: 4, look: look({ hair: 3, skin: 5, pants: 2 }) }, { size: 96 }).setMood(mood)))),
    el('div', { class: 'avd-row' }, el('div', { class: 'avd-label' }, 'Sobre el paño'), felt));
}

/* ---- busts --------------------------------------------------------------- */

const PLAYERS = [
  { id: 'p1', name: 'Agus', avatar: 0, level: 7, crown: true, connected: true, debt: 0, look: look({ skin: 1, hair: 0, hairColor: 1, pants: 0, hat: 'fedora', neck: 'bowtie', pet: 'dog' }) },
  { id: 'p2', name: 'Valentina', avatar: 8, level: 12, crown: false, connected: true, debt: 0, look: look({ skin: 0, hair: 1, hairColor: 3, pants: 3, glasses: 'shades', neck: 'chain', aura: 'sparkle' }) },
  { id: 'p3', name: 'Beto', avatar: 5, level: 3, crown: false, connected: true, debt: 500, look: look({ skin: 3, hair: 3, hairColor: 0, pants: 1, hat: 'cap' }) },
  { id: 'p4', name: 'Maru', avatar: 3, level: 5, crown: false, connected: true, debt: 0, look: look({ skin: 4, hair: 2, hairColor: 0, pants: 5, glasses: 'nerd', neck: 'scarf', pet: 'cat' }) },
  { id: 'p5', name: 'El Tano', avatar: 11, level: 21, crown: false, connected: true, debt: 0, look: look({ skin: 2, hair: 4, hairColor: 6, pants: 1, neck: 'chain', aura: 'fire' }) },
  { id: 'p6', name: 'Sofi', avatar: 9, level: 2, crown: false, connected: false, debt: 0, look: look({ skin: 1, hair: 5, hairColor: 4, pants: 2, hat: 'party' }) },
  { id: 'p7', name: 'Don Pepe', avatar: 10, level: 34, crown: false, connected: true, debt: 0, look: look({ skin: 5, hair: 0, hairColor: 5, pants: 4, hat: 'tophat', glasses: 'monocle', neck: 'bowtie', pet: 'parrot', aura: 'gold' }) },
  { id: 'p8', name: 'Lucho', avatar: 6, level: 1, crown: false, connected: true, debt: 1200, look: look({ skin: 0, hair: 0, hairColor: 2, pants: 0, hat: 'cowboy' }) },
];
const SPARE = [
  { id: 'p9', name: 'Carmencita', avatar: 7, level: 9, crown: false, connected: true, debt: 0, look: look({ skin: 2, hair: 1, hairColor: 7, pants: 5, hat: 'crown', aura: 'sparkle' }) },
  { id: 'p10', name: 'Nacho', avatar: 2, level: 4, crown: false, connected: true, debt: 300, look: look({ skin: 4, hair: 2, hairColor: 2, pants: 0, hat: 'visor', glasses: 'shades' }) },
  { id: 'p11', name: 'La Colo', avatar: 4, level: 15, crown: false, connected: true, debt: 0, look: look({ skin: 0, hair: 5, hairColor: 4, pants: 3, neck: 'scarf', pet: 'cat' }) },
  { id: 'p12', name: 'Maximiliano', avatar: 1, level: 6, crown: false, connected: true, debt: 0, look: look({ skin: 3, hair: 4, hairColor: 0, pants: 1, glasses: 'nerd', pet: 'dog' }) },
];
const ME = 'p1';

section('Bustos', 'Listas y chat',
  row('24 / 36 / 48 / 64 px', ...[24, 36, 48, 64].flatMap((size) => PLAYERS.slice(0, 4).map((p) => createBust(p, { size })))),
  row('Todos a 44 px', ...[...PLAYERS, ...SPARE].map((p) => cell(p.name, createBust(p, { size: 44 })))),
  row('Todos los sombreros a 36 px', ...['none', ...LOOK_PAID.hat].flatMap((hat, i) => LOOK_FREE.hair.slice(0, 3).map((_, hair) => createBust({ avatar: (i + hair * 4) % 12, look: look({ hat, hair: (hair * 2 + i) % 6, hairColor: (i + hair) % 8, skin: (i + hair) % 6 }) }, { size: 36 })))));

/* ---- look editor --------------------------------------------------------- */

const shop = { owned: new Set(['hat:fedora', 'neck:bowtie', 'pet:dog', 'hat:cap', 'glasses:nerd']), balance: 6200, canBuy: true };
const editors = [];
const me = () => PLAYERS.find((p) => p.id === ME);

function editorState() {
  return {
    player: me(), owned: [...shop.owned], balance: shop.balance, canBuy: shop.canBuy,
    lockedReason: 'Terminá la mano que estás jugando para comprar.',
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
      createButton('Sumar 5.000 fichas', { size: 'sm', onClick: () => { shop.balance += 5000; refreshEditors(); } }),
      createButton('Dejar en 100 fichas', { size: 'sm', onClick: () => { shop.balance = 100; refreshEditors(); } }),
      createButton('canBuy sí / no', { size: 'sm', onClick: () => { shop.canBuy = !shop.canBuy; refreshEditors(); } })),
    logLine),
  el('div', { class: 'avd-editors' },
    el('div', { class: 'avd-modal', id: 'avd-editor-wide' }, makeEditor()),
    el('div', { class: 'avd-modal avd-modal--phone', id: 'avd-editor-phone' }, makeEditor())));

function openEditorModal() {
  const editor = makeEditor();
  openModal({
    title: 'Tu personaje',
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
const hitDealer = () => {
  dealer.classList.remove('is-hit');
  void dealer.offsetWidth;
  dealer.classList.add('is-hit');
};

const ITEMS = { tomato: 'Tomate', cake: 'Torta', rose: 'Rosa', water: 'Agua' };
const small = (label, onClick, variant) => createButton(label, { size: 'sm', variant, onClick });

section('Desfile', 'createParade',
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
      ...Object.keys(ITEMS).map((item) => small(ITEMS[item], () => parade.throwAt(pick(), 'dealer', item, { target: dealer, onImpact: hitDealer })))),
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
