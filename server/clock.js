'use strict';

/**
 * The only place the server touches wall-clock time and timers.
 *
 * Rooms and game contexts receive a clock object instead of calling
 * setTimeout / Date.now directly, so tests can drive them with a manual clock
 * (see test/helpers/fakeClock.js) and stay deterministic.
 *
 *   now()                 epoch milliseconds
 *   setTimeout(fn, ms)    -> opaque handle
 *   clearTimeout(handle)
 *   defer(fn)             run after the current tick (used to coalesce pushes)
 */
const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  defer: (fn) => {
    setImmediate(fn);
  },
});

module.exports = { realClock };
