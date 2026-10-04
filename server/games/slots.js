'use strict';

/**
 * Tragamonedas — three reels and a progressive jackpot fed by the whole team.
 *
 * actions  { type: 'spin', bet }
 * events   'spin' { playerId, reels, bet, win, jackpot, duration }
 * The bet is debited when the reels start and the prize is credited when they
 * stop, so balances do not spoil the animation.
 */

const meta = {
  id: 'slots',
  name: 'Tragamonedas',
  tagline: 'Tres rodillos y un pozo progresivo que alimenta todo el equipo.',
  order: 3,
  minBet: 5,
  maxBet: 500,
};

/** Symbol weights per reel and the multiplier paid for three of a kind. */
const SYMBOLS = Object.freeze([
  { id: 'cherry', weight: 30, pay: 8 },
  { id: 'lemon', weight: 25, pay: 12 },
  { id: 'bell', weight: 18, pay: 25 },
  { id: 'star', weight: 12, pay: 50 },
  { id: 'diamond', weight: 8, pay: 120 },
  { id: 'seven', weight: 4, pay: 300 },
]);
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);
const TWO_CHERRIES_PAY = 2;
const SPIN_MS = 2000;
const JACKPOT_SEED = 5000;
const JACKPOT_FEED = 0.03;
const RECENT_SIZE = 8;

function payoutOf(reels, bet) {
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    return bet * SYMBOLS.find((symbol) => symbol.id === reels[0]).pay;
  }
  if (reels[0] === 'cherry' && reels[1] === 'cherry') return bet * TWO_CHERRIES_PAY;
  return 0;
}

function create(ctx) {
  let jackpot = JACKPOT_SEED;
  const pending = new Map(); // playerId -> bet while the reels turn
  const last = new Map(); // playerId -> last finished spin
  const recent = [];

  function pickSymbol() {
    let roll = ctx.rng.int(0, TOTAL_WEIGHT);
    for (const symbol of SYMBOLS) {
      if (roll < symbol.weight) return symbol.id;
      roll -= symbol.weight;
    }
    return SYMBOLS[0].id;
  }

  function spin(playerId, action) {
    const bet = action.bet;
    if (!Number.isSafeInteger(bet) || bet < meta.minBet || bet > meta.maxBet) {
      throw ctx.error(`La apuesta va de ${meta.minBet} a ${meta.maxBet} fichas.`);
    }
    if (pending.has(playerId)) throw ctx.error('Esperá a que paren los rodillos.');
    if (!ctx.debit(playerId, bet)) throw ctx.error('No te alcanzan las fichas.');

    jackpot += Math.max(1, Math.floor(bet * JACKPOT_FEED));
    const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
    let win = payoutOf(reels, bet);
    const hitJackpot = reels.every((symbol) => symbol === 'seven');
    if (hitJackpot) {
      win += jackpot;
      jackpot = JACKPOT_SEED;
    }

    pending.set(playerId, bet);
    ctx.emit('spin', { playerId, reels, bet, win, jackpot: hitJackpot, duration: ctx.deadline(SPIN_MS) - ctx.now() });
    ctx.sync();

    ctx.after(SPIN_MS, () => {
      pending.delete(playerId);
      if (win > 0) ctx.credit(playerId, win);
      ctx.report(playerId, { wagered: bet, won: win });
      const player = ctx.player(playerId);
      const entry = {
        id: playerId,
        name: player ? player.name : '',
        avatar: player ? player.avatar : 0,
        reels,
        bet,
        win,
        jackpot: hitJackpot,
      };
      last.set(playerId, entry);
      recent.unshift(entry);
      if (recent.length > RECENT_SIZE) recent.length = RECENT_SIZE;
      if (hitJackpot) {
        ctx.announce(`¡${entry.name} se llevó el pozo de las tragamonedas: ${win} fichas!`, {
          kind: 'jackpot',
          playerId,
          amount: win,
        });
      }
      ctx.sync();
    });
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave() {
      ctx.sync();
    },

    onAction(playerId, action) {
      if (action.type === 'spin') return spin(playerId, action);
      throw ctx.error('Esa jugada no existe en las tragamonedas.');
    },

    view(playerId) {
      return {
        jackpot,
        limits: { minBet: meta.minBet, maxBet: meta.maxBet },
        paytable: SYMBOLS.map((symbol) => ({ id: symbol.id, pay: symbol.pay })),
        twoCherriesPay: TWO_CHERRIES_PAY,
        spinning: pending.has(playerId),
        recent: recent.slice(),
        you: { last: last.get(playerId) || null },
      };
    },

    stakeOf(playerId) {
      return pending.get(playerId) || 0;
    },
  };
}

module.exports = { meta, create, internals: { SYMBOLS, payoutOf, SPIN_MS, JACKPOT_SEED } };
