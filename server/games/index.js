'use strict';

/**
 * Game registry: auto-discovers every plugin in this folder.
 *
 * A plugin is any `server/games/<id>.js` except this file and files whose name
 * starts with an underscore (shared helpers such as `_hands.js`). Adding a game
 * to the casino is dropping one file here (plus its client module); nothing
 * else needs to be registered.
 */

const fs = require('node:fs');
const path = require('node:path');

const GAME_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const INSTANCE_METHODS = ['onSit', 'onLeave', 'onAction', 'view', 'stakeOf'];

/**
 * Throws a descriptive Error when `plugin` does not honour the contract.
 * @param {any} plugin   the module.exports of a game file
 * @param {string} expectedId  the file name without extension
 */
function validatePlugin(plugin, expectedId) {
  if (!plugin || typeof plugin !== 'object') throw new Error('module.exports must be an object { meta, create }');
  const { meta, create } = plugin;
  if (!meta || typeof meta !== 'object') throw new Error('missing meta');
  if (typeof meta.id !== 'string' || !GAME_ID.test(meta.id)) {
    throw new Error('meta.id must be lowercase letters, digits, "-" or "_"');
  }
  if (meta.id !== expectedId) throw new Error(`meta.id "${meta.id}" must match the file name "${expectedId}.js"`);
  if (typeof meta.name !== 'string' || meta.name.trim() === '') throw new Error('meta.name must be a non-empty string');
  if (typeof meta.tagline !== 'string') throw new Error('meta.tagline must be a string');
  if (typeof meta.order !== 'number' || !Number.isFinite(meta.order)) throw new Error('meta.order must be a number');
  if (!Number.isInteger(meta.minBet) || meta.minBet < 1) throw new Error('meta.minBet must be a positive integer');
  if (!Number.isInteger(meta.maxBet) || meta.maxBet < meta.minBet) {
    throw new Error('meta.maxBet must be an integer >= meta.minBet');
  }
  if (typeof create !== 'function') throw new Error('missing create(ctx)');
  try {
    JSON.stringify(meta);
  } catch (err) {
    throw new Error('meta must be JSON-serialisable');
  }
}

/** Throws when a freshly created instance lacks one of the mandatory methods. */
function validateInstance(instance, id) {
  if (!instance || typeof instance !== 'object') throw new Error(`${id}: create(ctx) must return an object`);
  for (const method of INSTANCE_METHODS) {
    if (typeof instance[method] !== 'function') throw new Error(`${id}: instance.${method}() is missing`);
  }
  if (instance.dispose !== undefined && typeof instance.dispose !== 'function') {
    throw new Error(`${id}: instance.dispose must be a function when present`);
  }
}

/**
 * @param {string} [dir] folder to scan (defaults to server/games)
 * @param {{ error: Function }} [log]
 * @returns {{ games: Map<string, { meta: object, create: Function }>, list: object[], errors: { file: string, error: Error }[] }}
 *   `list` is what clients receive in `welcome.games`: a JSON copy of each meta, sorted by `order`.
 *   A broken plugin is skipped and reported in `errors` (the test suite fails on it)
 *   so one bad file cannot take the whole club down.
 */
function loadGames(dir = __dirname, log = console) {
  const games = new Map();
  const errors = [];
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.js') && name !== 'index.js' && !name.startsWith('_'))
    .sort();

  for (const file of files) {
    const id = file.slice(0, -3);
    try {
      const plugin = require(path.join(dir, file));
      validatePlugin(plugin, id);
      games.set(id, plugin);
    } catch (error) {
      errors.push({ file, error });
      log.error(`[games] ${file} was skipped: ${error && error.message}`);
    }
  }

  const list = [...games.values()]
    .map((plugin) => JSON.parse(JSON.stringify(plugin.meta)))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return { games, list, errors };
}

module.exports = { loadGames, validatePlugin, validateInstance, GAME_ID };
