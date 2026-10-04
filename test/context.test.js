'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeCtx, GameError } = require('./helpers/fakeCtx');
const { resolveTimeScale, resolveConfig } = require('../server/config');

function setup(options = {}) {
  return createFakeCtx({
    meta: { id: 'ruleta', name: 'Ruleta' },
    players: [
      { id: 'ana', name: 'Ana', avatar: 3, balance: 1000 },
      { id: 'beto', name: 'Beto', balance: 50, connected: false },
      { id: 'caro', name: 'Caro', balance: 0, seated: false },
    ],
    ...options,
  });
}

test('seated() / player() / balance() expose only the public shape', () => {
  const fake = setup();
  const { ctx } = fake;
  assert.deepEqual(ctx.seated(), [
    { id: 'ana', name: 'Ana', avatar: 3, balance: 1000, connected: true },
    { id: 'beto', name: 'Beto', avatar: 0, balance: 50, connected: false },
  ]);
  assert.deepEqual(ctx.player('caro'), { id: 'caro', name: 'Caro', avatar: 0, balance: 0, connected: true });
  assert.equal(ctx.player('nobody'), null);
  assert.equal(ctx.player(undefined), null);
  assert.equal(ctx.balance('ana'), 1000);
  assert.equal(ctx.balance('nobody'), 0);

  // Returned objects are copies: mutating them cannot touch the wallet.
  ctx.seated()[0].balance = 999999;
  ctx.player('ana').balance = 999999;
  assert.equal(ctx.balance('ana'), 1000);
  assert.ok(Object.isFrozen(ctx), 'plugins cannot monkey-patch the context');
});

test('debit() charges only when the player can afford it', () => {
  const { ctx } = setup();
  assert.equal(ctx.debit('ana', 400), true);
  assert.equal(ctx.balance('ana'), 600);
  assert.equal(ctx.debit('ana', 601), false);
  assert.equal(ctx.balance('ana'), 600, 'a refused debit charges nothing');
  assert.equal(ctx.debit('ana', 600), true);
  assert.equal(ctx.balance('ana'), 0, 'balance can reach zero but never go below');
  assert.equal(ctx.debit('ana', 1), false);
  assert.equal(ctx.debit('nobody', 1), false);
});

test('debit() and credit() reject amounts that are not valid chip counts', () => {
  const { ctx } = setup();
  for (const bad of [0, -5, 1.5, NaN, Infinity, '10', null, undefined, 2 ** 60]) {
    assert.throws(() => ctx.debit('ana', bad), RangeError, `debit ${bad}`);
  }
  for (const bad of [-1, 2.5, NaN, Infinity, '10', null, undefined, 2 ** 60]) {
    assert.throws(() => ctx.credit('ana', bad), RangeError, `credit ${bad}`);
  }
  assert.equal(ctx.balance('ana'), 1000);
  ctx.credit('ana', 0);
  ctx.credit('ana', 250);
  assert.equal(ctx.balance('ana'), 1250);
});

test('credit() to an unknown player is logged, not thrown (a payout loop must finish)', () => {
  const fake = setup();
  fake.ctx.credit('ghost', 100);
  assert.equal(fake.errors.length, 1);
  assert.match(String(fake.errors[0][0]), /unknown player/);
  assert.equal(fake.totalBalance(), 1050);
});

test('after() fires once, in order, scaled, and can be cancelled', () => {
  const fake = setup({ timeScale: 0.5 });
  const fired = [];
  fake.ctx.after(1000, () => fired.push('a'));
  const b = fake.ctx.after(2000, () => fired.push('b'));
  fake.ctx.after(3000, () => fired.push('c'));
  fake.advance(499);
  assert.deepEqual(fired, []);
  fake.advance(1);
  assert.deepEqual(fired, ['a'], '1000 ms * 0.5 = 500 ms');
  b.cancel();
  b.cancel();
  fake.advance(5000);
  assert.deepEqual(fired, ['a', 'c']);
  assert.throws(() => fake.ctx.after(100, 'nope'), TypeError);
  assert.throws(() => fake.ctx.after(-1, () => {}), RangeError);
  assert.throws(() => fake.ctx.after(NaN, () => {}), RangeError);
});

