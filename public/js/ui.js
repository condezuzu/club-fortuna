/**
 * Club Fortuna — UI kit.
 *
 * Framework-free DOM builders shared by the app shell and every game.
 * Styles live in /css/tokens.css, /css/base.css and /css/components.css.
 *
 * Rules this module keeps:
 *   - never touches the DOM at import time and assumes no markup other than
 *     document.body (overlays are created lazily and appended to it);
 *   - strings always become TEXT nodes — there is no innerHTML anywhere here,
 *     so player names and chat are safe to pass to any creator;
 *   - user-facing strings (aria labels, default captions) are in Spanish.
 *
 * See docs/UI_KIT.md for the full reference.
 */

import * as audio from './audio.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ==========================================================================
   Small helpers
   ========================================================================== */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isNode(value) {
  return typeof Node !== 'undefined' && value instanceof Node;
}

function isChildLike(value) {
  return typeof value === 'string' || typeof value === 'number' || Array.isArray(value) || isNode(value);
}

/** True when the user asked the OS for reduced motion. */
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (isNode(child)) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

function addClasses(node, value) {
  const list = Array.isArray(value) ? value : String(value).split(/\s+/);
  for (const item of list) {
    if (!item) continue;
    if (Array.isArray(item)) addClasses(node, item);
    else for (const name of String(item).split(/\s+/)) if (name) node.classList.add(name);
  }
}

const BLOCKED_PROPS = new Set(['innerHTML', 'outerHTML', 'html', 'srcdoc']);

