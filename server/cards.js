'use strict';

/**
 * Playing cards shared by every card game.
 *
 *   Card = { rank: 'A'|'2'|...|'10'|'J'|'Q'|'K', suit: 'S'|'H'|'D'|'C' }
 *
 * Cards are plain JSON-safe objects so they can go straight into a view. Game
 * specific values (blackjack totals, baccarat points, poker rankings) belong
 * to each game; this module only knows what a deck is.
 */

const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const SUITS = Object.freeze(['S', 'H', 'D', 'C']);

const RANK_NAMES_ES = Object.freeze({
  A: 'As',
  J: 'Jota',
  Q: 'Reina',
  K: 'Rey',
});
const SUIT_NAMES_ES = Object.freeze({
  S: 'picas',
  H: 'corazones',
  D: 'diamantes',
  C: 'tréboles',
});

/** 52 fresh card objects, ordered by suit (S, H, D, C) and then rank (A..K). */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

/**
 * `nDecks` decks shuffled together with the given rng (pass `ctx.rng`).
 * Deal with `shoe.pop()` or `shoe.shift()`; never send the shoe to a client.
 * @param {number} nDecks
 * @param {{ shuffle: <T>(array: T[]) => T[] }} rng
 */
function createShoe(nDecks, rng) {
  if (!Number.isInteger(nDecks) || nDecks < 1 || nDecks > 16) {
    throw new RangeError('createShoe(nDecks, rng): nDecks must be an integer between 1 and 16');
  }
  if (!rng || typeof rng.shuffle !== 'function') {
    throw new TypeError('createShoe(nDecks, rng): rng with a shuffle() method required');
  }
  const cards = [];
  for (let i = 0; i < nDecks; i += 1) cards.push(...createDeck());
  return rng.shuffle(cards);
}

function isCard(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    RANKS.includes(value.rank) &&
    SUITS.includes(value.suit)
  );
}

/** A = 1, 2..10 face value, J = 11, Q = 12, K = 13. Accepts a card or a rank. */
function rankIndex(cardOrRank) {
  const rank = typeof cardOrRank === 'string' ? cardOrRank : cardOrRank && cardOrRank.rank;
  const index = RANKS.indexOf(rank);
  if (index === -1) throw new RangeError(`Unknown rank: ${rank}`);
  return index + 1;
}

/** Hearts and diamonds. */
function isRed(card) {
  return card.suit === 'H' || card.suit === 'D';
}

function sameCard(a, b) {
  return Boolean(a && b && a.rank === b.rank && a.suit === b.suit);
}

/** { rank: '10', suit: 'H' } -> '10H' */
function cardCode(card) {
  return `${card.rank}${card.suit}`;
}

/** 'AS' -> { rank: 'A', suit: 'S' }. Throws on anything that is not a card code. */
function parseCard(code) {
  const text = String(code).trim().toUpperCase();
  const card = { rank: text.slice(0, -1), suit: text.slice(-1) };
  if (!isCard(card)) throw new RangeError(`Not a card code: "${code}"`);
  return card;
}

/** 'AS KH 10D' -> three cards. Handy to script a shoe in tests. */
function parseCards(text) {
  return String(text)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseCard);
}

/** Spanish name for feed lines: "As de picas", "10 de corazones". */
function cardName(card) {
  return `${RANK_NAMES_ES[card.rank] || card.rank} de ${SUIT_NAMES_ES[card.suit]}`;
}

module.exports = {
  RANKS,
  SUITS,
  createDeck,
  createShoe,
  isCard,
  rankIndex,
  isRed,
  sameCard,
  cardCode,
  parseCard,
  parseCards,
  cardName,
};
