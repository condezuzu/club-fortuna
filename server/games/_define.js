'use strict';

/**
 * Wraps a game written as createWith(meta, ctx) into a plugin, and lets other
 * files derive variants of it (the high-limit tables) by overriding meta:
 *
 *   module.exports = defineGame(meta, createWith, { internals });
 *   // roulette_high.js
 *   module.exports = require('./roulette').variant({ id: 'roulette_high', minBet: 250, ... });
 *
 * Variant metas carry `base` (the id of the game they derive from, which is
 * also the client module that renders them), `tier`, `minBalance` (chips a
 * player must hold to sit) and `chips` (the denominations of the bet tray).
 */
function defineGame(meta, createWith, extras) {
  const make = (m) => ({ meta: m, create: (ctx) => createWith(m, ctx) });
  return {
    ...make(meta),
    ...extras,
    variant: (overrides) => make(Object.freeze({ ...meta, base: meta.id, ...overrides })),
  };
}

module.exports = { defineGame };
