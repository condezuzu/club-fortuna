'use strict';

const { defineGame } = require('./_define');

/**
 * Baccarat (punto banco).
 *
 * Round flow
 *   betting  the countdown starts with the first chip; any bettor can press "Repartir".
 *   dealing  the cards are already drawn and shown while clients animate them.
 *   result   payouts are credited and shown, then -> betting.
 *
 * actions  { type: 'bet', spot: 'player' | 'banker' | 'tie', amount } | { type: 'clear' } | { type: 'deal' }
 * Payouts: player 1:1, banker 0.95:1 (rounded down), tie 8:1. A tie returns player and banker bets.
 */

const meta = {
  id: 'baccarat',
  name: 'Baccarat',
  tagline: 'Punto o Banca: elegí un lado y que decida el nueve.',
  order: 4,
  minBet: 10,
  maxBet: 2000,
};

const TIMING = Object.freeze({ betting: 15000, dealing: 4500, result: 6000 });
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const SPOTS = ['player', 'banker', 'tie'];
const DECKS = 8;
const HISTORY_SIZE = 20;

function cardValue(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 0;
  return Number(card.rank);
}

function handTotal(cards) {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

/** Standard third-card rule for the banker. third = value of the player's third card, or null. */
function bankerDraws(bankerTotal, third) {
  if (third === null) return bankerTotal <= 5;
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return third !== 8;
  if (bankerTotal === 4) return third >= 2 && third <= 7;
  if (bankerTotal === 5) return third >= 4 && third <= 7;
  if (bankerTotal === 6) return third === 6 || third === 7;
  return false;
}

function createWith(meta, ctx) {
  let phase = 'betting';
  let deadline = null;
  let timer = null;
  let shoe = [];
  let hands = null;
  let results = [];
  const history = [];
  const bets = new Map(); // playerId -> { player, banker, tie }

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

  function totalOf(playerId) {
    const mine = bets.get(playerId);
    return mine ? mine.player + mine.banker + mine.tie : 0;
  }

  function deal() {
    disarm();
    if (bets.size === 0) return;
    if (shoe.length < 20) shoe = newShoe();
    const player = [shoe.pop(), shoe.pop()];
    const banker = [shoe.pop(), shoe.pop()];
    const natural = handTotal(player) >= 8 || handTotal(banker) >= 8;
    if (!natural) {
      let third = null;
      if (handTotal(player) <= 5) {
        const card = shoe.pop();
        player.push(card);
        third = cardValue(card);
      }
      if (bankerDraws(handTotal(banker), third)) banker.push(shoe.pop());
    }
    const playerTotal = handTotal(player);
    const bankerTotal = handTotal(banker);
    const winner = playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';
    hands = { player, banker, playerTotal, bankerTotal, winner };
    phase = 'dealing';
    arm(TIMING.dealing, settle);
    ctx.emit('deal', { duration: deadline - ctx.now() });
    ctx.sync();
  }

  function settle() {
    results = [];
    for (const [playerId, mine] of bets) {
      const wagered = mine.player + mine.banker + mine.tie;
      let won = 0;
      if (hands.winner === 'tie') won = mine.tie * 9 + mine.player + mine.banker;
      else if (hands.winner === 'player') won = mine.player * 2;
      else won = mine.banker + Math.floor(mine.banker * 0.95);
      if (won > 0) ctx.credit(playerId, won);
      ctx.report(playerId, { wagered, won });
      const who = ctx.player(playerId);
      results.push({ id: playerId, name: who ? who.name : '', avatar: who ? who.avatar : 0, wagered, won, net: won - wagered });
    }
    history.unshift(hands.winner);
    if (history.length > HISTORY_SIZE) history.length = HISTORY_SIZE;
    phase = 'result';
    arm(TIMING.result, reset);
    ctx.emit('result', { winner: hands.winner, results });
    ctx.sync();
  }

  function reset() {
    disarm();
    bets.clear();
    hands = null;
    results = [];
    phase = 'betting';
    ctx.sync();
  }

  function bet(playerId, action) {
    if (phase !== 'betting') throw ctx.error('Las cartas ya están en la mesa. Esperá a la próxima.');
    if (!SPOTS.includes(action.spot)) throw ctx.error('Esa apuesta no existe.');
    const amount = action.amount;
    if (!Number.isSafeInteger(amount) || amount < 1) throw ctx.error('El monto de la apuesta no es válido.');
    const mine = bets.get(playerId) || { player: 0, banker: 0, tie: 0 };
    const onSpot = mine[action.spot] + amount;
    if (onSpot < meta.minBet) throw ctx.error(`La apuesta mínima es de ${meta.minBet} fichas.`);
    if (onSpot > meta.maxBet) throw ctx.error(`La apuesta máxima es de ${meta.maxBet} fichas.`);
    if (!ctx.debit(playerId, amount)) throw ctx.error('No te alcanzan las fichas.');
    mine[action.spot] = onSpot;
    bets.set(playerId, mine);
    if (!timer) arm(TIMING.betting, deal);
    ctx.sync();
  }

  function clear(playerId) {
    if (phase !== 'betting') throw ctx.error('Las cartas ya están en la mesa.');
    const amount = totalOf(playerId);
    if (amount === 0) return;
    bets.delete(playerId);
    ctx.credit(playerId, amount);
    if (bets.size === 0) disarm();
    ctx.sync();
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave() {
      ctx.sync();
    },

    onAction(playerId, action) {
      switch (action.type) {
        case 'bet':
          return bet(playerId, action);
        case 'clear':
          return clear(playerId);
        case 'deal':
          if (phase !== 'betting' || !bets.has(playerId)) throw ctx.error('Primero hacé tu apuesta.');
          return deal();
        default:
          throw ctx.error('Esa jugada no existe en el baccarat.');
      }
    },

    view(playerId) {
      return {
        phase,
        deadline,
        limits: { minBet: meta.minBet, maxBet: meta.maxBet },
        bets: [...bets].map(([id, mine]) => {
          const who = ctx.player(id);
          return { id, name: who ? who.name : '', avatar: who ? who.avatar : 0, ...mine };
        }),
        hands,
        results,
        history: history.slice(),
        you: { total: totalOf(playerId) },
      };
    },

    stakeOf(playerId) {
      return phase === 'result' ? 0 : totalOf(playerId);
    },
  };
}

module.exports = defineGame(meta, createWith, { internals: { handTotal, bankerDraws, cardValue, TIMING } });
