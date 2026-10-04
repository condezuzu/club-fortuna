/**
 * Club Fortuna — animated European roulette wheel.
 *
 *   import { createWheel } from '/js/wheel.js';
 *   const wheel = createWheel({ onTick() {}, onLand(number) {} });
 *
 * createWheel() returns an HTMLElement with class "wheel": a square sized by
 * its container (styles in /css/wheel.css) and painted on a canvas at device
 * resolution.
 *
 *   wheel.spin(number, durationMs)  animate: the ball comes to rest in pocket
 *                                   `number` exactly at durationMs. Calling it
 *                                   again restarts from the rotor's current
 *                                   pose. durationMs < 1200 behaves like
 *                                   settle(number).
 *   wheel.settle(number)            no animation: the ball at rest in that
 *                                   pocket, the pocket softly lit.
 *   wheel.clear()                   no ball.
 *   wheel.destroy()                 cancels every frame, timer, observer and
 *                                   listener. The element stays where it is.
 *   wheel.getState()                snapshot for tests and tooling.
 *
 *   onTick()        the ball crossed a fret. Never more often than every 45 ms.
 *   onLand(number)  once per spin(), when the ball has settled.
 *
 * Why the landing cannot miss: planSpin() writes the whole spin as closed-form
 * functions of time, built BACKWARDS from the target. The rotor's angle is a
 * fixed curve; the ball's last second is described in the rotor's own frame
 * (so many frets from the centre of the winning pocket, ending at zero); the
 * fall and the laps on the track are integrated back from that touchdown. A
 * frame only ever asks "where is everything at time t?", so the result does
 * not depend on the frame rate, and a frame that arrives late simply shows
 * the final pose. selfTest() walks that same maths for every pocket.
 *
 * Angles are radians, clockwise from 12 o'clock. Radii are fractions of the
 * wheel's outer radius.
 */

import { el, prefersReducedMotion } from './ui.js';

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2; // canvas angle of 12 o'clock

/** Pocket order, clockwise from the zero. */
export const WHEEL_NUMBERS = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
  7, 28, 12, 35, 3, 26,
]);
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const POCKETS = WHEEL_NUMBERS.length;
const STEP = TAU / POCKETS;
const INDEX_OF = new Map(WHEEL_NUMBERS.map((number, index) => [number, index]));
const COLOR_NAMES = { red: 'rojo', black: 'negro', green: 'verde' };

