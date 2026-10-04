'use strict';

// Shared tables deal only when everybody seated has confirmed, or when the countdown ends.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTable } = require('./helpers/fakeCtx');

const GAMES = {
  blackjack: { plugin: require('../server/games/blackjack'), bet: { type: 'bet', amount: 10 }, dealt: 'playing' },
  baccarat: { plugin: require('../server/games/baccarat'), bet: { type: 'bet', spot: 'player', amount: 10 }, dealt: 'dealing' },
  poker3: { plugin: require('../server/games/poker3'), bet: { type: 'bet', amount: 10 }, dealt: 'deciding' },
};
const two = () => [
  { id: 'ana', name: 'Ana', balance: 1000 },
  { id: 'beto', name: 'Beto', balance: 1000 },
];

for (const [name, game] of Object.entries(GAMES)) {
  const betting = game.plugin.internals.TIMING.betting;
  const phaseOf = (table) => table.view('ana').phase;

  test(`${name}: alone at the table, "Repartir" deals at once`, () => {
    const table = createTable(game.plugin, { players: [{ id: 'ana', name: 'Ana', balance: 1000 }] });
    assert.throws(() => table.act('ana', { type: 'deal' }), /apuesta/);
    table.act('ana', game.bet);
    table.act('ana', { type: 'deal' });
    assert.notEqual(phaseOf(table), 'betting');
  });

  test(`${name}: with two seated, both have to confirm`, () => {
    const table = createTable(game.plugin, { players: two() });
    table.act('ana', game.bet);
    table.act('ana', { type: 'ready' });
    assert.equal(phaseOf(table), 'betting', 'Beto has not confirmed');
    assert.deepEqual(table.view('beto').waiting, ['Beto']);
    assert.equal(table.view('ana').you.ready, true);

    table.act('ana', { type: 'ready', ready: false });
    assert.deepEqual(table.view('ana').waiting, ['Ana', 'Beto']);
    table.act('beto', { type: 'ready' }); // no bet: he sits this hand out
    assert.equal(phaseOf(table), 'betting', 'now it is Ana who has not confirmed');
    table.act('ana', { type: 'ready' });
    assert.notEqual(phaseOf(table), 'betting');
    assert.equal(table.stake('beto'), 0);
    assert.deepEqual(table.view('ana').waiting, []);
  });

  test(`${name}: a new bet has to be confirmed again`, () => {
    const table = createTable(game.plugin, { players: two() });
    table.act('ana', game.bet);
    table.act('ana', { type: 'ready' });
    table.act('ana', game.bet);
    assert.equal(table.view('ana').you.ready, false);
    table.act('beto', { type: 'ready' });
    assert.equal(phaseOf(table), 'betting');
  });

  test(`${name}: nobody has to wait for ever — the countdown deals, and so does the slow one leaving`, () => {
    const slow = createTable(game.plugin, { players: two() });
    slow.act('ana', game.bet);
    slow.act('ana', { type: 'ready' });
    slow.advance(betting - 1);
    assert.equal(phaseOf(slow), 'betting');
    slow.advance(1);
    assert.notEqual(phaseOf(slow), 'betting');

    const gone = createTable(game.plugin, { players: two() });
    gone.act('ana', game.bet);
    gone.act('ana', { type: 'ready' });
    gone.leave('beto');
    assert.notEqual(phaseOf(gone), 'betting');
  });

  test(`${name}: hostile confirmations are refused`, () => {
    const table = createTable(game.plugin, { players: two() });
    table.act('ana', game.bet);
    assert.throws(() => table.act('ana', { type: 'ready', ready: 'yes' }));
    assert.throws(() => table.act('ana', { type: 'ready', ready: 1 }));
    table.act('ana', { type: 'ready' });
    table.act('beto', { type: 'ready' });
    assert.throws(() => table.act('ana', { type: 'ready' }), /empezó/);
  });
}
