'use strict';

/** High-limit table: same rules as plinko.js, bigger numbers, and an entry requirement. */
module.exports = require('./plinko').variant({
  id: 'plinko_high',
  tier: 'high',
  minBalance: 10000,
  chips: [500, 1000, 5000, 10000],
  name: 'Plinko High Limit',
  tagline: 'Bolitas de 500 para arriba. Un borde de x1.000 acá es otra vida.',
  order: 16,
  minBet: 500,
  maxBet: 10000,
});