function applyProps(node, props) {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (BLOCKED_PROPS.has(key)) continue; // markup strings are never accepted
    if (key === 'class' || key === 'className') {
      if (value) addClasses(node, value);
    } else if (key === 'dataset') {
      if (value) for (const k of Object.keys(value)) if (value[k] != null) node.dataset[k] = String(value[k]);
    } else if (key === 'style') {
      if (typeof value === 'string') node.style.cssText = value;
      else if (value) {
        for (const k of Object.keys(value)) {
          if (value[k] == null) continue;
          if (k.startsWith('--') || k.includes('-')) node.style.setProperty(k, String(value[k]));
          else node.style[k] = value[k];
        }
      }
    } else if (key === 'attrs') {
      if (value) {
        for (const k of Object.keys(value)) {
          const v = value[k];
          if (v == null || v === false || /^on/i.test(k)) continue;
          node.setAttribute(k, v === true ? '' : String(v));
        }
      }
    } else if (/^on[A-Z]/.test(key)) {
      if (typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      if (value != null) node.textContent = String(value);
    } else if (value == null) {
      continue;
    } else if (key === 'role' || key.startsWith('aria-') || key.startsWith('data-')) {
      node.setAttribute(key, String(value));
    } else if (key in node) {
      node[key] = value;
    } else if (value !== false) {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

/**
 * Tiny hyperscript helper.
 *
 *   el('div', { class: 'row', onClick: fn }, 'texto', el('span', null, 'más'))
 *   el('button.btn.btn--ghost', { type: 'button' }, 'Salir')
 *
 * props: class (string | array), dataset, style (object | string), attrs,
 * on<Event> handlers, text, plus any DOM property (id, type, value, disabled,
 * title, href, tabIndex ...). String / number children become TEXT nodes.
 * The props argument may be omitted (a string, node or array there is treated
 * as the first child).
 */
export function el(tag, props, ...children) {
  let tagName = String(tag || 'div');
  let tagClasses = null;
  if (tagName.includes('.')) {
    const parts = tagName.split('.');
    tagName = parts.shift() || 'div';
    tagClasses = parts.filter(Boolean);
  }
  const node = document.createElement(tagName);
  if (tagClasses && tagClasses.length) addClasses(node, tagClasses);
  if (isChildLike(props)) children.unshift(props);
  else if (props && typeof props === 'object') applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/**
 * SVG counterpart of el(): svg('circle', { cx: 12, cy: 12, r: 9 }).
 * attrs are set with setAttribute; children may be nodes or strings (text).
 */
export function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, String(tag));
  if (attrs && typeof attrs === 'object') {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value == null || value === false || /^on/i.test(key)) continue;
      node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

/** Remove every child of a node. Returns the node. */
export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ==========================================================================
   Numbers
   ========================================================================== */

/** 12500 -> "12.500" (always integers, "." as thousands separator). */
export function formatChips(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  const whole = Math.trunc(num);
  const digits = String(Math.abs(whole));
  if (digits.includes('e')) return String(whole);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return (whole < 0 ? '-' : '') + out;
}

/** Compact form for tight spaces: 950 -> "950", 12500 -> "12,5K", 2400000 -> "2,4M". */
export function formatCompact(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  const whole = Math.trunc(num);
  const abs = Math.abs(whole);
  if (abs < 10000) return formatChips(whole);
  const units = [[1e9, 'MM'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) {
    if (abs < size) continue;
    const value = abs / size;
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    const factor = Math.pow(10, decimals);
    let text = (Math.floor(value * factor) / factor).toFixed(decimals);
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return (whole < 0 ? '-' : '') + text.replace('.', ',') + suffix;
  }
  return formatChips(whole);
}

const numberAnimations = new WeakMap();

/**
 * Rolling number text.
 * opts: { duration = 700, format = formatChips, from, flash = false }
 * The first call on an element just sets the value; later calls roll from the
 * previous one. flash adds .num-up / .num-down for a brief colour pulse.
 * Returns { cancel() }.
 */
export function animateNumber(element, to, opts = {}) {
  const format = typeof opts.format === 'function' ? opts.format : formatChips;
  const target = Number.isFinite(Number(to)) ? Number(to) : 0;
  const previous = numberAnimations.get(element);
  if (previous && previous.raf) cancelAnimationFrame(previous.raf);
  const from = opts.from != null && Number.isFinite(Number(opts.from))
    ? Number(opts.from)
    : previous ? previous.value : target;
  const duration = Number.isFinite(opts.duration) ? opts.duration : 700;
  const state = { value: from, raf: 0 };
  numberAnimations.set(element, state);

  const finish = () => {
    state.value = target;
    state.raf = 0;
    element.textContent = format(target);
  };

  if (from === target || duration <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    finish();
    return { cancel() {} };
  }

  if (opts.flash) {
    const cls = target > from ? 'num-up' : 'num-down';
    element.classList.remove('num-up', 'num-down');
    void element.offsetWidth; // restart the CSS animation
    element.classList.add(cls);
    setTimeout(() => element.classList.remove(cls), 950);
  }

  let start = 0;
  const step = (ts) => {
    if (!start) start = ts;
    const p = clamp((ts - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    state.value = Math.round(from + (target - from) * eased);
    element.textContent = format(state.value);
    if (p < 1) state.raf = requestAnimationFrame(step);
    else finish();
  };
  element.textContent = format(from);
  state.raf = requestAnimationFrame(step);

  return {
    cancel() {
      if (state.raf) cancelAnimationFrame(state.raf);
      finish();
    },
  };
}

/* ==========================================================================
   Colour helpers
   ========================================================================== */

/** The 12 player "enamel" colours (mirrors --avatar-0 .. --avatar-11). */
export const AVATAR_COLORS = Object.freeze([
  '#d43a4c', '#ee7b30', '#f0b429', '#a8d13a', '#2ec4b6', '#4aa8f0',
  '#3d5fd9', '#8a56e2', '#d44fb8', '#f590ae', '#ece3cf', '#3b3644',
]);

/** CSS colour (hex) for avatar index 0..11. Out-of-range indexes wrap. */
export function avatarColor(index) {
  const n = Number(index);
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) % AVATAR_COLORS.length : 0;
  return AVATAR_COLORS[i];
}

function parseColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(value);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/i.exec(value);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = clamp(c, 0, 255) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK_DARK = '#1c1a24';
const INK_LIGHT = '#fffdf6';

/** Readable ink (dark or ivory) for text placed on the given colour. */
function inkFor(color) {
  const rgb = parseColor(color);
  if (!rgb) return INK_LIGHT;
  return luminance(rgb) > 0.36 ? INK_DARK : INK_LIGHT;
}

/* ==========================================================================
   Icons, suits and ornaments (inline SVG, built with DOM calls)
   ========================================================================== */

const SOLID = { fill: 'currentColor', stroke: 'none' };

/** Suit outlines on a 24 x 24 grid. Strings are path data. */
const SUIT_SHAPES = {
  S: ['M12 2.2C9.5 6 3 9.6 3 14.2C3 16.9 5.1 18.8 7.6 18.8C9.2 18.8 10.5 18.1 11.3 17C11.1 19 10.3 20.6 8.8 21.8L15.2 21.8C13.7 20.6 12.9 19 12.7 17C13.5 18.1 14.8 18.8 16.4 18.8C18.9 18.8 21 16.9 21 14.2C21 9.6 14.5 6 12 2.2Z'],
  H: ['M12 21.2C5.5 16.2 2.5 12.7 2.5 8.6C2.5 5.6 4.8 3.4 7.6 3.4C9.5 3.4 11.1 4.4 12 6C12.9 4.4 14.5 3.4 16.4 3.4C19.2 3.4 21.5 5.6 21.5 8.6C21.5 12.7 18.5 16.2 12 21.2Z'],
  D: ['M12 2C14.2 6 17.2 9.4 20 12C17.2 14.6 14.2 18 12 22C9.8 18 6.8 14.6 4 12C6.8 9.4 9.8 6 12 2Z'],
  C: [
    ['circle', { cx: 12, cy: 7.3, r: 4.3 }],
    ['circle', { cx: 6.9, cy: 13.5, r: 4.3 }],
    ['circle', { cx: 17.1, cy: 13.5, r: 4.3 }],
    ['circle', { cx: 12, cy: 12, r: 2.4 }],
    'M11.2 13C11.3 17 10.5 20 8.8 21.8L15.2 21.8C13.5 20 12.7 17 12.8 13Z',
  ],
};

function solid(spec) {
  return spec.map((part) => (typeof part === 'string' ? ['path', { d: part, ...SOLID }] : [part[0], { ...part[1], ...SOLID }]));
}

function dot(cx, cy, r) {
  return ['circle', { cx, cy, r, ...SOLID }];
}

/** Stroke icons on a 24 x 24 grid. Strings are stroked paths. */
const ICONS = {
  chip: [
    ['circle', { cx: 12, cy: 12, r: 9.2 }],
    ['circle', { cx: 12, cy: 12, r: 4.6 }],
    'M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9',
  ],
  cards: [
    'M9 6.3L4.2 7.6l3.4 12.6 1.4-.4',
    ['rect', { x: 9, y: 3.8, width: 11, height: 16.4, rx: 2 }],
    ['path', { d: 'M14.5 8.6l2.4 3.4-2.4 3.4-2.4-3.4z', ...SOLID }],
  ],
  users: [
    ['circle', { cx: 9, cy: 8, r: 3.3 }],
    'M2.8 19.5c0-3.4 2.8-5.9 6.2-5.9s6.2 2.5 6.2 5.9',
    'M15.4 4.9a3.3 3.3 0 0 1 0 6.2',
    'M17.6 14c2.2.8 3.6 2.9 3.6 5.5',
  ],
  user: [
    ['circle', { cx: 12, cy: 8, r: 3.6 }],
    'M4.5 20c0-3.9 3.4-6.6 7.5-6.6s7.5 2.7 7.5 6.6',
  ],
  chat: ['M4 5.5h16A1.5 1.5 0 0 1 21.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-8.5L7 21v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z'],
  send: ['M21 3L10.5 13.5', 'M21 3l-6.5 18-4-7.5L3 9.5z'],
  gift: [
    ['rect', { x: 3.5, y: 8, width: 17, height: 4, rx: 1 }],
    'M5 12v8.5h14V12',
    'M12 8v12.5',
    'M12 8c-1.2-3.2-3-4.6-4.6-4.6a2.3 2.3 0 0 0 0 4.6z',
    'M12 8c1.2-3.2 3-4.6 4.6-4.6a2.3 2.3 0 0 1 0 4.6z',
  ],
  volume: ['M4 9.5h3.2L12 5.5v13l-4.8-4H4z', 'M15.5 9a4.2 4.2 0 0 1 0 6', 'M18 6.2a8 8 0 0 1 0 11.6'],
  mute: ['M4 9.5h3.2L12 5.5v13l-4.8-4H4z', 'M16 9.5l5 5M21 9.5l-5 5'],
  copy: [
    ['rect', { x: 8.5, y: 8.5, width: 12, height: 12, rx: 2 }],
    'M15.5 5.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5',
  ],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  share: [
    ['circle', { cx: 18, cy: 5.5, r: 2.5 }],
    ['circle', { cx: 6, cy: 12, r: 2.5 }],
    ['circle', { cx: 18, cy: 18.5, r: 2.5 }],
    'M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1',
  ],
  back: ['M19.5 12h-15', 'M10.5 6l-6 6 6 6'],
  forward: ['M4.5 12h15', 'M13.5 6l6 6-6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M4.5 12.5l5 5 10-11'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  undo: ['M8.5 5L4 9.5 8.5 14', 'M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11'],
  trash: [
    'M4.5 7h15',
    'M9.5 7V4.5h5V7',
    'M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7',
    'M10 11v6M14 11v6',
  ],
  repeat: [
    'M16.5 2.5l4 4-4 4',
    'M3.5 11.5v-1a4 4 0 0 1 4-4h13',
    'M7.5 21.5l-4-4 4-4',
    'M20.5 12.5v1a4 4 0 0 1-4 4h-13',
  ],
  refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
  crown: ['M4 15.5L3 7l5 4 4-6 4 6 5-4-1 8.5z', 'M4.5 19h15'],
  trophy: [
    'M7.5 4h9v5a4.5 4.5 0 0 1-9 0z',
    'M7.5 5.5h-3V7a3 3 0 0 0 3 3',
    'M16.5 5.5h3V7a3 3 0 0 1-3 3',
    'M12 13.5V17',
    'M10 17h4l.8 3.5H9.2z',
  ],
  lifebuoy: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 3.8 }],
    'M5.6 5.6l3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7',
  ],
  dice: [
    ['rect', { x: 4, y: 4, width: 16, height: 16, rx: 3 }],
    dot(8.5, 8.5, 1.2), dot(15.5, 8.5, 1.2), dot(12, 12, 1.2), dot(8.5, 15.5, 1.2), dot(15.5, 15.5, 1.2),
  ],
  star: ['M12 3l2.78 5.63 6.22.91-4.5 4.38 1.06 6.19L12 17.2l-5.56 2.91 1.06-6.19L3 9.54l6.22-.91z'],
  sparkle: [
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
    'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  ],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 7v5l3.2 2'],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 11v5.5', dot(12, 7.8, 1.1)],
  help: [['circle', { cx: 12, cy: 12, r: 9 }], 'M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.5-1.3 1-1.3 2', dot(12, 17, 1.1)],
  warning: ['M12 3.5l9.2 16H2.8z', 'M12 10v4.5', dot(12, 17.1, 1.1)],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  settings: [
    'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1',
    ['circle', { cx: 15, cy: 7, r: 2 }],
    ['circle', { cx: 9, cy: 12, r: 2 }],
    ['circle', { cx: 17, cy: 17, r: 2 }],
  ],
  'chevron-down': ['M6 9.5l6 6 6-6'],
  'chevron-up': ['M6 14.5l6-6 6 6'],
  'chevron-left': ['M14.5 6l-6 6 6 6'],
  'chevron-right': ['M9.5 6l6 6-6 6'],
  door: ['M13.5 4.5h-7v15h7', 'M10.5 12h10', 'M17 8.5l3.5 3.5-3.5 3.5'],
  coins: [
    ['ellipse', { cx: 9, cy: 7.5, rx: 5.5, ry: 2.8 }],
    'M3.5 7.5v4c0 1.5 2.5 2.8 5.5 2.8',
    'M3.5 11.5v4c0 1.5 2.5 2.8 5.5 2.8',
    'M14.5 7.5v2.6',
    ['ellipse', { cx: 15, cy: 13, rx: 5.5, ry: 2.8 }],
    'M9.5 13v4.5c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8V13',
  ],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', ['circle', { cx: 12, cy: 12, r: 3 }]],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }], 'M8 10.5V8a4 4 0 0 1 8 0v2.5'],
  home: ['M3.5 11.5L12 4l8.5 7.5', 'M5.5 10v10h13V10', 'M10 20v-5.5h4V20'],
  edit: ['M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8.5 19z'],
  play: ['M7.5 4.5l12 7.5-12 7.5z'],
  target: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], dot(12, 12, 1.3)],
  offline: ['M5 12.5a10 10 0 0 1 14 0', 'M8.2 15.7a5.5 5.5 0 0 1 7.6 0', dot(12, 19, 1.2), 'M4 4l16 16'],
  spade: solid(SUIT_SHAPES.S),
  heart: solid(SUIT_SHAPES.H),
  diamond: solid(SUIT_SHAPES.D),
  club: solid(SUIT_SHAPES.C),
};

/** Every icon name accepted by icon(). */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

function buildShapes(target, spec) {
  for (const part of spec) {
    if (typeof part === 'string') target.appendChild(svg('path', { d: part }));
    else target.appendChild(svg(part[0], part[1]));
  }
  return target;
}

/**
 * Inline SVG icon (24 x 24 grid, stroke = currentColor, sized 1.25em by CSS).
 * opts: { size (px), label (makes it an accessible image), class }
 */
export function icon(name, opts = {}) {
  const key = Object.prototype.hasOwnProperty.call(ICONS, name) ? name : 'info';
  const classes = ['icon', `icon--${key}`];
  if (opts.class) classes.push(String(opts.class));
  const node = svg('svg', { class: classes.join(' '), viewBox: '0 0 24 24', focusable: 'false' });
  if (opts.label) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', String(opts.label));
  } else {
    node.setAttribute('aria-hidden', 'true');
  }
  if (Number.isFinite(opts.size)) {
    node.style.width = `${opts.size}px`;
    node.style.height = `${opts.size}px`;
  }
  return buildShapes(node, ICONS[key]);
}

