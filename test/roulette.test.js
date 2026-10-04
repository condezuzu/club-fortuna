'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const roulette = require('../server/games/roulette');
const { createTable } = require('./helpers/fakeCtx');

const { SPOTS, PAYOUTS, TIMING, WHEEL, RED_NUMBERS, colorOf, findSpot, payoutOf } = roulette.internals;

/** A fresh table with Ana and Beto seated (1000 chips each unless overridden). */
function table(options = {}) {
  return createTable(roulette, {
    players: [
      { id: 'ana', name: 'Ana', avatar: 1, balance: 1000 },
      { id: 'beto', name: 'Beto', avatar: 2, balance: 1000 },
    ],
    ...options,
  });
}

const bet = (spot, amount) => ({ type: 'bet', spot, amount });

/** Play one full round with a single bet and return the chips that came back. */
function returned(spot, amount, number) {
  const t = table({ ints: [number], players: [{ id: 'ana', balance: 5000 }] });
  t.act('ana', bet(spot, amount));
  t.advance(TIMING.betting + TIMING.spinning);
  return t.balance('ana') - (5000 - amount);
}

// ───────────────────────────── layout ─────────────────────────────

test('meta honours the plugin contract', () => {
  assert.equal(roulette.meta.id, 'roulette');
  assert.equal(roulette.meta.name, 'Ruleta');
  assert.equal(roulette.meta.order, 1);
  assert.equal(roulette.meta.minBet, 5);
  assert.equal(roulette.meta.maxBet, 2000);
  assert.ok(Number.isInteger(roulette.meta.tableLimit) && roulette.meta.tableLimit >= roulette.meta.maxBet);
  assert.ok(roulette.meta.tagline.length > 0);
});

test('the layout has exactly the legal spots of a European table', () => {
  const byKind = {};
  for (const spot of SPOTS.values()) byKind[spot.kind] = (byKind[spot.kind] || 0) + 1;
  assert.deepEqual(byKind, {
    straight: 37,
    split: 60, // 57 on the grid + 0-1, 0-2, 0-3
    street: 14, // 12 rows + trios 0-1-2 and 0-2-3
    corner: 23, // 22 on the grid + first four 0-1-2-3
    sixline: 11,
    column: 3,
    dozen: 3,
    red: 1,
    black: 1,
    even: 1,
    odd: 1,
    low: 1,
    high: 1,
  });
  assert.equal(SPOTS.size, 157);

  for (const spot of SPOTS.values()) {
    assert.equal(spot.payout, PAYOUTS[spot.kind]);
    assert.deepEqual([...spot.numbers], [...spot.numbers].sort((a, b) => a - b), `${spot.id} numbers ascending`);
    assert.equal(new Set(spot.numbers).size, spot.numbers.length);
    for (const n of spot.numbers) assert.ok(Number.isInteger(n) && n >= 0 && n <= 36);
    assert.ok(Object.isFrozen(spot) && Object.isFrozen(spot.numbers));
  }
});

test('a fair layout: every bet has the same house edge (36 / covered numbers)', () => {
  for (const spot of SPOTS.values()) {
    // The first four (0-1-2-3) pays 8:1 on four numbers like any corner.
    assert.equal((spot.payout + 1) * spot.numbers.length, 36, spot.id);
  }
});

