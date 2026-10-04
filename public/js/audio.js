/**
 * Club Fortuna — synthesized sound effects (Web Audio, no asset files).
 *
 * Public API:
 *   play(name, opts?)   one-shot effect; silent no-op when locked, muted or
 *                       unsupported. Never throws.
 *   unlock()            create / resume the AudioContext. Must run inside a
 *                       user gesture (the module also listens for the first
 *                       gesture on its own, so calling it is belt and braces).
 *   setMuted(bool)      persisted in localStorage
 *   isMuted()
 *   setVolume(0..1) / getVolume()   master volume, persisted
 *   SOUND_NAMES         every valid name
 */

export const SOUND_NAMES = Object.freeze([
  'chip', 'chips', 'card', 'flip', 'tick', 'spin',
  'win', 'bigwin', 'lose', 'click', 'notify', 'jackpot',
]);

const MUTED_KEY = 'clubfortuna.muted';
const VOLUME_KEY = 'clubfortuna.volume';
const DEFAULT_VOLUME = 0.7;

/** Minimum seconds between two plays of the same effect (avoids stacking). */
const MIN_GAP = { chip: 0.02, win: 0.25, bigwin: 0.5, jackpot: 0.8, spin: 0.4, lose: 0.2, notify: 0.15 };
const DEFAULT_GAP = 0.03;

let ac = null;          // AudioContext
let master = null;      // master GainNode
let noiseBuffer = null; // cached white noise
let unlocked = false;
let unlockedAt = 0;
let muted = readMuted();
let volume = readVolume();
const lastPlayed = new Map();

/* ---- persistence ---------------------------------------------------------- */

function readMuted() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function readVolume() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_VOLUME;
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value, 0, 1) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function store(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* private mode, quota ... not important */
  }
}

/* ---- helpers -------------------------------------------------------------- */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function rnd(min, max) {
  return min + Math.random() * (max - min);
}

function midi(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function contextCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function applyMasterGain() {
  if (!ac || !master) return;
  const target = muted ? 0 : volume;
  try {
    const t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(target, t, 0.015);
  } catch {
    master.gain.value = target;
  }
}

function resume() {
  try {
    if (ac && ac.state !== 'running' && ac.state !== 'closed' && typeof ac.resume === 'function') {
      const pending = ac.resume();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/* ---- public API ----------------------------------------------------------- */

/**
 * Create (once) and resume the AudioContext. Call from a user gesture.
 * @returns {boolean} true when audio is available.
 */
export function unlock() {
  try {
    const Ctor = contextCtor();
    if (!Ctor) return false;
    if (!ac) {
      try {
        ac = new Ctor({ latencyHint: 'interactive' });
      } catch {
        ac = new Ctor();
      }
      master = ac.createGain();
      master.gain.value = muted ? 0 : volume;
      // A gentle limiter so chords and stacked chips never clip.
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      master.connect(limiter);
      limiter.connect(ac.destination);
    }
    resume();
    unlocked = true;
    unlockedAt = nowMs();
    return true;
  } catch {
    return false;
  }
}

/**
 * Play a synthesized effect.
 * @param {string} name one of SOUND_NAMES
 * @param {{ volume?: number }} [opts] per-play volume multiplier (0..1.5)
 */
export function play(name, opts) {
  try {
    if (muted || !unlocked || !ac || !master) return;
    if (ac.state === 'closed') return;
    if (ac.state !== 'running') {
      resume();
      // Right after unlock() the context is still resuming: schedule anyway
      // (it plays as soon as it runs). Otherwise drop the sound instead of
      // letting a backlog burst out later.
      if (nowMs() - unlockedAt > 1200) return;
    }
    const sound = SOUNDS[name];
    if (typeof sound !== 'function') return;

    const t = ac.currentTime;
    const gap = MIN_GAP[name] != null ? MIN_GAP[name] : DEFAULT_GAP;
    const last = lastPlayed.get(name);
    if (last != null && t >= last && t - last < gap) return;
    lastPlayed.set(name, t);

    const out = ac.createGain();
    out.gain.value = opts && Number.isFinite(opts.volume) ? clamp(opts.volume, 0, 1.5) : 1;
    out.connect(master);
    sound(t + 0.008, out);
  } catch {
    /* audio must never break the game */
  }
}

/** @param {boolean} flag */
export function setMuted(flag) {
  muted = !!flag;
  store(MUTED_KEY, muted ? '1' : '0');
  applyMasterGain();
}

export function isMuted() {
  return muted;
}

/** @param {number} value 0..1 */
export function setVolume(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return;
  volume = clamp(next, 0, 1);
  store(VOLUME_KEY, String(volume));
  applyMasterGain();
}

export function getVolume() {
  return volume;
}

/* ---- synthesis building blocks -------------------------------------------- */

function getNoise() {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const length = Math.floor(ac.sampleRate * 2);
  noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/**
 * One enveloped oscillator.
 * o: { freq, to?, type?, dur, gain?, attack?, hold?, lowpass?, q? }
 */
function tone(t, out, o) {
  const attack = o.attack != null ? o.attack : 0.004;
  const hold = o.hold || 0;
  const peak = Math.max(0.0002, o.gain != null ? o.gain : 0.1);
  const end = t + attack + hold + o.dur;

  const osc = ac.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), end);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + attack);
  if (hold > 0) amp.gain.setValueAtTime(peak, t + attack + hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  if (o.lowpass) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(o.lowpass, t);
    filter.Q.value = o.q != null ? o.q : 0.7;
    osc.connect(filter);
    filter.connect(amp);
  } else {
    osc.connect(amp);
  }
  amp.connect(out);
  osc.start(t);
  osc.stop(end + 0.03);
}

/**
 * One enveloped, filtered burst of white noise.
 * o: { type?, freq, to?, q?, dur, gain?, attack? }
 */
function noise(t, out, o) {
  const attack = o.attack != null ? o.attack : 0.002;
  const peak = Math.max(0.0002, o.gain != null ? o.gain : 0.1);
  const end = t + attack + o.dur;

  const src = ac.createBufferSource();
  src.buffer = getNoise();
  src.loop = true;

  const filter = ac.createBiquadFilter();
  filter.type = o.type || 'bandpass';
  filter.frequency.setValueAtTime(o.freq, t);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(10, o.to), end);
  filter.Q.value = o.q != null ? o.q : 1;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  src.connect(filter);
  filter.connect(amp);
  amp.connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.03);
}

