'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rng = require('../server/rng');
const { createScriptedRng } = require('./helpers/fakeCtx');

test('int() stays inside [min, maxExclusive) and reaches every value', () => {
  const seen = new Set();
  for (let i = 0; i < 4000; i += 1) {
    const value = rng.int(0, 37);
    assert.ok(Number.isInteger(value) && value >= 0 && value < 37, `out of range: ${value}`);
    seen.add(value);
  }
  assert.equal(seen.size, 37, 'every roulette pocket shows up in 4000 draws');
  assert.equal(rng.int(5, 6), 5);
  assert.ok(rng.int(-3, 0) < 0);
});

test('int() rejects invalid bounds', () => {
  assert.throws(() => rng.int(0, 0), RangeError);
  assert.throws(() => rng.int(5, 2), RangeError);
  assert.throws(() => rng.int(0.5, 3), TypeError);
  assert.throws(() => rng.int(0, NaN), TypeError);
  assert.throws(() => rng.int('0', 3), TypeError);
  assert.throws(() => rng.int(0, 2 ** 50), RangeError);
});

test('float() returns numbers in [0, 1)', () => {
  let sum = 0;
  for (let i = 0; i < 2000; i += 1) {
    const value = rng.float();
    assert.ok(value >= 0 && value < 1);
    sum += value;
  }
  const mean = sum / 2000;
  assert.ok(mean > 0.4 && mean < 0.6, `mean ${mean} is suspicious`);
});

test('shuffle() returns a new permutation and leaves the input untouched', () => {
  const input = Array.from({ length: 52 }, (_, i) => i);
  const copy = input.slice();
  const out = rng.shuffle(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, copy, 'input not mutated');
  assert.equal(out.length, 52);
  assert.deepEqual([...out].sort((a, b) => a - b), copy, 'same elements');
  assert.notDeepEqual(out, copy, '52 cards coming out in order is a 1 in 8e67 event');
  assert.deepEqual(rng.shuffle([]), []);
  assert.deepEqual(rng.shuffle(['x']), ['x']);
  assert.throws(() => rng.shuffle('abc'), TypeError);
});

test('shuffle() is unbiased enough: every position sees every element', () => {
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i += 1) counts[rng.shuffle([0, 1, 2])[0]] += 1;
  for (const count of counts) assert.ok(count > 800 && count < 1200, `first-slot counts ${counts}`);
});

test('pick() returns an element of the array', () => {
  const options = ['a', 'b', 'c'];
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(rng.pick(options));
  assert.deepEqual([...seen].sort(), options);
  assert.throws(() => rng.pick([]), RangeError);
  assert.throws(() => rng.pick(null), RangeError);
});

test('createRng() derives shuffle and pick from the int source (documented draw order)', () => {
  const draws = [];
  const scripted = [0, 2, 1]; // j for i = 3, 2, 1
  const custom = rng.createRng({
    int: (min, max) => {
      draws.push([min, max]);
      return scripted.shift();
    },
    float: () => 0.5,
  });
  // i=3: swap a[3], a[0] -> d b c a ; i=2: swap a[2], a[2] ; i=1: swap a[1], a[1]
  assert.deepEqual(custom.shuffle(['a', 'b', 'c', 'd']), ['d', 'b', 'c', 'a']);
  assert.deepEqual(draws, [
    [0, 4],
    [0, 3],
    [0, 2],
  ]);
});

test('scripted rng: queues, strictness and fallbacks', () => {
  const strict = createScriptedRng({ ints: [3, (min, max) => max - 1], floats: [0.25] });
  assert.equal(strict.int(0, 10), 3);
  assert.equal(strict.int(0, 10), 9);
  assert.throws(() => strict.int(0, 10), /no scripted int is left/);
  assert.equal(strict.float(), 0.25);
  assert.throws(() => strict.float(), /no scripted float is left/);
  assert.deepEqual(strict.shuffle([1, 2, 3]), [1, 2, 3], 'identity shuffle by default');
  assert.equal(strict.calls.length, 4);

  const outOfRange = createScriptedRng({ ints: [40] });
  assert.throws(() => outOfRange.int(0, 37), /outside \[0, 37\)/);

  const lenient = createScriptedRng({ fallback: 'min' });
  assert.equal(lenient.int(4, 9), 4);
  assert.equal(lenient.float(), 0);
  assert.equal(lenient.pick(['x', 'y']), 'x');

  const scriptedShuffle = createScriptedRng({ shuffles: [[9, 8, 7], (array) => array.reverse()] });
  assert.deepEqual(scriptedShuffle.shuffle([1, 2, 3]), [9, 8, 7]);
  assert.deepEqual(scriptedShuffle.shuffle([1, 2, 3]), [3, 2, 1]);
  assert.deepEqual(scriptedShuffle.shuffle([1, 2, 3]), [1, 2, 3]);

  const fisherYates = createScriptedRng({ shuffle: 'fisher-yates', ints: [0, 0] });
  assert.deepEqual(fisherYates.shuffle(['a', 'b', 'c']), ['b', 'c', 'a']);
});