function suitSvg(suit, className) {
  const node = svg('svg', {
    class: className ? `suit ${className}` : 'suit',
    viewBox: '0 0 24 24',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  return buildShapes(node, SUIT_SHAPES[suit] || SUIT_SHAPES.S);
}

const SUITS = {
  S: { name: 'picas', color: 'black' },
  H: { name: 'corazones', color: 'red' },
  D: { name: 'diamantes', color: 'red' },
  C: { name: 'tréboles', color: 'black' },
};

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = { A: 'As', J: 'Jota', Q: 'Reina', K: 'Rey' };

/**
 * A standalone suit glyph ('S' | 'H' | 'D' | 'C') sized 1em, for inline use.
 * opts: { colored = true } — hearts and diamonds in crimson.
 */
export function createSuit(suit, opts = {}) {
  const info = SUITS[suit] || SUITS.S;
  const colored = opts.colored !== false && info.color === 'red';
  return suitSvg(suit, colored ? 'suit--inline suit--red' : 'suit--inline');
}

/**
 * Art-deco ornaments as inline SVG (stroke = currentColor, brass by default).
 * name: 'fan' | 'sunburst' | 'rule' | 'emblem'
 */
export function ornament(name, opts = {}) {
  const key = ['fan', 'sunburst', 'rule', 'emblem'].includes(name) ? name : 'fan';
  const boxes = { fan: '0 0 120 64', sunburst: '0 0 120 60', rule: '0 0 200 12', emblem: '0 0 64 64' };
  const classes = ['ornament', `ornament--${key}`];
  if (opts.class) classes.push(String(opts.class));
  const node = svg('svg', { class: classes.join(' '), viewBox: boxes[key], focusable: 'false', 'aria-hidden': 'true' });
  const paths = [];

  if (key === 'fan') {
    for (const r of [58, 44, 30, 16]) paths.push(`M${60 - r} 62A${r} ${r} 0 0 1 ${60 + r} 62`);
    for (let deg = 195; deg <= 345; deg += 15) {
      const a = (deg * Math.PI) / 180;
      paths.push(`M${round2(60 + 16 * Math.cos(a))} ${round2(62 + 16 * Math.sin(a))}L${round2(60 + 58 * Math.cos(a))} ${round2(62 + 58 * Math.sin(a))}`);
    }
    paths.push('M0 62H120');
  } else if (key === 'sunburst') {
    let long = true;
    for (let deg = 187.5; deg <= 352.5; deg += 7.5) {
      const a = (deg * Math.PI) / 180;
      const r = long ? 58 : 38;
      paths.push(`M${round2(60 + 14 * Math.cos(a))} ${round2(60 + 14 * Math.sin(a))}L${round2(60 + r * Math.cos(a))} ${round2(60 + r * Math.sin(a))}`);
      long = !long;
    }
    paths.push('M50 60A10 10 0 0 1 70 60', 'M0 60H120');
  } else if (key === 'rule') {
    paths.push('M0 6H82', 'M118 6H200', 'M100 1.5L106 6L100 10.5L94 6Z');
    node.appendChild(svg('path', { d: 'M88 4L90 6L88 8L86 6ZM112 4L114 6L112 8L110 6Z', ...SOLID }));
  } else {
    // emblem: a fan opening inside a double lozenge
    paths.push('M32 2L62 32L32 62L2 32Z', 'M32 8L56 32L32 56L8 32Z');
    const tips = [[8, 32], [14, 26], [20, 20], [26, 14], [32, 8], [38, 14], [44, 20], [50, 26], [56, 32]];
    for (const [x, y] of tips) paths.push(`M32 48L${x} ${y}`);
    node.appendChild(svg('circle', { cx: 32, cy: 48, r: 2.6, ...SOLID }));
  }
  node.insertBefore(svg('path', { d: paths.join('') }), node.firstChild);
  return node;
}

/* ==========================================================================
   Buttons, fields and small display pieces
   ========================================================================== */

const BUTTON_VARIANTS = new Set(['primary', 'secondary', 'ghost', 'danger']);
const BUTTON_SIZES = new Set(['sm', 'md', 'lg']);

/**
 * createButton(label, opts) -> <button>
 * opts: {
 *   variant: 'primary' | 'secondary' (default) | 'ghost' | 'danger',
 *   size: 'sm' | 'md' (default) | 'lg',
 *   icon, onClick(event), disabled, block, type = 'button',
 *   ariaLabel, title (tooltip), class,
 *   sound: 'click' (default) | any audio name | false
 * }
 * A null / empty label with an icon gives a square icon button (pass
 * ariaLabel or title). Exposes button.setLabel(text) and button.setIcon(name).
 */
export function createButton(label, opts = {}) {
  const variant = BUTTON_VARIANTS.has(opts.variant) ? opts.variant : 'secondary';
  const size = BUTTON_SIZES.has(opts.size) ? opts.size : 'md';
  const node = el('button', {
    type: opts.type || 'button',
    class: ['btn', `btn--${variant}`, `btn--${size}`, opts.block && 'btn--block', opts.class],
  });

  let iconWrap = null;
  let labelEl = null;

  const syncShape = () => node.classList.toggle('btn--icon', !!iconWrap && !labelEl);

  node.setIcon = (name) => {
    if (!name) {
      if (iconWrap) iconWrap.remove();
      iconWrap = null;
    } else {
      if (!iconWrap) {
        iconWrap = el('span', { class: 'btn__icon' });
        node.insertBefore(iconWrap, node.firstChild);
      }
      clear(iconWrap).appendChild(icon(name));
    }
    syncShape();
    return node;
  };

  node.setLabel = (content) => {
    const empty = content == null || content === '';
    if (empty) {
      if (labelEl) labelEl.remove();
      labelEl = null;
    } else {
      if (!labelEl) {
        labelEl = el('span', { class: 'btn__label' });
        node.appendChild(labelEl);
      }
      clear(labelEl);
      appendChildren(labelEl, [content]);
    }
    syncShape();
    return node;
  };

  if (opts.icon) node.setIcon(opts.icon);
  node.setLabel(label);

  const aria = opts.ariaLabel || (!labelEl && opts.title ? opts.title : null);
  if (aria) node.setAttribute('aria-label', String(aria));
  if (opts.title) attachTooltip(node, opts.title);
  if (opts.disabled) node.disabled = true;

  node.addEventListener('click', (event) => {
    if (opts.sound !== false) audio.play(typeof opts.sound === 'string' ? opts.sound : 'click');
    if (typeof opts.onClick === 'function') opts.onClick(event);
  });
  return node;
}

/**
 * Text input.
 * opts: { type = 'text', value, placeholder, maxLength, name, autocomplete,
 *         inputMode, ariaLabel, code (room-code styling), onInput(value, ev),
 *         onEnter(value, ev), class }
 */
export function createInput(opts = {}) {
  const node = el('input', {
    class: ['input', opts.code && 'input--code', opts.class],
    type: opts.type || 'text',
  });
  if (opts.value != null) node.value = String(opts.value);
  if (opts.placeholder != null) node.placeholder = String(opts.placeholder);
  if (Number.isFinite(opts.maxLength)) node.maxLength = opts.maxLength;
  if (opts.name) node.name = String(opts.name);
  node.setAttribute('autocomplete', opts.autocomplete || 'off');
  if (opts.inputMode) node.setAttribute('inputmode', String(opts.inputMode));
  if (opts.ariaLabel) node.setAttribute('aria-label', String(opts.ariaLabel));
  if (opts.code) {
    node.setAttribute('autocapitalize', 'characters');
    node.setAttribute('spellcheck', 'false');
  }
  if (typeof opts.onInput === 'function') node.addEventListener('input', (ev) => opts.onInput(node.value, ev));
  if (typeof opts.onEnter === 'function') {
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) opts.onEnter(node.value, ev);
    });
  }
  return node;
}

/** <label class="field"> wrapping a caption, a control and an optional hint. */
export function createField(label, control, opts = {}) {
  const node = el('label', { class: ['field', opts.class] });
  if (label != null && label !== '') node.appendChild(el('span', { class: 'field__label' }, String(label)));
  if (control) node.appendChild(control);
  const hint = el('span', { class: 'field__hint' });
  node.setHint = (text, isError) => {
    const empty = text == null || text === '';
    hint.textContent = empty ? '' : String(text);
    hint.classList.toggle('field__hint--error', !!isError);
    if (empty) hint.remove();
    else if (!hint.parentNode) node.appendChild(hint);
    return node;
  };
  node.setHint(opts.hint, false);
  return node;
}

/**
 * Segmented control (single choice).
 * opts: { options: [{ value, label, icon }], value, onChange(value), ariaLabel }
 * Exposes element.value and element.setValue(v) (silent).
 */
export function createSegmented(opts = {}) {
  const options = Array.isArray(opts.options) ? opts.options : [];
  let value = opts.value !== undefined ? opts.value : options.length ? options[0].value : undefined;
  const node = el('div', { class: ['segmented', opts.class], attrs: { role: 'radiogroup', 'aria-label': opts.ariaLabel || 'Opciones' } });
  const buttons = [];

  const paint = () => {
    for (const entry of buttons) {
      const active = entry.value === value;
      entry.button.classList.toggle('is-active', active);
      entry.button.setAttribute('aria-checked', active ? 'true' : 'false');
      entry.button.tabIndex = active ? 0 : -1;
    }
    if (buttons.length && !buttons.some((entry) => entry.value === value)) buttons[0].button.tabIndex = 0;
  };

  const choose = (next, fromUser) => {
    if (next === value) return;
    value = next;
    paint();
    if (fromUser) {
      audio.play('click');
      if (typeof opts.onChange === 'function') opts.onChange(value);
    }
  };

  for (const option of options) {
    const button = el('button', {
      type: 'button',
      class: 'segmented__option',
      attrs: { role: 'radio', 'aria-checked': 'false' },
      onClick: () => choose(option.value, true),
    }, option.icon ? icon(option.icon) : null, String(option.label != null ? option.label : option.value));
    buttons.push({ value: option.value, button });
    node.appendChild(button);
  }

  node.addEventListener('keydown', (ev) => {
    const index = buttons.findIndex((entry) => entry.button === document.activeElement);
    if (index < 0) return;
    let next = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    choose(buttons[next].value, true);
    buttons[next].button.focus();
  });

  Object.defineProperty(node, 'value', { get: () => value, set: (v) => node.setValue(v) });
  node.setValue = (v) => {
    value = v;
    paint();
    return node;
  };
  paint();
  return node;
}

/** Small uppercase label. opts: { variant: 'gold' | 'win' | 'danger' | 'info' | 'muted' | 'solid', icon } */
export function createBadge(text, opts = {}) {
  return el('span', { class: ['badge', opts.variant && `badge--${opts.variant}`, opts.class] },
    opts.icon ? icon(opts.icon) : null,
    text != null ? String(text) : null);
}

/**
 * Inline "chip glyph + amount" (balances, pots, payouts).
 * opts: { signed (prefix + on positives), tone: 'win' | 'loss', compact, class }
 * Exposes element.setAmount(n, { animate }).
 */
