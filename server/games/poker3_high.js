'use strict';

/** High-limit table: same rules as poker3.js, bigger numbers, and an entry requirement. */
module.exports = require('./poker3').variant({
  id: 'poker3_high',
  tier: 'high',
  minBalance: 10000,
  chips: [
    500,
    1000,
    5000,
    25000
  ],
  name: 'Póker High Limit',
  tagline: 'Tres cartas y mucha plata sobre el paño.',
  order: 15,
  minBet: 500,
  maxBet: 25000
});
