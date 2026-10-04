'use strict';

// Persistent profiles (signed saves), contributions to the team quota, loans,
// the shop, social spends, history and the high-limit tables.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestHub } = require('./helpers/fakeHub');
const saves = require('../server/saves');
const economy = require('../server/economy');

function roomWith(names, options) {
  const club = createTestHub(options);
  const clients = names.map((name) => club.client({ name }));
  clients[0].send({ t: 'createRoom' });
  const code = clients[0].room().code;
  for (const client of clients.slice(1)) client.send({ t: 'joinRoom', code });
  return [club, ...clients];
}
const act = (client, action) => client.send({ t: 'action', action });
const seat = (client) => client.send({ t: 'sit', game: 'mint' });

// ───────────────────────────── saves ─────────────────────────────

test('saves: round trip, and anything tampered with is refused', () => {
  const save = saves.pack({ v: 1, id: 'p0123456789ab', balance: 5 });
  assert.deepEqual(saves.unpack(save), { v: 1, id: 'p0123456789ab', balance: 5 });
  const [data, sig] = save.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, id: 'p0123456789ab', balance: 999999 }), 'utf8').toString('base64url');
  assert.equal(saves.unpack(`${forged}.${sig}`), null);
  assert.equal(saves.unpack(`${data}.${sig.slice(0, -2)}xx`), null);
  for (const junk of ['', 'abc', '.', 'a.', '.b', null, 42, 'x'.repeat(20000)]) assert.equal(saves.unpack(junk), null);
});

test('saves: the signing key can be upgraded without losing the profiles signed before', () => {
  const keep = { CLUB_SECRET: process.env.CLUB_SECRET, RENDER_SERVICE_ID: process.env.RENDER_SERVICE_ID };
  try {
    delete process.env.CLUB_SECRET;
    delete process.env.RENDER_SERVICE_ID;
    const dev = saves.pack({ v: 1, id: 'p0123456789ab' });
    assert.equal(saves.isSecured(), false);

    process.env.RENDER_SERVICE_ID = 'srv-test';
    assert.equal(saves.isSecured(), true);
    assert.equal(saves.unpack(dev), null, 'the key that is in the source is no longer accepted');
    const hosted = saves.pack({ v: 1, id: 'p0123456789ab' });

    process.env.CLUB_SECRET = 'a-real-secret';
    const secured = saves.pack({ v: 1, id: 'p0123456789ab' });
    assert.notEqual(secured, hosted);
    assert.deepEqual(saves.unpack(hosted), { v: 1, id: 'p0123456789ab' }, 'older saves keep working');
    assert.deepEqual(saves.unpack(secured), { v: 1, id: 'p0123456789ab' });
  } finally {
    for (const [key, value] of Object.entries(keep)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a save restores the whole profile on a fresh server; chips at stake come back', () => {
  const [club, ana] = roomWith(['Ana']);
  seat(ana);
  act(ana, { type: 'win', amount: 400 });
  act(ana, { type: 'stake', amount: 300 });
  ana.send({ t: 'loan', amount: 500 });
  club.clock.advance(2000);
  const save = ana.last('save').save;
  assert.equal(typeof save, 'string');

  const restarted = createTestHub();
  const back = restarted.client({ save });
  const welcome = back.last('welcome');
  assert.equal(welcome.you.id, ana.you.id, 'same public identity');
  assert.equal(welcome.you.name, 'Ana');
  assert.equal(welcome.profile.balance, 1000 + 400 + 500, 'the 300 at stake are returned');
  assert.equal(welcome.profile.debt, 600);
  assert.equal(welcome.profile.stats.won, 400);
  assert.notEqual(welcome.token, ana.token);

  back.send({ t: 'createRoom' });
  assert.equal(back.me().balance, 1900);
  assert.equal(back.me().net, 0, 'a new room starts counting from zero');
  assert.equal(back.me().debt, 600);
});

test('a forged or foreign save is ignored: brand-new identity with the starting balance', () => {
  const club = createTestHub();
  const forged = `${Buffer.from(JSON.stringify({ v: 1, id: 'p0123456789ab', balance: 5000000 }), 'utf8').toString('base64url')}.AAAA`;
  const eve = club.client({ name: 'Eve', save: forged });
  assert.equal(eve.last('welcome').profile.balance, 1000);
  assert.notEqual(eve.you.id, 'p0123456789ab');
});

test('a save for an identity that is still alive attaches to it (memory wins over the save)', () => {
  const [club, ana] = roomWith(['Ana']);
  const stale = ana.last('welcome').save; // 1000 chips
  seat(ana);
  act(ana, { type: 'lose', amount: 900 });
  const again = club.client({ save: stale });
  assert.equal(again.you.id, ana.you.id);
  assert.equal(again.last('welcome').profile.balance, 100, 'the old save cannot undo the loss');
  assert.equal(ana.closed.code, 4001, 'the previous connection is replaced');
});

test('the wallet travels from room to room', () => {
  const [, ana] = roomWith(['Ana']);
  seat(ana);
  act(ana, { type: 'lose', amount: 300 });
  ana.send({ t: 'leaveRoom' });
  ana.send({ t: 'createRoom' });
  assert.equal(ana.me().balance, 700);
  assert.equal(ana.room().goal.profit, 0);
  assert.equal(ana.me().stats.wagered, 300, 'stats are personal, not per room');
});

// ───────────────────────────── contributions ─────────────────────────────

test('every member shows the own contribution to the quota; gifts do not move it', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  seat(ana);
  seat(beto);
  act(ana, { type: 'win', amount: 800 });
  act(beto, { type: 'lose', amount: 300 });
  const nets = () => Object.fromEntries(ana.room().players.map((player) => [player.name, player.net]));
  assert.deepEqual(nets(), { Ana: 800, Beto: -300 });
  ana.send({ t: 'gift', to: beto.you.id, amount: 500 });
  assert.deepEqual(nets(), { Ana: 800, Beto: -300 });
  assert.equal(ana.room().goal.profit, 500);
  act(beto, { type: 'stake', amount: 200 });
  assert.deepEqual(nets(), { Ana: 800, Beto: -300 }, 'chips at stake are not lost yet');
});

test('what a player does after leaving does not move the old room', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  seat(ana);
  act(ana, { type: 'win', amount: 500 });
  const code = ana.room().code;
  ana.send({ t: 'leaveRoom' });
  assert.equal(beto.room().goal.profit, 500);
  ana.send({ t: 'createRoom' });
  seat(ana);
  act(ana, { type: 'lose', amount: 1200 });
  assert.equal(beto.room().goal.profit, 500, 'her losses elsewhere are not this room business');
  ana.send({ t: 'joinRoom', code });
  assert.equal(beto.room().goal.profit, 500);
  assert.equal(ana.me().net, 500, 'she comes back with the contribution she left with');
  assert.equal(ana.me().balance, 300);
});

