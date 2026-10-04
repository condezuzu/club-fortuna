'use strict';

/**
 * Crypto-backed randomness. Every outcome in the casino comes from here,
 * through `ctx.rng`, so tests can swap it for a scripted generator.
 *
 *   int(min, maxExclusive)  uniform integer in [min, maxExclusive)
 *   float()                 uniform float in [0, 1) with 53 bits of entropy
 *   shuffle(array)          Fisher-Yates; returns a NEW array, input untouched
 *   pick(array)             one uniformly chosen element
 */

const crypto = require('node:crypto');

const MAX_RANGE = 2 ** 48 - 1; // crypto.randomInt limit

function cryptoInt(min, maxExclusive) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxExclusive)) {
    throw new TypeError('rng.int(min, maxExclusive): both bounds must be integers');
  }
  if (maxExclusive <= min) {
    throw new RangeError('rng.int(min, maxExclusive): maxExclusive must be greater than min');
  }
  if (maxExclusive - min > MAX_RANGE) {
    throw new RangeError('rng.int(min, maxExclusive): range too large');
  }
  return crypto.randomInt(min, maxExclusive);
}

function cryptoFloat() {
  const bytes = crypto.randomBytes(8);
  const high = bytes.readUInt32BE(0) >>> 5; // 27 bits
  const low = bytes.readUInt32BE(4) >>> 6; // 26 bits
  return (high * 67108864 + low) / 9007199254740992;
}

/**
 * Build the full rng interface on top of two primitives. The scripted rng used
 * by the tests is built with the same function, so `shuffle` and `pick` consume
 * integers in exactly the same order in tests and in production:
 *
 *   shuffle: for i = n-1 down to 1 -> j = int(0, i + 1); swap(a[i], a[j])
 *   pick:    array[int(0, array.length)]
 *
 * @param {{ int: (min: number, maxExclusive: number) => number, float: () => number }} source
 */
function createRng(source) {
  const { int, float } = source;
  return {
    int,
    float,
    shuffle(array) {
      if (!Array.isArray(array)) throw new TypeError('rng.shuffle(array): expected an array');
      const out = array.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    pick(array) {
      if (!Array.isArray(array) || array.length === 0) {
        throw new RangeError('rng.pick(array): expected a non-empty array');
      }
      return array[int(0, array.length)];
    },
  };
}

const rng = createRng({ int: cryptoInt, float: cryptoFloat });

module.exports = { ...rng, createRng };
