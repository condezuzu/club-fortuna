'use strict';

const { defineGame } = require('./_define');

/**
 * Póker de 3 cartas — everybody plays their own hand against the dealer.
 *
 * Round flow
 *   betting   place the ante; the countdown starts with the first one.
 *   deciding  three cards each. Every player chooses "Jugar" (a second bet equal
 *             to the ante) or "Retirarse" (the ante is lost).
 *   result    the dealer shows. The dealer needs Queen-high or better to qualify.
 *
 * actions  { type: 'bet', amount } | { type: 'clear' } | { type: 'deal' } | { type: 'play' } | { type: 'fold' }
 * Payouts: dealer does not qualify -> ante pays 1:1, play is returned. Dealer
 * qualifies -> the better hand wins ante and play 1:1. Ante bonus for whoever
 * plays: straight 1:1, three of a kind 4:1, straight flush 5:1.
 */

const meta = {
  id: 'poker3',
  name: 'Póker de 3 cartas',
  tagline: 'Tres cartas, una decisión: jugás o te retirás. Ganale la mano al crupier.',
  order: 5,
  minBet: 10,
  maxBet: 1000,
};

const TIMING = Object.freeze({ betting: 15000, deciding: 25000, result: 8000 });
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];
const HAND_NAMES = ['Carta alta', 'Par', 'Color', 'Escalera', 'Trío', 'Escalera de color'];
const ANTE_BONUS = { 3: 1, 4: 4, 5: 5 };

/** Score of a 3-card hand as an array compared left to right. */
function score(cards) {
  const values = cards.map((card) => RANKS.indexOf(card.rank) + 2).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  let straight = values[0] - values[1] === 1 && values[1] - values[2] === 1;
  let high = values[0];
  if (values[0] === 14 && values[1] === 3 && values[2] === 2) {
    straight = true;
    high = 3;
  }
  if (straight && flush) return [5, high];
  if (values[0] === values[2]) return [4, values[0]];
  if (straight) return [3, high];
  if (flush) return [2, ...values];
  if (values[0] === values[1]) return [1, values[0], values[2]];
  if (values[1] === values[2]) return [1, values[1], values[0]];
  return [0, ...values];
}

