'use strict';

/**
 * Manual clock with the same interface as server/clock.js.
 *
 *   const clock = createFakeClock();
 *   clock.setTimeout(fn, 1000);
 *   clock.advance(999);   // nothing
 *   clock.advance(1);     // fn runs, clock.now() moved 1000 ms in total
 *
 * Timers fire in chronological order (ties: creation order); a callback may
 * schedule more timers and they fire too if they fall inside the advanced span.
 * `defer(fn)` callbacks (the "end of tick" coalescing used by rooms) run on
 * `flush()` and automatically around every timer during `advance()`.
 */
function createFakeClock(startAt = 1_750_000_000_000) {
  let now = startAt;
  let sequence = 0;
  const timers = new Map();
  let deferred = [];

  function nextDue(limit) {
    let best = null;
    for (const timer of timers.values()) {
      if (timer.at > limit) continue;
      if (!best || timer.at < best.at || (timer.at === best.at && timer.id < best.id)) best = timer;
    }
    return best;
  }

  const clock = {
    now: () => now,

    setTimeout(fn, ms) {
      const id = (sequence += 1);
      const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
      timers.set(id, { id, at: now + delay, fn });
      return id;
    },

    clearTimeout(id) {
      timers.delete(id);
    },

    defer(fn) {
      deferred.push(fn);
    },

    /** Run everything queued with defer() (including what those callbacks defer). */
    flush() {
      let guard = 0;
      while (deferred.length > 0) {
        if ((guard += 1) > 10_000) throw new Error('fakeClock.flush: defer() loop');
        const batch = deferred;
        deferred = [];
        for (const fn of batch) fn();
      }
    },

    /** Move time forward, firing due timers in order. */
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('fakeClock.advance(ms): ms must be >= 0');
      const target = now + ms;
      clock.flush();
      let guard = 0;
      for (let timer = nextDue(target); timer; timer = nextDue(target)) {
        if ((guard += 1) > 100_000) throw new Error('fakeClock.advance: timer loop');
        timers.delete(timer.id);
        if (timer.at > now) now = timer.at;
        timer.fn();
        clock.flush();
      }
      now = target;
    },

    /** Number of timers still waiting. */
    pending: () => timers.size,
  };
  return clock;
}

module.exports = { createFakeClock };