const colorOf = (number) => (number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black');

/** Radii of every part, outside in. */
const G = Object.freeze({
  band: 0.978, // outer brass band: band .. 1
  rim: 0.905, // mahogany top: rim .. band
  lip: 0.89, // brass lip: lip .. rim
  trackOut: 0.878, // foot of the bowl's wall; the track runs bowl .. trackOut
  bowl: 0.772, // inner edge of the stationary bowl
  rotor: 0.764, // everything inside this turns
  numOut: 0.752, // number ring: numIn .. numOut
  numIn: 0.614,
  pocketOut: 0.606, // pocket ring: pocketIn .. pocketOut
  pocketIn: 0.494,
  cone: 0.482, // cone: hub .. cone
  hub: 0.112, // turret collar
  text: 0.684, // centre line of the numerals
  deflector: 0.797,
  ball: 0.033,
  ballTrack: 0.845, // ball centre while it laps the track
  ballPocket: 0.55, // ball centre at rest
});

const WHEEL_DIR = -1; // the rotor turns counter-clockwise ...
const BALL_DIR = 1; // ... and the ball runs clockwise
const IDLE_SPEED = 0.12; // rad/s, rotor at rest (one turn in about 52 s)
const MIN_SPIN_MS = 1200; // anything shorter is not worth animating
const FADE_MS = 600; // reduced motion: the result fades in over this
const TICK_MIN_MS = 45; // hard floor between two onTick calls
const TICK_PACE = 800; // ms·rad/s: on the track, ticks thin out as the ball slows
const LAND_GRACE_MS = 40; // the fallback timer fires this long after the end
const SAME_SPIN_MS = 120; // a repeated spin() ending within this is the same spin
const IDLE_FRAME_MS = 30; // the idle turn repaints at ~30 fps
const GLOW_MS = 480;
const GHOST_MS = 200;
const BALL_IN_MS = 220;
const MAX_PIXELS = 1600; // cap for the canvas side, in device pixels

/* ==========================================================================
   Small helpers
   ========================================================================== */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
const mod = (value, n) => ((value % n) + n) % n;
const wrap = (angle) => angle - TAU * Math.round(angle / TAU); // into [-PI, PI]
const smooth = (x) => x * x * (3 - 2 * x);
const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** Small seeded generator: the same seed always gives the same spin and the same wood grain. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Number printed on the pocket found at `angle` in the rotor's own frame. */
function numberAt(angle) {
  return WHEEL_NUMBERS[mod(Math.round(angle / STEP), POCKETS)];
}

/* ==========================================================================
   Trajectory (pure)
   ========================================================================== */

/**
 * Plan one spin. Everything it returns is a pure function of the time since
 * the spin started, in milliseconds.
 *
 * options: {
 *   number      winning number, 0..36
 *   duration    ms; the ball is at rest in the pocket at exactly this time
 *   wheelAngle  rotor angle when the spin starts (default 0)
 *   wheelSpeed  rotor speed when the spin starts, rad/s (default: idle)
 *   seed        picks the variations (number of frets, bounce height ...)
 * }
 *
 * Timeline, seconds: 0 .. t1 the ball laps the track, slowing down; t1 .. t2
 * it spirals down the bowl; at t2 it hits the rotor on a fret, `hops` frets
 * short of the middle of the winning pocket; t2 .. T it rattles over them and
 * settles; from T on it rides with the rotor.
 */
export function planSpin(options) {
  const { number } = options;
  const index = INDEX_OF.get(number);
  if (index === undefined) throw new RangeError(`wheel: ${String(number)} is not a pocket`);
  const duration = Math.max(MIN_SPIN_MS, Number(options.duration) || 0);
  const T = duration / 1000;
  const seed = options.seed === undefined ? 1 : options.seed >>> 0;
  const rand = mulberry32(seed);
  const wheel0 = Number(options.wheelAngle) || 0;
  const speed0 = Number.isFinite(options.wheelSpeed) ? Math.max(0, options.wheelSpeed) : IDLE_SPEED;

  /* ---- rotor: a push, then a long ease down to the idle speed ---------- */

  const ramp = clamp(0.06 * T, 0.25, 0.6);
  const coast = T - ramp;
  const gain = clamp(1 + 0.2 * T, 1.3, 2.8) * (0.94 + 0.12 * rand()) - IDLE_SPEED;
  const carry = speed0 - IDLE_SPEED; // whatever speed an interrupted spin left behind

  const rotorSpeed = (t) => {
    if (t < ramp) {
      const s = smooth(t / ramp);
      return IDLE_SPEED + gain * s + carry * (1 - s);
    }
    return t < T ? IDLE_SPEED + gain * (1 - smooth((t - ramp) / coast)) : IDLE_SPEED;
  };

  /** Radians turned since the start: the exact integral of rotorSpeed. */
  const rotorTurn = (t) => {
    if (t < ramp) {
      const p = t / ramp;
      const q = p * p * p * (1 - p / 2);
      return IDLE_SPEED * t + ramp * (gain * q + carry * (p - q));
    }
    const u = Math.min(1, (t - ramp) / coast);
    return IDLE_SPEED * t + (ramp * (gain + carry)) / 2 + gain * coast * (u - u * u * u * (1 - u / 2));
  };

  const wheelAt = (t) => wheel0 + WHEEL_DIR * rotorTurn(t);

  /* ---- the rattle, in the rotor's frame --------------------------------- */

  const most = T >= 6 ? 4 : T >= 3.2 ? 3 : 2;
  const pick = rand();
  const hops = most === 4 ? (pick < 0.25 ? 2 : pick < 0.7 ? 3 : 4) : most === 3 ? (pick < 0.45 ? 2 : 3) : 2;
  const keep = 0.63 + 0.09 * rand(); // share of its speed the ball keeps after each fret
  let settle = 0.5 + 0.1 * rand(); // seconds from the last fret to rest
  let drop = clamp(0.11 * T, 0.42, 1) * (0.9 + 0.2 * rand()); // seconds from the track to the rotor
  const bounce = 0.082 + 0.022 * rand(); // how far up the number ring the touchdown throws it
  const launch = 0.94 + 0.12 * rand();

  // The gaps between frets grow by 1 / keep each time; the last one equals settle * keep.
  let share = 1;
  for (let j = 1; j < hops; j++) share += keep ** j;
  const squeeze = Math.min(1, (0.72 * T) / (settle * share + drop)); // short spins: keep some laps
  settle *= squeeze;
  drop *= squeeze;

  // Fret i is hit at hitT[i], when the ball is hitRel[i] from the pocket's centre.
  const hitT = new Array(hops);
  const hitRel = new Array(hops);
  hitT[hops - 1] = T - settle;
  for (let i = hops - 2; i >= 0; i--) hitT[i] = hitT[i + 1] - settle * keep ** (hops - 1 - i);
  for (let i = 0; i < hops; i++) hitRel[i] = -(hops - i - 0.5) * STEP;
  const t2 = hitT[0];
  const t1 = t2 - drop;

  /** Offset from the centre of the winning pocket, along the ball's direction of travel. */
  const relAt = (t) => {
    if (t >= T) return 0;
    const last = hops - 1;
    if (t >= hitT[last]) {
      // Into the pocket, a touch past its middle, and back: starts at the speed the last fret left it.
      const s = (t - hitT[last]) / settle;
      return -0.5 * STEP * (1 - s) * (1 - s) * Math.cos(1.5 * Math.PI * s);
    }
    let i = last - 1;
    while (i > 0 && t < hitT[i]) i--;
    return hitRel[i] + ((t - hitT[i]) / (hitT[i + 1] - hitT[i])) * STEP;
  };

  // Every hit throws the ball up the slope of the number ring; each throw is smaller than the last
  // and is over before the next fret (or before the ball comes to rest).
  const hopSize = new Array(hops);
  const hopTime = new Array(hops);
  for (let i = 0, size = bounce; i < hops; i++) {
    const room = i < hops - 1 ? hitT[i + 1] - hitT[i] : settle * 0.6;
    const natural = 0.3 * Math.sqrt(size / 0.095);
    hopTime[i] = Math.min(natural, room * 0.94);
    hopSize[i] = size * (hopTime[i] / natural) ** 1.4;
    size = hopSize[i] * 0.62;
  }

  const hopAt = (t) => {
    let height = 0;
    for (let i = 0; i < hops; i++) {
      const x = (t - hitT[i]) / hopTime[i];
      if (x > 0 && x < 1) height = Math.max(height, hopSize[i] * 4 * x * (1 - x));
    }
    return height;
  };

  /* ---- before the rotor: speeds in the room's frame, integrated back ------ */

  const firstGap = hops > 1 ? hitT[1] - hitT[0] : settle;
  const exit = 2.4 * launch; // rad/s when the ball leaves the track
  // Just before touchdown it is still travelling its own way; the fret then knocks it back.
  const touch = Math.min(0.85 * exit, Math.max(0.8, 1.25 * (STEP / firstGap - rotorSpeed(t2))));
  const entry = clamp(2.4 + 1.7 * t1, 5.2, 11.5) * launch; // rad/s when it is thrown in
  const decay = Math.log(entry / exit) / t1;

  const ballSpeed = (t) => (t < t1 ? exit * Math.exp(decay * (t1 - t)) : exit + (touch - exit) * smooth((t - t1) / drop));

  /** Radians still to travel before touchdown, for t1 <= t <= t2. */
  const dropLeft = (t) => {
    const v = (t - t1) / drop;
    return drop * (exit * (1 - v) + (touch - exit) * (0.5 - v * v * v * (1 - v / 2)));
  };
  /** Radians still to travel before leaving the track, for t <= t1. */
  const trackLeft = (t) => (exit / decay) * Math.expm1(decay * (t1 - t));

  const home = index * STEP; // the winning pocket, in the rotor's frame
  const touchAngle = wheelAt(t2) + home + BALL_DIR * hitRel[0];
  const exitAngle = touchAngle - BALL_DIR * dropLeft(t1);

  /** Ball pose at `ms`: { angle, radius, lift }. lift is 0 on the wood, about 1 at the top of the first bounce. */
  const ballAt = (ms, out = {}) => {
    const t = Math.max(0, ms) / 1000;
    if (t >= T) {
      out.angle = wheelAt(t) + home;
      out.radius = G.ballPocket;
      out.lift = 0;
    } else if (t >= t2) {
      const height = hopAt(t);
      out.angle = wheelAt(t) + home + BALL_DIR * relAt(t);
      out.radius = G.ballPocket + height;
      out.lift = height / bounce;
    } else if (t >= t1) {
      const v = (t - t1) / drop;
      out.angle = touchAngle - BALL_DIR * dropLeft(t);
      out.radius = G.ballTrack - (G.ballTrack - G.ballPocket) * (0.16 * v + 0.84 * v * v * v);
      out.lift = 0;
    } else {
      out.angle = exitAngle - BALL_DIR * trackLeft(t);
      out.radius = G.ballTrack;
      out.lift = 0;
    }
    return out;
  };

  const scratch = {};

  /** How many pockets the ball is from the winning one (0 = inside it). Changes when it crosses a fret. */
  const cellAt = (ms) => {
    const t = Math.max(0, ms) / 1000;
    return Math.floor((BALL_DIR * (ballAt(ms, scratch).angle - wheelAt(t) - home)) / STEP + 0.5);
  };

  /** Shortest time allowed since the previous tick, at `ms`. */
  const tickGapAt = (ms) => {
    const t = ms / 1000;
    if (t >= t2) return TICK_MIN_MS; // on the rotor every fret is a real knock
    if (t > t2 - 0.07) return Infinity; // keep the touchdown clear of the last click on the way down
    return clamp(TICK_PACE / (ballSpeed(t) + rotorSpeed(t)), 55, 230);
  };

  return {
    number,
    index,
    duration,
    seed,
    hops,
    t1: t1 * 1000,
    t2: t2 * 1000,
    hits: hitT.map((t) => t * 1000),
    wheelAt: (ms) => wheelAt(Math.max(0, ms) / 1000),
    wheelSpeedAt: (ms) => rotorSpeed(Math.max(0, ms) / 1000),
    ballAt,
    cellAt,
    tickGapAt,
    /** Everything a frame needs: { wheel, ball: { angle, radius, lift }, landed }. */
    poseAt: (ms) => ({ wheel: wheelAt(Math.max(0, ms) / 1000), ball: ballAt(ms), landed: ms >= duration }),
  };
}

/**
 * Tick logic of one spin: call it once per frame with the time since the spin
 * started; it answers true when the ball crossed a fret and a click is due.
 */
function createTicker(plan) {
  let cell = null;
  let seen = 0;
  let last = -Infinity;
  return (ms) => {
    const next = plan.cellAt(Math.min(ms, plan.duration));
    const stalled = ms - seen > 250; // the tab was away: do not click for what nobody saw
    seen = ms;
    if (cell === null || next === cell || stalled) {
      cell = next;
      return false;
    }
    cell = next;
    if (ms - last < plan.tickGapAt(ms)) return false;
    last = ms;
    return true;
  };
}

/**
 * Runs the trajectory maths to its end for every number, several durations and
 * several starting conditions, at several frame rates.
 * Returns { ok, failures: [{ number, duration, seed, check, detail }], cases, checks }.
 */
export function selfTest() {
  const failures = [];
  let cases = 0;
  let checks = 0;
  const durations = [MIN_SPIN_MS, 3000, 9000, 14000];
  const frames = [1000 / 60, 1000 / 144, 1000 / 24, 180];
  const ball = {};

  for (const number of WHEEL_NUMBERS) {
    for (const duration of durations) {
      for (let variant = 0; variant < 3; variant++) {
        cases++;
        const seed = (Math.imul(number + 1, 2654435761) ^ Math.imul(duration, 40503) ^ Math.imul(variant + 1, 97)) >>> 0;
        const wheelAngle = variant === 0 ? 0 : variant === 1 ? -2.5 - number * 0.731 : 4321.987 + number;
        const wheelSpeed = variant === 1 ? 2.1 : IDLE_SPEED;
        const expect = (ok, check, detail) => {
          checks++;
          if (!ok && failures.length < 60) failures.push({ number, duration, seed, check, detail: String(detail) });
        };

        let plan;
        try {
          plan = planSpin({ number, duration, wheelAngle, wheelSpeed, seed });
        } catch (err) {
          expect(false, 'plan', err && err.message);
          continue;
        }
        const off = (pose) => wrap(pose.ball.angle - pose.wheel - plan.index * STEP);
        const under = (pose) => numberAt(pose.ball.angle - pose.wheel);
        const atRest = (pose) => Math.abs(off(pose)) < 1e-9 && Math.abs(pose.ball.radius - G.ballPocket) < 1e-12 && pose.ball.lift === 0;

        // 1. At `duration` the ball is still, in the middle of the right pocket.
        const end = plan.poseAt(duration);
        expect(under(end) === number, 'pocket', `ended on ${under(end)}`);
        expect(atRest(end) && end.landed, 'rest', `offset ${off(end)}, radius ${end.ball.radius}`);

        // 2. 50 ms earlier it was already inside that pocket and all but still.
        const near = plan.poseAt(duration - 50);
        expect(under(near) === number && Math.abs(off(near)) < STEP * 0.05 && near.ball.radius - G.ballPocket < 0.002, 'on-time', `offset ${off(near)}`);

        // 3. Any later frame (a tab that was hidden) shows it riding in that pocket.
        for (const late of [1, 37, 60000]) {
          const pose = plan.poseAt(duration + late);
          expect(under(pose) === number && atRest(pose), 'late-frame', `+${late} ms: ${under(pose)}, offset ${off(pose)}`);
        }

        // 4. No teleporting, and the ball stays between the track and the pocket.
        let jump = 0;
        let slide = 0;
        let lowest = Infinity;
        let highest = -Infinity;
        let prevAngle = plan.ballAt(0, ball).angle;
        let prevRadius = ball.radius;
        for (let t = 0; t < duration; ) {
          const dt = t < plan.t2 - 8 ? 4 : 1;
          t = Math.min(duration, t + dt);
          plan.ballAt(t, ball);
          jump = Math.max(jump, Math.abs(ball.angle - prevAngle) / dt);
          slide = Math.max(slide, Math.abs(ball.radius - prevRadius) / dt);
          lowest = Math.min(lowest, ball.radius);
          highest = Math.max(highest, ball.radius);
          prevAngle = ball.angle;
          prevRadius = ball.radius;
        }
        expect(jump < 0.0135, 'continuity', `ball angle moved ${jump} rad/ms`);
        expect(slide < 0.0045, 'continuity', `ball radius moved ${slide} per ms`);
        expect(lowest > G.ballPocket - 1e-9 && highest < G.ballTrack + 1e-9, 'bounds', `radius ${lowest} .. ${highest}`);

        // 5. The rattle crosses 2-4 frets, one pocket at a time, the first at touchdown.
        let crossings = 0;
        let orderly = true;
        let cell = plan.cellAt(plan.t2 - 2);
        const first = cell;
        for (let t = plan.t2 - 1; t <= duration; t++) {
          const next = plan.cellAt(t);
          if (next !== cell) {
            crossings++;
            orderly = orderly && next === cell + 1;
            cell = next;
          }
        }
        expect(first === -plan.hops && cell === 0 && orderly, 'rattle', `cells ${first} -> ${cell}`);
        expect(crossings === plan.hops && crossings >= 2 && crossings <= 4, 'rattle', `${crossings} frets, planned ${plan.hops}`);

        // 6. On the track the ball and the rotor go opposite ways.
        const a = plan.poseAt(plan.t1 * 0.5);
        const b = plan.poseAt(plan.t1 * 0.5 + 8);
        expect((b.ball.angle - a.ball.angle) * BALL_DIR > 0 && (b.wheel - a.wheel) * WHEEL_DIR > 0, 'direction', 'ball and rotor turn the same way');

        // 7. Same ending at any frame rate; ticks never closer than 45 ms; one tick per fret of the rattle.
        const jitter = mulberry32(seed ^ 0x9e3779b9);
        for (let f = 0; f <= frames.length; f++) {
          const tick = createTicker(plan);
          let t = 0;
          let last = -Infinity;
          let closest = Infinity;
          let knocks = 0;
          let pose;
          do {
            t += f < frames.length ? frames[f] : 4 + 110 * jitter();
            pose = plan.poseAt(t);
            if (tick(t)) {
              closest = Math.min(closest, t - last);
              last = t;
              if (t >= plan.t2) knocks++;
            }
          } while (!pose.landed);
          expect(under(pose) === number && atRest(pose), 'frame-rate', `cadence ${f}: ended on ${under(pose)}, offset ${off(pose)}`);
          expect(closest >= TICK_MIN_MS, 'tick-gap', `cadence ${f}: ${closest} ms`);
          if (f < 2) expect(knocks === plan.hops, 'tick-count', `cadence ${f}: ${knocks} clicks for ${plan.hops} frets`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, cases, checks };
}

/* ==========================================================================
   Painting
   --------------------------------------------------------------------------
   The wheel is five sprites, painted once per size and composed every frame:
     bowl    stationary: rim, brass, track, deflectors
     rotor   turns: number ring, pockets, frets, numerals, cone veneer
     light   stationary, over the rotor: brass rings, shading and the lamp's
             glare. Light that stays put while the rotor turns under it is
             what makes the wheel read as a solid object.
     handle  turns: the four arms (plus their shadow, cast in a fixed direction)
     cap     stationary: the turret's dome
   The lamp hangs to the upper left.
   ========================================================================== */

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const LAMP = [255, 244, 222];
const FALLBACK_FACE = '"Bodoni MT", "Didot", "Bodoni 72", "Times New Roman", Times, serif';

const PALETTE = {
  wood: ['--wheel-wood', '#4b1c13'],
  track: ['--wheel-track', '#1e0e0b'],
  red: ['--wheel-red', '#b3202f'],
  black: ['--wheel-black', '#17141e'],
  green: ['--wheel-green', '#178058'],
  numeral: ['--wheel-numeral', '#faf4e3'],
  ball: ['--wheel-ball', '#fffdf6'],
  glow: ['--wheel-glow', '#f3dfa2'],
};
const GOLD = [
  ['--gold-50', '#fff8e1'],
  ['--gold-100', '#fbefc9'],
  ['--gold-200', '#f3dfa2'],
  ['--gold-300', '#e6c878'],
  ['--gold-400', '#d4af5a'],
  ['--gold-500', '#b8923f'],
  ['--gold-600', '#94722c'],
  ['--gold-700', '#6e5320'],
  ['--gold-800', '#4a3716'],
  ['--gold-900', '#2b200d'],
];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, amount) => (amount < 0 ? mix(c, BLACK, -amount) : mix(c, WHITE, amount));
const warm = (c, amount) => mix(c, [255, 186, 128], amount);
const css = (c, alpha = c.length > 3 ? c[3] : 1) =>
  `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(alpha * 1000) / 1000})`;

/** Any CSS colour -> [r, g, b], using a canvas context as the parser. */
function toRgb(probe, value, fallback) {
  const read = (text) => {
    probe.fillStyle = '#010203';
    probe.fillStyle = text;
    const out = String(probe.fillStyle);
    if (out === '#010203') return null; // the context refused it
    if (out[0] === '#') return [1, 3, 5].map((at) => parseInt(out.slice(at, at + 2), 16));
    const parts = /^rgba?\(([^)]+)\)/.exec(out);
    return parts ? parts[1].split(/[\s,/]+/).slice(0, 3).map(Number) : null;
  };
  return (value && read(value)) || read(fallback);
}

/** Colours and type, read from the element's CSS (custom properties in wheel.css, brass from tokens.css). */
function readStyle(root, probe) {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
  const get = (name) => (style ? style.getPropertyValue(name).trim() : '');
  const look = { gold: GOLD.map(([name, fallback]) => toRgb(probe, get(name), fallback)) };
  for (const key of Object.keys(PALETTE)) look[key] = toRgb(probe, get(PALETTE[key][0]), PALETTE[key][1]);
  look.family = (style && style.fontFamily) || FALLBACK_FACE;
  look.weight = (style && style.fontWeight) || '700';
  return look;
}

/**
 * The stack to print the numerals with. A wheel wants lining figures, and the
 * kit's numeral face keeps them behind the "lnum" feature, which a canvas only
 * applies in engines where the <canvas> element's CSS reaches its text. So:
 * measure a 9, and step down to a face whose default figures are lining.
 */
function chooseFace(probe, family, weight) {
  const lining = (stack) => {
    probe.font = `${weight} 100px ${stack}`;
    return !(probe.measureText('9').actualBoundingBoxDescent > 8);
  };
  for (const stack of [family, FALLBACK_FACE]) if (lining(stack)) return stack;
  return 'Arial, Helvetica, sans-serif';
}

/** Changes when a web font arrives and the numerals have to be printed again. */
function faceSignature(probe, look) {
  const stack = chooseFace(probe, look.family, look.weight);
  probe.font = `${look.weight} 100px ${stack}`;
  return `${stack}|${Math.round(probe.measureText('0123456789').width)}`;
}

/* ---- paths and fills ------------------------------------------------------ */

function disc(ctx, radius) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
}

function ring(ctx, inner, outer) {
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, TAU);
  ctx.moveTo(inner, 0);
  ctx.arc(0, 0, inner, TAU, 0, true);
}

/** Adds one annular wedge to the current path; angles are clockwise from 12 o'clock. */
function wedge(ctx, inner, outer, from, to) {
  ctx.moveTo(outer * Math.sin(from), -outer * Math.cos(from));
  ctx.arc(0, 0, outer, TOP + from, TOP + to);
  ctx.arc(0, 0, inner, TOP + to, TOP + from, true);
  ctx.closePath();
}

function radial(ctx, inner, outer, stops, x = 0, y = 0) {
  const gradient = ctx.createRadialGradient(x, y, inner, x, y, outer);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  return gradient;
}

function sampleStops(stops, at) {
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < at) i++;
  const [a, ca] = stops[i - 1];
  const [b, cb] = stops[i];
  const t = b > a ? clamp01((at - a) / (b - a)) : 0;
  const alpha = (c) => (c.length > 3 ? c[3] : 1);
  return [...mix(ca, cb, t), alpha(ca) + (alpha(cb) - alpha(ca)) * t];
}