test('outside bets cover the right numbers', () => {
  const numbers = (id) => [...SPOTS.get(id).numbers];
  assert.deepEqual(numbers('column:1'), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
  assert.deepEqual(numbers('column:2'), [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]);
  assert.deepEqual(numbers('column:3'), [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]);
  assert.deepEqual(numbers('dozen:1'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(numbers('dozen:2'), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(numbers('dozen:3'), [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
  assert.deepEqual(numbers('red'), [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  assert.deepEqual(numbers('black'), [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);
  assert.equal(numbers('even').length, 18);
  assert.ok(numbers('even').every((n) => n % 2 === 0 && n !== 0));
  assert.ok(numbers('odd').every((n) => n % 2 === 1));
  assert.deepEqual(numbers('low'), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.deepEqual(numbers('high'), Array.from({ length: 18 }, (_, i) => i + 19));
  for (const id of ['red', 'black', 'even', 'odd', 'low', 'high', 'column:1', 'dozen:1']) {
    assert.ok(!numbers(id).includes(0), `${id} loses on zero`);
  }
});

test('wheel and colours', () => {
  assert.equal(WHEEL.length, 37);
  assert.equal(new Set(WHEEL).size, 37);
  assert.equal(WHEEL[0], 0);
  assert.deepEqual(WHEEL.slice(0, 5), [0, 32, 15, 19, 4]);
  assert.equal(RED_NUMBERS.length, 18);
  assert.equal(colorOf(0), 'green');
  assert.equal(colorOf(1), 'red');
  assert.equal(colorOf(2), 'black');
  assert.equal(colorOf(36), 'red');
  // On the wheel, colours alternate all the way around (after the zero).
  for (let i = 1; i < WHEEL.length - 1; i += 1) assert.notEqual(colorOf(WHEEL[i]), colorOf(WHEEL[i + 1]));
});

test('geometry: only neighbours on the 3x12 layout can be combined', () => {
  const legal = [
    'straight:0', 'straight:36',
    'split:1-2', 'split:2-3', 'split:1-4', 'split:33-36', 'split:35-36', 'split:0-1', 'split:0-2', 'split:0-3',
    'street:1-2-3', 'street:34-35-36', 'street:0-1-2', 'street:0-2-3',
    'corner:1-2-4-5', 'corner:2-3-5-6', 'corner:32-33-35-36', 'corner:0-1-2-3',
    'sixline:1-2-3-4-5-6', 'sixline:31-32-33-34-35-36',
    'column:1', 'column:3', 'dozen:1', 'dozen:3', 'red', 'black', 'even', 'odd', 'low', 'high',
  ];
  for (const id of legal) assert.ok(findSpot(id), `${id} should be legal`);

  const illegal = [
    'straight:37', 'straight:-1', 'straight:1.5', 'straight:', 'straight', 'straight:01x',
    'split:3-4', // end of one row and start of the next: not neighbours
    'split:1-3', 'split:1-5', 'split:0-4', 'split:1-1', 'split:36-37', 'split:34-37', 'split:1-2-3',
    'street:2-3-4', 'street:1-2-4', 'street:0-1-3', 'street:1-2', 'street:35-36-37',
    'corner:3-4-6-7', // wraps around the edge
    'corner:1-2-3-4', 'corner:1-2-5-6', 'corner:0-1-2-4', 'corner:34-35-37-38',
    'sixline:2-3-4-5-6-7', 'sixline:1-2-3-7-8-9', 'sixline:34-35-36-37-38-39',
    'column:0', 'column:4', 'dozen:0', 'dozen:4', 'red:1', 'RED', 'Red', 'green', 'zero',
    'basket', 'trio:0-1-2', '', ' ', 'split:1-2 ', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
    'split:' + '1-'.repeat(30) + '2',
  ];
  for (const id of illegal) assert.equal(findSpot(id), null, `${JSON.stringify(id)} should be illegal`);
  for (const notAString of [17, null, undefined, {}, ['red'], true, 0]) assert.equal(findSpot(notAString), null);
});

test('numbers may arrive in any order and are normalised to the canonical id', () => {
  assert.equal(findSpot('split:18-17').id, 'split:17-18');
  assert.equal(findSpot('corner:20-19-17-16').id, 'corner:16-17-19-20');
  assert.equal(findSpot('street:3-0-2').id, 'street:0-2-3');
  const t = table();
  t.act('ana', bet('split:18-17', 10));
  t.act('ana', bet('split:17-18', 10));
  assert.deepEqual(t.view('ana').players[0].bets, [{ spot: 'split:17-18', amount: 20 }]);
});

// ───────────────────────────── payouts ─────────────────────────────

test('payouts: every kind pays its standard odds when it wins and nothing when it loses', () => {
  const cases = [
    // [spot, winning number, losing number, chips returned per 10 staked]
    ['straight:17', 17, 18, 360],
    ['straight:0', 0, 1, 360],
    ['split:17-18', 18, 16, 180],
    ['split:17-20', 20, 23, 180],
    ['split:0-2', 0, 1, 180],
    ['street:16-17-18', 16, 19, 120],
    ['street:0-1-2', 0, 3, 120],
    ['street:0-2-3', 3, 1, 120],
    ['corner:16-17-19-20', 19, 18, 90],
    ['corner:0-1-2-3', 0, 4, 90],
    ['sixline:13-14-15-16-17-18', 15, 19, 60],
    ['column:1', 34, 35, 30],
    ['column:2', 2, 3, 30],
    ['column:3', 36, 0, 30],
    ['dozen:1', 12, 13, 30],
    ['dozen:2', 13, 25, 30],
    ['dozen:3', 36, 0, 30],
    ['red', 1, 2, 20],
    ['black', 2, 1, 20],
    ['even', 36, 35, 20],
    ['odd', 35, 36, 20],
    ['low', 18, 19, 20],
    ['high', 19, 18, 20],
  ];
  const kinds = new Set();
  for (const [spot, win, lose, back] of cases) {
    kinds.add(SPOTS.get(spot).kind);
    assert.equal(returned(spot, 10, win), back, `${spot} wins on ${win}`);
    assert.equal(returned(spot, 10, lose), 0, `${spot} loses on ${lose}`);
  }
  assert.deepEqual([...kinds].sort(), Object.keys(PAYOUTS).sort(), 'every bet kind is covered');
});

test('zero beats every outside bet', () => {
  for (const spot of ['red', 'black', 'even', 'odd', 'low', 'high', 'column:1', 'column:2', 'column:3', 'dozen:1', 'dozen:2', 'dozen:3']) {
    assert.equal(returned(spot, 10, 0), 0, spot);
  }
});

test('payoutOf agrees with an exhaustive check over all 37 numbers', () => {
  for (const spot of SPOTS.values()) {
    let total = 0;
    for (let n = 0; n <= 36; n += 1) {
      const paid = payoutOf(spot, 1, n);
      assert.equal(paid, spot.numbers.includes(n) ? spot.payout + 1 : 0);
      total += paid;
    }
    assert.equal(total, 36, `${spot.id}: 37 chips staked over the wheel return 36`);
  }
});

test('several bets by several players resolve independently', () => {
  const t = table({ ints: [17] });
  t.act('ana', bet('straight:17', 10)); // +360
  t.act('ana', bet('red', 100)); // 17 is black: lost
  t.act('ana', bet('split:17-18', 20)); // +360
  t.act('beto', bet('black', 50)); // +100
  t.act('beto', bet('dozen:3', 30)); // lost
  assert.equal(t.balance('ana'), 870);
  assert.equal(t.balance('beto'), 920);
  assert.equal(t.stake('ana'), 130);
  assert.equal(t.stake('beto'), 80);

  t.advance(TIMING.betting + TIMING.spinning);
  assert.equal(t.balance('ana'), 870 + 360 + 360);
  assert.equal(t.balance('beto'), 920 + 100);
  assert.equal(t.stake('ana'), 0);
  assert.equal(t.stake('beto'), 0);

  const { result } = t.view('ana');
  assert.equal(result.number, 17);
  assert.equal(result.color, 'black');
  assert.deepEqual(result.results, [
    { id: 'ana', name: 'Ana', avatar: 1, wagered: 130, won: 720, net: 590 },
    { id: 'beto', name: 'Beto', avatar: 2, wagered: 80, won: 100, net: 20 },
  ]);
  assert.deepEqual([...result.winningSpots].sort(), ['black', 'split:17-18', 'straight:17']);
  assert.equal(result.totalWagered, 210);
  assert.equal(result.totalWon, 820);
  assert.deepEqual(t.reports, [
    { playerId: 'ana', wagered: 130, won: 720 },
    { playerId: 'beto', wagered: 80, won: 100 },
  ]);
  assert.deepEqual(
    t.announcements.map((entry) => [entry.kind, entry.playerId, entry.amount]),
    [['win', 'ana', 590]],
    'only the notable win reaches the feed'
  );
});

// ───────────────────────────── validation ─────────────────────────────

test('limits: minimum and maximum per spot, table limit per player', () => {
  const t = table({ players: [{ id: 'ana', balance: 50000 }] });
  t.rejects('ana', bet('red', 4), /mínima/);
  t.rejects('ana', bet('red', 1), /mínima/);
  t.act('ana', bet('red', 5));
  t.act('ana', bet('red', 1)); // stacking: 6 on the spot is fine
  assert.equal(t.view('ana').players[0].bets[0].amount, 6);

  t.rejects('ana', bet('red', 1995), /máximo por casilla/); // 6 + 1995 > 2000
  t.act('ana', bet('red', 1994)); // exactly 2000
  t.rejects('ana', bet('red', 1), /máximo por casilla/);
  t.rejects('ana', bet('black', 2001), /máximo por casilla/);

  for (const spot of ['black', 'even', 'odd']) t.act('ana', bet(spot, 2000));
  t.act('ana', bet('low', 1995)); // total 9995
  t.rejects('ana', bet('high', 10), /límite de la mesa/);
  t.act('ana', bet('high', 5)); // total 10000: exactly the limit
  t.rejects('ana', bet('dozen:1', 5), /límite de la mesa/);
  assert.equal(t.stake('ana'), 10000);
  assert.equal(t.balance('ana'), 40000);
});

test('amounts must be positive integers the player can afford', () => {
  const t = table({ players: [{ id: 'ana', balance: 100 }] });
  for (const amount of [0, -5, -2000, 2.5, 5.000001, '10', null, true, [10], { n: 10 }, 1e21, Number.MAX_SAFE_INTEGER, 2 ** 53]) {
    t.rejects('ana', bet('red', amount));
  }
  t.rejects('ana', { type: 'bet', spot: 'red' }, /monto/);
  t.rejects('ana', bet('red', 101), /No te alcanzan/);
  t.act('ana', bet('red', 100));
  t.rejects('ana', bet('black', 5), /No te alcanzan/);
  assert.equal(t.balance('ana'), 0);
  assert.equal(t.stake('ana'), 100);
});

test('unknown spots, unknown actions and malformed actions are rejected without side effects', () => {
  const t = table();
  t.rejects('ana', bet('split:3-4', 10), /no existe en el paño/);
  t.rejects('ana', bet(undefined, 10), /no existe en el paño/);
  t.rejects('ana', bet({ toString: () => 'red' }, 10));
  t.rejects('ana', bet(['red'], 10));
  t.rejects('ana', { type: 'cheat', number: 17 }, /no existe/);
  t.rejects('ana', { type: 'spin' });
  t.rejects('ana', { type: 'resolve' });
  t.rejects('ana', { type: '__proto__' });
  t.rejects('ana', { type: 'ready', ready: 'yes' });
  t.rejects('ana', { type: 'ready' }, /Ahora no hay apuestas abiertas/);
  t.rejects('ana', { type: 'undo' }, /nada para deshacer/);
  t.rejects('ana', { type: 'clear' }, /No tenés apuestas/);
  t.rejects('ana', { type: 'rebet' }, /apuesta anterior/);
  assert.equal(t.view('ana').phase, 'idle');
  assert.equal(t.emits.length, 0);
  assert.equal(t.totalBalance(), 2000);
});

test('a spoofed playerId inside the action is ignored: the bet belongs to the sender', () => {
  const t = table();
  t.act('ana', { type: 'bet', spot: 'red', amount: 50, playerId: 'beto', id: 'beto', player: 'beto' });
  assert.equal(t.balance('ana'), 950);
  assert.equal(t.balance('beto'), 1000);
  assert.equal(t.stake('beto'), 0);
});

// ───────────────────────────── undo / clear / rebet ─────────────────────────────

test('undo removes the last chip, one at a time, and refunds it', () => {
  const t = table();
  t.act('ana', bet('red', 50));
  t.act('ana', bet('straight:7', 10));
  t.act('ana', bet('red', 25));
  assert.equal(t.balance('ana'), 915);

  t.act('ana', { type: 'undo' });
  assert.deepEqual(t.view('ana').players[0].bets, [
    { spot: 'red', amount: 50 },
    { spot: 'straight:7', amount: 10 },
  ]);
  assert.equal(t.balance('ana'), 940);

  t.act('ana', { type: 'undo' });
  assert.deepEqual(t.view('ana').players[0].bets, [{ spot: 'red', amount: 50 }]);
  t.act('ana', { type: 'undo' });
  assert.equal(t.balance('ana'), 1000);
  assert.equal(t.stake('ana'), 0);
  assert.equal(t.view('ana').phase, 'idle', 'an empty layout goes back to idle');
  t.rejects('ana', { type: 'undo' }, /nada para deshacer/);
  assert.deepEqual(t.emitted('unbet').map((event) => [event.amount, event.reason]), [
    [25, 'undo'],
    [10, 'undo'],
    [50, 'undo'],
  ]);
});

test('undo only touches my own chips', () => {
  const t = table();
  t.act('ana', bet('red', 50));
  t.act('beto', bet('red', 70));
  t.act('ana', { type: 'undo' });
  assert.equal(t.stake('beto'), 70);
  assert.equal(t.view('ana').phase, 'betting', 'Beto still has chips down');
  t.rejects('ana', { type: 'undo' });
});

test('clear refunds everything I placed', () => {
  const t = table();
  t.act('ana', bet('red', 50));
  t.act('ana', bet('straight:7', 10));
  t.act('beto', bet('black', 30));
  t.act('ana', { type: 'clear' });
  assert.equal(t.balance('ana'), 1000);
  assert.equal(t.stake('ana'), 0);
  assert.equal(t.stake('beto'), 30);
  assert.deepEqual(t.view('ana').players[0].bets, []);
  t.rejects('ana', { type: 'clear' }, /No tenés apuestas/);
  t.rejects('ana', { type: 'undo' }, /nada para deshacer/);
});

test('the countdown stops when the layout is emptied and restarts with the next chip', () => {
  const t = table({ ints: [5] });
  t.act('ana', bet('red', 50));
  t.advance(TIMING.betting - 1000);
  t.act('ana', { type: 'clear' });
  assert.equal(t.view('ana').phase, 'idle');
  assert.equal(t.view('ana').deadline, null);
  t.advance(TIMING.betting * 3);
  assert.equal(t.view('ana').phase, 'idle', 'no spin on an empty table');
  assert.equal(t.rng.calls.length, 0, 'and no number drawn');

  t.act('ana', bet('red', 50));
  const view = t.view('ana');
  assert.equal(view.phase, 'betting');
  assert.equal(view.deadline, t.now() + TIMING.betting, 'a full fresh countdown');
});

test('rebet repeats the previous round as a single undoable step', () => {
  const t = table({ ints: [1, 2] });
  t.rejects('ana', { type: 'rebet' }, /apuesta anterior/);
  t.act('ana', bet('red', 50));
  t.act('ana', bet('straight:7', 10));
  t.advance(TIMING.betting + TIMING.spinning + TIMING.result); // 1 is red: +100
  assert.equal(t.balance('ana'), 1040);
  assert.equal(t.view('ana').phase, 'idle');
  assert.equal(t.view('ana').you.canRebet, true);
  assert.equal(t.view('ana').you.rebetTotal, 60);

  t.act('ana', { type: 'rebet' });
  assert.equal(t.balance('ana'), 980);
  assert.equal(t.view('ana').phase, 'betting');
  assert.deepEqual(t.view('ana').players[0].bets, [
    { spot: 'red', amount: 50 },
    { spot: 'straight:7', amount: 10 },
  ]);
  assert.deepEqual(t.emitted('rebet'), [{ playerId: 'ana', amount: 60 }]);
  t.rejects('ana', { type: 'rebet' }, /primero retirá/);

  t.act('ana', { type: 'undo' }); // the whole rebet comes back
  assert.equal(t.balance('ana'), 1040);
  assert.equal(t.stake('ana'), 0);

  t.act('ana', { type: 'rebet' });
  t.act('ana', bet('black', 5));
  t.advance(TIMING.betting + TIMING.spinning + TIMING.result); // 2 is black
  assert.equal(t.view('ana').you.rebetTotal, 65, 'rebet now remembers the latest round');
});

test('rebet needs enough chips for the whole previous bet (all or nothing)', () => {
  const t = table({ ints: [2], players: [{ id: 'ana', balance: 100 }] });
  t.act('ana', bet('red', 100));
  t.advance(TIMING.betting + TIMING.spinning + TIMING.result); // black: lost everything
  assert.equal(t.balance('ana'), 0);
  t.rejects('ana', { type: 'rebet' }, /Necesitás 100 fichas/);
  t.setBalance('ana', 99);
  t.rejects('ana', { type: 'rebet' }, /Necesitás 100 fichas/);
  t.setBalance('ana', 100);
  t.act('ana', { type: 'rebet' });
  assert.equal(t.balance('ana'), 0);
  assert.equal(t.stake('ana'), 100);
});

// ───────────────────────────── phases ─────────────────────────────

test('phase flow: idle -> betting -> spinning -> result -> idle, with deadlines', () => {
  const t = table({ ints: [32] });
  const start = t.now();
  let view = t.view('ana');
  assert.equal(view.phase, 'idle');
  assert.equal(view.deadline, null);
  assert.equal(view.duration, null);
  assert.equal(view.number, null);
  assert.equal(view.round, 1);
  assert.equal(view.result, null);
  assert.deepEqual(view.history, []);
  assert.deepEqual(view.limits, { minBet: 5, maxBet: 2000, tableLimit: 10000 });

  t.act('ana', bet('red', 100));
  view = t.view('ana');
  assert.equal(view.phase, 'betting');
  assert.equal(view.deadline, start + TIMING.betting);
  assert.equal(view.duration, TIMING.betting);
  assert.equal(view.number, null);

  t.advance(10000);
  t.act('beto', bet('black', 100)); // a late chip does not extend the countdown
  assert.equal(t.view('beto').deadline, start + TIMING.betting);

  t.advance(TIMING.betting - 10000 - 1);
  assert.equal(t.view('ana').phase, 'betting');
  t.advance(1);
  view = t.view('ana');
  assert.equal(view.phase, 'spinning');
  assert.equal(view.number, 32, 'the number is public once the wheel spins');
  assert.equal(view.deadline, start + TIMING.betting + TIMING.spinning);
  assert.equal(view.duration, TIMING.spinning);
  assert.deepEqual(t.emitted('spin'), [{ round: 1, number: 32, duration: TIMING.spinning }]);
  assert.equal(t.balance('ana'), 900, 'nothing is paid while the ball is rolling');
  assert.equal(t.stake('ana'), 100);
  assert.equal(view.result, null);
  assert.deepEqual(view.history, []);

  t.advance(TIMING.spinning);
  view = t.view('ana');
  assert.equal(view.phase, 'result');
  assert.equal(view.number, 32);
  assert.equal(view.deadline, start + TIMING.betting + TIMING.spinning + TIMING.result);
  assert.equal(view.result.number, 32);
  assert.equal(view.result.color, 'red');
  assert.deepEqual(view.history, [32]);
  assert.equal(t.balance('ana'), 1100);
  assert.equal(t.balance('beto'), 900);
  assert.equal(t.stake('ana'), 0, 'paid chips are no longer at stake');
  assert.equal(view.players[0].bets.length, 1, 'but the layout is still shown during the result');
  assert.equal(t.emitted('result').length, 1);
  assert.equal(t.emitted('result')[0].number, 32);

  t.advance(TIMING.result);
  view = t.view('ana');
  assert.equal(view.phase, 'idle');
  assert.equal(view.round, 2);
  assert.equal(view.number, null);
  assert.equal(view.deadline, null);
  assert.deepEqual(view.players.map((player) => player.bets), [[], []]);
  assert.equal(view.result.number, 32, 'the last result stays available');
  assert.deepEqual(view.history, [32]);
  assert.deepEqual(t.rng.calls.map((call) => [call.fn, call.min, call.max]), [['int', 0, 37]], 'one draw per round');
});

test('bets are locked while spinning and during the result', () => {
  const t = table({ ints: [0] });
  t.act('ana', bet('red', 100));
  t.advance(TIMING.betting);
  for (const action of [bet('black', 10), { type: 'undo' }, { type: 'clear' }, { type: 'rebet' }]) {
    t.rejects('ana', action, /No va más/);
    t.rejects('beto', action, /No va más/);
  }
  t.rejects('ana', { type: 'ready' }, /no hay apuestas abiertas/);
  t.advance(TIMING.spinning);
  assert.equal(t.view('ana').phase, 'result');
  t.rejects('ana', bet('black', 10), /No va más/);
  t.rejects('ana', { type: 'undo' }, /No va más/);
  assert.equal(t.balance('ana'), 900, 'zero: the house wins');
});

test('ready: the wheel spins as soon as every seated bettor is ready', () => {
  const t = table({ ints: [9] });
  t.rejects('ana', { type: 'ready' });
  t.act('ana', bet('red', 10));
  t.act('beto', bet('black', 10));
  t.rejects('ana', { type: 'ready', ready: 1 });

  t.act('ana', { type: 'ready' });
  assert.equal(t.view('ana').phase, 'betting', 'Beto is not ready yet');
  assert.equal(t.view('ana').you.ready, true);
  assert.equal(t.view('beto').you.ready, false);
  assert.equal(t.view('beto').players[0].ready, true, 'everybody sees who is ready');

  // A ready player cannot touch the bets until un-readying.
  t.rejects('ana', bet('red', 10), /Listo/);
  t.rejects('ana', { type: 'undo' }, /Listo/);
  t.rejects('ana', { type: 'clear' }, /Listo/);
  t.act('ana', { type: 'ready', ready: false });
  t.act('ana', bet('red', 10));
  t.act('ana', { type: 'ready', ready: true });

  t.act('beto', { type: 'ready' });
  assert.equal(t.view('ana').phase, 'spinning', 'no need to wait for the countdown');
  assert.equal(t.view('ana').number, 9);
  t.advance(TIMING.spinning);
  assert.equal(t.balance('ana'), 1020);
  t.advance(TIMING.result);
  assert.equal(t.view('ana').you.ready, false, 'ready flags reset every round');
});

test('ready: spectators without chips do not hold up the spin', () => {
  const t = table({ ints: [9] });
  t.act('ana', bet('red', 10));
  t.rejects('beto', { type: 'ready' }, /Primero poné una ficha/);
  t.act('ana', { type: 'ready' });
  assert.equal(t.view('ana').phase, 'spinning');
});

test('the old betting timer does not fire a second spin after an early one', () => {
  const t = table({ ints: [9, 11] });
  t.act('ana', bet('red', 10));
  t.act('ana', { type: 'ready' });
  t.advance(TIMING.spinning + TIMING.result); // round 1 over
  t.act('ana', bet('red', 10)); // round 2 betting opens
  t.advance(TIMING.betting - TIMING.spinning - TIMING.result - 1);
  assert.equal(t.view('ana').phase, 'betting', 'round 1 timer was cancelled; round 2 has its own full countdown');
  assert.equal(t.rng.calls.length, 1);
});

test('view flags tell the client which buttons to enable', () => {
  const t = table({ ints: [4] });
  assert.deepEqual(t.view('ana').you, {
    ready: false, canBet: true, canUndo: false, canClear: false, canRebet: false, canReady: false, rebetTotal: 0,
  });
  t.act('ana', bet('red', 10));
  assert.deepEqual(t.view('ana').you, {
    ready: false, canBet: true, canUndo: true, canClear: true, canRebet: false, canReady: true, rebetTotal: 0,
  });
  assert.deepEqual(t.view('beto').you, {
    ready: false, canBet: true, canUndo: false, canClear: false, canRebet: false, canReady: false, rebetTotal: 0,
  });
  t.act('beto', bet('black', 10));
  t.act('ana', { type: 'ready' });
  assert.deepEqual(t.view('ana').you, {
    ready: true, canBet: false, canUndo: false, canClear: false, canRebet: false, canReady: true, rebetTotal: 0,
  });
  t.act('beto', { type: 'ready' }); // everybody ready: the wheel spins
  assert.deepEqual(t.view('ana').you, {
    ready: true, canBet: false, canUndo: false, canClear: false, canRebet: false, canReady: false, rebetTotal: 0,
  });
  t.advance(TIMING.spinning + TIMING.result);
  assert.deepEqual(t.view('ana').you, {
    ready: false, canBet: true, canUndo: false, canClear: false, canRebet: true, canReady: false, rebetTotal: 10,
  });
});

test('everybody sees everybody: per-player bets, totals and identical public state', () => {
  const t = table();
  t.act('ana', bet('red', 50));
  t.act('ana', bet('straight:7', 10));
  t.act('beto', bet('red', 25));
  const ana = t.view('ana');
  const beto = t.view('beto');

  assert.deepEqual(ana.players, [
    { id: 'ana', name: 'Ana', avatar: 1, seated: true, connected: true, ready: false, total: 60,
      bets: [{ spot: 'red', amount: 50 }, { spot: 'straight:7', amount: 10 }] },
    { id: 'beto', name: 'Beto', avatar: 2, seated: true, connected: true, ready: false, total: 25,
      bets: [{ spot: 'red', amount: 25 }] },
  ]);
  assert.deepEqual(ana.players, beto.players);
  assert.deepEqual(ana.totals, { table: 85, you: 60 });
  assert.deepEqual(beto.totals, { table: 85, you: 25 });
  assert.deepEqual(
    t.emitted('bet'),
    [
      { playerId: 'ana', spot: 'red', amount: 50 },
      { playerId: 'ana', spot: 'straight:7', amount: 10 },
      { playerId: 'beto', spot: 'red', amount: 25 },
    ]
  );
  assert.ok(t.emits.every((event) => event.to === null), 'table events go to everybody');
});

test('history keeps the last 15 numbers, newest first', () => {
  const numbers = Array.from({ length: 18 }, (_, i) => i);
  const t = table({ ints: numbers, players: [{ id: 'ana', balance: 100000 }] });
  for (let i = 0; i < numbers.length; i += 1) {
    t.act('ana', bet('red', 5));
    t.act('ana', { type: 'ready' });
    t.advance(TIMING.spinning + TIMING.result);
  }
  const view = t.view('ana');
  assert.equal(view.history.length, 15);
  assert.deepEqual(view.history, [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(view.round, 19);
});

// ───────────────────────────── leaving ─────────────────────────────

test('a player who leaves mid-round keeps the bets and gets paid', () => {
  const t = table({ ints: [3] });
  t.act('ana', bet('red', 100)); // 3 is red
  t.act('beto', bet('black', 40));
  t.leave('ana');
  assert.equal(t.stake('ana'), 100, 'still at stake after leaving');

  const view = t.view('beto');
  assert.deepEqual(view.players.map((player) => [player.id, player.seated, player.total]), [
    ['beto', true, 40],
    ['ana', false, 100],
  ]);
  assert.equal(view.players[1].name, 'Ana', 'the view carries the name of absent bettors');

  t.advance(TIMING.betting + TIMING.spinning);
  assert.equal(t.balance('ana'), 1100);
  assert.equal(t.stake('ana'), 0);
  assert.deepEqual(t.reports.map((report) => report.playerId).sort(), ['ana', 'beto']);
  t.advance(TIMING.result);
  assert.deepEqual(t.view('beto').players.map((player) => player.id), ['beto'], 'gone from the table next round');
});

test('a ready table does not wait for a bettor who left', () => {
  const t = table({ ints: [3] });
  t.act('ana', bet('red', 100));
  t.act('beto', bet('black', 40));
  t.act('beto', { type: 'ready' });
  assert.equal(t.view('beto').phase, 'betting');
  t.leave('ana');
  assert.equal(t.view('beto').phase, 'spinning', 'Ana left: everyone still seated is ready');
  t.advance(TIMING.spinning);
  assert.equal(t.balance('ana'), 1100);
});

test('if every bettor leaves, the round still resolves when the countdown ends', () => {
  const t = table({ ints: [3] });
  t.act('ana', bet('red', 100));
  t.leave('ana');
  assert.equal(t.view('beto').phase, 'betting');
  t.leave('beto');
  t.advance(TIMING.betting + TIMING.spinning + TIMING.result);
  assert.equal(t.balance('ana'), 1100);
  assert.equal(t.game.view('ana').phase, 'idle');
});

test('a player who comes back can rebet what they played before leaving', () => {
  const t = table({ ints: [3] });
  t.act('ana', bet('red', 100));
  t.leave('ana');
  t.advance(TIMING.betting + TIMING.spinning + TIMING.result);
  t.sit('ana');
  t.act('ana', { type: 'rebet' });
  assert.equal(t.stake('ana'), 100);
});

test('disconnected players are flagged in the view', () => {
  const t = table();
  t.setConnected('beto', false);
  assert.deepEqual(t.view('ana').players.map((player) => player.connected), [true, false]);
});

// ───────────────────────────── conservation ─────────────────────────────

test('chip conservation: balances + stakes only change by house results', () => {
  const t = table({ ints: [17, 0, 36], players: [{ id: 'ana', balance: 3000 }, { id: 'beto', balance: 3000 }] });
  const start = t.chips();
  const script = [
    ['ana', bet('straight:17', 100)],
    ['beto', bet('red', 200)],
    ['ana', bet('corner:16-17-19-20', 40)],
    ['ana', { type: 'undo' }],
    ['beto', bet('dozen:2', 60)],
    ['beto', { type: 'clear' }],
    ['beto', bet('black', 500)],
    ['ana', bet('split:17-18', 20)],
  ];
  for (const [who, action] of script) {
    t.act(who, action);
    assert.equal(t.chips(), start, `after ${JSON.stringify(action)}`);
  }
  t.rejects('ana', bet('red', 100000));
  assert.equal(t.chips(), start);

  t.advance(TIMING.betting);
  assert.equal(t.chips(), start, 'spinning: nothing paid yet, stakes still counted');
  t.advance(TIMING.spinning);

  const { result } = t.view('ana');
  assert.equal(t.chips(), start - result.totalWagered + result.totalWon);
  const debits = t.ledger.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + entry.amount, 0);
  const credits = t.ledger.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.amount, 0);
  assert.equal(t.totalBalance(), 6000 - debits + credits, 'every chip moved through ctx.debit / ctx.credit');
  // 17: straight 100 -> 3600, split 20 -> 360, black 500 -> 1000
  assert.equal(result.totalWon, 3600 + 360 + 1000);
  assert.equal(result.totalWagered, 100 + 20 + 500);
});

test('a long random session never creates or destroys chips', () => {
  const t = createTable(roulette, {
    fallback: 'random',
    players: [
      { id: 'ana', balance: 20000 },
      { id: 'beto', balance: 20000 },
      { id: 'caro', balance: 20000 },
    ],
  });
  const spots = [...SPOTS.keys()];
  let seed = 12345;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let expected = t.chips();
  for (let roundIndex = 0; roundIndex < 60; roundIndex += 1) {
    for (let i = 0; i < 12; i += 1) {
      const who = ['ana', 'beto', 'caro'][next(3)];
      const roll = next(10);
      const action =
        roll < 7 ? bet(spots[next(spots.length)], [5, 25, 100, 500][next(4)]) : roll < 9 ? { type: 'undo' } : { type: 'clear' };
      try {
        t.act(who, action);
      } catch (err) {
        assert.equal(err.name, 'GameError', err.stack);
      }
      assert.equal(t.chips(), expected);
    }
    if (t.view('ana').phase === 'idle') continue;
    t.advance(TIMING.betting + TIMING.spinning);
    const { result } = t.view('ana');
    expected += result.totalWon - result.totalWagered;
    assert.equal(t.chips(), expected);
    for (const player of ['ana', 'beto', 'caro']) {
      assert.ok(t.balance(player) >= 0);
      assert.equal(t.stake(player), 0);
    }
    t.advance(TIMING.result);
  }
});
