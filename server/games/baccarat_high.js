'use strict';

/** High-limit table: same rules as baccarat.js, bigger numbers, and an entry requirement. */
module.exports = require('./baccarat').variant({
  id: 'baccarat_high',
  tier: 'high',
  minBalance: 10000,
  chips: [
    500,
    1000,
    5000,
    25000
  ],
  name: 'Baccarat High Limit',
  tagline: 'El juego de las ballenas, con límites de ballena.',
  order: 14,
  minBet: 500,
  maxBet: 100000
});
