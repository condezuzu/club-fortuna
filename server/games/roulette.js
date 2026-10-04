'use strict';

/**
 * Ruleta — European single-zero roulette.
 *
 * This is the REFERENCE game plugin: new games should copy its shape.
 *
 *   1. `meta`: static description shown on the casino floor.
 *   2. Pure rules at module level (layout, payouts): no state, easy to test.
 *   3. `create(ctx)`: one closure per room holding ALL the table state, with
 *      small named functions for each phase transition and each action.
 *   4. Every action validates everything first and mutates state last; chips
 *      only move through ctx.debit / ctx.credit.
 *
 * Round flow
 *   idle      nobody has chips on the layout.
 *   betting   starts when the first chip lands; a countdown runs. Every bettor
 *             can press "Listo"; when all seated bettors are ready the wheel
 *             spins right away.
 *   spinning  bets are locked and the winning number is drawn immediately (so
 *             clients can animate the ball landing on it), but nothing is paid
 *             yet: balances must not spoil the animation.
 *   result    payouts are credited and shown for a few seconds, then -> idle.
 *
 * Wire format
 *   actions  { type: 'bet', spot, amount } | { type: 'undo' } | { type: 'clear' }
 *            | { type: 'rebet' } | { type: 'ready', ready?: boolean }
 *   events   'bet'    { playerId, spot, amount }
 *            'unbet'  { playerId, amount, reason: 'undo' | 'clear' }
 *            'rebet'  { playerId, amount }
 *            'spin'   { round, number, duration }
 *            'result' { round, number, color, results, winningSpots, totalWagered, totalWon }
 *   view     see view() at the bottom of create().
 *
 * Spot ids (the single source of truth for the layout geometry)
 *   straight:17            one number, 0..36                       35:1
 *   split:17-18            two neighbours (also 0-1, 0-2, 0-3)     17:1
 *   street:16-17-18        a row of three (also 0-1-2 and 0-2-3)   11:1
 *   corner:16-17-19-20     four numbers (also 0-1-2-3)              8:1
 *   sixline:13-14-15-16-17-18   two neighbouring rows               5:1
 *   column:1..3            n % 3 === 1, 2, 0 respectively           2:1
 *   dozen:1..3             1-12, 13-24, 25-36                       2:1
 *   red, black, even, odd, low (1-18), high (19-36)                 1:1
 *   Numbers are always written in ascending order.
 */

const { formatChips } = require('../util');

const meta = {
  id: 'roulette',
  name: 'Ruleta',
  tagline: 'Europea, de un solo cero. Apostá en equipo y que gire la bola.',
  order: 1,
  minBet: 5, // minimum total on a spot
  maxBet: 2000, // maximum total on a spot, per player
  tableLimit: 10000, // maximum total on the layout, per player and round
};

/** Nominal phase durations in ms (ctx scales them with CASINO_TIME_SCALE). */
const TIMING = Object.freeze({ betting: 30000, spinning: 9000, result: 7000 });

const HISTORY_SIZE = 15;

/** Payout odds "N to 1": a winning bet returns amount * (N + 1). */
const PAYOUTS = Object.freeze({
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixline: 5,
  column: 2,
  dozen: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
});

const RED_NUMBERS = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RED = new Set(RED_NUMBERS);

/** Pocket order on a European wheel, clockwise from zero (clients animate with it). */
const WHEEL = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
  7, 28, 12, 35, 3, 26,
]);

function colorOf(number) {
  if (number === 0) return 'green';
  return RED.has(number) ? 'red' : 'black';
}

function range(from, to) {
  const out = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}

/**
 * Every legal bet on the standard layout (three columns by twelve rows, zero
 * on top). Geometry is validated by looking a spot up in this table: anything
 * that is not here cannot be bet on.
 * @returns {Map<string, { id: string, kind: string, numbers: readonly number[], payout: number }>}
 */
