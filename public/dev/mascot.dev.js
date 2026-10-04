// Dev page for Don Fortunato (/dev/mascot.html): every kind, animation and hit item,
// plus controls to freeze him, resize him and change what he knows about the player.
// (An external module because the server's CSP does not run inline scripts.)
import { el } from '/js/ui.js';
import * as audio from '/js/audio.js';
import { createMascot, MASCOT_KINDS, MASCOT_ANIMS } from '/js/mascot.js';

const HIT_ITEMS = ['tomato', 'cake', 'rose', 'water'];
const SIZES = [96, 108, 150, 300, 520];

const panel = document.getElementById('dev');
const floor = document.getElementById('floor');
const wall = document.getElementById('wall');

const ctx = { name: 'Agus', debt: 0 };
const state = { reduced: false, frozen: false, freezeAt: 0 };
let mascot = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- freezing a pose ------------------------------------------------------------ */

// A frozen pose is pinned: every CSS animation and transition is set to the time that
// has really elapsed since it started, so what you see does not depend on the page
// having painted every frame (it does not while the window is hidden).
function track(node) {
  const born = new Map();
  const scan = () => {
    const now = performance.now();
    for (const animation of node.getAnimations({ subtree: true })) if (!born.has(animation)) born.set(animation, now);
  };
  const observer = new MutationObserver(scan);
  observer.observe(node, { attributes: true });
  scan();
  return {
    scan,
    pin() {
      observer.disconnect();
      scan();
      const now = performance.now();
      // only what is still running: seeking a cancelled animation would revive it
      for (const animation of node.getAnimations({ subtree: true })) {
        try {
          animation.currentTime = now - born.get(animation);
        } catch {
          /* not seekable: leave it where it is */
        }
      }
    },
  };
}

async function freezeAfter(node, act, ms) {
  node.freeze(false);
  const tracker = track(node);
  act();
  tracker.scan(); // what the action started is born now, not when the observer gets its turn
  await wait(ms);
  node.freeze(true);
  tracker.pin();
}

/* ---- the mascot ------------------------------------------------------------------- */

const log = el('p', { class: 'dev__log' }, 'Tocá un botón (o al propio Don Fortunato).');
const host = el('div', { class: 'dev-floor__host' });
const freezeBox = el('input', { type: 'checkbox' });

function note(text) {
  log.textContent = text;
}

function setFrozen(on) {
  state.frozen = on;
  freezeBox.checked = on;
  mascot.freeze(on);
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

/** Run something on the mascot; with "congelar a los N ms" set, hold the pose N ms later. */
let runs = 0;

async function run(act, describe) {
  runs += 1;
  const mine = runs;
  if (state.frozen) setFrozen(false);
  if (!(state.freezeAt > 0)) {
    act();
    note(describe());
    return;
  }
  const target = mascot;
  let text = '';
  await freezeAfter(
    target,
    () => {
      act();
      text = describe();
    },
    state.freezeAt
  );
  if (mine !== runs || target !== mascot) return;
  state.frozen = true;
  freezeBox.checked = true;
  note(`${text} · congelado a los ${state.freezeAt} ms`);
}

/* ---- panel --------------------------------------------------------------------- */

const button = (label, cls, onClick) => el('button', { type: 'button', class: ['dev__btn', cls], onClick }, label);

function group(title, hint, ...rows) {
  return el(
    'section',
    { class: 'dev__group' },
    el('div', { class: 'dev__head' }, el('span', { class: 'eyebrow' }, title), hint ? el('span', { class: 'dev__hint' }, hint) : null),
    ...rows
  );
}

function check(label, onChange, input = el('input', { type: 'checkbox' })) {
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'dev__check' }, input, label);
}

const custom = el('input', {
  class: 'dev__input dev__input--wide',
  type: 'text',
  placeholder: 'Texto propio (opcional): say(kind, texto)',
  maxLength: 200,
});

const kinds = el(
  'div',
  { class: 'dev__row' },
  MASCOT_KINDS.map((kind) =>
    button(kind, null, () => {
      const text = custom.value.trim();
      let line = '';
      run(
        () => {
          line = mascot.say(kind, text || undefined);
        },
        () => `say('${kind}') → «${line}» · anim: ${mascot.dataset.anim || '—'}`
      );
    })
  ),
  button('(desconocido)', null, () => {
    let line = '';
    run(
      () => {
        line = mascot.say('algo-que-no-existe');
      },
      () => `say('algo-que-no-existe') → «${line}» · anim: ${mascot.dataset.anim || '—'}`
    );
  })
);

const anims = el(
  'div',
  { class: 'dev__row' },
  MASCOT_ANIMS.map((anim) => button(anim, 'dev__btn--anim', () => run(() => mascot.play(anim), () => `play('${anim}')`)))
);

const hits = el(
  'div',
  { class: 'dev__row' },
  HIT_ITEMS.map((item) => button(item, 'dev__btn--hit', () => run(() => mascot.hit(item), () => `hit('${item}')`)))
);

