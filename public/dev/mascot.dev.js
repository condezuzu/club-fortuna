// Dev page for Don Fortunato (/dev/mascot.html): every kind, animation and hit item,
// plus controls to freeze him, resize him and change what he knows about the player.
import { el } from '/js/ui.js';
import * as audio from '/js/audio.js';
import { createMascot, MASCOT_KINDS, MASCOT_ANIMS } from '/js/mascot.js';

const HIT_ITEMS = ['tomato', 'cake', 'rose', 'water'];
const SIZES = [96, 150, 300, 520];

const panel = document.getElementById('dev');
const floor = document.getElementById('floor');
const wall = document.getElementById('wall');

const ctx = { name: 'Agus', debt: 0 };
const state = { reduced: false, frozen: false };
let mascot = null;

const log = el('p', { class: 'dev__log', attrs: { 'aria-live': 'off' } }, 'Tocá un botón (o al propio Don Fortunato).');
const host = el('div', { class: 'dev-floor__host' });

function note(text) {
  log.textContent = text;
}

function build() {
  if (mascot) mascot.destroy();
  mascot = createMascot({
    audio,
    getContext: () => ({ name: ctx.name, debt: ctx.debt }),
    reducedMotion: state.reduced ? true : undefined,
  });
  host.append(mascot);
  if (state.frozen) mascot.freeze(true);
  window.mascot = mascot; // handy from the console
}

const button = (label, cls, onClick) => el('button', { type: 'button', class: ['dev__btn', cls], onClick }, label);

function group(title, hint, ...rows) {
  return el(
    'section',
    { class: 'dev__group' },
    el('div', { class: 'dev__head' }, el('span', { class: 'eyebrow' }, title), hint ? el('span', { class: 'dev__hint' }, hint) : null),
    ...rows
  );
}

function check(label, onChange, checked = false) {
  const input = el('input', { type: 'checkbox', checked, onChange: () => onChange(input.checked) });
  return el('label', { class: 'dev__check' }, input, label);
}

/* ---- panel --------------------------------------------------------------------- */

const custom = el('input', { class: 'dev__input dev__input--wide', type: 'text', placeholder: 'Texto propio (opcional): say(kind, texto)', maxLength: 200 });

const kinds = el(
  'div',
  { class: 'dev__row' },
  MASCOT_KINDS.map((kind) =>
    button(kind, null, () => {
      const text = custom.value.trim();
      const line = mascot.say(kind, text || undefined);
      note(`say('${kind}') → ${line || '(sin línea)'} · anim: ${mascot.dataset.anim || '—'}`);
    })
  ),
  button('desconocido', null, () => note(`say('???') → ${mascot.say('???')}`))
);

const anims = el(
  'div',
  { class: 'dev__row' },
  MASCOT_ANIMS.map((anim) =>
    button(anim, 'dev__btn--anim', () => {
      mascot.play(anim);
      note(`play('${anim}')`);
    })
  )
);

const hits = el(
  'div',
  { class: 'dev__row' },
  HIT_ITEMS.map((item) =>
    button(item, 'dev__btn--hit', () => {
      mascot.hit(item);
      note(`hit('${item}')`);
    })
  )
);

const sizeButtons = SIZES.map((px) =>
  button(`${px}px`, null, () => {
    document.documentElement.style.setProperty('--mascot-h', `${px}px`);
    for (const b of sizeButtons) b.setAttribute('aria-pressed', String(b === sizeButtons[SIZES.indexOf(px)]));
  })
);
sizeButtons[1].setAttribute('aria-pressed', 'true');
const autoSize = button('auto', null, () => {
  document.documentElement.style.removeProperty('--mascot-h');
  for (const b of sizeButtons) b.setAttribute('aria-pressed', 'false');
});

const backdrops = ['tinta', 'paño', 'marfil'].map((label, i) =>
  button(label, null, () => {
    const bg = ['ink', 'felt', 'ivory'][i];
    wall.dataset.bg = bg;
    floor.dataset.bg = bg;
  })
);

const nameInput = el('input', {
  class: 'dev__input',
  type: 'text',
  value: ctx.name,
  maxLength: 24,
  attrs: { 'aria-label': 'Nombre del jugador' },
  onInput: () => {
    ctx.name = nameInput.value;
  },
});

const controls = el(
  'div',
  { class: 'dev__row' },
  check('Congelar animaciones', (on) => {
    state.frozen = on;
    mascot.freeze(on);
  }),
  check('Movimiento reducido', (on) => {
    state.reduced = on;
    build();
  }),
  check('El jugador tiene deuda', (on) => {
    ctx.debt = on ? 1500 : 0;
  }),
  nameInput,
  button('Recrear', null, () => {
    build();
    note('destroy() + createMascot()');
  })
);

panel.replaceChildren(
  el(
    'header',
    { class: 'dev__head' },
    el('h1', { class: 'dev__title' }, 'Don Fortunato'),
    el('span', { class: 'dev__hint' }, 'createMascot({ audio, getContext }) · say(kind, text?) · play(anim) · hit(item) · destroy()')
  ),
  group('Controles', null, controls, el('div', { class: 'dev__row' }, el('span', { class: 'dev__hint' }, 'Tamaño (--mascot-h):'), sizeButtons, autoSize, el('span', { class: 'dev__hint' }, 'Fondo:'), backdrops)),
  group('say(kind)', `${MASCOT_KINDS.length} tipos`, el('div', { class: 'dev__row' }, custom), kinds),
  group('play(anim)', `${MASCOT_ANIMS.length} animaciones`, anims),
  group('hit(item)', 'lo que le tiran los jugadores', hits),
  log
);

/* ---- the bottom bar -------------------------------------------------------------- */

floor.append(
  host,
  ...['#d43a4c', '#2ec4b6', '#8a56e2'].map((color, i) => el('span', { class: 'dev-floor__walker', style: { background: color } }, ['AG', 'LU', 'MX'][i]))
);

build();

// Console helper for close-ups: devInspect(1200, -700, -60) blows him up and slides the
// bar so one part of the drawing fills the window; devInspect() puts everything back.
window.devInspect = (height, bottom = 0, left = 0) => {
  const on = Number.isFinite(height);
  if (on) document.documentElement.style.setProperty('--mascot-h', `${height}px`);
  else document.documentElement.style.removeProperty('--mascot-h');
  floor.style.bottom = on ? `${bottom}px` : '';
  floor.style.left = on ? `${left}px` : '';
  floor.style.background = on ? 'transparent' : '';
  floor.style.borderTopColor = on ? 'transparent' : '';
  floor.style.boxShadow = on ? 'none' : '';
  panel.style.visibility = on ? 'hidden' : '';
  for (const node of floor.querySelectorAll('.dev-floor__walker')) node.style.display = on ? 'none' : '';
};