export function createChipAmount(amount, opts = {}) {
  const value = el('span', { class: 'chip-amount__value' });
  const node = el('span', { class: ['chip-amount', opts.tone && `chip-amount--${opts.tone}`, opts.class] },
    el('span', { class: 'chip-amount__icon' }, icon('chip')), value);
  const base = opts.compact ? formatCompact : formatChips;
  const format = (n) => (opts.signed && n > 0 ? `+${base(n)}` : base(n));
  node.setAmount = (n, o = {}) => {
    const next = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
    node.dataset.value = String(next);
    animateNumber(value, next, { format, duration: o.animate === false ? 0 : o.duration, flash: !!o.flash });
    return node;
  };
  node.setAmount(amount, { animate: false });
  return node;
}

/**
 * Boxed surface.
 * opts: { title, eyebrow, ornate (deco corner brackets), raised, content, class }
 * Exposes element.body (append your content there).
 */
export function createPanel(opts = {}) {
  const body = el('div', { class: 'panel__body' });
  const node = el('section', { class: ['panel', opts.ornate && 'panel--ornate', opts.raised && 'panel--raised', opts.class] });
  if (opts.title || opts.eyebrow) {
    const heading = el('div', null,
      opts.eyebrow ? el('div', { class: 'eyebrow' }, String(opts.eyebrow)) : null,
      opts.title ? el('h3', { class: 'panel__title' }, String(opts.title)) : null);
    node.appendChild(el('header', { class: 'panel__header' }, heading));
  }
  if (opts.content != null) appendChildren(body, [opts.content]);
  node.appendChild(body);
  node.body = body;
  return node;
}

/** Thin double rule with a lozenge (or a caption) in the middle. */
export function createDivider(opts = {}) {
  return el('div', { class: ['divider', opts.class], attrs: { role: 'separator' } },
    opts.label ? el('span', { class: 'divider__label' }, String(opts.label)) : el('span', { class: 'divider__gem' }));
}

/** Brass progress bar. opts: { value 0..1, label, size: 'lg' }. Exposes setValue(v). */
export function createMeter(opts = {}) {
  const node = el('div', {
    class: ['meter', opts.size === 'lg' && 'meter--lg', opts.class],
    attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': opts.label || 'Progreso' },
  }, el('div', { class: 'meter__fill' }));
  node.setValue = (v) => {
    const fraction = clamp(Number(v) || 0, 0, 1);
    node.style.setProperty('--value', String(fraction));
    node.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    return node;
  };
  node.setValue(opts.value);
  return node;
}

/** Small loading ring. */
export function createSpinner(opts = {}) {
  return el('span', { class: ['spinner', opts.class], attrs: { role: 'status', 'aria-label': opts.label || 'Cargando' } });
}

/* ==========================================================================
   Tooltip (one shared element, positioned in the viewport)
   ========================================================================== */

let tooltipEl = null;
let tooltipTimer = 0;
let tooltipWatch = 0;
let tooltipTarget = null;

function hideTooltip() {
  clearTimeout(tooltipTimer);
  clearInterval(tooltipWatch);
  tooltipTimer = 0;
  tooltipWatch = 0;
  tooltipTarget = null;
  if (tooltipEl) tooltipEl.classList.remove('is-visible');
}

function showTooltip(target, text) {
  if (!text || !target.isConnected) return;
  if (!tooltipEl) tooltipEl = el('div', { class: 'tooltip', attrs: { role: 'tooltip' } });
  if (!tooltipEl.isConnected) document.body.appendChild(tooltipEl);
  tooltipEl.textContent = text;
  const anchor = target.getBoundingClientRect();
  const width = tooltipEl.offsetWidth;
  const height = tooltipEl.offsetHeight;
  const viewport = document.documentElement.clientWidth || window.innerWidth;
  const margin = 8;
  const left = clamp(anchor.left + anchor.width / 2 - width / 2, margin, Math.max(margin, viewport - width - margin));
  let top = anchor.top - height - 8;
  if (top < margin) top = anchor.bottom + 8;
  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
  tooltipEl.classList.add('is-visible');
  tooltipTarget = target;
  clearInterval(tooltipWatch);
  tooltipWatch = setInterval(() => {
    if (!tooltipTarget || !tooltipTarget.isConnected) hideTooltip();
  }, 400);
}

/**
 * Attach a text tooltip to an element (hover with a mouse, or keyboard focus).
 * Returns { set(text), detach() }.
 */
export function attachTooltip(target, text) {
  let label = text == null ? '' : String(text);
  const onEnter = (ev) => {
    if (ev.pointerType === 'touch') return;
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => showTooltip(target, label), 350);
  };
  const onFocus = () => {
    let visible = true;
    try {
      visible = target.matches(':focus-visible');
    } catch {
      visible = true;
    }
    if (visible) showTooltip(target, label);
  };
  const onLeave = () => hideTooltip();
  const onKey = (ev) => {
    if (ev.key === 'Escape') hideTooltip();
  };
  target.addEventListener('pointerenter', onEnter);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('pointerdown', onLeave);
  target.addEventListener('focus', onFocus);
  target.addEventListener('blur', onLeave);
  target.addEventListener('keydown', onKey);
  return {
    set(next) {
      label = next == null ? '' : String(next);
      if (tooltipTarget === target && tooltipEl) tooltipEl.textContent = label;
    },
    detach() {
      if (tooltipTarget === target) hideTooltip();
      target.removeEventListener('pointerenter', onEnter);
      target.removeEventListener('pointerleave', onLeave);
      target.removeEventListener('pointerdown', onLeave);
      target.removeEventListener('focus', onFocus);
      target.removeEventListener('blur', onLeave);
      target.removeEventListener('keydown', onKey);
    },
  };
}

/* ==========================================================================
   Playing cards
   ========================================================================== */

/** Pip coordinates (x, y in 0..1) for number cards. */
const PIP_LAYOUTS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

/** Court ornaments, centred on the origin. */
const COURT_CROWNS = {
  K: ['M-8 4.2L-8 -2.6L-4 1L0 -4.6L4 1L8 -2.6L8 4.2Z'],
  Q: [
    'M-7.4 4.2L-8.4 -1.8L-4 1.4L0 -3.4L4 1.4L8.4 -1.8L7.4 4.2Z',
    ['circle', { cx: -8.4, cy: -2.9, r: 1.1 }],
    ['circle', { cx: 0, cy: -4.6, r: 1.2 }],
    ['circle', { cx: 8.4, cy: -2.9, r: 1.1 }],
  ],
  J: ['M0 -4.6L3.2 0L0 4.6L-3.2 0Z', 'M-7.2 -2.3L-5.6 0L-7.2 2.3L-8.8 0Z', 'M7.2 -2.3L8.8 0L7.2 2.3L5.6 0Z'],
};

function isCard(card) {
  return !!card && typeof card === 'object' && RANKS.includes(card.rank) && Object.prototype.hasOwnProperty.call(SUITS, card.suit);
}

function cardName(card) {
  return `${RANK_NAMES[card.rank] || card.rank} de ${SUITS[card.suit].name}`;
}

