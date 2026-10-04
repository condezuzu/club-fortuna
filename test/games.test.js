'use strict';

/**
 * Game registry + a conformance check that runs against EVERY plugin found in
 * server/games. Drop a new game file there and it is automatically held to the
 * plugin contract (docs/GAME_API.md) by this file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadGames, validatePlugin, validateInstance } = require('../server/games');
const { createTable, GameError } = require('./helpers/fakeCtx');
const { createSilentLog } = require('./helpers/fakeHub');

const BROKEN_DIR = path.join(__dirname, 'fixtures', 'broken-games');
const registry = loadGames(undefined, createSilentLog());

/** Fails on anything JSON would silently drop or mangle (undefined, NaN, functions, Maps...). */
function assertJsonSafe(value, where) {
  if (value === null) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${where} is ${value}`);
    return;
  }
  assert.equal(type, 'object', `${where} is a ${type}`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${where}[${index}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  assert.ok(proto === Object.prototype || proto === null, `${where} is not a plain object`);
  for (const [key, item] of Object.entries(value)) assertJsonSafe(item, `${where}.${key}`);
}

test('the registry discovers plugins and skips index.js, _helpers and broken files', () => {
  const log = createSilentLog();
  const found = loadGames(BROKEN_DIR, log);
  assert.deepEqual([...found.games.keys()], ['good']);
  assert.deepEqual(found.list, [{ id: 'good', name: 'Buena', tagline: 'Funciona', order: 5, minBet: 1, maxBet: 10 }]);
  assert.deepEqual(found.errors.map((entry) => entry.file).sort(), ['nometa.js', 'throws.js', 'wrongid.js']);
  assert.equal(log.errors.length, 3, 'every skipped plugin is reported');
  const reasons = Object.fromEntries(found.errors.map((entry) => [entry.file, entry.error.message]));
  assert.match(reasons['wrongid.js'], /must match the file name/);
  assert.match(reasons['nometa.js'], /missing meta/);
  assert.match(reasons['throws.js'], /cannot even be required/);
});

test('validatePlugin spells out what is wrong', () => {
  const good = { meta: { id: 'x', name: 'X', tagline: '', order: 1, minBet: 1, maxBet: 5 }, create() {} };
  validatePlugin(good, 'x');
  const broken = (patch, pattern) => {
    assert.throws(() => validatePlugin({ ...good, meta: { ...good.meta, ...patch } }, 'x'), pattern);
  };
  broken({ id: 'Upper' }, /meta\.id/);
  broken({ id: '__proto__' }, /meta\.id/);
  broken({ name: '' }, /meta\.name/);
  broken({ tagline: 5 }, /meta\.tagline/);
  broken({ order: '1' }, /meta\.order/);
  broken({ minBet: 0 }, /meta\.minBet/);
  broken({ minBet: 1.5 }, /meta\.minBet/);
  broken({ maxBet: 0 }, /meta\.maxBet/);
  assert.throws(() => validatePlugin({ meta: good.meta }, 'x'), /missing create/);
  assert.throws(() => validatePlugin(null, 'x'), /module\.exports/);
  assert.throws(() => validateInstance({ onSit() {} }, 'x'), /onLeave\(\) is missing/);
  assert.throws(() => validateInstance(null, 'x'), /must return an object/);
});

test('server/games loads cleanly and the floor is sorted by meta.order', () => {
  assert.deepEqual(registry.errors, [], 'no plugin in server/games may be broken');
  assert.ok(registry.games.has('roulette'));
  assert.equal(registry.list[0].id, 'roulette', 'roulette (order 1) opens the floor');
  const orders = registry.list.map((meta) => meta.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.equal(new Set(registry.list.map((meta) => meta.id)).size, registry.list.length);
  for (const meta of registry.list) {
    assert.notEqual(meta, registry.games.get(meta.id).meta, 'clients get a copy of the meta');
  }
});

for (const [id, plugin] of registry.games) {
  test(`plugin contract: ${id}`, async (t) => {
    await t.test('meta is complete and written for players', () => {
      const { meta } = plugin;
      assert.equal(meta.id, id);
      assert.ok(meta.name.trim().length > 0);
      assert.ok(meta.tagline.trim().length > 0, 'a Spanish tagline for the casino floor');
      assert.ok(Number.isInteger(meta.minBet) && meta.minBet >= 1);
      assert.ok(Number.isInteger(meta.maxBet) && meta.maxBet >= meta.minBet);
      assertJsonSafe(meta, 'meta');
    });

    await t.test('fresh table: views are JSON-safe, stakes are zero, nothing was charged', () => {
      const table = createTable(plugin, { fallback: 'random', players: [] });
      table.addPlayer({ id: 'ana', name: 'Ana', avatar: 1, balance: 5000, seated: false });
      table.addPlayer({ id: 'beto', name: 'Beto', avatar: 2, balance: 5000, seated: false });
      for (const player of ['ana', 'beto']) {
        try {
          table.sit(player);
        } catch (err) {
          assert.ok(err instanceof GameError, `onSit may only refuse with ctx.error(): ${err.stack}`);
        }
      }
      assert.ok(table.isSeated('ana'), 'the first player can always sit');
      for (const viewer of table.seatedIds()) {
        const view = table.game.view(viewer);
        assertJsonSafe(view, `view(${viewer})`);
        assert.deepEqual(table.view(viewer), view, 'the view survives a JSON round trip unchanged');
      }
      for (const player of ['ana', 'beto', 'somebody-who-never-sat']) {
        assert.equal(table.game.stakeOf(player), 0, `stakeOf(${player}) on a fresh table`);
      }
      assert.equal(table.totalBalance(), 10000, 'sitting down is free');
    });

    await t.test('unknown and malformed actions are rejected with ctx.error() and move no chips', () => {
      const table = createTable(plugin, { fallback: 'random', players: [{ id: 'ana', balance: 5000 }] });
      const garbage = [
        { type: 'definitely-not-an-action' },
        { type: '__proto__' },
        { type: 'constructor' },
        { type: 'toString', amount: 100 },
        { type: 'hasOwnProperty' },
      ];
      for (const action of garbage) table.rejects('ana', action);
      assert.equal(table.balance('ana'), 5000);
      assert.equal(table.stake('ana'), 0);
    });

    await t.test('leaving, time passing and disposing never throw', () => {
      const table = createTable(plugin, { fallback: 'random', players: [{ id: 'ana' }, { id: 'beto', seated: false }] });
      const chips = table.chips();
      table.advance(120000);
      table.leave('ana');
      table.advance(120000);
      assert.equal(table.chips(), chips, 'an idle table neither creates nor destroys chips');
      assertJsonSafe(table.game.view('ana'), 'view of a player who left');
      assert.equal(table.game.stakeOf('ana'), 0);
      if (typeof table.game.dispose === 'function') table.game.dispose();
      table.dispose();
    });
  });
}
