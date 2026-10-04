'use strict';

const { defineGame } = require('./_define');
const { createReady } = require('./_ready');

/**
 * Blackjack — everybody at the table plays against the dealer.
 *
 * Round flow
 *   betting  the countdown starts with the first bet; any bettor can press "Repartir".
 *   playing  one hand per bettor, played in order with a turn timer.
 *   dealer   the hole card is revealed and the dealer draws to 17.
 *   result   payouts are shown for a few seconds, then -> betting.
 *
 * actions  { type: 'bet', amount } | { type: 'clear' } | { type: 'deal' }
 *          | { type: 'hit' } | { type: 'stand' } | { type: 'double' }
 * Rules: 6 decks, dealer stands on every 17, blackjack pays 3:2, no splits.
 */

const meta = {
  id: 'blackjack',
  name: 'Blackjack',
  tagline: 'Llegá a 21 sin pasarte. Toda la mesa contra el crupier.',
  order: 2,
  minBet: 10,
  maxBet: 1000,
};

const TIMING = Object.freeze({ betting: 20000, turn: 25000, dealer: 2500, result: 7000 });
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const DECKS = 6;
const RESHUFFLE_AT = 60;

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' || card.rank === '10') {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function createWith(meta, ctx) {
  let phase = 'betting';
  let deadline = null;
  let timer = null;
  let shoe = [];
  let dealer = [];
  let hands = [];
  let turn = -1;
  const bets = new Map(); // playerId -> amount (betting phase only)
  const ready = createReady(ctx);

  function draw() {
    if (shoe.length === 0) shoe = newShoe();
    return shoe.pop();
  }

  function newShoe() {
    const cards = [];
    for (let d = 0; d < DECKS; d += 1) {
      for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    }
    return ctx.rng.shuffle(cards);
  }

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

  function isSeated(playerId) {
    return ctx.seated().some((player) => player.id === playerId);
  }

  function deal() {
    disarm();
    if (bets.size === 0) return;
    ready.clear();
    if (shoe.length < RESHUFFLE_AT) shoe = newShoe();
    hands = [...bets].map(([id, bet]) => ({ id, bet, cards: [], status: 'playing', result: null, payout: 0 }));
    bets.clear();
    dealer = [];
    for (let round = 0; round < 2; round += 1) {
      for (const hand of hands) hand.cards.push(draw());
      dealer.push(draw());
    }
    for (const hand of hands) {
      if (handTotal(hand.cards) === 21) hand.status = 'blackjack';
    }
    phase = 'playing';
    turn = -1;
    ctx.emit('deal', {});
    if (handTotal(dealer) === 21) {
      dealerPlay();
      return;
    }
    nextTurn();
  }

  function nextTurn() {
    turn += 1;
    while (turn < hands.length) {
      const hand = hands[turn];
      if (hand.status === 'playing' && !isSeated(hand.id)) hand.status = 'stand';
      if (hand.status === 'playing') break;
      turn += 1;
    }
    if (turn >= hands.length) {
      dealerPlay();
      return;
    }
    armTurn();
    ctx.sync();
  }

  function armTurn() {
    const current = turn;
    arm(TIMING.turn, () => {
      if (phase !== 'playing' || turn !== current) return;
      hands[turn].status = 'stand';
      nextTurn();
    });
  }

  function dealerPlay() {
    phase = 'dealer';
    const anyoneStanding = hands.some((hand) => hand.status === 'stand');
    if (anyoneStanding) {
      while (handTotal(dealer) < 17) dealer.push(draw());
    }
    arm(TIMING.dealer, settle);
    ctx.emit('dealer', {});
    ctx.sync();
  }

  function settle() {
    const dealerTotal = handTotal(dealer);
    const dealerBlackjack = dealer.length === 2 && dealerTotal === 21;
    for (const hand of hands) {
      const total = handTotal(hand.cards);
      if (hand.status === 'bust') {
        hand.result = 'lose';
      } else if (hand.status === 'blackjack') {
        if (dealerBlackjack) {
          hand.result = 'push';
          hand.payout = hand.bet;
        } else {
          hand.result = 'blackjack';
          hand.payout = hand.bet + Math.floor(hand.bet * 1.5);
        }
      } else if (dealerBlackjack) {
        hand.result = 'lose';
      } else if (dealerTotal > 21 || total > dealerTotal) {
        hand.result = 'win';
        hand.payout = hand.bet * 2;
      } else if (total === dealerTotal) {
        hand.result = 'push';
        hand.payout = hand.bet;
      } else {
        hand.result = 'lose';
      }
      if (hand.payout > 0) ctx.credit(hand.id, hand.payout);
      ctx.report(hand.id, { wagered: hand.bet, won: hand.payout, tag: hand.result === 'blackjack' ? 'blackjack' : undefined });
    }
    phase = 'result';
    arm(TIMING.result, reset);
    ctx.emit('result', { hands: hands.map((hand) => ({ id: hand.id, result: hand.result, net: hand.payout - hand.bet })) });
    ctx.sync();
  }

  function reset() {
    disarm();
    hands = [];
    dealer = [];
    turn = -1;
    phase = 'betting';
    if (bets.size > 0) arm(TIMING.betting, deal);
    ctx.sync();
  }

  function currentHand(playerId) {
    if (phase !== 'playing' || turn < 0 || turn >= hands.length || hands[turn].id !== playerId) {
      throw ctx.error('No es tu turno.');
    }
    return hands[turn];
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
    ready.delete(playerId); // a new bet has to be confirmed again
    if (!timer) arm(TIMING.betting, deal);
    ctx.sync();
  }

  function clear(playerId) {
    if (phase !== 'betting') throw ctx.error('La mano ya empezó.');
    const amount = bets.get(playerId) || 0;
    if (amount === 0) return;
    bets.delete(playerId);
    ctx.credit(playerId, amount);
    ready.delete(playerId);
    if (bets.size === 0) {
      disarm();
      ready.clear();
    }
    ctx.sync();
  }

  function hit(playerId) {
    const hand = currentHand(playerId);
    hand.cards.push(draw());
    const total = handTotal(hand.cards);
    if (total > 21) {
      hand.status = 'bust';
      nextTurn();
    } else if (total === 21) {
      hand.status = 'stand';
      nextTurn();
    } else {
      armTurn();
      ctx.sync();
    }
  }

  function stand(playerId) {
    currentHand(playerId).status = 'stand';
    nextTurn();
  }

  function double(playerId) {
    const hand = currentHand(playerId);
    if (hand.cards.length !== 2) throw ctx.error('Solo podés doblar con las dos primeras cartas.');
    if (!ctx.debit(playerId, hand.bet)) throw ctx.error('No te alcanzan las fichas para doblar.');
    hand.bet *= 2;
    hand.cards.push(draw());
    hand.status = handTotal(hand.cards) > 21 ? 'bust' : 'stand';
    nextTurn();
  }

  function who(id) {
    const player = ctx.player(id);
    return { id, name: player ? player.name : '', avatar: player ? player.avatar : 0 };
  }

  /**
   * "Repartir" / "Listo". The cards come out once EVERYBODY seated has confirmed
   * (somebody without a bet sits the hand out), or when the countdown ends.
   */
  function confirm(playerId, action) {
    if (phase !== 'betting') throw ctx.error('La mano ya empezó.');
    if (bets.size === 0) throw ctx.error('Primero hacé tu apuesta.');
    const wanted = action.ready === undefined ? true : action.ready;
    if (typeof wanted !== 'boolean') throw ctx.error('Jugada inválida.');
    ready.set(playerId, wanted);
    if (ready.all()) deal();
    else ctx.sync();
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave(playerId) {
      ready.delete(playerId);
      if (phase === 'betting' && bets.size > 0 && ready.all()) {
        deal(); // whoever was holding up the hand left
        return;
      }
      if (phase === 'playing' && turn >= 0 && turn < hands.length && hands[turn].id === playerId) {
        hands[turn].status = 'stand';
        nextTurn();
        return;
      }
      ctx.sync();
    },

    onAction(playerId, action) {
      switch (action.type) {
        case 'bet':
          return bet(playerId, action);
        case 'clear':
          return clear(playerId);
        case 'deal':
        case 'ready':
          return confirm(playerId, action);
        case 'hit':
          return hit(playerId);
        case 'stand':
          return stand(playerId);
        case 'double':
          return double(playerId);
        default:
          throw ctx.error('Esa jugada no existe en el blackjack.');
      }
    },

    view(playerId) {
      const hidden = phase === 'playing';
      const mine = phase === 'playing' && turn >= 0 && turn < hands.length && hands[turn].id === playerId ? hands[turn] : null;
      return {
        phase,
        deadline,
        limits: { minBet: meta.minBet, maxBet: meta.maxBet },
        dealer: {
          cards: hidden ? [dealer[0], null] : dealer.slice(),
          total: hidden || dealer.length === 0 ? null : handTotal(dealer),
        },
        bets: [...bets].map(([id, amount]) => ({ ...who(id), amount })),
        hands: hands.map((hand) => ({
          ...who(hand.id),
          cards: hand.cards.slice(),
          total: handTotal(hand.cards),
          bet: hand.bet,
          status: hand.status,
          result: hand.result,
          payout: hand.payout,
        })),
        turn: phase === 'playing' && turn >= 0 && turn < hands.length ? hands[turn].id : null,
        ready: ready.list(),
        waiting: phase === 'betting' && bets.size > 0 ? ready.waiting() : [],
        you: {
          bet: bets.get(playerId) || 0,
          ready: ready.has(playerId),
          myTurn: Boolean(mine),
          canDouble: Boolean(mine && mine.cards.length === 2 && ctx.balance(playerId) >= mine.bet),
        },
      };
    },

    stakeOf(playerId) {
      let stake = bets.get(playerId) || 0;
      if (phase === 'playing' || phase === 'dealer') {
        for (const hand of hands) if (hand.id === playerId) stake += hand.bet;
      }
      return stake;
    },
  };
}

module.exports = defineGame(meta, createWith, { internals: { handTotal, TIMING } });