function buildCourt(rank, suit) {
  const cx = 25;
  const cy = 50;
  const root = svg('svg', { viewBox: '0 0 50 100', focusable: 'false', 'aria-hidden': 'true' });
  root.appendChild(svg('rect', { class: 'court__frame', x: 0.75, y: 0.75, width: 48.5, height: 98.5, rx: 2.5 }));

  // sunburst rays from the medallion to the frame
  const rays = svg('g', { class: 'court__rays' });
  const halfW = 21;
  const halfH = 46;
  for (let i = 0; i < 24; i++) {
    const a = (i * 15 * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const reach = Math.min(
      Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Infinity,
    );
    rays.appendChild(svg('line', {
      x1: round2(cx + dx * 15), y1: round2(cy + dy * 15),
      x2: round2(cx + dx * reach), y2: round2(cy + dy * reach),
    }));
  }
  root.appendChild(rays);

  root.appendChild(svg('rect', { class: 'court__inner', x: 3.4, y: 3.4, width: 43.2, height: 93.2, rx: 1.2 }));
  root.appendChild(svg('path', { class: 'court__inner', d: 'M3.4 11L11 3.4M39 3.4L46.6 11M46.6 89L39 96.6M11 96.6L3.4 89' }));

  for (const flipped of [false, true]) {
    root.appendChild(svg('circle', { class: 'court__pad', cx, cy: flipped ? 86.5 : 13.5, r: 8 }));
    const pip = svg('g', {
      class: 'court__suit',
      transform: flipped ? 'translate(30.5 92) rotate(180) scale(0.4583)' : 'translate(19.5 8) scale(0.4583)',
    });
    root.appendChild(buildShapes(pip, SUIT_SHAPES[suit]));
    const crown = svg('g', {
      class: 'court__crown',
      transform: flipped ? 'translate(25 71.5) rotate(180)' : 'translate(25 28.5)',
    });
    root.appendChild(buildShapes(crown, COURT_CROWNS[rank]));
  }

  root.appendChild(svg('circle', { class: 'court__disc', cx, cy, r: 15 }));
  root.appendChild(svg('circle', { class: 'court__ring', cx, cy, r: 12.4 }));
  root.appendChild(svg('text', { class: 'court__letter', x: cx, y: cy, dy: '0.35em', 'text-anchor': 'middle' }, rank));
  return root;
}

function buildCardFront(front, card) {
  clear(front);
  const corner = (position) => el('div', { class: ['card__corner', `card__corner--${position}`] },
    el('span', { class: ['card__rank', card.rank === '10' && 'card__rank--wide'] }, card.rank),
    suitSvg(card.suit, 'card__suit'));
  front.appendChild(corner('tl'));
  front.appendChild(corner('br'));

  const layout = PIP_LAYOUTS[card.rank];
  if (layout) {
    const pips = el('div', { class: 'card__pips' });
    for (const [x, y] of layout) {
      const pip = suitSvg(card.suit, y > 0.5 ? 'card__pip card__pip--flip' : 'card__pip');
      pip.style.setProperty('--x', String(round2(x * 100) / 100));
      pip.style.setProperty('--y', String(Math.round(y * 10000) / 10000));
      pips.appendChild(pip);
    }
    front.appendChild(pips);
  } else if (COURT_CROWNS[card.rank]) {
    front.appendChild(el('div', { class: 'card__court' }, buildCourt(card.rank, card.suit)));
  }
  front.appendChild(suitSvg(card.suit, 'card__big'));
}

/**
 * createCard(card, opts) -> element
 *   card: { rank: 'A'|'2'..'10'|'J'|'Q'|'K', suit: 'S'|'H'|'D'|'C' } or null (unknown)
 *   opts: { faceDown, size: 'sm'|'md'|'lg', simple, interactive }
 *
 * The front shows when the card is known AND wanted face up, so:
 *   createCard(null)                 -> back
 *   el.setCard({ rank, suit })       -> flips to the front (unless created /
 *                                       flipped face down on purpose)
 *   createCard(c, { faceDown: true }) then el.flip(true) -> reveal
 *
 * Methods (all return the element): setCard(card), flip(faceUp?),
 * dealIn(delayMs?, { x, y, rot }). Read-only: element.card, element.faceUp.
 * Without opts.size the card follows the CSS variable --card-w.
 */
export function createCard(card, opts = {}) {
  const front = el('div', { class: 'card__face card__front' });
  const back = el('div', { class: 'card__face card__back' });
  const inner = el('div', { class: 'card__inner' }, front, back);
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : null;
  const node = el('div', {
    class: ['card', size && `card--${size}`, opts.simple && 'card--simple', opts.interactive && 'card--interactive', opts.class],
    attrs: { role: 'img' },
  }, inner);

  let current = null;
  let wantFaceUp = !opts.faceDown;
  let dealTimer = 0;

  const sync = () => {
    const showFront = wantFaceUp && !!current;
    node.classList.toggle('is-facedown', !showFront);
    node.setAttribute('aria-label', showFront ? cardName(current) : 'Carta boca abajo');
  };

  node.setCard = (next) => {
    if (isCard(next)) {
      const changed = !current || current.rank !== next.rank || current.suit !== next.suit;
      current = { rank: next.rank, suit: next.suit };
      if (changed) {
        buildCardFront(front, current);
        node.dataset.rank = current.rank;
        node.dataset.suit = current.suit;
        node.dataset.color = SUITS[current.suit].color;
      }
    } else {
      current = null; // keep the old face so it does not vanish mid-flip
    }
    sync();
    return node;
  };

  node.flip = (faceUp) => {
    wantFaceUp = faceUp === undefined ? !wantFaceUp : !!faceUp;
    sync();
    return node;
  };

  node.dealIn = (delayMs = 0, from = {}) => {
    const delay = Math.max(0, Number(delayMs) || 0);
    const toLength = (v) => (typeof v === 'number' ? `${v}px` : String(v));
    if (from && from.x != null) node.style.setProperty('--deal-x', toLength(from.x));
    if (from && from.y != null) node.style.setProperty('--deal-y', toLength(from.y));
    if (from && from.rot != null) node.style.setProperty('--deal-rot', typeof from.rot === 'number' ? `${from.rot}deg` : String(from.rot));
    clearTimeout(dealTimer);
    node.classList.remove('is-dealing');
    void node.offsetWidth; // restart the animation if it was already running
    node.style.animationDelay = `${delay}ms`;
    node.classList.add('is-dealing');
    const done = () => {
      clearTimeout(dealTimer);
      node.removeEventListener('animationend', onEnd);
      node.classList.remove('is-dealing');
      node.style.animationDelay = '';
    };
    const onEnd = (ev) => {
      if (ev.target === node && ev.animationName === 'card-deal') done();
    };
    node.addEventListener('animationend', onEnd);
    dealTimer = setTimeout(done, delay + 900);
    return node;
  };

  Object.defineProperty(node, 'card', { get: () => (current ? { rank: current.rank, suit: current.suit } : null) });
  Object.defineProperty(node, 'faceUp', { get: () => wantFaceUp && !!current });

  node.setCard(card);
  return node;
}

/**
 * Container for a hand of cards.
 * opts: { variant: 'fan' | 'spread' | 'tight' | 'pile', class }
 */
export function createHand(opts = {}) {
  const variant = ['fan', 'spread', 'tight', 'pile'].includes(opts.variant) ? opts.variant : null;
  return el('div', { class: ['hand', variant && `hand--${variant}`, opts.class] });
}

/* ==========================================================================
   Chips
   ========================================================================== */

/** Chip denominations, ascending. */
export const CHIP_VALUES = Object.freeze([1, 5, 25, 100, 500, 1000, 5000]);

/** Short text printed on a chip: 25 -> "25", 1000 -> "1K", 2500 -> "2,5K". */
export function chipLabel(value) {
  const v = Math.abs(Math.trunc(Number(value) || 0));
  if (v >= 1000000) return `${String(Math.floor(v / 100000) / 10).replace('.', ',')}M`;
  if (v >= 1000) return `${String(Math.floor(v / 100) / 10).replace('.', ',')}K`;
  return String(v);
}

function denominationOf(value) {
  let denom = CHIP_VALUES[0];
  for (const v of CHIP_VALUES) if (value >= v) denom = v;
  return denom;
}

/**
 * Greedy split of an amount into chip values, largest first.
 * splitChips(130) -> [100, 25, 5]. `limit` caps the list length (rendering).
 */
export function splitChips(amount, values = CHIP_VALUES, limit = 40) {
  let rest = Math.max(0, Math.trunc(Number(amount) || 0));
  const sorted = [...values].filter((v) => Number.isInteger(v) && v > 0).sort((a, b) => b - a);
  const out = [];
  for (const v of sorted) {
    while (rest >= v && out.length < limit) {
      out.push(v);
      rest -= v;
    }
    if (out.length >= limit) break;
  }
  return out;
}

function resolveTint(color) {
  if (color == null || color === false) return null;
  if (typeof color === 'number') return avatarColor(color);
  return String(color);
}

function applyChipColors(node, value, color) {
  node.dataset.denom = String(denominationOf(value));
  const tint = resolveTint(color);
  node.classList.toggle('chip--tinted', !!tint);
  if (tint) {
    const rgb = parseColor(tint);
    const light = rgb ? luminance(rgb) > 0.36 : false;
    node.style.setProperty('--chip-color', tint);
    node.style.setProperty('--chip-inlay', light ? '#2b2530' : '#f6eeda');
    node.style.setProperty('--chip-ink', light ? INK_DARK : INK_LIGHT);
  } else {
    node.style.removeProperty('--chip-color');
    node.style.removeProperty('--chip-inlay');
    node.style.removeProperty('--chip-ink');
  }
}

/**
 * createChip(value, opts) -> a single top-down casino chip
 * opts: {
 *   size: 'sm' | 'md' | 'lg'  (omit to inherit --chip-size),
 *   color: css colour or avatar index — tints the chip (a player's chips),
 *   label: custom text, or false for a blank chip,
 *   decorative: true to hide it from assistive tech
 * }
 */
export function createChip(value, opts = {}) {
  const v = Math.max(0, Math.trunc(Number(value) || 0));
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : null;
  const text = opts.label === false ? '' : opts.label != null ? String(opts.label) : chipLabel(v);
  const node = el('span', { class: ['chip', size && `chip--${size}`, opts.class], dataset: { value: String(v) } });
  if (text) {
    node.dataset.len = String(Math.min(4, Array.from(text).length));
    node.appendChild(el('span', { class: 'chip__label' }, text));
  }
  if (opts.decorative) {
    node.setAttribute('aria-hidden', 'true');
  } else {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `Ficha de ${formatChips(v)}`);
  }
  applyChipColors(node, v, opts.color);
  return node;
}

/**
 * createChipStack(amount, opts) -> compact stack + total label
 * opts: {
 *   size: 'sm' | 'md' | 'lg',
 *   color: css colour or avatar index (tints every chip),
 *   max: most chips drawn (default 5; the label always shows the real total),
 *   label: false to hide it, or a string to replace the formatted amount,
 *   animate: chips drop in
 * }
 * Exposes element.setAmount(n, { animate }) and element.amount.
 */
export function createChipStack(amount, opts = {}) {
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : null;
  const max = clamp(Math.trunc(Number(opts.max) || 5), 1, 20);
  const pile = el('div', { class: 'chip-stack__pile', attrs: { 'aria-hidden': 'true' } });
  const label = el('span', { class: 'chip-stack__label' });
  const node = el('div', { class: ['chip-stack', size && `chip-stack--${size}`, opts.class], attrs: { role: 'img' } }, pile);
  if (opts.label !== false) node.appendChild(label);
  let total = 0;

  node.setAmount = (next, o = {}) => {
    total = Math.max(0, Math.trunc(Number(next) || 0));
    const values = splitChips(total, CHIP_VALUES, max);
    clear(pile);
    values.forEach((v, i) => {
      const chip = createChip(v, { color: opts.color, decorative: true });
      chip.style.setProperty('--i', String(i));
      pile.appendChild(chip);
    });
    pile.style.setProperty('--count', String(Math.max(1, values.length)));
    label.textContent = typeof opts.label === 'string' ? opts.label : formatChips(total);
    node.classList.toggle('is-empty', total === 0);
    node.setAttribute('aria-label', `${formatChips(total)} en fichas`);
    node.classList.remove('is-dropping');
    if (o.animate || (o.animate === undefined && opts.animate)) {
      void node.offsetWidth;
      node.classList.add('is-dropping');
    }
    return node;
  };

  Object.defineProperty(node, 'amount', { get: () => total });
  node.setAmount(amount);
  return node;
}