const sizeButtons = SIZES.map((px) =>
  button(`${px}px`, null, () => {
    document.documentElement.style.setProperty('--mascot-h', `${px}px`);
    for (const other of sizeButtons) other.setAttribute('aria-pressed', String(other === sizeButtons[SIZES.indexOf(px)]));
  })
);
const autoSize = button('auto', null, () => {
  document.documentElement.style.removeProperty('--mascot-h');
  for (const other of sizeButtons) other.setAttribute('aria-pressed', 'false');
});

const backdrops = ['barra', 'paño', 'marfil'].map((label, i) =>
  button(label, null, () => {
    const bg = ['bar', 'felt', 'ivory'][i];
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

const freezeAtInput = el('input', {
  class: 'dev__input dev__input--num',
  type: 'number',
  min: '0',
  max: '10000',
  step: '50',
  placeholder: 'ms',
  attrs: { 'aria-label': 'Congelar a los (milisegundos)' },
  onInput: () => {
    state.freezeAt = Math.max(0, Number(freezeAtInput.value) || 0);
  },
});

const controls = el(
  'div',
  { class: 'dev__row' },
  check('Congelar animaciones', (on) => setFrozen(on), freezeBox),
  el('label', { class: 'dev__check' }, 'Congelar a los', freezeAtInput, 'ms de cada acción'),
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
  log,
  group(
    'Controles',
    null,
    controls,
    el('div', { class: 'dev__row' }, el('span', { class: 'dev__hint' }, 'Tamaño (--mascot-h):'), sizeButtons, autoSize, el('span', { class: 'dev__hint' }, 'Fondo:'), backdrops)
  ),
  group('say(kind)', `${MASCOT_KINDS.length} tipos`, el('div', { class: 'dev__row' }, custom), kinds),
  group('play(anim)', `${MASCOT_ANIMS.length} animaciones`, anims),
  group('hit(item)', 'lo que le tiran los jugadores', hits)
);

/* ---- the bottom bar -------------------------------------------------------------- */

floor.append(
  host,
  ...['#d43a4c', '#2ec4b6', '#8a56e2'].map((color, i) => el('span', { class: 'dev-floor__walker', style: { background: color } }, ['AG', 'LU', 'MX'][i]))
);

build();

/* ---- console helpers (close inspection, screenshots) ------------------------------ */

//   devPose('cheer', 500)            play an animation on the mascot and freeze it 500 ms in
//   devAfter(() => mascot.hit('cake'), 900)   run anything, freeze 900 ms later
//   devSheet([['cheer', 500], ['hit:cake', 900], ['say:win', 700]], 260)
//                                    contact sheet: one frozen copy per entry; devSheet() removes it
//   devInspect(1200, -700, -60)      blow him up and slide the bar so one part of the drawing
//                                    fills the window; devInspect() puts everything back

window.devPose = async (anim, at = 600) => {
  await freezeAfter(mascot, () => mascot.play(anim), at);
  state.frozen = true;
  freezeBox.checked = true;
  return `${anim} @ ${at} ms`;
};

window.devAfter = async (fn, ms = 600) => {
  await freezeAfter(mascot, fn, ms);
  state.frozen = true;
  freezeBox.checked = true;
  return `frozen after ${ms} ms`;
};

let sheet = null;
let sheetMascots = [];

window.devSheet = async (entries, height = 230, opts = {}) => {
  for (const copy of sheetMascots) copy.destroy();
  sheetMascots = [];
  if (sheet) sheet.remove();
  sheet = null;
  if (!Array.isArray(entries) || !entries.length) return 'sheet removed';

  sheet = el('div', {
    style: {
      position: 'fixed',
      inset: '0',
      zIndex: '5000',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      alignContent: 'center',
      justifyContent: 'center',
      gap: `${Math.round(height * 0.34)}px ${Math.round(height * (opts.gap || 0.3))}px`,
      padding: `${Math.round(height * 0.3)}px 16px 24px`,
      background: opts.background || 'var(--ink-950)',
      overflow: 'hidden',
      '--mascot-h': `${height}px`,
    },
  });
  document.body.append(sheet);

  await Promise.all(
    entries.map(async ([what, at = 600]) => {
      const copy = createMascot({ getContext: () => ({ name: ctx.name, debt: ctx.debt }), reducedMotion: opts.reduced ? true : undefined });
      sheetMascots.push(copy);
      sheet.append(
        el('div', { style: { display: 'grid', justifyItems: 'center', gap: '6px' } }, copy, el('span', { class: 'dev__hint' }, `${what} · ${at} ms`))
      );
      const [verb, arg] = String(what).includes(':') ? String(what).split(':') : ['play', what];
      await freezeAfter(
        copy,
        () => {
          if (verb === 'hit') copy.hit(arg);
          else if (verb === 'say') copy.say(arg);
          else if (arg !== 'idle') copy.play(arg);
        },
        at
      );
    })
  );
  return `${entries.length} poses`;
};

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
