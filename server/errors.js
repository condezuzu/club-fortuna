'use strict';

/**
 * Errors whose message is meant for the player.
 *
 * Anything thrown as a ClubError (or a subclass) is delivered to the offending
 * player only, as `{ t: 'error', message, code }`. The message is written in
 * Spanish (rioplatense voseo) and shown as a toast. Any other exception is a
 * bug: it is logged with its stack and the player gets a generic message.
 */
class ClubError extends Error {
  /**
   * @param {string} message Spanish, user-facing.
   * @param {string} [code]  Stable machine-readable code (see docs/GAME_API.md).
   */
  constructor(message, code) {
    super(message);
    this.name = 'ClubError';
    this.code = code || 'invalid';
  }
}

/** Thrown by game plugins through `ctx.error('…')` to reject an action or a seat. */
class GameError extends ClubError {
  constructor(message) {
    super(message, 'game');
    this.name = 'GameError';
  }
}

module.exports = { ClubError, GameError };