/**
 * createChipTray(opts) -> bet-size selector (radio group of chips)
 * opts: {
 *   values: denominations to offer (default [5, 25, 100, 500, 1000]),
 *   value: initially selected value,
 *   onChange(value): user picked another chip, or refresh() had to step down
 *                    because the selected chip became unaffordable,
 *   getBalance(): chips the player can spend; unaffordable chips are dimmed
 *                 and disabled,
 *   size: 'sm' | 'md' | 'lg', label (aria)
 * }
 * Exposes element.value, element.setValue(v) (silent) and element.refresh()
 * (call it whenever the balance changes).
 */
export function createChipTray(opts = {}) {
  const source = Array.isArray(opts.values) && opts.values.length ? opts.values : [5, 25, 100, 500, 1000];
  const values = [...new Set(source.map(Number).filter((v) => Number.isInteger(v) && v > 0))].sort((a, b) => a - b);
  if (!values.length) values.push(5);
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : null;
  let value = values.includes(Number(opts.value)) ? Number(opts.value) : values[0];

  const node = el('div', {
    class: ['chip-tray', size && `chip-tray--${size}`, opts.class],
    attrs: { role: 'radiogroup', 'aria-label': opts.label || 'Valor de la ficha' },
  });
  const buttons = new Map();

  const affordable = (v) => {
    if (typeof opts.getBalance !== 'function') return true;
    const balance = Number(opts.getBalance());
    return Number.isFinite(balance) ? balance >= v : true;
  };

  const paint = () => {
    for (const [v, button] of buttons) {
      const selected = v === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    }
  };

  const emit = () => {
    if (typeof opts.onChange === 'function') opts.onChange(value);
  };

  const pick = (v) => {
    const button = buttons.get(v);
    if (!button || button.disabled) return;
    audio.play('chip');
    if (v === value) return;
    value = v;
    paint();
    emit();
  };

  for (const v of values) {
    const button = el('button', {
      type: 'button',
      class: 'chip-tray__btn',
      dataset: { value: String(v) },
      attrs: { role: 'radio', 'aria-checked': 'false', 'aria-label': `Ficha de ${formatChips(v)}` },
      onClick: () => pick(v),
    }, createChip(v, { decorative: true }));
    buttons.set(v, button);
    node.appendChild(button);
  }

  node.addEventListener('keydown', (ev) => {
    const enabled = values.filter((v) => !buttons.get(v).disabled);
    if (!enabled.length) return;
    const index = enabled.indexOf(value);
    let next = null;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') next = enabled[Math.min(enabled.length - 1, index + 1)];
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') next = enabled[Math.max(0, index - 1)];
    else if (ev.key === 'Home') next = enabled[0];
    else if (ev.key === 'End') next = enabled[enabled.length - 1];
    if (next == null) return;
    ev.preventDefault();
    pick(next);
    buttons.get(next).focus();
  });

  node.refresh = () => {
    let best = null;
    for (const [v, button] of buttons) {
      const ok = affordable(v);
      button.disabled = !ok;
      button.classList.toggle('is-unaffordable', !ok);
      if (ok) best = v; // ascending order: ends as the largest affordable chip
    }
    if (best != null && !affordable(value)) {
      value = best;
      paint();
      emit();
    } else {
      paint();
    }
    return node;
  };

  node.setValue = (v) => {
    const next = Number(v);
    if (buttons.has(next)) {
      value = next;
      paint();
    }
    return node;
  };

  Object.defineProperty(node, 'value', { get: () => value, set: (v) => node.setValue(v) });
  node.refresh();
  return node;
}

function centerOf(target) {
  if (!target) return null;
  if (isNode(target)) {
    if (!target.isConnected || typeof target.getBoundingClientRect !== 'function') return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (Number.isFinite(target.x) && Number.isFinite(target.y)) return { x: target.x, y: target.y };
  return null;
}

/**
 * Fly one or more chips across the viewport (bets going out, payouts coming in).
 * from / to: an element or a viewport point { x, y }.
 * opts: { value = 25, color, size = 'sm', count = 1, duration = 420, stagger = 45, label }
 * Returns a Promise that resolves when every chip has landed (immediately
 * under reduced motion). Sound is up to the caller (audio.play('chip')).
 */
export function flyChip(from, to, opts = {}) {
  return new Promise((resolve) => {
    const a = centerOf(from);
    const b = centerOf(to);
    if (!a || !b || prefersReducedMotion() || typeof document.body.animate !== 'function') {
      resolve();
      return;
    }
    const count = clamp(Math.trunc(Number(opts.count) || 1), 1, 12);
    const duration = Number.isFinite(opts.duration) ? opts.duration : 420;
    const stagger = Number.isFinite(opts.stagger) ? opts.stagger : 45;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lift = Math.min(60, 18 + Math.hypot(dx, dy) * 0.12);
    let pending = count;

    for (let i = 0; i < count; i++) {
      const chip = createChip(opts.value != null ? opts.value : 25, {
        size: opts.size || 'sm',
        color: opts.color,
        label: opts.label,
        decorative: true,
        class: 'chip--flying',
      });
      chip.style.left = `${a.x}px`;
      chip.style.top = `${a.y}px`;
      document.body.appendChild(chip);
      const jx = count > 1 ? (Math.random() - 0.5) * 10 : 0;
      const jy = count > 1 ? (Math.random() - 0.5) * 10 : 0;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        chip.remove();
        pending -= 1;
        if (pending === 0) resolve();
      };
      const animation = chip.animate([
        { transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)' },
        { transform: `translate(-50%, -50%) translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.14)`, offset: 0.5 },
        { transform: `translate(-50%, -50%) translate(${dx + jx}px, ${dy + jy}px) scale(0.94)` },
      ], { duration, delay: i * stagger, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'both' });
      animation.onfinish = done;
      animation.oncancel = done;
      setTimeout(done, duration + i * stagger + 400); // safety net
    }
  });
}

/* ==========================================================================
   Countdown ring
   ========================================================================== */

/**
 * createCountdown(opts) -> circular countdown
 * opts: { size: 'sm' | 'md' | 'lg' | px number, label (aria), warnAt = 5000 ms,
 *         tick (play 'tick' each second while warning), onEnd() }
 *
 *   element.start(endsAtEpochMs, totalMs, nowFn = Date.now)
 *   element.stop()
 *
 * Driven by requestAnimationFrame against nowFn (pass api.serverNow for
 * deadlines created with ctx.deadline). Turns oxblood in the last 5 s. The
 * loop stops by itself when it reaches zero or the element leaves the DOM.
 */
