'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cards = require('../server/cards');
const rng = require('../server/rng');
const { createScriptedRng } = require('./helpers/fakeCtx');

test('createDeck() has 52 distinct, well-formed cards in a stable order', () => {
  const deck = cards.createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(cards.cardCode)).size, 52);
  for (const card of deck) {
    assert.ok(cards.isCard(card));
    assert.deepEqual(Object.keys(card).sort(), ['rank', 'suit']);
  }
  assert.deepEqual(deck[0], { rank: 'A', suit: 'S' });
  assert.deepEqual(deck[12], { rank: 'K', suit: 'S' });
  assert.deepEqual(deck[13], { rank: 'A', suit: 'H' });
  assert.deepEqual(deck[51], { rank: 'K', suit: 'C' });
  assert.notEqual(cards.createDeck()[0], deck[0], 'every deck is made of fresh objects');
});

test('createShoe() contains nDecks copies of every card, shuffled with the given rng', () => {
  const shoe = cards.createShoe(6, rng);
  assert.equal(shoe.length, 312);
  const counts = new Map();
  for (const card of shoe) counts.set(cards.cardCode(card), (counts.get(cards.cardCode(card)) || 0) + 1);
  assert.equal(counts.size, 52);
  for (const count of counts.values()) assert.equal(count, 6);
  assert.notDeepEqual(shoe.slice(0, 52), cards.createDeck(), 'a real shoe does not come out in factory order');
});

test('createShoe() with a scripted rng is deterministic', () => {
  const identity = cards.createShoe(1, createScriptedRng());
  assert.deepEqual(identity, cards.createDeck());

  const stacked = cards.parseCards('AS KH 10D');
  const shoe = cards.createShoe(1, createScriptedRng({ shuffles: [(deck) => [...stacked, ...deck]] }));
  assert.deepEqual(shoe.slice(0, 3), stacked);
  assert.equal(shoe.length, 55);
});

test('createShoe() validates its arguments', () => {
  assert.throws(() => cards.createShoe(0, rng), RangeError);
  assert.throws(() => cards.createShoe(1.5, rng), RangeError);
  assert.throws(() => cards.createShoe(100, rng), RangeError);
  assert.throws(() => cards.createShoe(1), TypeError);
  assert.throws(() => cards.createShoe(1, {}), TypeError);
});

test('helpers: codes, parsing, colours, ranks and Spanish names', () => {
  assert.equal(cards.cardCode({ rank: '10', suit: 'H' }), '10H');
  assert.deepEqual(cards.parseCard('10h'), { rank: '10', suit: 'H' });
  assert.deepEqual(cards.parseCards('AS, KH  2c'), [
    { rank: 'A', suit: 'S' },
    { rank: 'K', suit: 'H' },
    { rank: '2', suit: 'C' },
  ]);
  assert.throws(() => cards.parseCard('1S'), RangeError);
  assert.throws(() => cards.parseCard('AX'), RangeError);
  assert.throws(() => cards.parseCard(''), RangeError);

  assert.equal(cards.isRed({ rank: 'A', suit: 'H' }), true);
  assert.equal(cards.isRed({ rank: 'A', suit: 'D' }), true);
  assert.equal(cards.isRed({ rank: 'A', suit: 'S' }), false);
  assert.equal(cards.isRed({ rank: 'A', suit: 'C' }), false);

  assert.equal(cards.rankIndex('A'), 1);
  assert.equal(cards.rankIndex({ rank: '10', suit: 'S' }), 10);
  assert.equal(cards.rankIndex('K'), 13);
  assert.throws(() => cards.rankIndex('Z'), RangeError);

  assert.equal(cards.sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'S' }), true);
  assert.equal(cards.sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'H' }), false);
  assert.equal(cards.sameCard(null, { rank: 'A', suit: 'H' }), false);

  assert.equal(cards.isCard({ rank: '1', suit: 'S' }), false);
  assert.equal(cards.isCard(null), false);
  assert.equal(cards.isCard('AS'), false);

  assert.equal(cards.cardName({ rank: 'A', suit: 'S' }), 'As de picas');
  assert.equal(cards.cardName({ rank: '10', suit: 'H' }), '10 de corazones');
  assert.equal(cards.cardName({ rank: 'Q', suit: 'C' }), 'Reina de tréboles');
});