test('deadline() is consistent with after() and now()', () => {
  const fake = setup({ timeScale: 0.1 });
  const start = fake.ctx.now();
  const deadline = fake.ctx.deadline(30000);
  assert.equal(deadline, start + 3000);
  let firedAt = null;
  fake.ctx.after(30000, () => {
    firedAt = fake.ctx.now();
  });
  fake.advance(10000);
  assert.equal(firedAt, deadline, 'the timer fires exactly at the advertised deadline');
});

test('a timer that throws is caught and logged; later timers still run', () => {
  const fake = setup({ strictErrors: false });
  const fired = [];
  fake.ctx.after(10, () => {
    throw new Error('kaboom');
  });
  fake.ctx.after(20, () => fired.push('survivor'));
  fake.advance(100);
  assert.deepEqual(fired, ['survivor']);
  assert.equal(fake.errors.length, 1);

  const strict = setup();
  strict.ctx.after(10, () => {
    throw new Error('kaboom');
  });
  assert.throws(() => strict.advance(100), /kaboom/, 'the fake surfaces timer exceptions by default');
});

test('timers push a sync when they finish (safety net)', () => {
  const fake = setup();
  fake.ctx.after(10, () => {});
  assert.equal(fake.syncs, 0);
  fake.advance(10);
  assert.equal(fake.syncs, 1);
});

test('dispose() cancels pending timers and silences the context', () => {
  const fake = setup();
  let fired = false;
  fake.ctx.after(10, () => {
    fired = true;
  });
  fake.dispose();
  fake.advance(1000);
  assert.equal(fired, false);
  const late = fake.ctx.after(10, () => {
    fired = true;
  });
  fake.advance(1000);
  late.cancel();
  assert.equal(fired, false, 'timers created after dispose never fire');
  fake.ctx.sync();
  fake.ctx.emit('x', {});
  fake.ctx.announce('hola');
  assert.equal(fake.syncs, 0);
  assert.equal(fake.emits.length, 0);
  assert.equal(fake.announcements.length, 0);
});

test('emit() snapshots the payload and validates the event name', () => {
  const fake = setup();
  const payload = { cards: ['AS'] };
  fake.ctx.emit('deal', payload);
  payload.cards.push('KH');
  fake.ctx.emit('private', { secret: 1 }, 'ana');
  fake.ctx.emit('bare');
  assert.deepEqual(fake.emits, [
    { name: 'deal', payload: { cards: ['AS'] }, to: null },
    { name: 'private', payload: { secret: 1 }, to: 'ana' },
    { name: 'bare', payload: null, to: null },
  ]);
  assert.deepEqual(fake.emitted('deal'), [{ cards: ['AS'] }]);
  assert.throws(() => fake.ctx.emit('', {}), TypeError);
  assert.throws(() => fake.ctx.emit(42, {}), TypeError);
  assert.throws(() => fake.ctx.emit('has space', {}), TypeError);
});

test('report() accumulates stats', () => {
  const fake = setup();
  fake.ctx.report('ana', { wagered: 100, won: 0 });
  fake.ctx.report('ana', { wagered: 100, won: 300 });
  fake.ctx.report('ana', { wagered: 50, won: 50 });
  assert.deepEqual(fake.stats('ana'), { rounds: 3, wagered: 250, won: 350, biggestWin: 200 });
  assert.deepEqual(fake.stats('beto'), { rounds: 0, wagered: 0, won: 0, biggestWin: 0 });
  assert.equal(fake.reports.length, 3);
});

test('report() announces notable wins only', () => {
  const fake = setup();
  const { ctx } = fake;
  ctx.report('ana', { wagered: 100, won: 0 }); // loss
  ctx.report('ana', { wagered: 100, won: 200 }); // +100: not notable
  ctx.report('ana', { wagered: 1, won: 36 }); // 36x but only +35: pocket change
  assert.equal(fake.announcements.length, 0);

  ctx.report('ana', { wagered: 500, won: 1000 }); // +500
  ctx.report('ana', { wagered: 5, won: 180 }); // 36x, +175
  ctx.report('ana', { wagered: 2000, won: 72000 }); // +70.000: big
  assert.deepEqual(
    fake.announcements.map((entry) => [entry.kind, entry.amount, entry.playerId]),
    [
      ['win', 500, 'ana'],
      ['win', 175, 'ana'],
      ['bigwin', 70000, 'ana'],
    ]
  );
  assert.equal(fake.announcements[0].text, 'Ana ganó 500 fichas en Ruleta');
  assert.match(fake.announcements[2].text, /Ana .*Ruleta.*70\.000 fichas/);
});