/** Fills an annulus with colours that change around the circle: stops are [turn 0..1 clockwise from 12 o'clock, colour]. */
function conicRing(ctx, inner, outer, stops) {
  if (typeof ctx.createConicGradient === 'function') {
    const gradient = ctx.createConicGradient(TOP, 0, 0);
    for (const [at, colour] of stops) gradient.addColorStop(at, css(colour));
    ring(ctx, inner, outer);
    ctx.fillStyle = gradient;
    ctx.fill();
    return;
  }
  const slices = 180; // engines without conic gradients: thin wedges
  for (let i = 0; i < slices; i++) {
    ctx.beginPath();
    wedge(ctx, inner, outer, (i / slices) * TAU, ((i + 1) / slices) * TAU);
    ctx.fillStyle = css(sampleStops(stops, (i + 0.5) / slices));
    ctx.fill();
  }
}

/** Polished brass under the lamp: a hot highlight towards it, a softer one opposite. */
function brass(gold) {
  return [
    [0, gold[5]], [0.07, gold[6]], [0.15, gold[7]], [0.24, gold[5]], [0.33, gold[3]], [0.385, gold[1]], [0.44, gold[3]],
    [0.54, gold[6]], [0.64, gold[7]], [0.73, gold[5]], [0.81, gold[3]], [0.868, gold[0]], [0.92, gold[2]], [0.97, gold[4]],
    [1, gold[5]],
  ];
}