function buildSpots() {
  const spots = new Map();
  const add = (kind, numbers, id) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const spotId = id || `${kind}:${sorted.join('-')}`;
    spots.set(spotId, Object.freeze({ id: spotId, kind, numbers: Object.freeze(sorted), payout: PAYOUTS[kind] }));
  };
  const numbers = range(1, 36);

  for (let n = 0; n <= 36; n += 1) add('straight', [n]);

  for (const n of numbers) {
    if (n % 3 !== 0) add('split', [n, n + 1]); // neighbours inside a row
    if (n <= 33) add('split', [n, n + 3]); // neighbours across rows
  }
  add('split', [0, 1]);
  add('split', [0, 2]);
  add('split', [0, 3]);

  for (let row = 0; row < 12; row += 1) add('street', [row * 3 + 1, row * 3 + 2, row * 3 + 3]);
  add('street', [0, 1, 2]); // trios with the zero
  add('street', [0, 2, 3]);

  for (const n of numbers) {
    if (n % 3 !== 0 && n <= 32) add('corner', [n, n + 1, n + 3, n + 4]);
  }
  add('corner', [0, 1, 2, 3]); // "first four"

  for (let row = 0; row < 11; row += 1) add('sixline', range(row * 3 + 1, row * 3 + 6));

  for (let column = 1; column <= 3; column += 1) {
    add('column', numbers.filter((n) => n % 3 === column % 3), `column:${column}`);
  }
  for (let dozen = 1; dozen <= 3; dozen += 1) {
    add('dozen', range((dozen - 1) * 12 + 1, dozen * 12), `dozen:${dozen}`);
  }

  add('red', RED_NUMBERS, 'red');
  add('black', numbers.filter((n) => !RED.has(n)), 'black');
  add('even', numbers.filter((n) => n % 2 === 0), 'even');
  add('odd', numbers.filter((n) => n % 2 === 1), 'odd');
  add('low', range(1, 18), 'low');
  add('high', range(19, 36), 'high');
  return spots;
}

const SPOTS = buildSpots();

/**
 * Resolve what the client sent into a legal spot, or null.
 * Canonical ids are looked up directly; "kind:a-b-c" with the numbers in any
 * order is accepted and normalised. Everything else is rejected.
 * @param {unknown} raw
 */
function findSpot(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const direct = SPOTS.get(raw);
  if (direct) return direct;
  const match = /^([a-z]+):(\d{1,2}(?:-\d{1,2}){0,5})$/.exec(raw);
  if (!match) return null;
  const sorted = match[2]
    .split('-')
    .map(Number)
    .sort((a, b) => a - b);
  return SPOTS.get(`${match[1]}:${sorted.join('-')}`) || null;
}

/** Chips returned by a bet of `amount` on `spot` when `number` comes up (0 if it loses). */
function payoutOf(spot, amount, number) {
  return spot.numbers.includes(number) ? amount * (spot.payout + 1) : 0;
}

