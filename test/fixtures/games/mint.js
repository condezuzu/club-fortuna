'use strict';

/**
 * Test-only game: a table that does whatever the test asks, so room-level
 * behaviour (wallet, stakes, team goal, events, timers, misbehaving plugins)
 * can be exercised deterministically. Never loaded by the real server.
 */

const meta = {
  id: 'mint',
  name: 'Casa de Moneda',
  tagline: 'Mesa de pruebas',
  order: 2,
  minBet: 1,
  maxBet: 1000000,
  seats: 3,
};

function create(ctx) {
  const stakes = new Map();
  const journal = [];

  function settle(id, multiplier) {
    const stake = stakes.get(id) || 0;
    stakes.delete(id);
    const won = stake * multiplier;
    ctx.credit(id, won);
    ctx.report(id, { wagered: stake, won });
    ctx.sync();
  }

  return {
    onSit(id) {
      if (ctx.seated().length > meta.seats) throw ctx.error('Mesa llena');
      journal.push(`sit:${id}`);
    },

    onLeave(id) {
      journal.push(`leave:${id}`);
    },

    onAction(id, action) {
      switch (action.type) {
        case 'win': // chips from the house
          ctx.credit(id, action.amount);
          ctx.report(id, { wagered: 0, won: action.amount });
          break;
        case 'lose': // chips to the house
          if (!ctx.debit(id, action.amount)) throw ctx.error('Saldo insuficiente');
          ctx.report(id, { wagered: action.amount, won: 0 });
          break;
        case 'stake':
          if (!Number.isInteger(action.amount) || action.amount < 1) throw ctx.error('Monto inválido');
          if (!ctx.debit(id, action.amount)) throw ctx.error('Saldo insuficiente');
          stakes.set(id, (stakes.get(id) || 0) + action.amount);
          break;
        case 'settle':
          settle(id, Number.isInteger(action.multiplier) ? action.multiplier : 1);
          break;
        case 'settleLater':
          ctx.after(action.ms, () => settle(id, Number.isInteger(action.multiplier) ? action.multiplier : 1));
          break;
        case 'emit':
          ctx.emit('hello', { from: id, note: action.note || null }, action.to);
          break;
        case 'announce':
          ctx.announce(action.text, { kind: action.kind, playerId: id, amount: action.amount });
          break;
        case 'crash':
          throw new Error('boom');
        case 'crashLater':
          ctx.after(action.ms, () => {
            throw new Error('boom later');
          });
          break;
        case 'badStake':
          stakes.set(id, 1.5);
          break;
        default:
          throw ctx.error('Acción desconocida');
      }
      ctx.sync();
    },

    view(id) {
      return {
        you: id,
        stake: stakes.get(id) || 0,
        seated: ctx.seated().map((player) => player.id),
        journal: journal.slice(),
      };
    },

    stakeOf(id) {
      return stakes.get(id) || 0;
    },
  };
}

module.exports = { meta, create };