/** Light and shade around a turned surface: `hi` towards `lit` (a turn fraction), `lo` on the far side. */
function lighting(hi, lo, lit = 0.875, focus = 1.5) {
  const stops = [];
  for (let i = 0; i <= 32; i++) {
    const v = Math.cos((i / 32 - lit) * TAU);
    stops.push([i / 32, v >= 0 ? [...LAMP, hi * v ** focus] : [...BLACK, lo * (-v) ** 1.25]]);
  }
  return stops;
}

/** A soft streak of reflected lamp along a circle, centred on turn fraction `at`. */
function sheen(ctx, radius, width, at, spread, alpha) {
  const clear = [...LAMP, 0];
  for (const [w, a] of [[width, alpha * 0.3], [width * 0.55, alpha * 0.55], [width * 0.22, alpha]]) {
    conicRing(ctx, radius - w / 2, radius + w / 2, [[0, clear], [at - spread, clear], [at, [...LAMP, a]], [at + spread, clear], [1, clear]]);
  }
}

function circleLine(ctx, radius, width, style) {
  disc(ctx, radius);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** Shadow thrown into a round well by its own edge: deepest on the lamp's side. `px` is pixels per unit. */
function insetShadow(ctx, px, radius, reach, blur, alpha) {
  ctx.save();
  disc(ctx, radius);
  ctx.clip();
  ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  ctx.shadowBlur = blur * px;
  ctx.shadowOffsetX = reach * px * Math.SQRT1_2;
  ctx.shadowOffsetY = reach * px * Math.SQRT1_2;
  circleLine(ctx, radius + 0.154, 0.3, '#000'); // lies just outside the clip: only its shadow shows
  ctx.restore();
}

/** Paints only the blurred shadow of whatever `draw` fills. */
function castShadow(ctx, px, blur, alpha, draw) {
  const far = 20000;
  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  ctx.shadowBlur = blur * px;
  ctx.shadowOffsetX = far;
  ctx.translate(-far / px, 0);
  ctx.fillStyle = '#000';
  draw();
  ctx.restore();
}

/** Wood figure: fine streaks that follow the turning. The caller clips. */
function grain(ctx, rand, inner, outer, count, base, strength = 1) {
  const dark = css(shade(base, -0.8));
  const light = css(warm(base, 0.5));
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const from = rand() * TAU;
    const pale = rand() > 0.7;
    ctx.beginPath();
    ctx.arc((rand() - 0.5) * 0.05, (rand() - 0.5) * 0.05, inner + (outer - inner) * rand(), from, from + 0.2 + rand() * rand() * 2.2);
    ctx.lineWidth = 0.0015 + rand() * 0.0045;
    ctx.strokeStyle = pale ? light : dark;
    ctx.globalAlpha = strength * (pale ? 0.03 + rand() * 0.07 : 0.06 + rand() * 0.16);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ---- the five sprites ----------------------------------------------------- */

function paintBowl(ctx, px, look) {
  const { wood, track, gold } = look;
  const rand = mulberry32(0xb0b1);

  // outer brass band
  conicRing(ctx, G.band, 1, brass(gold));
  circleLine(ctx, 0.9965, 0.007, 'rgba(0, 0, 0, 0.4)');
  circleLine(ctx, G.band, 0.004, 'rgba(0, 0, 0, 0.55)');

  // mahogany top, turned to a soft bullnose and lacquered
  ring(ctx, G.rim, G.band);
  ctx.fillStyle = radial(ctx, G.rim, G.band, [
    [0, css(shade(wood, -0.52))],
    [0.2, css(shade(wood, -0.1))],
    [0.55, css(warm(wood, 0.1))],
    [0.84, css(shade(wood, -0.12))],
    [1, css(shade(wood, -0.58))],
  ]);
  ctx.fill();
  ctx.save();
  ring(ctx, G.rim, G.band);
  ctx.clip();
  grain(ctx, rand, G.rim, G.band, 180, wood);
  ctx.restore();
  conicRing(ctx, G.rim, G.band, lighting(0.15, 0.45));
  sheen(ctx, (G.rim + G.band) / 2 + 0.005, 0.05, 0.875, 0.1, 0.5);
  sheen(ctx, (G.rim + G.band) / 2 - 0.004, 0.03, 0.375, 0.07, 0.14);

  // brass lip, then the wall that drops to the track
  conicRing(ctx, G.lip, G.rim, brass(gold));
  circleLine(ctx, G.rim, 0.0035, 'rgba(0, 0, 0, 0.55)');
  ring(ctx, G.trackOut, G.lip);
  ctx.fillStyle = radial(ctx, G.trackOut, G.lip, [[0, css(shade(track, -0.6))], [1, css(shade(wood, -0.66))]]);
  ctx.fill();

  // the track: a polished dish, darkest in the corner under the wall
  ring(ctx, G.bowl, G.trackOut);
  ctx.fillStyle = radial(ctx, G.bowl, G.trackOut, [
    [0, css(shade(track, -0.3))],
    [0.2, css(track)],
    [0.62, css(warm(track, 0.13))],
    [0.86, css(shade(track, -0.05))],
    [1, css(shade(track, -0.62))],
  ]);
  ctx.fill();
  ctx.save();
  ring(ctx, G.bowl, G.trackOut);
  ctx.clip();
  grain(ctx, rand, G.bowl, G.trackOut, 90, warm(track, 0.2), 0.8);
  ctx.restore();
  conicRing(ctx, G.bowl, G.lip, lighting(0.1, 0.42, 0.375)); // a dish is lit on the side away from the lamp
  sheen(ctx, G.ballTrack - 0.004, 0.05, 0.375, 0.09, 0.16);

  for (let i = 0; i < 8; i++) paintDeflector(ctx, px, gold, (i + 0.5) * (TAU / 8), i % 2 === 0);

  insetShadow(ctx, px, G.lip, 0.034, 0.05, 0.62);

  // the well the rotor sits in
  disc(ctx, G.bowl);
  ctx.fillStyle = '#070405';
  ctx.fill();
}

/** One brass deflector: a four-facet lozenge, each facet shaded by how it faces the lamp. */
function paintDeflector(ctx, px, gold, angle, upright) {
  const a = upright ? 0.0085 : 0.024; // half extent across the track
  const b = upright ? 0.022 : 0.0085; // half extent along the radius
  const points = [[0, -b], [a, 0], [0, b], [-a, 0]];
  const outline = () => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  ctx.save();
  ctx.rotate(angle);
  ctx.translate(0, -G.deflector);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 0.012 * px;
  ctx.shadowOffsetX = 0.005 * px;
  ctx.shadowOffsetY = 0.006 * px;
  outline();
  ctx.fillStyle = css(gold[5]);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const p = points[i];
    const q = points[(i + 1) % 4];
    const nx = q[1] - p[1];
    const ny = p[0] - q[0];
    const facing = -((nx * cos - ny * sin) + (nx * sin + ny * cos)) / (Math.hypot(nx, ny) * Math.SQRT2); // -1 .. 1 towards the lamp
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.fillStyle = css(facing >= 0 ? mix(gold[4], gold[0], facing) : mix(gold[4], gold[8], -facing));
    ctx.fill();
  }
  outline();
  ctx.lineWidth = 0.0018;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.stroke();
  ctx.restore();
}

function paintRotor(sprite, look, face) {
  const { ctx, scale: px } = sprite;
  const { gold } = look;
  const rand = mulberry32(0x70707);
  const groups = { red: look.red, black: look.black, green: look.green };
  const spoke = (angle, from, to, width, style) => {
    ctx.beginPath();
    ctx.moveTo(from * Math.sin(angle), -from * Math.cos(angle));
    ctx.lineTo(to * Math.sin(angle), -to * Math.cos(angle));
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
  };

  disc(ctx, G.rotor);
  ctx.fillStyle = css(gold[6]);
  ctx.fill();

  // number ring and, a step lower and darker, the pockets
  for (const name of Object.keys(groups)) {
    const c = groups[name];
    const pockets = (inner, outer) => {
      ctx.beginPath();
      WHEEL_NUMBERS.forEach((number, i) => {
        if (colorOf(number) === name) wedge(ctx, inner, outer, (i - 0.5) * STEP, (i + 0.5) * STEP);
      });
    };
    pockets(G.numIn, G.numOut);
    ctx.fillStyle = radial(ctx, G.numIn, G.numOut, [[0, css(shade(c, -0.36))], [0.45, css(shade(c, -0.06))], [1, css(shade(c, 0.07))]]);
    ctx.fill();
    pockets(G.pocketIn, G.pocketOut);
    ctx.fillStyle = radial(ctx, G.pocketIn, G.pocketOut, [[0, css(shade(c, -0.34))], [0.5, css(shade(c, -0.5))], [1, css(shade(c, -0.76))]]);
    ctx.fill();
  }

  // frets: tall brass blades between the pockets, running out as thin dividers between the numbers
  ctx.lineCap = 'butt';
  for (let i = 0; i < POCKETS; i++) {
    const angle = (i + 0.5) * STEP;
    spoke(angle, G.pocketIn, G.pocketOut, 0.024, 'rgba(0, 0, 0, 0.2)');
    spoke(angle, G.pocketIn, G.pocketOut, 0.0095, css(gold[7]));
    spoke(angle, G.pocketIn, G.pocketOut, 0.005, css(gold[2]));
    spoke(angle, G.numIn, G.numOut, 0.0058, css(gold[7]));
    spoke(angle, G.numIn, G.numOut, 0.0026, css(gold[3]));
  }

  // numerals: upright at 12 o'clock, feet towards the centre
  const size = 0.094 * px;
  ctx.save();
  ctx.font = `${look.weight} ${size}px ${face}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let widest = 0;
  for (const number of WHEEL_NUMBERS) widest = Math.max(widest, ctx.measureText(String(number)).width);
  const fit = clamp((STEP * G.text * px * 0.74) / (widest || 1), 0.7, 1);
  const rise = ctx.measureText('0').actualBoundingBoxAscent || size * 0.7;
  ctx.fillStyle = css(look.numeral);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 0.012 * px;
  WHEEL_NUMBERS.forEach((number, i) => {
    ctx.setTransform(1, 0, 0, 1, sprite.ox, sprite.oy);
    ctx.rotate(i * STEP);
    ctx.translate(0, -G.text * px);
    ctx.scale(fit, 1);
    ctx.fillText(String(number), 0, rise / 2);
  });
  ctx.restore();

  // cone: mahogany veneer laid in twelve leaves, the grain running to the centre
  const cone = warm(look.wood, 0.1);
  ring(ctx, G.hub * 0.5, G.cone);
  ctx.fillStyle = radial(ctx, G.hub, G.cone, [[0, css(warm(cone, 0.14))], [0.6, css(cone)], [1, css(shade(cone, -0.34))]]);
  ctx.fill();
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    wedge(ctx, G.hub * 0.5, G.cone, (i / 12) * TAU, ((i + 1) / 12) * TAU);
    ctx.fillStyle = i % 2 ? 'rgba(0, 0, 0, 0.13)' : 'rgba(255, 190, 140, 0.05)';
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const angle = rand() * TAU;
    const from = G.hub + (G.cone - G.hub) * rand() * 0.8;
    const pale = rand() > 0.72;
    ctx.globalAlpha = pale ? 0.03 + rand() * 0.06 : 0.05 + rand() * 0.15;
    spoke(angle, from, Math.min(G.cone, from + 0.04 + rand() * 0.22), 0.0015 + rand() * 0.004, pale ? css(warm(cone, 0.5)) : css(shade(cone, -0.8)));
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 12; i++) spoke((i / 12) * TAU, G.hub, G.cone, 0.0022, 'rgba(0, 0, 0, 0.3)');

  disc(ctx, G.hub);
  ctx.fillStyle = css(gold[7]);
  ctx.fill();
}

function paintLight(ctx, px, look) {
  const { gold } = look;
  const clear = [...LAMP, 0];
  const edge = 'rgba(0, 0, 0, 0.5)';

  // the bowl's edge shades the rotor on the lamp's side
  insetShadow(ctx, px, G.bowl, 0.02, 0.035, 0.6);

  // number ring and pockets dish inwards (lit on the far side); the pockets also sit under a ledge
  conicRing(ctx, G.pocketIn, G.numOut, lighting(0.08, 0.36, 0.375));
  ring(ctx, G.pocketIn, G.pocketOut);
  ctx.fillStyle = radial(ctx, G.pocketIn, G.pocketOut, [[0, 'rgba(0, 0, 0, 0)'], [0.6, 'rgba(0, 0, 0, 0.06)'], [1, 'rgba(0, 0, 0, 0.5)']]);
  ctx.fill();

  // brass: the rotor's edge, the ledge above the pockets, the foot of the cone
  conicRing(ctx, G.numOut, G.rotor, brass(gold));
  circleLine(ctx, G.numOut, 0.003, edge);
  conicRing(ctx, G.pocketOut, G.numIn, brass(gold));
  circleLine(ctx, G.pocketOut, 0.003, edge);
  conicRing(ctx, G.cone, G.pocketIn, brass(gold));
  circleLine(ctx, G.pocketIn, 0.003, edge);
  circleLine(ctx, G.cone, 0.003, edge);

  // the cone rises to the turret: lit towards the lamp, with a streak of glare down its flank
  conicRing(ctx, G.hub, G.cone, lighting(0.26, 0.52, 0.875, 2));
  conicRing(ctx, G.hub, G.cone, [[0, clear], [0.83, clear], [0.875, [...LAMP, 0.26]], [0.92, clear], [1, clear]]);
  conicRing(ctx, 0.343, 0.352, brass(gold)); // inlaid brass line
  circleLine(ctx, 0.3545, 0.003, 'rgba(0, 0, 0, 0.35)');

  // the turret's shadow on the cone, then its collar
  ctx.save();
  disc(ctx, G.cone);
  ctx.clip();
  disc(ctx, 0.6);
  ctx.fillStyle = radial(ctx, G.hub * 0.7, G.hub * 2.5, [[0, 'rgba(0, 0, 0, 0.6)'], [1, 'rgba(0, 0, 0, 0)']], 0.032, 0.038);
  ctx.fill();
  ctx.restore();
  conicRing(ctx, 0, G.hub, brass(gold));
  circleLine(ctx, G.hub, 0.004, 'rgba(0, 0, 0, 0.6)');
  circleLine(ctx, G.hub * 0.86, 0.003, 'rgba(0, 0, 0, 0.28)');

  // the lamp's glare over the lacquer, and the fall-off away from it
  disc(ctx, 1);
  ctx.fillStyle = radial(ctx, 0, 0.95, [[0, css(LAMP, 0.15)], [0.5, css(LAMP, 0.05)], [1, css(LAMP, 0)]], -0.4, -0.48);
  ctx.fill();
  disc(ctx, 1);
  ctx.fillStyle = radial(ctx, 0.6, 1.5, [[0, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 0, 0.44)']], -0.25, -0.3);
  ctx.fill();
}

const ARM = { from: 0.05, to: 0.268, wide: 0.0175, slim: 0.0115, knob: 0.03, knobAt: 0.29 };

function handlePath(ctx) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const cos = Math.cos((i * TAU) / 4);
    const sin = Math.sin((i * TAU) / 4);
    const at = (x, y) => [x * cos - y * sin, x * sin + y * cos];
    const corners = [at(-ARM.wide, -ARM.from), at(-ARM.slim, -ARM.to), at(ARM.slim, -ARM.to), at(ARM.wide, -ARM.from)];
    corners.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const [kx, ky] = at(0, -ARM.knobAt);
    ctx.moveTo(kx + ARM.knob, ky);
    ctx.arc(kx, ky, ARM.knob, 0, TAU);
  }
}

function paintHandle(ctx, px, look) {
  const { gold } = look;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * TAU) / 4);
    // arm: a tapering rod, bright along its ridge
    const rod = ctx.createLinearGradient(-ARM.wide, 0, ARM.wide, 0);
    [[0, gold[8]], [0.2, gold[5]], [0.42, gold[1]], [0.56, gold[3]], [0.82, gold[6]], [1, gold[9]]].forEach(([at, c]) => rod.addColorStop(at, css(c)));
    ctx.beginPath();
    ctx.moveTo(-ARM.wide, -ARM.from);
    ctx.lineTo(-ARM.slim, -ARM.to);
    ctx.lineTo(ARM.slim, -ARM.to);
    ctx.lineTo(ARM.wide, -ARM.from);
    ctx.closePath();
    ctx.fillStyle = rod;
    ctx.fill();
    ctx.lineWidth = 0.0022;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.stroke();
    // ferrule
    ctx.fillStyle = rod;
    ctx.fillRect(-ARM.slim - 0.004, -ARM.to + 0.006, (ARM.slim + 0.004) * 2, 0.012);
    ctx.strokeRect(-ARM.slim - 0.004, -ARM.to + 0.006, (ARM.slim + 0.004) * 2, 0.012);
    // knob: lit evenly here; its glint is added per frame so it stays on the lamp's side
    ctx.beginPath();
    ctx.arc(0, -ARM.knobAt, ARM.knob, 0, TAU);
    ctx.fillStyle = radial(ctx, 0, ARM.knob, [[0, css(gold[2])], [0.55, css(gold[4])], [0.86, css(gold[6])], [1, css(gold[8])]], 0, -ARM.knobAt);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function paintCap(ctx, px, look) {
  const { gold } = look;
  const ball = (radius, x, y) => {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    const g = ctx.createRadialGradient(x * radius, y * radius, radius * 0.04, 0, 0, radius);
    [[0, gold[0]], [0.22, gold[2]], [0.55, gold[4]], [0.82, gold[6]], [1, gold[8]]].forEach(([at, c]) => g.addColorStop(at, css(c)));
    ctx.fillStyle = g;
    ctx.fill();
  };
  castShadow(ctx, px, 0.02, 0.7, () => {
    ctx.beginPath();
    ctx.arc(0.008, 0.01, 0.07, 0, TAU);
    ctx.fill();
  });
  conicRing(ctx, 0, 0.072, brass(gold)); // shoulder
  circleLine(ctx, 0.072, 0.0035, 'rgba(0, 0, 0, 0.6)');
  ball(0.058, -0.42, -0.46); // dome
  circleLine(ctx, 0.058, 0.003, 'rgba(0, 0, 0, 0.45)');
  circleLine(ctx, 0.04, 0.0025, 'rgba(0, 0, 0, 0.25)');
  castShadow(ctx, px, 0.01, 0.6, () => {
    ctx.beginPath();
    ctx.arc(0.005, 0.006, 0.023, 0, TAU);
    ctx.fill();
  });
  ball(0.023, -0.4, -0.44); // finial
  circleLine(ctx, 0.023, 0.002, 'rgba(0, 0, 0, 0.4)');
}

/** Ivory ball of `radius` pixels, centred on the origin. */
function paintBall(ctx, radius, look) {
  const ivory = look.ball;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  const body = ctx.createRadialGradient(-0.36 * radius, -0.4 * radius, radius * 0.05, -0.1 * radius, -0.12 * radius, radius * 1.12);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.3, css(ivory));
  body.addColorStop(0.64, css(mix(ivory, [178, 160, 126], 0.6)));
  body.addColorStop(1, css(mix(ivory, [66, 52, 40], 0.9)));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath(); // warm light bounced back off the wood
  ctx.arc(0, 0, radius * 0.9, 0.12 * Math.PI, 0.62 * Math.PI);
  ctx.lineWidth = radius * 0.16;
  ctx.strokeStyle = 'rgba(255, 190, 140, 0.3)';
  ctx.stroke();
  ctx.restore();
  ctx.beginPath(); // the lamp
  ctx.ellipse(-0.36 * radius, -0.42 * radius, 0.21 * radius, 0.14 * radius, -Math.PI / 4, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
}

function paintGlow(ctx, px, look) {
  const c = look.glow;
  const pocket = () => {
    ctx.beginPath();
    wedge(ctx, G.pocketIn, G.numOut, -STEP / 2, STEP / 2);
  };
  ctx.save();
  ctx.shadowColor = css(c, 0.95);
  ctx.shadowBlur = 0.06 * px;
  ctx.shadowOffsetX = 20000;
  ctx.translate(-20000 / px, 0);
  pocket();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  pocket();
  ctx.fillStyle = radial(ctx, G.pocketIn, G.numOut, [[0, css(c, 0.5)], [0.42, css(c, 0.3)], [1, css(c, 0.2)]]);
  ctx.fill();
  pocket();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.007;
  ctx.strokeStyle = css(shade(c, 0.35), 0.95);
  ctx.stroke();
}

/** A canvas whose context draws in wheel units, with the wheel's centre at (ox, oy) pixels. */
function makeSprite(width, height, scale, ox, oy, canvas) {
  const node = canvas || document.createElement('canvas');
  node.width = Math.max(1, Math.ceil(width));
  node.height = Math.max(1, Math.ceil(height));
  const ctx = node.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  return { canvas: node, ctx, scale, ox, oy };
}

/**
 * Paint every sprite for a wheel `unit` device pixels in radius.
 * `density` (>= 1) oversamples the sprites that get rotated, so the numerals
 * stay sharp at any angle on ordinary screens too.
 */
function buildSprites(unit, density, look, ink) {
  const side = Math.round(unit * 2 + 1);
  const half = side / 2;
  const fine = unit * density;
  const centred = (radius, scale, canvas) => {
    const edge = Math.ceil(radius * scale) * 2 + 4;
    return makeSprite(edge, edge, scale, edge / 2, edge / 2, canvas);
  };

  const bowl = makeSprite(side, side, unit, half, half);
  paintBowl(bowl.ctx, unit, look);

  // The rotor is painted on a canvas that lives in the document, so the page's font features reach its numerals.
  const rotor = centred(G.rotor, fine, ink);
  const face = chooseFace(rotor.ctx, look.family, look.weight);
  paintRotor(rotor, look, face);

  const light = makeSprite(side, side, unit, half, half);
  paintLight(light.ctx, unit, look);

  const handle = centred(ARM.knobAt + ARM.knob, fine);
  paintHandle(handle.ctx, fine, look);
  const handleShadow = centred(ARM.knobAt + ARM.knob + 0.06, unit);
  castShadow(handleShadow.ctx, unit, 0.022, 0.62, () => {
    handlePath(handleShadow.ctx);
    handleShadow.ctx.fill();
  });

  const cap = centred(0.12, unit);
  paintCap(cap.ctx, unit, look);

  const ballRadius = G.ball * fine;
  const ball = centred(G.ball, fine);
  ball.ctx.setTransform(1, 0, 0, 1, ball.ox, ball.oy);
  paintBall(ball.ctx, ballRadius, look);
  const ballShadow = centred(G.ball * 1.7, unit);
  disc(ballShadow.ctx, G.ball * 1.7);
  ballShadow.ctx.fillStyle = radial(ballShadow.ctx, 0, G.ball * 1.7, [[0, 'rgba(0, 0, 0, 0.62)'], [0.45, 'rgba(0, 0, 0, 0.4)'], [1, 'rgba(0, 0, 0, 0)']]);
  ballShadow.ctx.fill();

  const glow = makeSprite(0.44 * unit, 0.5 * unit, unit, 0.22 * unit, 0.87 * unit);
  paintGlow(glow.ctx, unit, look);

  return { unit, face, bowl, rotor, light, handle, handleShadow, cap, ball, ballShadow, glow };
}

/* ==========================================================================
   The component
   ========================================================================== */

/**
 * createWheel(options) -> HTMLElement (class "wheel")
 *
 * options: {
 *   onTick()          the ball crossed a fret (at most once every 45 ms)
 *   onLand(number)    once per spin(), when the ball has settled
 *   reducedMotion     true / false to override the system preference
 * }
 */
export function createWheel(options = {}) {
  const onTick = typeof options.onTick === 'function' ? options.onTick : null;
  const onLand = typeof options.onLand === 'function' ? options.onLand : null;
  const motionOverride = typeof options.reducedMotion === 'boolean' ? options.reducedMotion : null;
  const calm = () => (motionOverride === null ? prefersReducedMotion() : motionOverride);

  const canvas = el('canvas', { class: 'wheel__canvas', attrs: { 'aria-hidden': 'true' } });
  const ink = el('canvas', { class: 'wheel__ink', attrs: { 'aria-hidden': 'true', hidden: true } });
  const root = el('div', { class: 'wheel', attrs: { role: 'img', 'aria-label': 'Ruleta' } }, canvas, ink);
  const ctx = canvas.getContext('2d');

  let destroyed = false;
  let pixels = 0; // canvas side, device pixels
  let cssSize = 0; // element side, CSS pixels
  let unit = 0; // wheel radius, device pixels
  let sprites = null;
  let signature = '';
  let fontsAsked = false;
  let exactPixels = false; // the resize observer reports device pixels itself
  let inView = true;
  let reduced = calm();

  let raf = 0;
  let landTimer = 0;
  let wakeTimer = 0;
  let paintTimer = 0;
  let lastPaint = 0;

  // The rotor when no spin is running: `angle` at time `at`, turning at the idle speed plus a
  // surplus that dies away (what an interrupted spin leaves behind).
  let rotor = { angle: 0, at: now(), surplus: 0 };
  let run = null; // the spin in progress: { number, index, start, end, plan, tick }
  let resting = null; // the ball at rest: { number, index }
  let ghost = null; // the previous ball, fading out: { index | pose, at }
  let glow = { index: -1, from: 0, to: 0, at: 0 };
  const scratch = {};

  /* ---- time-based state --------------------------------------------------- */

  const SURPLUS_TAU = 0.6; // s

  function rotorAt(time) {
    if (run && run.plan) return run.plan.wheelAt(time - run.start);
    if (reduced) return rotor.angle;
    const dt = Math.max(0, time - rotor.at) / 1000;
    return rotor.angle + WHEEL_DIR * (IDLE_SPEED * dt + rotor.surplus * SURPLUS_TAU * (1 - Math.exp(-dt / SURPLUS_TAU)));
  }

  function rotorSpeedAt(time) {
    if (run && run.plan) return run.plan.wheelSpeedAt(time - run.start);
    if (reduced) return 0;
    return IDLE_SPEED + rotor.surplus * Math.exp(-Math.max(0, time - rotor.at) / 1000 / SURPLUS_TAU);
  }

  /** Freeze the rotor's current motion into `rotor` (call before changing `run` or `reduced`). */
  function holdRotor(time) {
    rotor = { angle: wrap(rotorAt(time)), at: time, surplus: Math.max(0, rotorSpeedAt(time) - IDLE_SPEED) };
  }

  /** The ball at `time`: { angle, radius, lift, alpha, moving } or null. */
  function ballAt(time, wheel) {
    if (run) {
      const t = time - run.start;
      if (run.plan) {
        const pose = run.plan.ballAt(t, scratch);
        pose.alpha = clamp01(t / BALL_IN_MS);
        pose.moving = t < run.plan.t2;
        return pose;
      }
      const shown = clamp01((t - (run.end - run.start - FADE_MS)) / FADE_MS);
      return shown > 0 ? { angle: wheel + run.index * STEP, radius: G.ballPocket, lift: 0, alpha: smooth(shown), moving: false } : null;
    }
    return resting ? { angle: wheel + resting.index * STEP, radius: G.ballPocket, lift: 0, alpha: 1, moving: false } : null;
  }

  function glowAt(time) {
    if (run && !run.plan) return smooth(clamp01((time - (run.end - FADE_MS)) / FADE_MS));
    const p = clamp01((time - glow.at) / GLOW_MS);
    return glow.from + (glow.to - glow.from) * (1 - (1 - p) * (1 - p));
  }

  function setGlow(index, level, time, instant) {
    const from = instant ? level : index === glow.index || level === 0 ? glowAt(time) : 0;
    glow = { index: level > 0 ? index : glow.index, from, to: level, at: time };
  }

  const fading = (time) => (ghost !== null && time - ghost.at < GHOST_MS) || (glow.from !== glow.to && time - glow.at < GLOW_MS);

  /* ---- drawing ------------------------------------------------------------ */

  function blit(sprite, x, y, angle = 0, alpha = 1, zoom = 1) {
    const k = (unit / sprite.scale) * zoom; // sprites painted for another size are simply stretched
    if (angle) {
      const cos = Math.cos(angle) * k;
      const sin = Math.sin(angle) * k;
      ctx.setTransform(cos, sin, -sin, cos, x, y);
    } else {
      ctx.setTransform(k, 0, 0, k, x, y);
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite.canvas, -sprite.ox, -sprite.oy);
  }

  function drawBall(pose, centre, alpha, withShadow) {
    const x = centre + pose.radius * unit * Math.sin(pose.angle);
    const y = centre - pose.radius * unit * Math.cos(pose.angle);
    if (withShadow) {
      const reach = (0.011 + 0.03 * pose.lift) * unit;
      blit(sprites.ballShadow, x + reach * 0.8, y + reach, 0, alpha * (0.95 - 0.35 * pose.lift), 1 + 0.25 * pose.lift);
    }
    blit(sprites.ball, x, y, 0, alpha, 1 + 0.09 * pose.lift);
  }

  function paint(time) {
    if (!ctx || !sprites || pixels < 8) return;
    lastPaint = time;
    const centre = pixels / 2;
    const wheel = rotorAt(time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, pixels, pixels);
    blit(sprites.bowl, centre, centre);
    blit(sprites.rotor, centre, centre, wheel);
    blit(sprites.light, centre, centre);

    // winning pocket
    const level = glowAt(time);
    const lit = run && !run.plan ? run.index : glow.index;
    if (level > 0.004 && lit >= 0) {
      const breath = reduced || glow.to === 0 ? 1 : 0.86 + 0.14 * Math.cos((time - glow.at) / 520);
      ctx.globalCompositeOperation = 'lighter';
      blit(sprites.glow, centre, centre, wheel + lit * STEP, clamp01(level * breath));
      ctx.globalCompositeOperation = 'source-over';
    }

    // handle: its shadow falls away from the lamp whichever way the arms point
    blit(sprites.handleShadow, centre + 0.016 * unit, centre + 0.022 * unit, wheel);
    blit(sprites.handle, centre, centre, wheel);
    blit(sprites.cap, centre, centre);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255, 252, 240, 0.85)';
    for (let i = 0; i < 4; i++) {
      const angle = wheel + (i * TAU) / 4;
      ctx.beginPath();
      ctx.arc(centre + (ARM.knobAt * Math.sin(angle) - 0.011) * unit, centre - (ARM.knobAt * Math.cos(angle) + 0.012) * unit, 0.0085 * unit, 0, TAU);
      ctx.fill();
    }

    // ball
    if (ghost) {
      const left = 1 - (time - ghost.at) / GHOST_MS;
      if (left <= 0) ghost = null;
      else drawBall(ghost.pose || { angle: wheel + ghost.index * STEP, radius: G.ballPocket, lift: 0 }, centre, left, true);
    }
    const ball = ballAt(time, wheel);
    if (ball && ball.alpha > 0) {
      const alpha = ball.alpha;
      if (ball.moving) {
        // motion blur: where the ball was during the last frame
        const t = time - run.start;
        const tail = run.plan.ballAt(t - 16, {});
        const smear = Math.hypot(tail.radius * Math.sin(tail.angle) - ball.radius * Math.sin(ball.angle), tail.radius * Math.cos(tail.angle) - ball.radius * Math.cos(ball.angle)) * unit;
        if (smear > 2) for (let i = 5; i >= 1; i--) drawBall(run.plan.ballAt(t - i * 3.2, tail), centre, alpha * (0.44 - 0.075 * i), false);
      }
      drawBall(ball, centre, alpha, true);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* ---- sprites and size --------------------------------------------------- */

  function repaintSprites() {
    paintTimer = 0;
    if (destroyed || !ctx || pixels < 8 || !root.isConnected) return;
    const look = readStyle(root, ink.getContext('2d'));
    const dpr = cssSize > 0 ? pixels / cssSize : 1;
    const density = dpr >= 2.5 ? 1 : dpr >= 1.75 ? 1.5 : 2;
    sprites = buildSprites(unit, Math.max(1, Math.min(density, 1500 / (2 * G.rotor * unit))), look, ink);
    signature = faceSignature(ink.getContext('2d'), look);
    paint(now());
    if (!fontsAsked && document.fonts && typeof document.fonts.load === 'function') {
      fontsAsked = true; // a web font nobody has used yet only loads when asked for; 'loadingdone' then reprints the numerals
      try {
        document.fonts.load(`${look.weight} 16px ${look.family}`, '0123456789').catch(() => {});
      } catch {
        /* an odd font-family value: the fallback face is already in place */
      }
    }
  }

  function resize(devicePixels, cssPixels) {
    if (destroyed) return;
    cssSize = cssPixels;
    const next = Math.min(MAX_PIXELS, Math.max(0, Math.round(devicePixels)));
    if (cssPixels > 0) root.style.setProperty('--wheel-size', `${Math.round(cssPixels * 100) / 100}px`);
    if (next === pixels) return;
    pixels = next;
    if (pixels < 8 || !ctx) return;
    canvas.width = pixels;
    canvas.height = pixels;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    unit = pixels / 2 - 0.5;
    clearTimeout(paintTimer);
    if (!sprites) {
      repaintSprites();
    } else if (sprites.unit !== unit) {
      paint(now()); // stretch the old sprites for now, repaint them once the size settles
      paintTimer = setTimeout(repaintSprites, 120);
    } else {
      paint(now());
    }
    kick();
  }

  function measure() {
    if (destroyed || exactPixels) return;
    const side = Math.min(root.clientWidth, root.clientHeight);
    resize(side * (window.devicePixelRatio || 1), side);
  }

  /* ---- frame loop --------------------------------------------------------- */

  const awake = () => !destroyed && pixels >= 8 && root.isConnected && !document.hidden;

  function kick() {
    if (!raf && awake()) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!awake()) return; // parked: an observer, a timer or the next call wakes it up
    const time = now();
    if (run) {
      if (run.plan && run.tick(time - run.start) && onTick) call(onTick);
      if (time >= run.end) finish();
    }
    const busy = (run && (run.plan || time >= run.end - FADE_MS)) || fading(time);
    if (inView && (busy || time - lastPaint >= IDLE_FRAME_MS - 2)) paint(time);
    if (!raf && (busy || (inView && !reduced))) raf = requestAnimationFrame(frame); // a listener may already have asked for one
  }

  function refresh() {
    if (awake() && inView) paint(now());
    kick();
  }

  function call(fn, value) {
    try {
      fn(value);
    } catch (err) {
      console.error(err); // a faulty listener must not stop the wheel
    }
  }

  /* ---- state changes ------------------------------------------------------ */

  function mark(state, number) {
    root.dataset.state = state;
    root.classList.toggle('is-spinning', state === 'spinning');
    root.classList.toggle('is-settled', state === 'settled');
    if (state === 'settled') {
      root.dataset.number = String(number);
      root.dataset.color = colorOf(number);
      root.setAttribute('aria-label', `Ruleta: salió el ${number}, ${COLOR_NAMES[colorOf(number)]}`);
    } else {
      delete root.dataset.number;
      delete root.dataset.color;
      root.setAttribute('aria-label', state === 'spinning' ? 'Ruleta girando' : 'Ruleta');
    }
  }

  function stopTimers() {
    clearTimeout(landTimer);
    clearTimeout(wakeTimer);
    landTimer = 0;
    wakeTimer = 0;
  }

  /** Let whatever ball is showing fade out where it is. */
  function dismissBall(time) {
    const ball = ballAt(time, rotorAt(time));
    if (!ball || ball.alpha <= 0) ghost = null;
    else if (run) ghost = { pose: { angle: ball.angle, radius: ball.radius, lift: ball.lift }, at: time };
    else ghost = { index: resting.index, at: time };
  }

  function rest(number, index, time, instant) {
    resting = { number, index };
    setGlow(index, 1, time, instant);
    mark('settled', number);
  }

  /** The ball has arrived: hand over from the spin to the idle turn, then tell the game. */
  function finish() {
    if (!run || destroyed) return;
    const { number, index, plan, end } = run;
    const quiet = !plan;
    rotor = { angle: plan ? wrap(plan.wheelAt(plan.duration)) : rotor.angle, at: end, surplus: 0 };
    run = null;
    stopTimers();
    rest(number, index, now(), quiet);
    refresh();
    if (onLand) call(onLand, number);
  }

  function begin(number, index, duration, time) {
    holdRotor(time);
    dismissBall(time);
    stopTimers();
    resting = null;
    setGlow(-1, 0, time, false);
    reduced = calm();
    run = { number, index, start: time, end: time + duration, plan: null, tick: null };
    if (!reduced) {
      run.plan = planSpin({ number, duration, wheelAngle: rotor.angle, wheelSpeed: IDLE_SPEED + rotor.surplus, seed: (Math.random() * 4294967296) >>> 0 });
      run.tick = createTicker(run.plan);
    } else {
      wakeTimer = setTimeout(kick, Math.max(0, duration - FADE_MS)); // nothing moves until the result fades in
    }
    landTimer = setTimeout(finish, duration + LAND_GRACE_MS); // frames normally get there first; this covers hidden tabs
    mark('spinning');
    refresh();
  }

  function spin(number, durationMs) {
    if (destroyed) return;
    const index = INDEX_OF.get(number);
    if (index === undefined) {
      clear();
      return;
    }
    const duration = Number(durationMs);
    const time = now();
    if (!(duration >= MIN_SPIN_MS)) {
      // Too short to animate: show the result and report it, as any spin does.
      if (run || !resting || resting.number !== number) place(number, index, time);
      clearTimeout(landTimer);
      landTimer = setTimeout(() => {
        landTimer = 0;
        if (onLand) call(onLand, number);
      }, 0);
      return;
    }
    if (run && run.number === number && Math.abs(run.end - (time + duration)) <= SAME_SPIN_MS) return; // the same spin, announced again
    begin(number, index, duration, time);
  }

  /** Put the ball at rest in a pocket, without animation. */
  function place(number, index, time) {
    const near = run && run.number === number && run.end - time < 250;
    holdRotor(time);
    if (near) ghost = null;
    else dismissBall(time);
    run = null;
    stopTimers();
    rest(number, index, time, true);
    refresh();
  }

  function settle(number) {
    if (destroyed) return;
    const index = INDEX_OF.get(number);
    if (index === undefined) {
      clear();
      return;
    }
    if (!run && resting && resting.number === number) return; // already there
    const completes = run !== null && run.number === number; // the game got there before the ball: that spin still lands
    place(number, index, now());
    if (completes) {
      landTimer = setTimeout(() => {
        landTimer = 0;
        if (onLand) call(onLand, number);
      }, 0);
    }
  }

  function clear() {
    if (destroyed) return;
    const time = now();
    holdRotor(time);
    dismissBall(time);
    run = null;
    stopTimers();
    resting = null;
    setGlow(-1, 0, time, false);
    mark('clear');
    refresh();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    stopTimers();
    clearTimeout(paintTimer);
    if (resizer) resizer.disconnect();
    if (viewer) viewer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', measure);
    if (motionQuery) {
      if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
      else if (motionQuery.removeListener) motionQuery.removeListener(onMotionChange);
    }
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts);
    run = null;
    resting = null;
    ghost = null;
    if (sprites) for (const key of Object.keys(sprites)) if (sprites[key] && sprites[key].canvas) sprites[key].canvas.width = sprites[key].canvas.height = 0;
    sprites = null;
  }

  function getState() {
    const time = now();
    const wheel = rotorAt(time);
    const ball = ballAt(time, wheel);
    const reach = cssSize / 2;
    return {
      state: run ? 'spinning' : resting ? 'settled' : 'clear',
      number: run ? run.number : resting ? resting.number : null,
      remaining: run ? Math.max(0, run.end - time) : 0,
      wheelAngle: wheel,
      ball: ball
        ? {
            angle: ball.angle,
            radius: ball.radius,
            x: reach + ball.radius * reach * Math.sin(ball.angle),
            y: reach - ball.radius * reach * Math.cos(ball.angle),
            over: numberAt(ball.angle - wheel),
          }
        : null,
      size: cssSize,
      pixels,
      reducedMotion: reduced,
      face: sprites ? sprites.face : null,
    };
  }

  /* ---- observers and listeners -------------------------------------------- */

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      refresh();
    }
  }

  function onMotionChange() {
    if (destroyed || calm() === reduced) return;
    const time = now();
    if (run) {
      // Carry on with the same spin in the other style.
      const { number, index, end } = run;
      if (end - time >= MIN_SPIN_MS) begin(number, index, end - time, time);
      else settle(number);
      return;
    }
    holdRotor(time);
    reduced = calm();
    rotor.surplus = 0;
    refresh();
  }

  function onFonts() {
    if (destroyed || !sprites || !root.isConnected) return;
    const look = readStyle(root, ink.getContext('2d'));
    if (faceSignature(ink.getContext('2d'), look) === signature) return;
    clearTimeout(paintTimer);
    paintTimer = setTimeout(repaintSprites, 0);
  }

  let resizer = null;
  if (typeof ResizeObserver === 'function') {
    resizer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const css = Math.min(entry.contentRect.width, entry.contentRect.height);
      const exact = entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
      exactPixels = Boolean(exact);
      resize(exact ? Math.min(exact.inlineSize, exact.blockSize) : css * (window.devicePixelRatio || 1), css);
    });
    try {
      resizer.observe(root, { box: 'device-pixel-content-box' });
    } catch {
      resizer.observe(root);
    }
  }

  let viewer = null;
  if (typeof IntersectionObserver === 'function') {
    viewer = new IntersectionObserver(
      (entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView) refresh();
      },
      { rootMargin: '80px' },
    );
    viewer.observe(root);
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', measure); // zoom and screen changes where the observer cannot see device pixels

  const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts);

  mark('clear');
  root.spin = spin;
  root.settle = settle;
  root.clear = clear;
  root.destroy = destroy;
  root.getState = getState;
  return root;
}