test('report() with garbage is logged and ignored', () => {
  const fake = setup({ strictErrors: false });
  fake.ctx.report('ana', { wagered: -1, won: 10 });
  fake.ctx.report('ana', { wagered: 10, won: 2.5 });
  fake.ctx.report('ana', null);
  fake.ctx.report('ghost', { wagered: 1, won: 1 });
  assert.equal(fake.errors.length, 4);
  assert.deepEqual(fake.stats('ana'), { rounds: 0, wagered: 0, won: 0, biggestWin: 0 });
});

test('announce() validates and normalises feed lines', () => {
  const fake = setup({ strictErrors: false });
  fake.ctx.announce('  ¡Pozo acumulado!  ', { kind: 'jackpot', playerId: 'ana', amount: 5000 });
  fake.ctx.announce('Sin opciones');
  fake.ctx.announce('x'.repeat(500), { amount: 1.5 });
  assert.deepEqual(fake.announcements[0], { kind: 'jackpot', text: '¡Pozo acumulado!', playerId: 'ana', amount: 5000 });
  assert.deepEqual(fake.announcements[1], { kind: 'info', text: 'Sin opciones', playerId: null, amount: null });
  assert.equal(fake.announcements[2].text.length, 200);
  assert.equal(fake.announcements[2].amount, null);

  fake.ctx.announce('', {});
  fake.ctx.announce(42);
  fake.ctx.announce('hola', { kind: 'NOT A KIND' });
  assert.equal(fake.announcements.length, 3);
  assert.equal(fake.errors.length, 3);
});

test('error() builds a GameError carrying the Spanish message', () => {
  const { ctx } = setup();
  const err = ctx.error('Mesa llena');
  assert.ok(err instanceof GameError);
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'Mesa llena');
  assert.equal(err.code, 'game');
  assert.equal(ctx.error().message, 'Jugada inválida.');
});

test('the fake keeps a ledger of chip movements', () => {
  const fake = setup();
  fake.ctx.debit('ana', 100);
  fake.ctx.debit('ana', 5000); // refused
  fake.ctx.credit('beto', 30);
  assert.deepEqual(fake.ledger, [
    { type: 'debit', id: 'ana', amount: 100 },
    { type: 'credit', id: 'beto', amount: 30 },
  ]);
  fake.clearLog();
  assert.equal(fake.ledger.length, 0);
  assert.equal(fake.balance('ana'), 900, 'clearLog keeps balances');
});

test('resolveTimeScale() prefers the explicit value, then the environment', () => {
  const saved = process.env.CASINO_TIME_SCALE;
  try {
    delete process.env.CASINO_TIME_SCALE;
    assert.equal(resolveTimeScale(), 1);
    assert.equal(resolveTimeScale(0.25), 0.25);
    assert.equal(resolveTimeScale(-3), 1);
    assert.equal(resolveTimeScale('abc'), 1);
    process.env.CASINO_TIME_SCALE = '0.05';
    assert.equal(resolveTimeScale(), 0.05);
    assert.equal(resolveTimeScale(2), 2);
    process.env.CASINO_TIME_SCALE = 'nonsense';
    assert.equal(resolveTimeScale(), 1);
  } finally {
    if (saved === undefined) delete process.env.CASINO_TIME_SCALE;
    else process.env.CASINO_TIME_SCALE = saved;
  }
});

test('resolveConfig() rejects typos and invalid values', () => {
  assert.equal(resolveConfig().START_BALANCE, 1000);
  assert.equal(resolveConfig({ MAX_PLAYERS: 3 }).MAX_PLAYERS, 3);
  assert.throws(() => resolveConfig({ MAX_PLAYER: 3 }), /Unknown config key/);
  assert.throws(() => resolveConfig({ MAX_PLAYERS: '3' }), /must be a non-negative number/);
  assert.throws(() => resolveConfig({ MAX_PLAYERS: -1 }), /must be a non-negative number/);
});