export function createCountdown(opts = {}) {
  const R = 19;
  const C = 2 * Math.PI * R;
  const track = svg('circle', { class: 'countdown__track', cx: 22, cy: 22, r: R, 'stroke-width': 3 });
  const ring = svg('circle', {
    class: 'countdown__ring', cx: 22, cy: 22, r: R, 'stroke-width': 3,
    'stroke-dasharray': C.toFixed(3), 'stroke-dashoffset': '0',
  });
  const graphic = svg('svg', { class: 'countdown__svg', viewBox: '0 0 44 44', focusable: 'false', 'aria-hidden': 'true' }, track, ring);
  const label = el('span', { class: 'countdown__label' });
  const sizeClass = ['sm', 'md', 'lg'].includes(opts.size) ? `countdown--${opts.size}` : null;
  const node = el('div', {
    class: ['countdown', 'is-idle', sizeClass, opts.class],
    attrs: { role: 'timer', 'aria-label': opts.label || 'Tiempo restante' },
  }, graphic, label);
  if (typeof opts.size === 'number' && Number.isFinite(opts.size)) node.style.setProperty('--cd-size', `${opts.size}px`);

  const warnAt = Number.isFinite(opts.warnAt) ? opts.warnAt : 5000;
  let rafId = 0;
  let endsAt = 0;
  let total = 0;
  let now = Date.now;
  let lastSecond = null;
  let seenConnected = false;

  const halt = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const frame = () => {
    rafId = 0;
    if (node.isConnected) seenConnected = true;
    else if (seenConnected) return; // removed from the DOM: let the loop die
    const remaining = endsAt - now();
    const fraction = total > 0 ? clamp(remaining / total, 0, 1) : 0;
    ring.setAttribute('stroke-dashoffset', (C * (1 - fraction)).toFixed(2));
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    if (seconds !== lastSecond) {
      const first = lastSecond === null;
      lastSecond = seconds;
      label.textContent = String(seconds);
      const warning = remaining > 0 && remaining <= warnAt;
      node.classList.toggle('is-warning', warning);
      if (warning && opts.tick && !first) audio.play('tick');
    }
    if (remaining <= 0) {
      node.classList.remove('is-warning');
      node.classList.add('is-done');
      if (typeof opts.onEnd === 'function') {
        try {
          opts.onEnd();
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    rafId = requestAnimationFrame(frame);
  };

  node.start = (endsAtEpochMs, totalMs, nowFn) => {
    halt();
    now = typeof nowFn === 'function' ? nowFn : Date.now;
    endsAt = Number(endsAtEpochMs) || 0;
    const left = Math.max(0, endsAt - now());
    total = Number.isFinite(Number(totalMs)) && Number(totalMs) > 0 ? Number(totalMs) : left;
    lastSecond = null;
    seenConnected = node.isConnected;
    node.classList.remove('is-idle', 'is-done', 'is-warning');
    frame();
    return node;
  };

  node.stop = () => {
    halt();
    lastSecond = null;
    label.textContent = '';
    ring.setAttribute('stroke-dashoffset', '0');
    node.classList.remove('is-warning', 'is-done');
    node.classList.add('is-idle');
    return node;
  };

  return node;
}

/* ==========================================================================
   Avatars
   ========================================================================== */

function initialsOf(name) {
  const words = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0]);
  if (words.length === 1) return first.slice(0, 2).join('');
  return first[0] + Array.from(words[words.length - 1])[0];
}

/**
 * createAvatar(player, opts) -> monogram disc tinted by player.avatar
 * player: { name, avatar, connected? }
 * opts: { size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | px number, active, class }
 * Exposes element.update(player) and element.setActive(bool).
 */
export function createAvatar(player, opts = {}) {
  const initials = el('span', { class: 'avatar__initials' });
  const sizeClass = ['xs', 'sm', 'md', 'lg', 'xl'].includes(opts.size) ? `avatar--${opts.size}` : null;
  const node = el('span', { class: ['avatar', sizeClass, opts.class], attrs: { role: 'img' } }, initials);
  if (typeof opts.size === 'number' && Number.isFinite(opts.size)) node.style.setProperty('--avatar-size', `${opts.size}px`);

  node.update = (p) => {
    const data = p || {};
    const color = avatarColor(data.avatar);
    node.style.setProperty('--avatar-color', color);
    node.style.setProperty('--avatar-ink', inkFor(color));
    initials.textContent = initialsOf(data.name);
    node.setAttribute('aria-label', data.name ? String(data.name) : 'Jugador');
    node.classList.toggle('avatar--offline', data.connected === false);
    return node;
  };

  node.setActive = (flag) => {
    node.classList.toggle('avatar--active', !!flag);
    return node;
  };

  node.update(player);
  if (opts.active) node.setActive(true);
  return node;
}

/**
 * Avatar + name (+ a second line) in a capsule — seat labels, player lists.
 * opts: { size (avatar size, default 'sm'), meta: text | node, showBalance, me, active, class }
 * Exposes element.update(player, { meta }), element.setActive(bool), element.setMeta(content).
 */
export function createNameplate(player, opts = {}) {
  const avatar = createAvatar(player, { size: opts.size || 'sm' });
  const name = el('span', { class: 'nameplate__name' });
  const meta = el('span', { class: 'nameplate__meta' });
  const text = el('span', { class: 'nameplate__text' }, name);
  const node = el('span', { class: ['nameplate', opts.me && 'is-me', opts.class] }, avatar, text);

  node.setMeta = (content) => {
    clear(meta);
    const empty = content == null || content === '';
    if (empty) meta.remove();
    else {
      appendChildren(meta, [content]);
      if (!meta.parentNode) text.appendChild(meta);
    }
    return node;
  };

  node.update = (p, o = {}) => {
    const data = p || {};
    avatar.update(data);
    name.textContent = data.name ? String(data.name) : 'Jugador';
    node.classList.toggle('is-offline', data.connected === false);
    if (o.meta !== undefined) node.setMeta(o.meta);
    else if (opts.showBalance && Number.isFinite(Number(data.balance))) node.setMeta(formatChips(data.balance));
    return node;
  };

  node.setActive = (flag) => {
    node.classList.toggle('is-active', !!flag);
    avatar.setActive(flag);
    return node;
  };

  node.avatar = avatar;
  node.update(player, { meta: opts.meta });
  if (opts.active) node.setActive(true);
  return node;
}

/* ==========================================================================
   Toasts
   ========================================================================== */

const TOAST_ICONS = { info: 'info', win: 'trophy', error: 'warning' };
const MAX_TOASTS = 4;
let toastStack = null;
const liveToasts = [];

/**
 * toast(message, opts) -> { close(), element }
 * opts: { kind: 'info' | 'win' | 'error', duration (ms; 0 keeps it until clicked) }
 * A repeated identical message restarts the existing toast instead of stacking.
 */
export function toast(message, opts = {}) {
  const kind = Object.prototype.hasOwnProperty.call(TOAST_ICONS, opts.kind) ? opts.kind : 'info';
  const text = message == null ? '' : String(message);
  const duration = Number.isFinite(opts.duration) ? opts.duration : kind === 'error' ? 4500 : 3200;

  const existing = liveToasts.find((entry) => entry.text === text && entry.kind === kind && !entry.closed);
  if (existing) {
    existing.arm(duration);
    return existing.api;
  }

  if (!toastStack) {
    toastStack = el('div', { class: 'toast-stack', attrs: { role: 'region', 'aria-live': 'polite', 'aria-label': 'Avisos' } });
  }
  if (!toastStack.isConnected) document.body.appendChild(toastStack);

  const node = el('div', { class: ['toast', `toast--${kind}`], attrs: { role: kind === 'error' ? 'alert' : 'status' } },
    el('span', { class: 'toast__icon' }, icon(TOAST_ICONS[kind])),
    el('span', { class: 'toast__msg' }, text));

  const entry = { text, kind, closed: false, timer: 0, api: null, arm: null };

  const close = () => {
    if (entry.closed) return;
    entry.closed = true;
    clearTimeout(entry.timer);
    const index = liveToasts.indexOf(entry);
    if (index >= 0) liveToasts.splice(index, 1);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), prefersReducedMotion() ? 0 : 220);
  };

  entry.arm = (ms) => {
    clearTimeout(entry.timer);
    if (ms > 0) entry.timer = setTimeout(close, ms);
  };
  entry.api = { close, element: node };

  node.addEventListener('click', close);
  liveToasts.push(entry);
  while (liveToasts.length > MAX_TOASTS) liveToasts[0].api.close();
  toastStack.appendChild(node);
  entry.arm(duration);
  return entry.api;
}

/* ==========================================================================
   Modal
   ========================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];
let modalSeq = 0;

function focusablesIn(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((node) => node.getClientRects().length > 0);
}

/**
 * openModal(opts) -> { close(), element }
 * opts: {
 *   title, content: node | string,
 *   actions: [{ label, variant, icon, onClick({ close }), autofocus }],
 *   dismissible = true (Escape, backdrop click and the close button),
 *   size: 'sm' | 'md' | 'lg', onClose()
 * }
 * An action closes the modal after its onClick unless onClick returns false
 * (or a Promise resolving to false) — use that to keep it open on a failed
 * validation. Focus is trapped inside and restored on close.
 */
