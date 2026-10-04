'use strict';

const { defineGame } = require('./_define');

/**
 * Plinko — a ball falls through rows of pegs; every peg sends it left or right
 * with the same chance, and the slot it ends in pays a multiplier.
 *
 * Each player chooses the number of rows and the risk of every ball. Everybody
 * at the table sees every ball: the `drop` event carries the whole path, so the
 * clients only animate what the server already decided.
 *
 *   actions  { type: 'drop', bet, rows: 8 | 12 | 16, risk: 'low' | 'medium' | 'high' }
 *   events   'drop' { id, playerId, name, avatar, rows, risk, path, slot, bet, win, mult, duration }
 *            path is a string of 'L' / 'R', one letter per row; slot = how many 'R'.
 *
 * The bet is debited when the ball is released and the prize is credited when
 * it lands (`duration` ms later), so a balance never spoils the fall.
 */

const meta = {
  id: 'plinko',
  name: 'Plinko',
  tagline: 'Soltá la bolita y que rebote hasta el premio. Vos elegís las filas y el riesgo.',
  order: 6,
  minBet: 5,
  maxBet: 500,
};

const ROWS = Object.freeze([8, 12, 16]);
const RISKS = Object.freeze(['low', 'medium', 'high']);
const MAX_BALLS = 10; // balls one player may have in the air
const STEP_MS = 290; // fall time per row
const LAND_MS = 550; // into the slot
const RECENT_SIZE = 16;

/**
 * Multipliers in TENTHS (integers, so payouts are exact): slot 0 is the far
 * left, slot `rows` the far right. Every table returns about 99 % on average;
 * the risk only moves the money from the middle to the edges.
 */
const TABLES = Object.freeze({
  8: {
    low: [56, 21, 11, 10, 5, 10, 11, 21, 56],
    medium: [130, 30, 13, 7, 4, 7, 13, 30, 130],
    high: [290, 40, 15, 3, 2, 3, 15, 40, 290],
  },
  12: {
    low: [100, 30, 16, 14, 11, 10, 5, 10, 11, 14, 16, 30, 100],
    medium: [330, 110, 40, 20, 11, 6, 3, 6, 11, 20, 40, 110, 330],
    high: [1700, 240, 81, 20, 7, 2, 2, 2, 7, 20, 81, 240, 1700],
  },
  16: {
    low: [160, 90, 20, 14, 14, 12, 11, 10, 5, 10, 11, 12, 14, 14, 20, 90, 160],
    medium: [1100, 410, 100, 50, 30, 15, 10, 5, 3, 5, 10, 15, 30, 50, 100, 410, 1100],
    high: [10000, 1300, 260, 90, 40, 20, 2, 2, 2, 2, 2, 20, 40, 90, 260, 1300, 10000],
  },
});

/** The tables as plain multipliers, for the clients. */
const PUBLIC_TABLES = Object.freeze(
  Object.fromEntries(
    ROWS.map((rows) => [rows, Object.fromEntries(RISKS.map((risk) => [risk, TABLES[rows][risk].map((tenths) => tenths / 10)]))])
  )
);

function payoutOf(bet, rows, risk, slot) {
  return Math.floor((bet * TABLES[rows][risk][slot]) / 10);
}

function createWith(meta, ctx) {
  let seq = 0;
  const flying = new Map(); // playerId -> balls in the air
  const staked = new Map(); // playerId -> chips in the air
  const recent = [];

  function bump(map, key, delta) {
    const value = (map.get(key) || 0) + delta;
    if (value > 0) map.set(key, value);
    else map.delete(key);
  }

  function drop(playerId, action) {
    const { bet, rows, risk } = action;
    if (!Number.isSafeInteger(bet) || bet < meta.minBet || bet > meta.maxBet) {
      throw ctx.error(`La apuesta va de ${meta.minBet} a ${meta.maxBet} fichas.`);
    }
    if (!ROWS.includes(rows)) throw ctx.error('Elegí 8, 12 o 16 filas.');
    if (!RISKS.includes(risk)) throw ctx.error('Elegí un riesgo: bajo, medio o alto.');
    if ((flying.get(playerId) || 0) >= MAX_BALLS) throw ctx.error('Esperá a que caiga alguna bolita.');
    if (!ctx.debit(playerId, bet)) throw ctx.error('No te alcanzan las fichas.');

    let path = '';
    let slot = 0;
    for (let row = 0; row < rows; row += 1) {
      const right = ctx.rng.int(0, 2) === 1;
      path += right ? 'R' : 'L';
      if (right) slot += 1;
    }
    const win = payoutOf(bet, rows, risk, slot);
    const mult = TABLES[rows][risk][slot] / 10;
    const id = (seq += 1);
    const nominal = rows * STEP_MS + LAND_MS;
    const who = ctx.player(playerId);
    const ball = { id, playerId, name: who ? who.name : '', avatar: who ? who.avatar : 0, rows, risk, slot, bet, win, mult };

    bump(flying, playerId, 1);
    bump(staked, playerId, bet);
    ctx.emit('drop', { ...ball, path, duration: ctx.deadline(nominal) - ctx.now() });
    ctx.sync();

    ctx.after(nominal, () => {
      bump(flying, playerId, -1);
      bump(staked, playerId, -bet);
      if (win > 0) ctx.credit(playerId, win);
      ctx.report(playerId, { wagered: bet, won: win });
      recent.unshift(ball);
      if (recent.length > RECENT_SIZE) recent.length = RECENT_SIZE;
      ctx.sync();
    });
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave() {
      // Balls in the air keep falling and are paid when they land.
      ctx.sync();
    },

    onAction(playerId, action) {
      if (action.type === 'drop') return drop(playerId, action);
      throw ctx.error('Esa jugada no existe en el plinko.');
    },

    view(playerId) {
      return {
        limits: { minBet: meta.minBet, maxBet: meta.maxBet },
        rows: ROWS,
        risks: RISKS,
        tables: PUBLIC_TABLES,
        maxBalls: MAX_BALLS,
        flying: flying.get(playerId) || 0,
        recent: recent.slice(),
      };
    },

    stakeOf(playerId) {
      return staked.get(playerId) || 0;
    },
  };
}

module.exports = defineGame(meta, createWith, { internals: { TABLES, ROWS, RISKS, MAX_BALLS, STEP_MS, LAND_MS, payoutOf } });
