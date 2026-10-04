'use strict';

/** Test-only game: a second, inert table (to test moving between tables). */

const meta = { id: 'vault', name: 'Bóveda', tagline: 'Otra mesa de pruebas', order: 1, minBet: 1, maxBet: 100 };

function create(ctx) {
  const visits = [];
  return {
    onSit(id) {
      visits.push(id);
    },
    onLeave() {},
    onAction() {
      throw ctx.error('Acá no se juega');
    },
    view(id) {
      return { you: id, visits: visits.slice() };
    },
    stakeOf() {
      return 0;
    },
  };
}

module.exports = { meta, create };
