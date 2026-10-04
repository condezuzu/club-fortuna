'use strict';

/** High-limit table: same rules as slots.js, bigger numbers, and an entry requirement. */
module.exports = require('./slots').variant({
  id: 'slots_high',
  tier: 'high',
  minBalance: 10000,
  chips: [
    500,
    1000,
    5000,
    10000
  ],
  name: 'Tragamonedas High Roller',
  tagline: 'Giros caros y un pozo que arranca en un cuarto de millón.',
  order: 13,
  minBet: 500,
  maxBet: 10000,
  jackpotSeed: 250000
});
