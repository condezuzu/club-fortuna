'use strict';

/** High-limit table: same rules as roulette.js, bigger numbers, and an entry requirement. */
module.exports = require('./roulette').variant({
  id: 'roulette_high',
  tier: 'high',
  minBalance: 10000,
  chips: [
    500,
    1000,
    5000,
    25000
  ],
  name: 'Ruleta High Limit',
  tagline: 'La misma rueda, otras cifras. Solo para bolsillos pesados.',
  order: 11,
  minBet: 250,
  maxBet: 50000,
  tableLimit: 500000
});