test('peak: the most a player was ever worth, borrowed chips not counted, and it survives a restart', () => {
  const [club, ana] = roomWith(['Ana']);
  seat(ana);
  assert.equal(ana.me().peak, 1000);
  act(ana, { type: 'win', amount: 4000 }); // quota 1: +250 bonus
  assert.equal(ana.me().peak, 5250);
  act(ana, { type: 'stake', amount: 5000 });
  assert.equal(ana.me().peak, 5250, 'chips on the table are still hers');
  act(ana, { type: 'settle', multiplier: 0 });
  ana.send({ t: 'loan', amount: 1000 });
  assert.equal(ana.me().balance, 1250);
  assert.equal(ana.me().peak, 5250, 'a loan is not wealth');
  club.clock.advance(2000);
  const back = createTestHub().client({ save: ana.last('save').save });
  assert.equal(back.last('welcome').profile.peak, 5250);
});

// ───────────────────────────── loans ─────────────────────────────

test('loan: interest, limit by level, garnish on every net win, manual repay', () => {
  const [, ana] = roomWith(['Ana']);
  seat(ana);
  ana.send({ t: 'loan', amount: 50 });
  assert.equal(ana.error().code, 'bad_amount');
  ana.send({ t: 'loan', amount: 500 });
  assert.equal(ana.me().balance, 1500);
  assert.equal(ana.me().debt, 600);
  assert.equal(ana.room().goal.profit, 0, 'borrowed chips are not profit');
  ana.send({ t: 'loan', amount: 600 });
  assert.equal(ana.error().code, 'loan_limit', '600 + 720 would exceed the level-0 limit of 1.200');

  act(ana, { type: 'win', amount: 1000 }); // 30 % of the net win goes to the debt
  assert.equal(ana.me().debt, 300);
  assert.equal(ana.me().balance, 1500 + 1000 - 300);
  assert.equal(ana.room().goal.profit, 1000);

  ana.send({ t: 'repay', amount: 5000 });
  assert.equal(ana.me().debt, 0);
  assert.equal(ana.me().balance, 1900);
  assert.equal(ana.room().goal.profit, 1000);
  assert.ok(ana.room().feed.some((entry) => entry.kind === 'debt'));
});

