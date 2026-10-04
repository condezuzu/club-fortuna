'use strict';

module.exports = {
  meta: { id: 'good', name: 'Buena', tagline: 'Funciona', order: 5, minBet: 1, maxBet: 10 },
  create() {
    return { onSit() {}, onLeave() {}, onAction() {}, view: () => ({}), stakeOf: () => 0 };
  },
};