function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function createWith(meta, ctx) {
  let phase = 'betting';
  let deadline = null;
  let timer = null;
  let dealer = [];
  let hands = [];
  const bets = new Map();

  function arm(ms, fn) {
    if (timer) timer.cancel();
    deadline = ctx.deadline(ms);
    timer = ctx.after(ms, fn);
  }

  function disarm() {
    if (timer) timer.cancel();
    timer = null;
    deadline = null;
  }

  function deal() {
    disarm();
    if (bets.size === 0) return;
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
    const shoe = ctx.rng.shuffle(deck);
    hands = [...bets].map(([id, ante]) => ({
      id,
      ante,
      play: 0,
      cards: [shoe.pop(), shoe.pop(), shoe.pop()],
      decision: null,
      result: null,
      payout: 0,
    }));
    bets.clear();
    dealer = [shoe.pop(), shoe.pop(), shoe.pop()];
    phase = 'deciding';
    arm(TIMING.deciding, () => {
      for (const hand of hands) if (!hand.decision) hand.decision = 'fold';
      settle();
    });
    ctx.emit('deal', {});
    ctx.sync();
  }

  function settleIfDone() {
    const seated = new Set(ctx.seated().map((player) => player.id));
    for (const hand of hands) if (!hand.decision && !seated.has(hand.id)) hand.decision = 'fold';
    if (hands.every((hand) => hand.decision)) settle();
    else ctx.sync();
  }

  function settle() {
    disarm();
    const dealerScore = score(dealer);
    const qualifies = dealerScore[0] > 0 || dealerScore[1] >= 12;
    for (const hand of hands) {
      const wagered = hand.ante + hand.play;
      if (hand.decision === 'fold') {
        hand.result = 'fold';
      } else {
        const mine = score(hand.cards);
        const bonus = hand.ante * (ANTE_BONUS[mine[0]] || 0);
        if (!qualifies) {
          hand.result = 'noqualify';
          hand.payout = hand.ante * 2 + hand.play;
        } else {
          const diff = compare(mine, dealerScore);
          if (diff > 0) {
            hand.result = 'win';
            hand.payout = wagered * 2;
          } else if (diff === 0) {
            hand.result = 'push';
            hand.payout = wagered;
          } else {
            hand.result = 'lose';
          }
        }
        hand.payout += bonus;
      }
      if (hand.payout > 0) ctx.credit(hand.id, hand.payout);
      ctx.report(hand.id, { wagered, won: hand.payout });
    }
    phase = 'result';
    arm(TIMING.result, reset);
    ctx.emit('result', {
      qualifies,
      hands: hands.map((hand) => ({ id: hand.id, result: hand.result, net: hand.payout - hand.ante - hand.play })),
    });
    ctx.sync();
  }

  function reset() {
    disarm();
    hands = [];
    dealer = [];
    phase = 'betting';
    ctx.sync();
  }

  function myHand(playerId) {
    const hand = phase === 'deciding' ? hands.find((h) => h.id === playerId && !h.decision) : null;
    if (!hand) throw ctx.error('No tenés una mano para decidir.');
    return hand;
  }

  function bet(playerId, action) {
    if (phase !== 'betting') throw ctx.error('La mano ya empezó. Esperá a la próxima.');
    const amount = action.amount;
    if (!Number.isSafeInteger(amount) || amount < 1) throw ctx.error('El monto de la apuesta no es válido.');
    const total = (bets.get(playerId) || 0) + amount;
    if (total < meta.minBet) throw ctx.error(`La apuesta mínima es de ${meta.minBet} fichas.`);
    if (total > meta.maxBet) throw ctx.error(`La apuesta máxima es de ${meta.maxBet} fichas.`);
    if (!ctx.debit(playerId, amount)) throw ctx.error('No te alcanzan las fichas.');
    bets.set(playerId, total);
    if (!timer) arm(TIMING.betting, deal);
    ctx.sync();
  }

  function clear(playerId) {
    if (phase !== 'betting') throw ctx.error('La mano ya empezó.');
    const amount = bets.get(playerId) || 0;
    if (amount === 0) return;
    bets.delete(playerId);
    ctx.credit(playerId, amount);
    if (bets.size === 0) disarm();
    ctx.sync();
  }

  function who(id) {
    const player = ctx.player(id);
    return { id, name: player ? player.name : '', avatar: player ? player.avatar : 0 };
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave() {
      if (phase === 'deciding') settleIfDone();
      else ctx.sync();
    },

    onAction(playerId, action) {
      switch (action.type) {
        case 'bet':
          return bet(playerId, action);
        case 'clear':
          return clear(playerId);
        case 'deal':
          if (phase !== 'betting' || !bets.has(playerId)) throw ctx.error('Primero poné tu apuesta.');
          return deal();
        case 'play': {
          const hand = myHand(playerId);
          if (!ctx.debit(playerId, hand.ante)) throw ctx.error('No te alcanzan las fichas para jugar la mano.');
          hand.play = hand.ante;
          hand.decision = 'play';
          return settleIfDone();
        }
        case 'fold':
          myHand(playerId).decision = 'fold';
          return settleIfDone();
        default:
          throw ctx.error('Esa jugada no existe en el póker.');
      }
    },

    view(playerId) {
      const open = phase === 'result';
      const mine = hands.find((hand) => hand.id === playerId) || null;
      return {
        phase,
        deadline,
        limits: { minBet: meta.minBet, maxBet: meta.maxBet },
        dealer: {
          cards: open ? dealer.slice() : dealer.map(() => null),
          hand: open && dealer.length ? HAND_NAMES[score(dealer)[0]] : null,
        },
        bets: [...bets].map(([id, amount]) => ({ ...who(id), amount })),
        hands: hands.map((hand) => {
          const visible = open || hand.id === playerId;
          return {
            ...who(hand.id),
            cards: visible ? hand.cards.slice() : hand.cards.map(() => null),
            hand: visible ? HAND_NAMES[score(hand.cards)[0]] : null,
            ante: hand.ante,
            play: hand.play,
            decision: hand.decision,
            result: hand.result,
            payout: hand.payout,
          };
        }),
        you: {
          bet: bets.get(playerId) || 0,
          deciding: Boolean(phase === 'deciding' && mine && !mine.decision),
        },
      };
    },

    stakeOf(playerId) {
      let stake = bets.get(playerId) || 0;
      if (phase === 'deciding') {
        for (const hand of hands) if (hand.id === playerId) stake += hand.ante + hand.play;
      }
      return stake;
    },
  };
}

module.exports = defineGame(meta, createWith, { internals: { score, compare, HAND_NAMES } });