test('repayFor: a teammate can pay somebody else\'s debt', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  beto.send({ t: 'loan', amount: 500 });
  ana.send({ t: 'repayFor', to: beto.you.id, amount: 250 });
  assert.equal(beto.me().debt, 350);
  assert.equal(ana.me().balance, 750);
  assert.deepEqual(ana.room().players.map((player) => player.net), [0, 0]);
  ana.send({ t: 'repayFor', to: ana.you.id, amount: 10 });
  assert.equal(ana.error().code, 'bad_target');
});

// ───────────────────────────── shop / look ─────────────────────────────

test('shop: titles, cosmetics and themes are bought once, equipped, and never touch the profit', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  seat(ana);
  act(ana, { type: 'win', amount: 9000 });
  const profit = ana.room().goal.profit;
  const balance = ana.me().balance;

  ana.send({ t: 'buy', item: 'title:timbero' });
  assert.equal(ana.me().title, 'Timbero de ley');
  ana.send({ t: 'buy', item: 'hat:fedora' });
  assert.equal(ana.me().look.hat, 'fedora', 'a cosmetic is worn right away');
  assert.equal(beto.room().players[0].look.hat, 'fedora', 'and everybody sees it');
  ana.send({ t: 'buy', item: 'theme:crimson' });
  assert.equal(ana.room().economy.theme, 'theme:crimson');
  assert.deepEqual(ana.room().economy.owned, ['title:timbero', 'hat:fedora', 'theme:crimson']);
  assert.equal(ana.me().balance, balance - 1500 - 1500 - 2500);
  assert.equal(ana.room().goal.profit, profit);

  ana.send({ t: 'buy', item: 'hat:fedora' });
  assert.equal(ana.error().code, 'owned');
  ana.send({ t: 'buy', item: 'hat:nope' });
  assert.equal(ana.error().code, 'bad_item');
  ana.send({ t: 'buy', item: 'theme:emerald' });
  assert.equal(ana.error().code, 'bad_item', 'the free theme is not for sale');
  beto.send({ t: 'buy', item: 'hat:crown' });
  assert.equal(beto.error().code, 'insufficient');

  ana.send({ t: 'equip', item: null });
  assert.equal(ana.me().title, null);
  ana.send({ t: 'equip', item: 'theme:emerald' });
  assert.equal(ana.room().economy.theme, 'theme:emerald');
  ana.send({ t: 'equip', item: 'title:dueno' });
  assert.equal(ana.error().code, 'bad_item');
});