/** A soft brass note: two detuned saws through an opening low-pass + body. */
function brass(t, out, freq, dur, gain) {
  const end = t + dur + 0.1;

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(freq * 1.2, t);
  filter.frequency.exponentialRampToValueAtTime(freq * 4.5, t + 0.035);
  filter.frequency.exponentialRampToValueAtTime(freq * 2, end);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.018);
  amp.gain.setValueAtTime(gain, t + Math.max(0.025, dur * 0.55));
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  for (const detune of [-7, 7]) {
    const saw = ac.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(freq, t);
    saw.detune.setValueAtTime(detune, t);
    saw.connect(filter);
    saw.start(t);
    saw.stop(end + 0.03);
  }

  const body = ac.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(freq, t);
  const bodyGain = ac.createGain();
  bodyGain.gain.value = 0.7;
  body.connect(bodyGain);
  bodyGain.connect(amp);
  body.start(t);
  body.stop(end + 0.03);

  filter.connect(amp);
  amp.connect(out);
}

/** A single coin "ching": two inharmonic partials with a fast decay. */
function coin(t, out, gain) {
  const freq = rnd(2300, 5200);
  tone(t, out, { freq, dur: rnd(0.08, 0.16), gain, attack: 0.001 });
  tone(t, out, { freq: freq * 1.5, dur: 0.06, gain: gain * 0.45, attack: 0.001 });
}

function shimmer(t, out, dur, count, gain) {
  for (let i = 0; i < count; i++) coin(t + Math.random() * dur, out, gain * rnd(0.5, 1));
}

/** One clay chip landing: filtered noise click + short ceramic ping. */
function chipHit(t, out, gain, pitch) {
  noise(t, out, { type: 'bandpass', freq: 4200 * pitch, q: 1.4, dur: 0.028, gain: 0.2 * gain, attack: 0.001 });
  tone(t, out, { freq: 2640 * pitch, dur: 0.075, gain: 0.07 * gain, attack: 0.001 });
  tone(t, out, { freq: 3960 * pitch, dur: 0.05, gain: 0.03 * gain, attack: 0.001 });
  tone(t, out, { type: 'triangle', freq: 1180 * pitch, dur: 0.04, gain: 0.05 * gain, attack: 0.001 });
}

/* ---- the effects ---------------------------------------------------------- */

