'use strict';

/**
 * "Everybody confirms" for the betting phase of a shared table.
 *
 * A round must not start on somebody who is still choosing a bet: it starts
 * when every seated, connected player has confirmed (with or without a bet —
 * confirming without one means sitting the round out), or when the table's own
 * countdown runs out. Players who left the table or lost the connection never
 * hold the others up. A player alone at the table just confirms and plays.
 *
 *   const ready = createReady(ctx);
 *   ready.set(playerId, true);
 *   if (ready.all()) startTheRound();
 */
function createReady(ctx) {
  const confirmed = new Set();
  const present = () => ctx.seated().filter((player) => player.connected);
  return {
    has: (id) => confirmed.has(id),
    set(id, on) {
      if (on) confirmed.add(id);
      else confirmed.delete(id);
    },
    delete: (id) => confirmed.delete(id),
    clear: () => confirmed.clear(),
    /** Has everybody seated (and connected) confirmed? False for an empty table. */
    all() {
      const players = present();
      return players.length > 0 && players.every((player) => confirmed.has(player.id));
    },
    /** Names of the seated players the table is still waiting for. */
    waiting: () =>
      present()
        .filter((player) => !confirmed.has(player.id))
        .map((player) => player.name),
    list: () => [...confirmed],
  };
}

module.exports = { createReady };
