'use strict';

/** High-limit table: same rules as blackjack.js, bigger numbers, and an entry requirement. */
module.exports = require('./blackjack').variant({
  id: 'blackjack_high',
  tier: 'high',
  minBalance: 10000,
  chips: [
    500,
    1000,
    5000,
    25000
  ],
  name: 'Blackjack High Limit',
  tagline: 'Manos de 500 para arriba. Acá no se viene a mirar.',
  order: 12,
  minBet: 500,
  maxBet: 50000
});
