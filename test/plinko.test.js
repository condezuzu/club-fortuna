'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const plinko = require('../server/games/plinko');
const { createTable } = require('./helpers/fakeCtx');

const { TABLES, ROWS, RISKS, MAX_BALLS, STEP_MS, LAND_MS, payoutOf } = plinko.internals;
const fallTime = (rows) => rows * STEP_MS + LAND_MS;
const drop = (bet, rows, risk) => ({ type: 'drop', bet, rows, risk });

function choose(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

test('tables: one slot more than rows, symmetric, and about 99 % back on average', () => {
  for (const rows of ROWS) {
    for (const risk of RISKS) {
      const table = TABLES[rows][risk];
      assert.equal(table.length, rows + 1);
      assert.deepEqual(table, table.slice().reverse(), `${rows} ${risk} is symmetric`);
      assert.ok(table.every((tenths) => Number.isInteger(tenths) && tenths > 0));
      let back = 0;
      for (let slot = 0; slot <= rows; slot += 1) back += (choose(rows, slot) / 2 ** rows) * (table[slot] / 10);
      assert.ok(back > 0.97 && back < 1, `${rows} ${risk} returns ${back.toFixed(4)}`);
    }
    const edge = (risk) => TABLES[rows][risk][0];
    const middle = (risk) => TABLES[rows][risk][rows / 2];
    assert.ok(edge('low') < edge('medium') && edge('medium') < edge('high'), 'more risk, bigger edges');
    assert.ok(middle('low') >= middle('medium') && middle('medium') >= middle('high'), 'more risk, emptier middle');
  }
});

test('a ball: the path decides the slot, the bet leaves at once and the prize arrives when it lands', () => {
  const table = createTable(plinko, { players: [{ id: 'ana', balance: 1000 }], ints: [1, 1, 1, 1, 1, 1, 1, 1] });
  table.act('ana', drop(100, 8, 'medium'));
  assert.equal(table.balance('ana'), 900);
  assert.equal(table.stake('ana'), 100);
  const [ball] = table.emitted('drop');
  assert.equal(ball.path, 'RRRRRRRR');
  assert.equal(ball.slot, 8);
  assert.equal(ball.mult, 13);
  assert.equal(ball.win, 1300);
  assert.equal(ball.duration, fallTime(8));
  assert.equal(table.view('ana').flying, 1);
  assert.deepEqual(table.view('ana').recent, [], 'nothing is revealed in the view before it lands');

  table.advance(fallTime(8) - 1);
  assert.equal(table.balance('ana'), 900);
  table.advance(1);
  assert.equal(table.balance('ana'), 900 + 1300);
  assert.equal(table.stake('ana'), 0);
  const view = table.view('ana');
  assert.equal(view.flying, 0);
  assert.equal(view.recent[0].mult, 13);
  assert.equal(view.recent[0].win, 1300);
});

test('the middle of a high-risk board pays a fifth; payouts round down', () => {
  const ints = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]; // 6 rights out of 12
  const table = createTable(plinko, { players: [{ id: 'ana', balance: 1000 }], ints });
  table.act('ana', drop(7, 12, 'high'));
  const [ball] = table.emitted('drop');
  assert.equal(ball.slot, 6);
  assert.equal(ball.mult, 0.2);
  assert.equal(ball.win, 1, 'floor(7 x 0.2)');
  assert.equal(payoutOf(7, 12, 'high', 6), 1);
  table.advance(fallTime(12));
  assert.equal(table.balance('ana'), 1000 - 7 + 1);
});

test('several balls in the air, up to a limit, each paid on its own landing', () => {
  const table = createTable(plinko, { players: [{ id: 'ana', balance: 5000 }], fallback: 'min' });
  for (let i = 0; i < MAX_BALLS; i += 1) table.act('ana', drop(10, 8, 'low'));
  assert.equal(table.view('ana').flying, MAX_BALLS);
  assert.equal(table.stake('ana'), 10 * MAX_BALLS);
  assert.throws(() => table.act('ana', drop(10, 8, 'low')), /Esperá/);
  table.advance(fallTime(8));
  assert.equal(table.view('ana').flying, 0);
  // every ball went all the way left: 5.6x on a low-risk board of 8 rows
  assert.equal(table.balance('ana'), 5000 - 10 * MAX_BALLS + 56 * MAX_BALLS);
  table.act('ana', drop(10, 8, 'low'));
  assert.equal(table.view('ana').flying, 1);
});

test('everybody at the table sees every ball; a ball outlives its owner leaving the table', () => {
  const table = createTable(plinko, { players: [{ id: 'ana', balance: 100 }, { id: 'beto', balance: 100 }], fallback: 'min' });
  table.act('beto', drop(10, 16, 'high'));
  const [ball] = table.emitted('drop');
  assert.equal(ball.playerId, 'beto');
  assert.equal(ball.mult, 1000);
  assert.equal(table.view('ana').flying, 0, 'flying counts only my own balls');
  table.leave('beto');
  table.advance(fallTime(16));
  assert.equal(table.balance('beto'), 90 + 10000);
  assert.equal(table.view('ana').recent[0].playerId, 'beto');
});

test('hostile drops are refused and cost nothing', () => {
  const table = createTable(plinko, { players: [{ id: 'ana', balance: 100 }], fallback: 'min' });
  const bad = [
    drop(4, 8, 'low'),
    drop(501, 8, 'low'),
    drop(10.5, 8, 'low'),
    drop('10', 8, 'low'),
    drop(-10, 8, 'low'),
    drop(10, 9, 'low'),
    drop(10, '8', 'low'),
    drop(10, 8, 'extreme'),
    drop(10, 'constructor', 'length'),
    drop(10, 8, '__proto__'),
    drop(200, 8, 'low'), // more than the balance
    { type: 'drop' },
    { type: 'tilt' },
  ];
  for (const action of bad) assert.throws(() => table.act('ana', action), undefined, JSON.stringify(action));
  assert.equal(table.balance('ana'), 100);
  assert.equal(table.emitted('drop').length, 0);
});
