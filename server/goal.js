'use strict';

/**
 * The team goal: the cooperative heart of the club.
 *
 *   profit = sum(balance + stake) - sum(buyIns)   over everybody who has ever
 *                                                  been in the room
 *
 * Levels are reached when the profit crosses ascending targets and never go
 * back down. Level 0 is where every room starts.
 */

const START_TITLE = 'Recién llegados';

const NAMED_LEVELS = Object.freeze([
  { target: 2_500, title: 'Aprendices' },
  { target: 7_500, title: 'Apostadores' },
  { target: 20_000, title: 'Tiburones' },
  { target: 50_000, title: 'Altos Rodadores' },
  { target: 125_000, title: 'Leyendas del Club' },
]);

const GROWTH = 2.5; // every level past the named ones multiplies the target
const ROUND_TO = 1_250; // keeps the generated targets on tidy numbers
const MAX_LEVEL = 30; // far beyond anything reachable; keeps targets in safe-integer range
const BONUS_SHARE = 0.1; // bonus per player = 10 % of the level target
const BONUS_ROUND_TO = 50;

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function roman(n) {
  let rest = n;
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

const targetCache = [0, ...NAMED_LEVELS.map((level) => level.target)];

/** Profit needed to reach `level` (0 for level 0). */
function targetFor(level) {
  if (!Number.isInteger(level) || level < 0) throw new RangeError(`Invalid level: ${level}`);
  while (targetCache.length <= level) {
    const previous = targetCache[targetCache.length - 1];
    targetCache.push(Math.round((previous * GROWTH) / ROUND_TO) * ROUND_TO);
  }
  return targetCache[level];
}

/** Spanish title of a level. */
function titleFor(level) {
  if (level <= 0) return START_TITLE;
  if (level <= NAMED_LEVELS.length) return NAMED_LEVELS[level - 1].title;
  // Level 6 is "Leyendas del Club II", level 7 "… III", and so on.
  return `${NAMED_LEVELS[NAMED_LEVELS.length - 1].title} ${roman(level - NAMED_LEVELS.length + 1)}`;
}

/** Chips every present player receives when the team reaches `level`. */
function bonusFor(level) {
  if (level <= 0) return 0;
  return Math.round((targetFor(level) * BONUS_SHARE) / BONUS_ROUND_TO) * BONUS_ROUND_TO;
}

/** The level the team deserves with this profit; never lower than `currentLevel`. */
function levelFor(profit, currentLevel) {
  let level = currentLevel;
  while (level < MAX_LEVEL && profit >= targetFor(level + 1)) level += 1;
  return level;
}

/**
 * The `goal` object of the room snapshot.
 * Progress towards the next level = (profit - prevTarget) / (target - prevTarget),
 * clamped to 0..1 by the client (profit may be negative or fall below prevTarget).
 */
function goalView(level, profit) {
  return {
    level,
    title: titleFor(level),
    profit,
    target: targetFor(level + 1),
    prevTarget: targetFor(level),
    nextTitle: titleFor(level + 1),
  };
}

module.exports = { MAX_LEVEL, START_TITLE, targetFor, titleFor, bonusFor, levelFor, goalView };