test('look: free parts are validated, paid parts must be owned', () => {
  const [, ana] = roomWith(['Ana']);
  const base = { ...economy.LOOK_DEFAULT };
  ana.send({ t: 'look', look: { ...base, skin: 3, hair: 5, hairColor: 7, pants: 2 }, avatar: 4 });
  assert.equal(ana.me().look.skin, 3);
  assert.equal(ana.me().avatar, 4);
  ana.send({ t: 'look', look: { ...base, hat: 'tophat' } });
  assert.equal(ana.error().code, 'not_owned');
  for (const bad of [null, [], { ...base, skin: 6 }, { ...base, hair: -1 }, { ...base, pants: 1.5 }, { ...base, hat: 'ghost' }, { ...base, pet: 7 }]) {
    ana.clear();
    ana.send({ t: 'look', look: bad });
    assert.ok(ana.error(), `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(ana.me().look.skin, 3, 'a refused look changes nothing');
});

test('in debt there is no shopping', () => {
  const [, ana] = roomWith(['Ana']);
  ana.send({ t: 'loan', amount: 900 });
  ana.send({ t: 'buy', item: 'hat:party' });
  assert.equal(ana.error().code, 'in_debt');
});

// ───────────────────────────── social spends ─────────────────────────────

test('throw, rain and tip cost chips, reach the whole room and leave the profit alone', () => {
  const [, ana, beto, caro] = roomWith(['Ana', 'Beto', 'Caro']);
  seat(ana);
  act(ana, { type: 'win', amount: 2000 });
  const profit = ana.room().goal.profit;

  ana.send({ t: 'throw', to: beto.you.id, item: 'tomato' });
  assert.deepEqual(caro.last('throw'), { t: 'throw', from: ana.you.id, name: 'Ana', to: beto.you.id, toName: 'Beto', item: 'tomato' });
  ana.send({ t: 'throw', to: 'dealer', item: 'cake' });
  assert.equal(ana.error().code, 'throw_cooldown');
  ana.send({ t: 'throw', to: ana.you.id, item: 'rose' });
  assert.equal(ana.error().code, 'bad_target');
  ana.send({ t: 'throw', to: beto.you.id, item: 'anvil' });
  assert.equal(ana.error().code, 'bad_item');

  const before = ana.me().balance;
  ana.send({ t: 'rain' });
  assert.equal(ana.me().balance, before - economy.RAIN.cost);
  assert.equal(beto.me().balance, 1000 + economy.RAIN.each);
  assert.equal(caro.last('rain').name, 'Ana');

  ana.send({ t: 'tip', amount: 500 });
  assert.equal(beto.last('tip').amount, 500);
  ana.send({ t: 'tip', amount: 5 });
  assert.equal(ana.error().code, 'bad_amount');

  assert.equal(ana.room().goal.profit, profit);
  assert.deepEqual(ana.room().players.map((player) => player.net), [2000, 0, 0]);
});

// ───────────────────────────── history ─────────────────────────────

test('history: every resolved bet lands in the personal history, newest first', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  seat(ana);
  act(ana, { type: 'lose', amount: 100 });
  act(ana, { type: 'win', amount: 250 });
  beto.send({ t: 'profileOf', id: ana.you.id });
  const card = beto.last('profileOf').player;
  assert.equal(card.name, 'Ana');
  assert.deepEqual(card.history.map((entry) => [entry.g, entry.w, entry.r]), [
    ['Casa de Moneda', 0, 250],
    ['Casa de Moneda', 100, 0],
  ]);
  assert.equal(card.net, 150);
  assert.equal(card.stats.rounds, 2);
  beto.send({ t: 'profileOf', id: 'nobody' });
  assert.equal(beto.error().code, 'bad_target');
});

// ───────────────────────────── rescue minigame ─────────────────────────────

test('rescue minigame: a sequence to repeat; a wrong answer pays nothing', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto'], { config: { RESCUE_MINIGAME: 1 } });
  ana.send({ t: 'gift', to: beto.you.id, amount: 995 });
  ana.send({ t: 'rescue' });
  const challenge = ana.last('rescueChallenge');
  assert.equal(challenge.sequence.length, economy.RESCUE_GAME.length);
  ana.send({ t: 'rescue', answer: challenge.sequence.map((value) => (value + 1) % 4) });
  assert.equal(ana.error().code, 'rescue_failed');
  assert.equal(ana.me().balance, 5);
  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_cooldown');
  club.clock.advance(economy.RESCUE_GAME.failCooldownMs);
  ana.send({ t: 'rescue' });
  ana.send({ t: 'rescue', answer: ana.last('rescueChallenge').sequence });
  assert.equal(ana.me().balance, 505);
  ana.send({ t: 'rescue', answer: [0, 0, 0, 0, 0, 0] });
  assert.equal(ana.error().code, 'rescue_expired', 'a challenge is single use');
});

// ───────────────────────────── high limit ─────────────────────────────

test('high-limit tables: same games, bigger limits, and you need the chips to sit', () => {
  const club = createTestHub({ realGames: true });
  const ana = club.client({ name: 'Ana' });
  const games = ana.last('welcome').games;
  const high = games.filter((meta) => meta.tier === 'high');
  assert.deepEqual(high.map((meta) => meta.base).sort(), ['baccarat', 'blackjack', 'poker3', 'roulette', 'slots']);
  for (const meta of high) {
    const base = games.find((other) => other.id === meta.base);
    assert.ok(meta.minBet > base.minBet && meta.maxBet > base.maxBet);
    assert.ok(meta.minBalance >= 10000);
  }
  ana.send({ t: 'createRoom' });
  ana.send({ t: 'sit', game: 'blackjack_high' });
  assert.equal(ana.error().code, 'high_limit');
  assert.equal(ana.me().table, null);
});