export function openModal(opts = {}) {
  const seq = ++modalSeq;
  const titleId = `cf-modal-title-${seq}`;
  const dismissible = opts.dismissible !== false;
  const restoreFocus = document.activeElement;
  let closed = false;

  const header = el('div', { class: 'modal__header' });
  const body = el('div', { class: 'modal__body' });
  const actions = el('div', { class: 'modal__actions' });
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : null;
  const dialog = el('div', {
    class: ['modal', size && `modal--${size}`, opts.class],
    attrs: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
  });
  const backdrop = el('div', { class: 'modal-backdrop' }, dialog);
  const api = { close: null, element: dialog };

  const onKeyDown = (ev) => {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (ev.key === 'Escape') {
      if (!dismissible) return;
      ev.preventDefault();
      ev.stopPropagation();
      api.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = focusablesIn(dialog);
    if (!items.length) {
      ev.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (ev.shiftKey && (active === first || !dialog.contains(active))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || !dialog.contains(active))) {
      ev.preventDefault();
      first.focus();
    }
  };

  const onFocusIn = (ev) => {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (!dialog.contains(ev.target)) dialog.focus();
  };

  api.close = () => {
    if (closed) return;
    closed = true;
    const index = modalStack.indexOf(api);
    if (index >= 0) modalStack.splice(index, 1);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn);
    if (!modalStack.length) document.documentElement.classList.remove('has-modal');
    backdrop.classList.add('is-leaving');
    setTimeout(() => backdrop.remove(), prefersReducedMotion() ? 0 : 200);
    if (restoreFocus && restoreFocus.isConnected && typeof restoreFocus.focus === 'function') {
      try {
        restoreFocus.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    if (typeof opts.onClose === 'function') {
      try {
        opts.onClose();
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (opts.title != null && opts.title !== '') {
    header.appendChild(el('h2', { class: 'modal__title', id: titleId }, String(opts.title)));
    dialog.setAttribute('aria-labelledby', titleId);
  } else {
    header.appendChild(el('span', { class: 'modal__title' }));
    dialog.setAttribute('aria-label', opts.ariaLabel || 'Diálogo');
  }
  if (dismissible) {
    header.appendChild(createButton(null, {
      variant: 'ghost', size: 'sm', icon: 'close', ariaLabel: 'Cerrar', class: 'modal__close', sound: false,
      onClick: () => api.close(),
    }));
  }
  dialog.appendChild(header);

  if (opts.content != null) {
    if (typeof opts.content === 'string') body.appendChild(el('p', null, opts.content));
    else appendChildren(body, [opts.content]);
  }
  dialog.appendChild(body);

  let preferred = null;
  for (const action of Array.isArray(opts.actions) ? opts.actions : []) {
    if (!action) continue;
    const button = createButton(action.label, {
      variant: action.variant || 'secondary',
      icon: action.icon,
      disabled: action.disabled,
      onClick: () => {
        let result;
        try {
          result = typeof action.onClick === 'function' ? action.onClick({ close: api.close }) : undefined;
        } catch (err) {
          console.error(err);
          return;
        }
        if (result && typeof result.then === 'function') {
          result.then((value) => {
            if (value !== false) api.close();
          }, () => {});
        } else if (result !== false) {
          api.close();
        }
      },
    });
    if (action.autofocus || (!preferred && action.variant === 'primary')) preferred = button;
    actions.appendChild(button);
  }
  if (actions.childNodes.length) dialog.appendChild(actions);

  let pressedOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (ev) => {
    pressedOnBackdrop = ev.target === backdrop;
  });
  backdrop.addEventListener('click', (ev) => {
    if (dismissible && pressedOnBackdrop && ev.target === backdrop) api.close();
    pressedOnBackdrop = false;
  });

  document.body.appendChild(backdrop);
  document.documentElement.classList.add('has-modal');
  modalStack.push(api);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn);

  const firstField = body.querySelector('[autofocus], [data-autofocus], input:not([type="hidden"]), textarea, select');
  const initial = firstField || preferred || dialog;
  try {
    initial.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
  return api;
}

/* ==========================================================================
   Table banner
   ========================================================================== */

const BANNER_KINDS = new Set(['win', 'lose', 'push', 'info']);
const banners = new WeakMap();

/**
 * showBanner(root, opts) -> { close(), element }
 * Big transient text sweeping in over a table.
 * root: the positioned container to cover (a game stage); a static root gets
 *       the .banner-host class (position: relative).
 * opts: { title, subtitle, kind: 'win' | 'lose' | 'push' | 'info', duration = 2400 (0 = until close()) }
 * A new banner replaces the one already showing in the same root.
 */
export function showBanner(root, opts = {}) {
  const host = isNode(root) ? root : document.body;
  const previous = banners.get(host);
  if (previous) previous.dispose();

  const kind = BANNER_KINDS.has(opts.kind) ? opts.kind : 'info';
  const node = el('div', { class: ['banner', `banner--${kind}`], attrs: { role: 'status', 'aria-live': 'polite' } },
    el('div', { class: 'banner__plate' },
      el('div', { class: 'banner__title' }, opts.title == null ? '' : String(opts.title)),
      opts.subtitle != null && opts.subtitle !== '' ? el('div', { class: 'banner__subtitle' }, String(opts.subtitle)) : null));

  try {
    if (host !== document.body && getComputedStyle(host).position === 'static') host.classList.add('banner-host');
  } catch {
    /* ignore */
  }
  host.appendChild(node);

  let closed = false;
  let hideTimer = 0;
  let removeTimer = 0;

  const dispose = () => {
    closed = true;
    clearTimeout(hideTimer);
    clearTimeout(removeTimer);
    node.remove();
    if (banners.get(host) === record) banners.delete(host);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(hideTimer);
    node.classList.add('is-leaving');
    removeTimer = setTimeout(dispose, prefersReducedMotion() ? 0 : 320);
  };

  const record = { dispose };
  banners.set(host, record);

  const duration = Number.isFinite(opts.duration) ? opts.duration : 2400;
  if (duration > 0) hideTimer = setTimeout(close, duration);
  return { close, element: node };
}

/* ==========================================================================
   Celebrate (canvas particle burst)
   ========================================================================== */

const CELEBRATE = {
  win: { count: 38, bursts: 1, spread: 2.3, speed: 560, life: [1.1, 1.8], rain: 0, caption: '' },
  bigwin: { count: 110, bursts: 2, spread: 2.9, speed: 760, life: [1.6, 2.6], rain: 30, caption: '¡Gran premio!' },
  jackpot: { count: 190, bursts: 3, spread: 3.3, speed: 900, life: [2.0, 3.2], rain: 90, caption: '¡Jackpot!' },
};
const CONFETTI_COLORS = ['#e6c878', '#f3dfa2', '#d4af5a', '#fbefc9', '#b93445', '#faf4e3', '#258a66'];
let fx = null;

function teardownFx() {
  if (!fx) return;
  if (fx.raf) cancelAnimationFrame(fx.raf);
  fx.wrap.remove();
  fx = null;
}

function ensureFx() {
  if (fx) return fx;
  const canvas = el('canvas', { class: 'celebrate__canvas', attrs: { 'aria-hidden': 'true' } });
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  const wrap = el('div', { class: 'celebrate' }, canvas);
  document.body.appendChild(wrap);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx = { wrap, ctx, w, h, particles: [], raf: 0, last: 0, figures: 0, figure: null, pending: [] };
  return fx;
}

const FIGURE_MS = 2650;
const FIGURE_BUMP_MS = 312; // where the entrance of celebrate-figure reaches its overshoot

/**
 * The big "+12.500" in the middle of the screen. Only one fits: celebrate()
 * calls this for the first headline, or for a repeat of the one on screen (two
 * Plinko balls in a row), which adds up instead of piling a second figure on top.
 */
function showFigure(state, caption, amount) {
  let figure = state.figure;
  let stay = FIGURE_MS;
  if (figure) {
    clearTimeout(figure.timer);
    figure.total += amount;
    figure.amount.textContent = `+${formatChips(figure.total)}`;
    // Replay the animation from its overshoot: a bump, without fading out and in again.
    figure.node.style.animation = 'none';
    void figure.node.offsetWidth;
    figure.node.style.animation = '';
    figure.node.style.animationDelay = `-${FIGURE_BUMP_MS}ms`;
    stay -= FIGURE_BUMP_MS;
  } else {
    const amountEl = el('div', { class: 'celebrate__amount' }, `+${formatChips(amount)}`);
    const node = el('div', { class: 'celebrate__figure' },
      caption ? el('div', { class: 'celebrate__caption' }, caption) : null,
      amountEl);
    state.wrap.appendChild(node);
    figure = { node, amount: amountEl, caption, total: amount, timer: 0 };
    state.figure = figure;
    state.figures += 1;
  }
  figure.timer = setTimeout(() => {
    figure.node.remove();
    if (fx !== state) return;
    state.figure = null;
    state.figures -= 1;
    const next = state.pending.shift();
    if (next) celebrate(next);
  }, stay);
}

function makeParticle(x, y, vx, vy, scale, life, delay) {
  const isCoin = Math.random() < 0.55;
  return {
    x, y, vx, vy,
    size: (isCoin ? 5 + Math.random() * 5 : 4 + Math.random() * 5) * scale,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 9,
    spin: Math.random() * Math.PI * 2,
    vs: 6 + Math.random() * 10,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    coin: isCoin,
    age: -delay,
    life,
    dead: false,
  };
}

function fxFrame(ts) {
  const s = fx;
  if (!s) return;
  const dt = Math.min(0.034, s.last ? (ts - s.last) / 1000 : 0.016);
  s.last = ts;
  const ctx = s.ctx;
  ctx.clearRect(0, 0, s.w, s.h);
  const drag = Math.exp(-1.5 * dt);
  let alive = 0;

  for (const p of s.particles) {
    if (p.dead) continue;
    p.age += dt;
    if (p.age < 0) {
      alive++;
      continue;
    }
    if (p.age >= p.life || p.y > s.h + 60) {
      p.dead = true;
      continue;
    }
    alive++;
    p.vx *= drag;
    p.vy = p.vy * drag + 1250 * dt * (p.coin ? 1 : 0.7);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.spin += p.vs * dt;

    ctx.globalAlpha = clamp((p.life - p.age) / 0.35, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const turn = Math.cos(p.spin);
    if (p.coin) {
      ctx.scale(Math.max(0.12, Math.abs(turn)), 1);
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fillStyle = turn > 0 ? '#e6c878' : '#b8923f';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = turn > 0 ? '#fbefc9' : '#d4af5a';
      ctx.fill();
    } else {
      ctx.scale(1, Math.max(0.15, Math.abs(turn)));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (s.particles.length > 500) s.particles = s.particles.filter((p) => !p.dead);
  if (alive > 0 || s.figures > 0) s.raf = requestAnimationFrame(fxFrame);
  else teardownFx();
}

/**
 * celebrate(opts) — gold coins and confetti over the whole viewport.
 * opts: {
 *   kind: 'win' (small burst) | 'bigwin' | 'jackpot' (heavier, with coin rain),
 *   amount: shown as "+12.500" for bigwin / jackpot,
 *   caption: text above the amount (defaults: "¡Gran premio!", "¡Jackpot!"),
 *   from: element or { x, y } viewport point the burst starts from
 * }
 * Removes itself when done. Does nothing under prefers-reduced-motion.
 * Pair it with audio.play('win' | 'bigwin' | 'jackpot').
 */
export function celebrate(opts = {}) {
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  if (prefersReducedMotion()) return;
  const kind = Object.prototype.hasOwnProperty.call(CELEBRATE, opts.kind) ? opts.kind : 'win';
  const conf = CELEBRATE[kind];
  const state = ensureFx();
  if (!state) return;

  // One headline at a time. A big win that also completes the quota used to
  // print "+3.500" and "+340" on top of each other: now the second celebration
  // waits for its turn, burst included.
  const amount = Number(opts.amount);
  const headline = kind !== 'win' && Number.isFinite(amount) && amount > 0;
  const caption = headline ? (opts.caption != null ? String(opts.caption) : conf.caption) : '';
  if (headline && state.figure && state.figure.caption !== caption) {
    const twin = state.pending.find((item) => item.caption === caption);
    if (twin) twin.amount += amount;
    else state.pending.push({ kind, caption, amount, from: opts.from });
    return;
  }

  const scale = clamp(Math.min(state.w, state.h) / 700, 0.7, 1.3);
  const origin = centerOf(opts.from) || { x: state.w / 2, y: state.h * 0.46 };
  const perBurst = Math.round(conf.count / conf.bursts);

  for (let b = 0; b < conf.bursts; b++) {
    const ox = b === 0 ? origin.x : origin.x + (Math.random() - 0.5) * state.w * 0.5;
    const oy = b === 0 ? origin.y : origin.y + (Math.random() - 0.5) * state.h * 0.2;
    for (let i = 0; i < perBurst; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * conf.spread;
      const speed = conf.speed * scale * (0.35 + Math.random() * 0.85);
      const life = conf.life[0] + Math.random() * (conf.life[1] - conf.life[0]);
      state.particles.push(makeParticle(ox, oy, Math.cos(angle) * speed, Math.sin(angle) * speed, scale, life, b * 0.28));
    }
  }
  for (let i = 0; i < conf.rain; i++) {
    const life = 2.2 + Math.random() * 1.4;
    state.particles.push(makeParticle(
      Math.random() * state.w, -20 - Math.random() * 60,
      (Math.random() - 0.5) * 80, 60 + Math.random() * 220,
      scale, life, 0.3 + Math.random() * 1.6,
    ));
  }

  if (headline) showFigure(state, caption, amount);

  if (!state.raf) {
    state.last = 0;
    state.raf = requestAnimationFrame(fxFrame);
  }
}