const SOUNDS = {
  /** A single chip placed on the felt. */
  chip(t, out) {
    chipHit(t, out, 1, rnd(0.94, 1.06));
  },

  /** A small stack being pushed / paid. */
  chips(t, out) {
    let offset = 0;
    for (let i = 0; i < 4; i++) {
      chipHit(t + offset, out, 1 - i * 0.14, rnd(0.9, 1.1));
      offset += rnd(0.035, 0.07);
    }
  },

  /** A card sliding out of the shoe and landing. */
  card(t, out) {
    noise(t, out, { type: 'bandpass', freq: 1500, to: 4600, q: 0.7, dur: 0.12, gain: 0.16, attack: 0.02 });
    tone(t + 0.085, out, { freq: 150, to: 80, dur: 0.07, gain: 0.06, attack: 0.002 });
  },

  /** A card being turned over. */
  flip(t, out) {
    noise(t, out, { type: 'highpass', freq: 2200, q: 0.7, dur: 0.05, gain: 0.11, attack: 0.002 });
    tone(t + 0.012, out, { type: 'triangle', freq: 620, to: 300, dur: 0.06, gain: 0.05, attack: 0.002 });
  },

  /** Countdown tick. */
  tick(t, out) {
    tone(t, out, { type: 'triangle', freq: 1320, dur: 0.045, gain: 0.085, attack: 0.001 });
    tone(t, out, { freq: 2640, dur: 0.025, gain: 0.025, attack: 0.001 });
  },

  /** A wheel / ball / reel spinning down (about 1.9 s). */
  spin(t, out) {
    noise(t, out, { type: 'bandpass', freq: 900, to: 420, q: 0.9, dur: 1.9, gain: 0.06, attack: 0.08 });
    let offset = 0;
    let step = 0.045;
    for (let i = 0; i < 20; i++) {
      tone(t + offset, out, {
        type: 'triangle',
        freq: rnd(1500, 1900) * (1 - i * 0.012),
        dur: 0.03,
        gain: 0.07 * (1 - i / 30),
        attack: 0.001,
      });
      offset += step;
      step *= 1.07;
    }
  },

  /** Rising brass arpeggio. */
  win(t, out) {
    const notes = [72, 76, 79, 84];
    notes.forEach((note, i) => {
      brass(t + i * 0.085, out, midi(note), i === notes.length - 1 ? 0.4 : 0.15, 0.075);
    });
    shimmer(t + 0.22, out, 0.45, 5, 0.03);
  },

  /** Longer fanfare with a held chord and coin shimmer. */
  bigwin(t, out) {
    [67, 72, 76, 79, 84].forEach((note, i) => brass(t + i * 0.09, out, midi(note), 0.14, 0.07));
    const chordAt = t + 0.5;
    [72, 76, 79, 84].forEach((note) => brass(chordAt, out, midi(note), 0.7, 0.045));
    shimmer(t + 0.3, out, 1.3, 16, 0.035);
  },

  /** I – IV – V – I fanfare, long final chord, dense coin shimmer. */
  jackpot(t, out) {
    const arps = [[72, 76, 79], [77, 81, 84], [79, 83, 86]];
    arps.forEach((arp, a) => {
      arp.forEach((note, i) => brass(t + a * 0.33 + i * 0.09, out, midi(note), 0.15, 0.065));
    });
    const chordAt = t + 1.02;
    [60, 72, 76, 79, 84, 88].forEach((note) => brass(chordAt, out, midi(note), 1.25, 0.036));
    noise(chordAt, out, { type: 'highpass', freq: 5200, q: 0.5, dur: 1.1, gain: 0.03, attack: 0.02 });
    shimmer(t + 0.2, out, 2.4, 34, 0.035);
  },

  /** Soft descending third — a shrug, not a punishment. */
  lose(t, out) {
    tone(t, out, { type: 'triangle', freq: midi(64), to: midi(63.6), dur: 0.2, gain: 0.1, attack: 0.012, lowpass: 1400 });
    tone(t + 0.17, out, { type: 'triangle', freq: midi(60), to: midi(59.3), dur: 0.36, gain: 0.1, attack: 0.012, lowpass: 1200 });
  },

  /** UI click. */
  click(t, out) {
    tone(t, out, { freq: 1700, to: 1000, dur: 0.028, gain: 0.045, attack: 0.001 });
    noise(t, out, { type: 'highpass', freq: 5000, q: 0.7, dur: 0.012, gain: 0.018, attack: 0.001 });
  },

  /** Two-note glass bell (chat, gifts, turn reminders). */
  notify(t, out) {
    tone(t, out, { freq: midi(81), dur: 0.32, gain: 0.085, attack: 0.004 });
    tone(t, out, { freq: midi(81) * 2, dur: 0.12, gain: 0.018, attack: 0.004 });
    tone(t + 0.12, out, { freq: midi(88), dur: 0.42, gain: 0.085, attack: 0.004 });
    tone(t + 0.12, out, { freq: midi(88) * 2, dur: 0.14, gain: 0.018, attack: 0.004 });
  },
};

/* ---- auto-unlock on the first gesture ------------------------------------- */

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const gestureEvents = ['pointerdown', 'keydown', 'touchend'];
  const onGesture = () => {
    unlock();
    if (ac && ac.state === 'running') {
      for (const type of gestureEvents) window.removeEventListener(type, onGesture, true);
    }
  };
  for (const type of gestureEvents) window.addEventListener(type, onGesture, { capture: true, passive: true });
}