function create(ctx) {
  let phase = 'idle';
  let round = 1;
  let startedAt = null; // server epoch ms when the current phase began
  let deadline = null; // server epoch ms when the current phase ends
  let timer = null;
  let number = null; // drawn at spin time, public from then on
  let lastResult = null;
  const history = []; // newest first

  /** playerId -> Map<spotId, amount>: chips on the layout this round. */
  const bets = new Map();
  /** playerId -> stack of chip groups [{ spot, amount }], for "undo". */
  const undoStacks = new Map();
  /** players who pressed "Listo" this round. */
  const ready = new Set();
  /** playerId -> [{ spot, amount }]: bets of that player's last resolved round, for "rebet". */
  const previous = new Map();

  // ── helpers ──────────────────────────────────────────────────────────

  function totalOf(playerId) {
    const mine = bets.get(playerId);
    if (!mine) return 0;
    let total = 0;
    for (const amount of mine.values()) total += amount;
    return total;
  }

  function sumOf(group) {
    return group.reduce((total, chip) => total + chip.amount, 0);
  }

  function enterPhase(name, ms) {
    if (timer) timer.cancel();
    timer = null;
    phase = name;
    startedAt = ms === null ? null : ctx.now();
    deadline = ms === null ? null : ctx.deadline(ms);
  }

  function placeChips(playerId, group) {
    let mine = bets.get(playerId);
    if (!mine) {
      mine = new Map();
      bets.set(playerId, mine);
    }
    for (const chip of group) mine.set(chip.spot, (mine.get(chip.spot) || 0) + chip.amount);
    let stack = undoStacks.get(playerId);
    if (!stack) {
      stack = [];
      undoStacks.set(playerId, stack);
    }
    stack.push(group);
    if (phase === 'idle') openBetting();
  }

  function removeChips(playerId, group) {
    const mine = bets.get(playerId);
    for (const chip of group) {
      const left = mine.get(chip.spot) - chip.amount;
      if (left > 0) mine.set(chip.spot, left);
      else mine.delete(chip.spot);
    }
    if (mine.size === 0) {
      bets.delete(playerId);
      undoStacks.delete(playerId);
      ready.delete(playerId);
    }
    if (bets.size === 0) enterPhase('idle', null); // empty layout: stop the countdown
  }

  /** Throws unless this player may change bets right now. */
  function assertCanBet(playerId) {
    if (phase !== 'idle' && phase !== 'betting') {
      throw ctx.error('No va más: las apuestas están cerradas. Esperá la próxima ronda.');
    }
    if (ready.has(playerId)) {
      throw ctx.error('Ya marcaste "Listo". Desmarcalo para cambiar tus apuestas.');
    }
  }

  // ── phase transitions ────────────────────────────────────────────────

  function openBetting() {
    enterPhase('betting', TIMING.betting);
    timer = ctx.after(TIMING.betting, spin);
  }

  /** Spin as soon as every bettor still seated at the table is ready. */
  function spinIfEveryoneIsReady() {
    if (phase !== 'betting') return;
    const seated = new Set(ctx.seated().map((player) => player.id));
    const waitingFor = [...bets.keys()].filter((id) => seated.has(id));
    if (waitingFor.length > 0 && waitingFor.every((id) => ready.has(id))) spin();
  }

  function spin() {
    if (phase !== 'betting') return;
    enterPhase('spinning', TIMING.spinning);
    number = ctx.rng.int(0, 37);
    timer = ctx.after(TIMING.spinning, resolve);
    ctx.emit('spin', { round, number, duration: deadline - startedAt });
    ctx.sync();
  }

  function resolve() {
    const results = [];
    const winningSpots = new Set();
    let totalWagered = 0;
    let totalWon = 0;

    for (const [playerId, mine] of bets) {
      let wagered = 0;
      let won = 0;
      const chips = [];
      for (const [spotId, amount] of mine) {
        const payout = payoutOf(SPOTS.get(spotId), amount, number);
        wagered += amount;
        won += payout;
        if (payout > 0) winningSpots.add(spotId);
        chips.push({ spot: spotId, amount });
      }
      if (won > 0) ctx.credit(playerId, won);
      ctx.report(playerId, { wagered, won });
      previous.set(playerId, chips);
      totalWagered += wagered;
      totalWon += won;
      const player = ctx.player(playerId);
      results.push({
        id: playerId,
        name: player ? player.name : '',
        avatar: player ? player.avatar : 0,
        wagered,
        won,
        net: won - wagered,
      });
    }
    results.sort((a, b) => b.net - a.net);

    history.unshift(number);
    if (history.length > HISTORY_SIZE) history.length = HISTORY_SIZE;
    lastResult = {
      round,
      number,
      color: colorOf(number),
      results,
      winningSpots: [...winningSpots],
      totalWagered,
      totalWon,
    };

    // From here on the chips are paid: stakeOf() reports 0 (see below) while
    // the layout stays visible until the result phase ends.
    enterPhase('result', TIMING.result);
    timer = ctx.after(TIMING.result, reset);
    ctx.emit('result', lastResult);
    ctx.sync();
  }

  function reset() {
    bets.clear();
    undoStacks.clear();
    ready.clear();
    number = null;
    round += 1;
    enterPhase('idle', null);
    ctx.sync();
  }

  // ── actions ──────────────────────────────────────────────────────────

  function bet(playerId, action) {
    assertCanBet(playerId);
    const spot = findSpot(action.spot);
    if (!spot) throw ctx.error('Esa apuesta no existe en el paño.');
    const amount = action.amount;
    if (!Number.isSafeInteger(amount) || amount < 1) throw ctx.error('El monto de la apuesta no es válido.');

    const mine = bets.get(playerId);
    const onSpot = (mine ? mine.get(spot.id) || 0 : 0) + amount;
    if (onSpot < meta.minBet) throw ctx.error(`La apuesta mínima es de ${formatChips(meta.minBet)} fichas.`);
    if (onSpot > meta.maxBet) {
      throw ctx.error(`El máximo por casilla es de ${formatChips(meta.maxBet)} fichas.`);
    }
    if (totalOf(playerId) + amount > meta.tableLimit) {
      throw ctx.error(`El límite de la mesa es de ${formatChips(meta.tableLimit)} fichas por jugador.`);
    }
    // Everything is valid: only now do chips move.
    if (!ctx.debit(playerId, amount)) throw ctx.error('No te alcanzan las fichas para esa apuesta.');

    placeChips(playerId, [{ spot: spot.id, amount }]);
    ctx.emit('bet', { playerId, spot: spot.id, amount });
    ctx.sync();
  }

  function undo(playerId) {
    assertCanBet(playerId);
    const stack = undoStacks.get(playerId);
    if (!stack || stack.length === 0) throw ctx.error('No hay nada para deshacer.');
    const group = stack.pop();
    const amount = sumOf(group);
    removeChips(playerId, group);
    ctx.credit(playerId, amount);
    ctx.emit('unbet', { playerId, amount, reason: 'undo' });
    ctx.sync();
  }

  function clear(playerId) {
    assertCanBet(playerId);
    const mine = bets.get(playerId);
    if (!mine) throw ctx.error('No tenés apuestas en la mesa.');
    const group = [...mine].map(([spot, amount]) => ({ spot, amount }));
    const amount = sumOf(group);
    removeChips(playerId, group);
    ctx.credit(playerId, amount);
    ctx.emit('unbet', { playerId, amount, reason: 'clear' });
    ctx.sync();
  }

  function rebet(playerId) {
    assertCanBet(playerId);
    if (bets.has(playerId)) throw ctx.error('Para repetir la apuesta, primero retirá las fichas que pusiste.');
    const group = previous.get(playerId);
    if (!group || group.length === 0) throw ctx.error('Todavía no tenés una apuesta anterior para repetir.');
    const amount = sumOf(group);
    if (!ctx.debit(playerId, amount)) {
      throw ctx.error(`Necesitás ${formatChips(amount)} fichas para repetir la apuesta.`);
    }
    placeChips(playerId, group.map((chip) => ({ ...chip }))); // one undo step removes the whole rebet
    ctx.emit('rebet', { playerId, amount });
    ctx.sync();
  }

  function setReady(playerId, action) {
    const wanted = action.ready === undefined ? true : action.ready;
    if (typeof wanted !== 'boolean') throw ctx.error('Jugada inválida.');
    if (phase !== 'betting') throw ctx.error('Ahora no hay apuestas abiertas.');
    if (!bets.has(playerId)) throw ctx.error('Primero poné una ficha en el paño.');
    if (wanted) ready.add(playerId);
    else ready.delete(playerId);
    ctx.sync();
    spinIfEveryoneIsReady();
  }

  // ── view ─────────────────────────────────────────────────────────────

  function playerView(id, seated) {
    const player = ctx.player(id);
    const mine = bets.get(id);
    return {
      id,
      // Name and avatar travel with the view: a bettor who left the room is no
      // longer in the room snapshot, but the chips are still on the layout.
      name: player ? player.name : '',
      avatar: player ? player.avatar : 0,
      seated,
      connected: Boolean(player && player.connected),
      ready: ready.has(id),
      total: totalOf(id),
      bets: mine ? [...mine].map(([spot, amount]) => ({ spot, amount })) : [],
    };
  }

  return {
    onSit() {
      ctx.sync();
    },

    onLeave() {
      // The chips stay on the layout and resolve normally. Whoever left no
      // longer holds up the spin.
      spinIfEveryoneIsReady();
      ctx.sync();
    },

    onAction(playerId, action) {
      switch (action.type) {
        case 'bet':
          return bet(playerId, action);
        case 'undo':
          return undo(playerId);
        case 'clear':
          return clear(playerId);
        case 'rebet':
          return rebet(playerId);
        case 'ready':
          return setReady(playerId, action);
        default:
          throw ctx.error('Esa jugada no existe en la ruleta.');
      }
    },

    view(playerId) {
      const seated = ctx.seated();
      const seatedIds = new Set(seated.map((player) => player.id));
      const players = seated.map((player) => playerView(player.id, true));
      for (const id of bets.keys()) {
        if (!seatedIds.has(id)) players.push(playerView(id, false));
      }
      const open = phase === 'idle' || phase === 'betting';
      const isReady = ready.has(playerId);
      const stack = undoStacks.get(playerId);
      const before = previous.get(playerId);
      let tableTotal = 0;
      for (const id of bets.keys()) tableTotal += totalOf(id);

      return {
        phase,
        round,
        deadline, // server epoch ms; compare with api.serverNow()
        duration: deadline === null ? null : deadline - startedAt, // full length of the phase, ms
        number: phase === 'spinning' || phase === 'result' ? number : null,
        limits: { minBet: meta.minBet, maxBet: meta.maxBet, tableLimit: meta.tableLimit },
        players,
        totals: { table: tableTotal, you: totalOf(playerId) },
        you: {
          ready: isReady,
          canBet: open && !isReady,
          canUndo: open && !isReady && Boolean(stack && stack.length > 0),
          canClear: open && !isReady && bets.has(playerId),
          canRebet: open && !isReady && !bets.has(playerId) && Boolean(before && before.length > 0),
          canReady: phase === 'betting' && bets.has(playerId),
          rebetTotal: before ? sumOf(before) : 0,
        },
        history: history.slice(),
        result: lastResult, // last resolved round (null before the first spin)
      };
    },

    stakeOf(playerId) {
      // During 'result' the bets are still displayed but already paid.
      return phase === 'result' ? 0 : totalOf(playerId);
    },

    dispose() {
      // Nothing to release: ctx timers are cancelled automatically.
    },
  };
}

module.exports = {
  meta,
  create,
  // Exposed for tests and tooling; not part of the plugin contract.
  internals: { SPOTS, PAYOUTS, TIMING, WHEEL, RED_NUMBERS, HISTORY_SIZE, colorOf, findSpot, payoutOf },
};
