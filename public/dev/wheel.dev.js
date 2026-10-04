/**
 * Club Fortuna — roulette wheel test bench (served at /dev/wheel.html).
 * Dev-only page: drives public/js/wheel.js and shows what it reports back.
 * The page's script lives here because the server's CSP forbids inline scripts.
 */

import { createWheel, selfTest, WHEEL_NUMBERS } from '../js/wheel.js';

const find = (selector) => document.querySelector(selector);
const mount = find('[data-mount]');
const log = find('[data-log]');
const out = {
  state: find('[data-out="state"]'),
  ticks: find('[data-out="ticks"]'),
  landed: find('[data-out="landed"]'),
  selftest: find('[data-out="selftest"]'),
};
const sizeSelect = find('[data-size]');
const reducedBox = find('[data-reduced]');
const soundBox = find('[data-sound]');

let wheel = null;
let ticks = 0;
let startedAt = 0;
let audio = null; // /js/audio.js, loaded the first time "Sonido" is ticked
const landed = [];

function say(text) {
  const line = document.createElement('li');
  line.textContent = text;
  log.prepend(line);
  while (log.children.length > 40) log.lastChild.remove();
}

function build() {
  if (wheel) {
    wheel.destroy();
    wheel.remove();
  }
  wheel = createWheel({
    reducedMotion: reducedBox.checked ? true : undefined,
    onTick() {
      ticks += 1;
      out.ticks.textContent = String(ticks);
      if (audio && soundBox.checked) audio.play('tick');
    },
    onLand(number) {
      const { ball } = wheel.getState();
      landed.push(number);
      out.landed.textContent = landed.slice(-12).join(', ');
      say(`onLand(${number}) a los ${Math.round(performance.now() - startedAt)} ms · bola sobre el ${ball ? ball.over : '—'} · ${ticks} ticks`);
    },
  });
  mount.append(wheel);
  window.wheel = wheel; // handy in the console
}

function act(button) {
  const { act: name, number, ms } = button.dataset;
  if (name === 'spin') {
    const target = number === undefined ? WHEEL_NUMBERS[Math.floor(Math.random() * WHEEL_NUMBERS.length)] : Number(number);
    ticks = 0;
    out.ticks.textContent = '0';
    startedAt = performance.now();
    wheel.spin(target, Number(ms));
    say(`spin(${target}, ${ms})`);
  } else if (name === 'settle') {
    wheel.settle(Number(number));
    say(`settle(${number})`);
  } else if (name === 'clear') {
    wheel.clear();
    say('clear()');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-act]') : null;
  if (button) act(button);
});

sizeSelect.addEventListener('change', () => {
  mount.style.width = `${sizeSelect.value}px`;
});

reducedBox.addEventListener('change', () => {
  build();
  say(reducedBox.checked ? 'movimiento reducido: sí' : 'movimiento reducido: según el sistema');
});

soundBox.addEventListener('change', async () => {
  if (!soundBox.checked || audio) return;
  try {
    audio = await import('../js/audio.js');
    audio.unlock();
  } catch (err) {
    say(`sin sonido: ${err.message}`);
  }
});

setInterval(() => {
  const state = wheel.getState();
  const names = { clear: 'sin bola', spinning: `girando al ${state.number} · faltan ${(state.remaining / 1000).toFixed(1)} s`, settled: `bola en el ${state.number}` };
  out.state.textContent = `${names[state.state]} · ${Math.round(state.size)} px (${state.pixels} px reales)`;
}, 200);

mount.style.width = `${sizeSelect.value}px`;
build();

// The trajectory check, after the first paint so it does not delay it.
setTimeout(() => {
  const t0 = performance.now();
  const result = selfTest();
  const ms = Math.round(performance.now() - t0);
  out.selftest.textContent = result.ok
    ? `ok · ${result.cases} giros, ${result.checks} comprobaciones, ${ms} ms`
    : `FALLÓ · ${result.failures.length} de ${result.checks} comprobaciones`;
  out.selftest.className = result.ok ? 'is-ok' : 'is-bad';
  for (const failure of result.failures.slice(0, 10)) say(`selfTest: ${failure.check} · número ${failure.number}, ${failure.duration} ms · ${failure.detail}`);
  window.wheelSelfTest = result;
}, 300);
