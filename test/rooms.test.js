'use strict';

/**
 * Room-level behaviour, driven through the real Hub with fake transports and
 * a manual clock (test/helpers/fakeHub.js). The games are the test fixtures
 * "mint" (does whatever the test asks) and "vault" (an inert second table).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestHub } = require('./helpers/fakeHub');
const { generateRoomCode, normalizeRoomCode, CODE_ALPHABET, CODE_BLOCKLIST } = require('../server/rooms');
const goal = require('../server/goal');
const rng = require('../server/rng');

/** A club with a room and `names.length` members in it. Returns [club, ...clients]. */
function roomWith(names, options) {
  const club = createTestHub(options);
  const clients = names.map((name) => club.client({ name }));
  clients[0].send({ t: 'createRoom' });
  const code = clients[0].room().code;
  for (const client of clients.slice(1)) client.send({ t: 'joinRoom', code });
  return [club, ...clients];
}

const act = (client, action) => client.send({ t: 'action', action });
const totalBalance = (room) => room.players.reduce((sum, player) => sum + player.balance + player.stake, 0);

// ───────────────────────────── hello / profile ─────────────────────────────

test('hello: welcome carries identity, a 128-bit token, the clock and the games', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana', avatar: 7 });
  const welcome = ana.last('welcome');
  assert.deepEqual(Object.keys(welcome).sort(), ['games', 'room', 'serverNow', 't', 'token', 'you']);
  assert.match(welcome.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(welcome.you, { id: welcome.you.id, name: 'Ana', avatar: 7 });
  assert.equal(typeof welcome.you.id, 'string');
  assert.notEqual(welcome.you.id, welcome.token);
  assert.equal(welcome.serverNow, club.clock.now());
  assert.equal(welcome.room, null);
  assert.deepEqual(welcome.games.map((meta) => meta.id), ['vault', 'mint'], 'sorted by meta.order');
  assert.equal(welcome.games[1].name, 'Casa de Moneda');
});

test('hello: defaults and sanitising', () => {
  const club = createTestHub();
  const anonymous = club.client();
  assert.equal(anonymous.you.name, 'Invitado');
  assert.ok(Number.isInteger(anonymous.you.avatar) && anonymous.you.avatar >= 0 && anonymous.you.avatar <= 11);

  assert.equal(club.client({ name: '   ' }).you.name, 'Invitado');
  assert.equal(club.client({ name: 12345 }).you.name, 'Invitado');
  assert.equal(club.client({ name: '  Ana \n\t María  ' }).you.name, 'Ana María');
  assert.equal(club.client({ name: 'x'.repeat(40) }).you.name, 'x'.repeat(16));
  assert.equal(club.client({ name: 'A\u0000B\u0007C' }).you.name, 'A B C');
  assert.equal(club.client({ name: 'Bet​o‮﻿' }).you.name, 'Beto', 'zero-width and bidi overrides are stripped');
  assert.equal(club.client({ name: '<b>Ñandú</b>' }).you.name, '<b>Ñandú</b>', 'markup is kept verbatim (clients render text nodes)');
  assert.equal(club.client({ name: '😀'.repeat(20) }).you.name, '😀'.repeat(16), 'length is counted in code points');
  for (const avatar of [12, -1, 1.5, '3', null]) {
    const { avatar: assigned } = club.client({ name: 'X', avatar }).you;
    assert.ok(Number.isInteger(assigned) && assigned >= 0 && assigned <= 11, `avatar ${avatar} replaced by a valid one`);
  }
});

test('hello twice on the same connection is refused', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana' });
  ana.send({ t: 'hello', name: 'Otra' });
  assert.equal(ana.error().code, 'already_hello');
  assert.equal(ana.all('welcome').length, 1);
});

test('anything before hello is refused, except ping', () => {
  const club = createTestHub();
  const raw = club.client(false);
  raw.send({ t: 'createRoom' });
  assert.equal(raw.error().code, 'hello_required');
  raw.send({ t: 'ping', c: 7 });
  assert.deepEqual(raw.last('pong'), { t: 'pong', c: 7, s: club.clock.now() });
  assert.equal(club.hub.rooms.size, 0);
});

test('profile: updates name and avatar, validates both, and reaches the room', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'profile', name: '  Anita  ', avatar: 4 });
  assert.deepEqual(ana.last('you').you, { id: ana.you.id, name: 'Anita', avatar: 4 });
  assert.deepEqual(
    beto.room().players.map((player) => [player.name, player.avatar]),
    [['Anita', 4], ['Beto', beto.you.avatar]]
  );

  ana.send({ t: 'profile', name: '', avatar: 4 });
  assert.equal(ana.error().code, 'bad_name');
  ana.send({ t: 'profile', name: 'Ana', avatar: 12 });
  assert.equal(ana.error().code, 'bad_avatar');
  ana.send({ t: 'profile', name: 'Ana', avatar: '3' });
  assert.equal(ana.error().code, 'bad_avatar');
  ana.send({ t: 'profile', name: ['Ana'], avatar: 3 });
  assert.equal(ana.error().code, 'bad_name');
  ana.send({ t: 'profile' });
  assert.equal(ana.error().code, 'bad_profile');
  assert.equal(beto.room().players[0].name, 'Anita', 'rejected profiles change nothing');

  ana.send({ t: 'profile', avatar: 9 });
  assert.deepEqual(ana.last('you').you, { id: ana.you.id, name: 'Anita', avatar: 9 }, 'partial updates are fine');
});

// ───────────────────────────── create / join / leave ─────────────────────────────

test('createRoom: code, snapshot shape and starting balance', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana', avatar: 2 });
  ana.send({ t: 'createRoom' });
  const room = ana.room();
  assert.match(room.code, /^[A-Z]{4}$/);
  for (const letter of room.code) assert.ok(CODE_ALPHABET.includes(letter));
  assert.deepEqual(Object.keys(room).sort(), ['chat', 'code', 'feed', 'goal', 'players', 'rescue', 'tables', 'you']);
  assert.equal(room.you, ana.you.id);
  assert.deepEqual(room.players, [
    {
      id: ana.you.id,
      name: 'Ana',
      avatar: 2,
      balance: 1000,
      stake: 0,
      table: null,
      connected: true,
      stats: { rounds: 0, wagered: 0, won: 0, biggestWin: 0 },
    },
  ]);
  assert.deepEqual(room.tables, { vault: { seated: [] }, mint: { seated: [] } });
  assert.deepEqual(room.goal, {
    level: 0,
    title: 'Recién llegados',
    profit: 0,
    target: 2500,
    prevTarget: 0,
    nextTitle: 'Aprendices',
  });
  assert.deepEqual(room.chat, []);
  assert.equal(room.feed.length, 1);
  assert.deepEqual(room.feed[0], {
    id: 1,
    ts: club.clock.now(),
    kind: 'join',
    text: 'Ana se unió a la sala',
    playerId: ana.you.id,
    amount: null,
    targetId: null,
  });
  assert.deepEqual(room.rescue, { amount: 500, threshold: 10, cooldownMs: 30000, availableAt: 0 });
  assert.equal(club.hub.rooms.size, 1);
});

test('createRoom twice answers with the room you are already in', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana' });
  ana.send({ t: 'createRoom' });
  const code = ana.room().code;
  ana.clear();
  ana.send({ t: 'createRoom' });
  assert.equal(ana.all('room').length, 1, 'the client always gets an answer');
  assert.equal(ana.room().code, code);
  assert.equal(club.hub.rooms.size, 1);
  assert.equal(ana.room().players.length, 1);
});

test('joinRoom: by code (any case), everybody is told, wrong codes are refused', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana' });
  const beto = club.client({ name: 'Beto' });
  ana.send({ t: 'createRoom' });
  const code = ana.room().code;

  beto.send({ t: 'joinRoom', code: `  ${code.toLowerCase()} ` });
  assert.equal(beto.room().code, code);
  assert.equal(beto.room().you, beto.you.id);
  assert.deepEqual(ana.room().players.map((player) => player.name), ['Ana', 'Beto']);
  assert.equal(ana.room().you, ana.you.id, 'each viewer gets a personal snapshot');
  assert.deepEqual(ana.room().feed.map((entry) => entry.text), ['Ana se unió a la sala', 'Beto se unió a la sala']);
  assert.equal(beto.me().balance, 1000);

  const caro = club.client({ name: 'Caro' });
  for (const bad of ['ABC', 'ABCDE', '', 'AB1D', 'AB D', 1234, null, undefined, ['ABCD'], { code }]) {
    caro.clear();
    caro.send({ t: 'joinRoom', code: bad });
    assert.equal(caro.error().code, 'bad_code', `code ${JSON.stringify(bad)}`);
    assert.equal(caro.room(), null);
  }
  const missing = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  caro.send({ t: 'joinRoom', code: missing });
  assert.equal(caro.error().code, 'room_not_found');
  assert.equal(caro.error().message, 'No encontramos esa sala. Revisá el código.');
});

test('joinRoom twice is idempotent; joining another room switches rooms', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana' });
  const beto = club.client({ name: 'Beto' });
  ana.send({ t: 'createRoom' });
  beto.send({ t: 'createRoom' });
  const first = ana.room().code;
  const second = beto.room().code;
  assert.notEqual(first, second);

  ana.clear();
  ana.send({ t: 'joinRoom', code: first });
  assert.equal(ana.all('room').length, 1);
  assert.equal(ana.room().players.length, 1);

  ana.clear();
  ana.send({ t: 'joinRoom', code: second });
  assert.deepEqual(ana.messages.map((message) => message.t), ['left', 'room']);
  assert.equal(ana.room().code, second);
  assert.equal(ana.room().players.length, 2);
  assert.equal(club.hub.rooms.get(first).presentCount(), 0);
});

test('a room holds at most 8 players; a freed slot can be taken', () => {
  const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  const [club, ...members] = roomWith(names);
  const code = members[0].room().code;
  assert.equal(members[7].room().players.length, 8);

  const ninth = club.client({ name: 'Noveno' });
  ninth.send({ t: 'joinRoom', code });
  assert.equal(ninth.error().code, 'room_full');
  assert.match(ninth.error().message, /máximo 8/);
  assert.equal(ninth.room(), null);
  assert.equal(members[0].room().players.length, 8);

  members[3].send({ t: 'leaveRoom' });
  ninth.send({ t: 'joinRoom', code });
  assert.equal(ninth.room().players.length, 8);
  assert.ok(ninth.room().players.some((player) => player.name === 'Noveno'));
});

test('a full room does not make you lose the room you are in', () => {
  const [club, first] = roomWith(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  const outsider = club.client({ name: 'Afuera' });
  outsider.send({ t: 'createRoom' });
  const own = outsider.room().code;
  outsider.send({ t: 'joinRoom', code: first.room().code });
  assert.equal(outsider.error().code, 'room_full');
  assert.equal(outsider.room().code, own);
  assert.equal(outsider.all('left').length, 0);
});

test('leaveRoom: the leaver gets `left`, the others an updated snapshot and a feed line', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  beto.send({ t: 'leaveRoom' });
  assert.equal(beto.last('left').t, 'left');
  assert.equal(beto.room(), null);
  assert.deepEqual(ana.room().players.map((player) => player.name), ['Ana']);
  assert.equal(ana.room().feed.at(-1).text, 'Beto salió de la sala');
  assert.equal(ana.room().feed.at(-1).kind, 'leave');

  beto.clear();
  beto.send({ t: 'leaveRoom' });
  assert.deepEqual(beto.messages, [{ t: 'left' }], 'leaving twice is harmless');
  beto.send({ t: 'sit', game: 'mint' });
  assert.equal(beto.error().code, 'not_in_room');
  assert.equal(club.hub.rooms.size, 1);
});

test('coming back to a room restores the wallet instead of handing a new buy-in', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  const code = ana.room().code;
  beto.send({ t: 'sit', game: 'mint' });
  act(beto, { type: 'lose', amount: 400 });
  assert.equal(beto.me().balance, 600);
  beto.send({ t: 'leaveRoom' });
  assert.equal(ana.room().goal.profit, -400, 'people who left still count for the team profit');

  beto.send({ t: 'joinRoom', code });
  assert.equal(beto.me().balance, 600);
  assert.equal(beto.me().stats.rounds, 1);
  assert.equal(beto.room().goal.profit, -400);
  assert.equal(beto.room().feed.at(-1).text, 'Beto volvió a la sala');
  assert.deepEqual(beto.room().players.map((player) => player.name), ['Ana', 'Beto']);
});

// ───────────────────────────── tables ─────────────────────────────

test('sit / stand: seats show up in the snapshot and only seated players get views', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  assert.equal(ana.me().table, 'mint');
  assert.deepEqual(ana.room().tables, { vault: { seated: [] }, mint: { seated: [ana.you.id] } });
  assert.deepEqual(ana.game('mint'), { you: ana.you.id, stake: 0, seated: [ana.you.id], journal: [`sit:${ana.you.id}`] });
  assert.equal(beto.all('game').length, 0, 'spectators in the lobby get no table traffic');
  assert.equal(beto.room().players[0].table, 'mint');

  beto.send({ t: 'sit', game: 'mint' });
  assert.deepEqual(ana.game('mint').seated, [ana.you.id, beto.you.id], 'sit order');
  assert.equal(beto.game('mint').you, beto.you.id, 'views are per viewer');

  ana.send({ t: 'stand' });
  assert.equal(ana.me().table, null);
  assert.deepEqual(beto.room().tables.mint.seated, [beto.you.id]);
  assert.deepEqual(beto.game('mint').journal, [`sit:${ana.you.id}`, `sit:${beto.you.id}`, `leave:${ana.you.id}`]);

  ana.clear();
  ana.send({ t: 'stand' });
  assert.equal(ana.all('error').length, 0, 'standing while not seated is a no-op');
});

test('sitting at another table stands you up from the previous one', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  beto.send({ t: 'sit', game: 'mint' });
  ana.send({ t: 'sit', game: 'mint' });
  ana.send({ t: 'sit', game: 'vault' });
  assert.equal(ana.me().table, 'vault');
  assert.deepEqual(ana.room().tables, { vault: { seated: [ana.you.id] }, mint: { seated: [beto.you.id] } });
  assert.ok(beto.game('mint').journal.includes(`leave:${ana.you.id}`), 'onLeave ran on the old table');
  assert.deepEqual(ana.game('vault'), { you: ana.you.id, visits: [ana.you.id] });
});

test('sitting where you already sit just re-sends the view', () => {
  const [, ana] = roomWith(['Ana']);
  ana.send({ t: 'sit', game: 'mint' });
  ana.clear();
  ana.send({ t: 'sit', game: 'mint' });
  assert.equal(ana.all('game').length, 1);
  assert.deepEqual(ana.game('mint').journal, [`sit:${ana.you.id}`], 'onSit did not run twice');
});

test('a plugin can refuse a seat; unknown games are refused', () => {
  const [, a, b, c, d] = roomWith(['A', 'B', 'C', 'D']);
  for (const client of [a, b, c]) client.send({ t: 'sit', game: 'mint' });
  d.send({ t: 'sit', game: 'mint' });
  assert.deepEqual({ ...d.error() }, { t: 'error', message: 'Mesa llena', code: 'game' });
  assert.equal(d.me().table, null);
  assert.equal(d.room().tables.mint.seated.length, 3);
  assert.equal(d.all('game').length, 0);

  for (const game of ['poker', '', 'constructor', '__proto__', 'toString', 42, null, {}, ['mint']]) {
    d.clear();
    d.send({ t: 'sit', game });
    assert.equal(d.error().code, 'unknown_game', `game ${JSON.stringify(game)}`);
  }
});

test('actions are routed to the table of the sender, with errors only for the sender', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  act(ana, { type: 'win', amount: 100 });
  assert.equal(ana.error().code, 'not_seated');
  assert.equal(ana.error().message, 'No estás sentado en ninguna mesa.');

  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  ana.clear();
  beto.clear();

  act(ana, { type: 'nonsense' });
  assert.deepEqual({ ...ana.error() }, { t: 'error', message: 'Acción desconocida', code: 'game' });
  assert.equal(beto.messages.length, 0, 'a rejected action reaches nobody else');

  act(ana, { type: 'crash' });
  assert.equal(ana.error().code, 'internal');
  assert.equal(ana.error().message, 'Algo salió mal en la mesa. Probá de nuevo.');
  assert.equal(club.log.errors.length, 1, 'plugin bugs are logged');

  for (const action of [undefined, null, 'win', 42, [], { amount: 5 }, { type: 5 }, { type: '' }, { type: 'x'.repeat(41) }]) {
    ana.clear();
    ana.send({ t: 'action', action });
    assert.equal(ana.error().code, 'bad_action', `action ${JSON.stringify(action)}`);
  }
  assert.equal(ana.me().balance, 1000);
});

test('the sender of an action is the connection, never a field of the payload', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  ana.send({ t: 'action', playerId: beto.you.id, id: beto.you.id, action: { type: 'lose', amount: 300, playerId: beto.you.id } });
  assert.equal(ana.me().balance, 700);
  assert.equal(beto.me().balance, 1000);
});

test('events reach every seated player, or just the addressee', () => {
  const [, ana, beto, caro] = roomWith(['Ana', 'Beto', 'Caro']);
  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  for (const client of [ana, beto, caro]) client.clear();

  act(ana, { type: 'emit', note: 'hola' });
  const expected = { t: 'event', game: 'mint', name: 'hello', payload: { from: ana.you.id, note: 'hola' } };
  assert.deepEqual(ana.last('event'), expected);
  assert.deepEqual(beto.last('event'), expected);
  assert.equal(caro.all('event').length, 0, 'not seated: no events');

  for (const client of [ana, beto]) client.clear();
  act(ana, { type: 'emit', to: beto.you.id });
  assert.equal(ana.all('event').length, 0);
  assert.equal(beto.all('event').length, 1);
});

test('one flush per tick, ordered room -> game -> event, and unchanged snapshots are skipped', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  for (const client of [ana, beto]) client.clear();

  // Three messages in the same tick: no flush in between.
  const send = (action) => ana.conn.receive(JSON.stringify({ t: 'action', action }), false);
  send({ type: 'win', amount: 10 });
  send({ type: 'emit', note: 'x' });
  send({ type: 'win', amount: 5 });
  assert.equal(ana.messages.length, 0, 'nothing is pushed before the tick ends');
  club.clock.flush();
  assert.deepEqual(ana.messages.map((message) => message.t), ['room', 'game', 'event']);
  assert.deepEqual(beto.messages.map((message) => message.t), ['room', 'game', 'event']);
  assert.equal(ana.me().balance, 1015);

  for (const client of [ana, beto]) client.clear();
  act(ana, { type: 'emit' });
  assert.deepEqual(ana.messages.map((message) => message.t), ['game', 'event'], 'no room snapshot when nothing in it changed');
});

test('a misbehaving plugin cannot corrupt the room', () => {
  const [club, ana] = roomWith(['Ana']);
  ana.send({ t: 'sit', game: 'mint' });

  act(ana, { type: 'crashLater', ms: 1000 });
  club.clock.advance(1000);
  assert.equal(club.log.errors.length, 1, 'timer exception caught and logged');
  assert.match(String(club.log.errors[0][1]), /boom later/);
  act(ana, { type: 'win', amount: 1 });
  assert.equal(ana.me().balance, 1001, 'the table keeps working');

  for (const amount of [-5, 2.5, 'mil', null]) {
    ana.clear();
    act(ana, { type: 'win', amount });
    assert.equal(ana.error().code, 'internal', `ctx.credit(${amount}) throws inside the plugin`);
  }
  assert.equal(ana.me().balance, 1001);

  club.log.errors.length = 0;
  act(ana, { type: 'badStake' }); // stakeOf now returns 1.5
  assert.equal(ana.me().stake, 0, 'a non-integer stake is ignored');
  assert.ok(club.log.errors.some((args) => /stakeOf/.test(String(args[0]))));
});

test('feed announcements from games: automatic for notable wins, custom through ctx.announce', () => {
  const [, ana] = roomWith(['Ana']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'win', amount: 100 });
  assert.equal(ana.room().feed.length, 1, 'small wins are not news');
  act(ana, { type: 'win', amount: 800 });
  assert.deepEqual(
    { ...ana.room().feed.at(-1), id: 0, ts: 0 },
    { id: 0, ts: 0, kind: 'win', text: 'Ana ganó 800 fichas en Casa de Moneda', playerId: ana.you.id, amount: 800, targetId: null }
  );
  act(ana, { type: 'announce', text: '¡Pozo!', kind: 'jackpot', amount: 12345 });
  assert.deepEqual(
    { ...ana.room().feed.at(-1), id: 0, ts: 0 },
    { id: 0, ts: 0, kind: 'jackpot', text: '¡Pozo!', playerId: ana.you.id, amount: 12345, targetId: null }
  );
  assert.equal(ana.me().stats.rounds, 2);
  assert.equal(ana.me().stats.biggestWin, 800);
});

// ───────────────────────────── gifts ─────────────────────────────

test('gift: chips move between teammates, with a feed line and no effect on the profit', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'gift', to: beto.you.id, amount: 250 });
  assert.equal(ana.me().balance, 750);
  assert.equal(beto.me().balance, 1250);
  assert.equal(ana.room().goal.profit, 0);
  assert.deepEqual(
    { ...beto.room().feed.at(-1), id: 0, ts: 0 },
    { id: 0, ts: 0, kind: 'gift', text: 'Ana le regaló 250 fichas a Beto', playerId: ana.you.id, amount: 250, targetId: beto.you.id }
  );
  ana.send({ t: 'gift', to: beto.you.id, amount: 1 });
  assert.equal(beto.room().feed.at(-1).text, 'Ana le regaló 1 ficha a Beto');
  ana.send({ t: 'gift', to: beto.you.id, amount: 749 });
  assert.equal(ana.me().balance, 0, 'you can give away everything');
  assert.equal(totalBalance(ana.room()), 2000);
});

test('gift: validation', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const outsider = club.client({ name: 'Afuera' });
  outsider.send({ t: 'createRoom' });
  const cases = [
    [{ to: ana.you.id, amount: 10 }, 'bad_target'], // to self
    [{ to: outsider.you.id, amount: 10 }, 'bad_target'], // not in this room
    [{ to: 'nobody', amount: 10 }, 'bad_target'],
    [{ to: 42, amount: 10 }, 'bad_target'],
    [{ amount: 10 }, 'bad_target'],
    [{ to: beto.you.id, amount: 0 }, 'bad_amount'],
    [{ to: beto.you.id, amount: -100 }, 'bad_amount'],
    [{ to: beto.you.id, amount: 10.5 }, 'bad_amount'],
    [{ to: beto.you.id, amount: '10' }, 'bad_amount'],
    [{ to: beto.you.id, amount: null }, 'bad_amount'],
    [{ to: beto.you.id }, 'bad_amount'],
    [{ to: beto.you.id, amount: 1e30 }, 'bad_amount'],
    [{ to: beto.you.id, amount: 1001 }, 'insufficient'],
  ];
  for (const [fields, code] of cases) {
    ana.clear();
    ana.send({ t: 'gift', ...fields });
    assert.equal(ana.error().code, code, JSON.stringify(fields));
  }
  assert.equal(ana.me().balance, 1000);
  assert.equal(beto.me().balance, 1000);
  assert.equal(outsider.me().balance, 1000);

  // A spoofed sender is ignored: the chips leave the wallet of whoever sent the message.
  ana.send({ t: 'gift', from: beto.you.id, to: beto.you.id, amount: 10 });
  assert.equal(ana.me().balance, 990);
  assert.equal(beto.me().balance, 1010);
});

test('gift: chips at stake cannot be given away, and there is a short cooldown', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto'], { config: { GIFT_COOLDOWN_MS: 1000 } });
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 900 });
  ana.send({ t: 'gift', to: beto.you.id, amount: 101 });
  assert.equal(ana.error().code, 'insufficient');
  ana.send({ t: 'gift', to: beto.you.id, amount: 50 });
  ana.clear();
  ana.send({ t: 'gift', to: beto.you.id, amount: 50 });
  assert.equal(ana.error().code, 'gift_cooldown');
  club.clock.advance(1000);
  ana.send({ t: 'gift', to: beto.you.id, amount: 50 });
  assert.equal(ana.me().balance, 0);
  assert.equal(beto.me().balance, 1100);
});

// ───────────────────────────── rescue ─────────────────────────────

test('rescue: only when broke, adds 500 as a buy-in, 30 s cooldown', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });

  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_not_needed');
  act(ana, { type: 'lose', amount: 990 });
  ana.clear();
  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_not_needed', '10 chips left: not broke yet (needs < 10)');

  act(ana, { type: 'lose', amount: 1 });
  assert.equal(ana.me().balance, 9);
  const profitBefore = ana.room().goal.profit;
  assert.equal(profitBefore, -991);
  ana.clear();
  ana.send({ t: 'rescue' });
  assert.equal(ana.all('error').length, 0);
  assert.equal(ana.me().balance, 509);
  assert.equal(ana.room().goal.profit, profitBefore, 'a rescue is a buy-in: the team profit does not move');
  assert.deepEqual(
    { ...beto.room().feed.at(-1), id: 0, ts: 0 },
    { id: 0, ts: 0, kind: 'rescue', text: 'Ana pidió un rescate: +500 fichas', playerId: ana.you.id, amount: 500, targetId: null }
  );
  assert.equal(ana.room().rescue.availableAt, club.clock.now() + 30000);
  assert.equal(beto.room().rescue.availableAt, 0, 'the cooldown is personal');

  act(ana, { type: 'lose', amount: 505 });
  ana.clear();
  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_cooldown');
  assert.match(ana.error().message, /Esperá 30 s/);
  club.clock.advance(29999);
  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_cooldown');
  club.clock.advance(1);
  ana.clear();
  ana.send({ t: 'rescue' });
  assert.equal(ana.all('error').length, 0);
  assert.equal(ana.me().balance, 504);
});

test('rescue: chips at stake count against being broke', () => {
  const [, ana] = roomWith(['Ana']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 1000 });
  assert.equal(ana.me().balance, 0);
  assert.equal(ana.me().stake, 1000);
  ana.send({ t: 'rescue' });
  assert.equal(ana.error().code, 'rescue_not_needed');
  act(ana, { type: 'settle', multiplier: 0 });
  ana.clear();
  ana.send({ t: 'rescue' });
  assert.equal(ana.all('error').length, 0);
  assert.equal(ana.me().balance, 500);
});

// ───────────────────────────── team goal ─────────────────────────────

test('goal module: targets, titles and bonuses', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(goal.targetFor), [0, 2500, 7500, 20000, 50000, 125000, 312500, 781250]);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(goal.titleFor),
    ['Recién llegados', 'Aprendices', 'Apostadores', 'Tiburones', 'Altos Rodadores', 'Leyendas del Club',
      'Leyendas del Club II', 'Leyendas del Club III', 'Leyendas del Club IV']
  );
  assert.deepEqual([1, 2, 3, 4, 5].map(goal.bonusFor), [250, 750, 2000, 5000, 12500]);
  for (let level = 1; level <= goal.MAX_LEVEL + 1; level += 1) {
    assert.ok(Number.isSafeInteger(goal.targetFor(level)));
    assert.ok(goal.targetFor(level) > goal.targetFor(level - 1), 'targets ascend');
    assert.ok(goal.bonusFor(level) > 0 && Number.isInteger(goal.bonusFor(level)));
  }
  assert.equal(goal.levelFor(2499, 0), 0);
  assert.equal(goal.levelFor(2500, 0), 1);
  assert.equal(goal.levelFor(20000, 0), 3);
  assert.equal(goal.levelFor(-5000, 2), 2, 'never below the current level');
  assert.equal(goal.levelFor(Number.MAX_SAFE_INTEGER, 0), goal.MAX_LEVEL);
});

test('team profit counts balances and stakes of everybody against their buy-ins', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 600 });
  assert.equal(ana.me().balance, 400);
  assert.equal(ana.me().stake, 600);
  assert.equal(ana.room().goal.profit, 0, 'chips on the table are not lost yet');
  act(beto, { type: 'lose', amount: 300 });
  assert.equal(ana.room().goal.profit, -300);
  act(ana, { type: 'settle', multiplier: 2 });
  assert.equal(ana.me().balance, 1600);
  assert.equal(ana.me().stake, 0);
  assert.equal(ana.room().goal.profit, 300);
});

test('level-up: celebration, feed line and a bonus that leaves the profit untouched', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'win', amount: 2499 });
  assert.equal(ana.room().goal.level, 0);
  assert.equal(ana.all('celebrate').length, 0);

  for (const client of [ana, beto]) client.clear();
  act(ana, { type: 'win', amount: 1 });
  const expectedCelebration = { t: 'celebrate', kind: 'level', level: 1, title: 'Aprendices', bonus: 250, profit: 2500 };
  assert.deepEqual(ana.last('celebrate'), expectedCelebration);
  assert.deepEqual(beto.last('celebrate'), expectedCelebration, 'the whole room celebrates, seated or not');
  assert.deepEqual(ana.messages.map((message) => message.t), ['room', 'game', 'celebrate']);

  const room = beto.room();
  assert.deepEqual(room.goal, {
    level: 1,
    title: 'Aprendices',
    profit: 2500,
    target: 7500,
    prevTarget: 2500,
    nextTitle: 'Apostadores',
  });
  assert.equal(ana.me().balance, 1000 + 2500 + 250);
  assert.equal(beto.me().balance, 1000 + 250);
  const line = room.feed.find((entry) => entry.kind === 'level');
  assert.equal(line.text, '¡Nivel 1: Aprendices! Bono de 250 fichas para cada uno');
  assert.equal(line.amount, 250);

  // The bonus is a buy-in: it must not push the team towards the next level.
  act(ana, { type: 'win', amount: 4999 });
  assert.equal(ana.room().goal.profit, 7499);
  assert.equal(ana.room().goal.level, 1);
});

test('levels never go back down', () => {
  const [, ana] = roomWith(['Ana']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'win', amount: 8000 });
  assert.equal(ana.room().goal.level, 2);
  const afterBonus = ana.me().balance;
  assert.equal(afterBonus, 1000 + 8000 + 250 + 750);

  ana.clear();
  act(ana, { type: 'lose', amount: afterBonus });
  assert.equal(ana.room().goal.profit, -2000);
  assert.equal(ana.room().goal.level, 2);
  assert.equal(ana.room().goal.title, 'Apostadores');
  assert.equal(ana.all('celebrate').length, 0);

  // Climbing back over an old target does not pay its bonus twice.
  ana.send({ t: 'rescue' });
  act(ana, { type: 'win', amount: 7000 });
  assert.equal(ana.room().goal.profit, 5000);
  assert.equal(ana.room().goal.level, 2);
  assert.equal(ana.all('celebrate').length, 0);
  assert.equal(ana.me().balance, 7500);
});

test('jumping several levels at once: one celebration, every bonus paid', () => {
  const [, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'win', amount: 20000 });
  assert.deepEqual(ana.all('celebrate'), [
    { t: 'celebrate', kind: 'level', level: 3, title: 'Tiburones', bonus: 3000, profit: 20000 },
  ]);
  assert.equal(beto.me().balance, 1000 + 250 + 750 + 2000);
  assert.equal(ana.room().goal.profit, 20000);
  assert.deepEqual(
    ana.room().feed.filter((entry) => entry.kind === 'level').map((entry) => entry.text),
    [
      '¡Nivel 1: Aprendices! Bono de 250 fichas para cada uno',
      '¡Nivel 2: Apostadores! Bono de 750 fichas para cada uno',
      '¡Nivel 3: Tiburones! Bono de 2.000 fichas para cada uno',
    ]
  );
});

test('bonus accounting: profit is invariant under level bonuses, gifts and rescues', () => {
  const [, ana, beto, caro] = roomWith(['Ana', 'Beto', 'Caro']);
  for (const client of [ana, beto, caro]) client.send({ t: 'sit', game: 'mint' });
  let house = 0; // net chips the house paid out
  const play = (client, type, amount) => {
    act(client, { type, amount });
    house += type === 'win' ? amount : -amount;
    assert.equal(ana.room().goal.profit, house);
  };
  play(ana, 'win', 3000); // level 1
  ana.send({ t: 'gift', to: beto.you.id, amount: 1234 });
  assert.equal(ana.room().goal.profit, house);
  play(beto, 'lose', 2000);
  play(caro, 'lose', 1250);
  caro.send({ t: 'rescue' });
  assert.equal(caro.me().balance, 500);
  assert.equal(ana.room().goal.profit, house);
  play(caro, 'win', 9000); // level 2 (profit 8750)
  assert.equal(ana.room().goal.level, 2);
  assert.equal(house, 8750);
  // chips in play = buy-ins (3 x 1000) + rescue + bonuses (3 x (250 + 750)) + what the house paid
  assert.equal(totalBalance(ana.room()), 3000 + 500 + 3000 + house);
});

// ───────────────────────────── disconnect / reconnect ─────────────────────────────

test('reconnecting with the token restores identity, room, seat and balance', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 300 });
  ana.disconnect();
  assert.equal(beto.room().players[0].connected, false);
  assert.equal(beto.room().players[0].table, 'mint', 'the seat is kept');

  club.clock.advance(20000);
  const back = club.reconnect(ana);
  const welcome = back.last('welcome');
  assert.deepEqual(welcome.you, ana.you);
  assert.equal(welcome.token, ana.token);
  assert.equal(welcome.room.code, beto.room().code);
  assert.equal(back.me().balance, 700);
  assert.equal(back.me().stake, 300);
  assert.equal(back.me().table, 'mint');
  assert.equal(back.me().connected, true);
  assert.equal(back.game('mint').stake, 300, 'the table view is pushed right after the welcome');
  assert.deepEqual(back.messages.slice(0, 2).map((message) => message.t), ['welcome', 'game']);
  assert.equal(beto.room().players[0].connected, true);

  club.clock.advance(120000);
  assert.equal(back.me().table, 'mint', 'the seat timeout was cancelled by the reconnection');
});

test('an unknown or malformed token just creates a new identity', () => {
  const [club, ana] = roomWith(['Ana']);
  for (const token of ['f'.repeat(32), ana.you.id, 'short', 12345, null, { $ne: 1 }, ana.token.toUpperCase(), `${ana.token} `]) {
    const stranger = club.client({ name: 'X', token });
    assert.notEqual(stranger.you.id, ana.you.id, `token ${JSON.stringify(token)}`);
    assert.notEqual(stranger.token, ana.token);
    assert.equal(stranger.last('welcome').room, null);
  }
  assert.equal(ana.all('error').length, 0, 'the real Ana was not disturbed');
});

test('the same identity in a second tab replaces the first connection', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const second = club.reconnect(ana);
  assert.equal(ana.error().code, 'replaced');
  assert.deepEqual(ana.closed, { code: 4001, reason: 'replaced' });
  assert.equal(second.room().players.length, 2);
  assert.equal(beto.room().players[0].connected, true);

  ana.clear();
  ana.send({ t: 'gift', to: beto.you.id, amount: 100 });
  assert.equal(ana.messages.length, 0, 'the replaced connection is dead');
  assert.equal(second.me().balance, 1000);

  ana.disconnect(); // the old socket finally closes: must not mark the player as offline
  assert.equal(beto.room().players[0].connected, true);
  second.send({ t: 'gift', to: beto.you.id, amount: 100 });
  assert.equal(second.me().balance, 900);
});

test('seat timeout: a disconnected player keeps the seat for 60 s, then is stood up', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  ana.send({ t: 'sit', game: 'mint' });
  beto.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 200 });
  ana.disconnect();

  club.clock.advance(59999);
  assert.equal(beto.room().players[0].table, 'mint');
  assert.equal(beto.room().players[0].connected, false);
  club.clock.advance(1);
  assert.equal(beto.room().players[0].table, null);
  assert.deepEqual(beto.room().tables.mint.seated, [beto.you.id]);
  assert.ok(beto.game('mint').journal.includes(`leave:${ana.you.id}`), 'onLeave was called');
  assert.equal(beto.room().players[0].stake, 200, 'chips at stake stay at stake');
  assert.equal(beto.room().players.length, 2, 'still a member of the room');

  const back = club.reconnect(ana);
  assert.equal(back.me().table, null);
  assert.equal(back.me().balance, 800);
  assert.equal(back.all('game').length, 0);
});

test('chips at stake are paid to a player who left the table, and even the room', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const code = ana.room().code;
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'stake', amount: 400 });
  act(ana, { type: 'settleLater', ms: 5000, multiplier: 3 });
  ana.send({ t: 'leaveRoom' });
  assert.equal(ana.room(), null);
  assert.equal(beto.room().players.length, 1);
  assert.equal(beto.room().goal.profit, 0, 'the stake of someone who left still counts');

  // Time passes, the bet resolves x3 while Ana is away.
  club.clock.advance(5000);
  assert.equal(beto.room().goal.profit, 800);
  ana.send({ t: 'joinRoom', code });
  assert.equal(ana.me().balance, 600 + 1200);
  assert.equal(ana.me().stats.rounds, 1);
});

test('a player who stays disconnected for 10 minutes gives up the slot but not the chips', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const code = ana.room().code;
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'lose', amount: 100 });
  ana.disconnect();
  club.clock.advance(10 * 60000 - 1);
  assert.equal(beto.room().players.length, 2);
  club.clock.advance(1);
  assert.deepEqual(beto.room().players.map((player) => player.name), ['Beto']);
  assert.equal(beto.room().feed.at(-1).text, 'Ana salió de la sala');

  const back = club.reconnect(ana);
  assert.equal(back.last('welcome').room, null, 'no longer in the room...');
  back.send({ t: 'joinRoom', code });
  assert.equal(back.me().balance, 900, '...but the wallet is waiting');
});

test('a room is destroyed after everybody has been disconnected for 10 minutes', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const code = ana.room().code;
  ana.send({ t: 'sit', game: 'mint' });
  act(ana, { type: 'settleLater', ms: 3600000 });
  ana.disconnect();
  club.clock.advance(5 * 60000);
  beto.disconnect();
  club.clock.advance(10 * 60000 - 1);
  assert.equal(club.hub.rooms.size, 1, 'the countdown starts when the LAST player disconnects');
  club.clock.advance(1);
  assert.equal(club.hub.rooms.size, 0);
  assert.equal(club.clock.pending(), 0, 'no timer of the room or its games survives');

  const back = club.reconnect(beto);
  assert.equal(back.last('welcome').room, null);
  assert.deepEqual(back.you, beto.you, 'the identity itself is still known');
  back.send({ t: 'joinRoom', code });
  assert.equal(back.error().code, 'room_not_found');
});

test('a reconnection cancels the destruction of the room', () => {
  const [club, ana] = roomWith(['Ana']);
  ana.disconnect();
  club.clock.advance(9 * 60000);
  const back = club.reconnect(ana);
  club.clock.advance(60 * 60000);
  assert.equal(club.hub.rooms.size, 1);
  assert.equal(back.room().players[0].connected, true);
});

test('an empty room (everybody left) is also destroyed after 10 minutes', () => {
  const [club, ana] = roomWith(['Ana']);
  ana.send({ t: 'leaveRoom' });
  assert.equal(club.hub.rooms.size, 1, 'kept for a while: the invite link may still be in use');
  club.clock.advance(10 * 60000);
  assert.equal(club.hub.rooms.size, 0);
});

test('idle identities are forgotten, identities in a live room are not', () => {
  const [club, ana] = roomWith(['Ana']);
  const loner = club.client({ name: 'Solo' });
  loner.disconnect();
  ana.disconnect();
  club.clock.advance(9 * 60000);
  club.client({ name: 'Trigger' }); // any hello runs the sweep
  assert.equal(club.reconnect(loner).you.id, loner.you.id, 'within the TTL the identity is kept');

  const loner2 = club.client({ name: 'Solo 2' });
  loner2.disconnect();
  club.clock.advance(11 * 60000);
  club.client({ name: 'Trigger' });
  assert.notEqual(club.reconnect(loner2).you.id, loner2.you.id, 'forgotten after the TTL');
});

// ───────────────────────────── chat / feed ─────────────────────────────

test('chat: broadcast to the room, sanitised, kept in the snapshot', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  const outsider = club.client({ name: 'Afuera' });
  ana.send({ t: 'chat', text: '  ¡Vamos   equipo!\n<img src=x onerror=alert(1)> ' });
  const expected = {
    id: 1,
    from: ana.you.id,
    name: 'Ana',
    avatar: ana.you.avatar,
    text: '¡Vamos equipo! <img src=x onerror=alert(1)>',
    ts: club.clock.now(),
  };
  assert.deepEqual(ana.last('chat'), { t: 'chat', msg: expected });
  assert.deepEqual(beto.last('chat'), { t: 'chat', msg: expected });
  assert.equal(outsider.all('chat').length, 0);

  const caro = club.client({ name: 'Caro' });
  caro.send({ t: 'joinRoom', code: ana.room().code });
  assert.deepEqual(caro.room().chat, [expected], 'late joiners get the backlog');
});

test('chat: length limits, types and rate limit', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto']);
  for (const text of ['', '   ', '​​', 'x'.repeat(201), 42, null, undefined, ['hola'], { text: 'hola' }]) {
    ana.clear();
    ana.send({ t: 'chat', text });
    assert.equal(ana.error().code, 'bad_chat', `text ${JSON.stringify(text)}`);
  }
  assert.equal(beto.all('chat').length, 0);

  ana.send({ t: 'chat', text: 'x'.repeat(200) });
  assert.equal(beto.last('chat').msg.text.length, 200);
  for (let i = 0; i < 4; i += 1) ana.send({ t: 'chat', text: `mensaje ${i}` });
  ana.clear();
  ana.send({ t: 'chat', text: 'uno más' });
  assert.equal(ana.error().code, 'chat_rate');
  assert.equal(beto.all('chat').length, 5);
  club.clock.advance(8000);
  ana.send({ t: 'chat', text: 'ahora sí' });
  assert.equal(beto.all('chat').length, 6);

  const loner = club.client({ name: 'Solo' });
  loner.send({ t: 'chat', text: 'hola?' });
  assert.equal(loner.error().code, 'not_in_room');
});

test('chat and feed keep only the last 50 entries', () => {
  const [club, ana, beto] = roomWith(['Ana', 'Beto'], { config: { CHAT_BURST: 1000 } });
  for (let i = 1; i <= 60; i += 1) ana.send({ t: 'chat', text: `m${i}` });
  for (let i = 1; i <= 60; i += 1) ana.send({ t: 'gift', to: beto.you.id, amount: 1 });
  const room = beto.room();
  assert.equal(room.chat.length, 50);
  assert.equal(room.chat[0].text, 'm11');
  assert.equal(room.chat.at(-1).text, 'm60');
  assert.equal(room.feed.length, 50);
  assert.equal(room.feed.at(-1).id, 62);
  assert.ok(room.feed.every((entry, index) => index === 0 || entry.id === room.feed[index - 1].id + 1));
  void club;
});

// ───────────────────────────── transport-level protection ─────────────────────────────

test('garbage frames get an error and never throw', () => {
  const [club, ana] = roomWith(['Ana']);
  const frames = ['', 'hola', '{', '[]', 'null', '42', '"text"', '{"t":5}', '{"no":"type"}', '{"t":null}', '[{"t":"ping"}]'];
  for (const frame of frames) {
    ana.clear();
    ana.raw(frame);
    assert.equal(ana.error().code, 'bad_message', `frame ${frame}`);
  }
  ana.clear();
  ana.raw(Buffer.from('{"t":"ping"}'), true);
  assert.equal(ana.error().code, 'bad_message', 'binary frames are refused');
  ana.raw(Buffer.from('{"t":"ping","c":1}'), false);
  assert.equal(ana.last('pong').c, 1, 'text frames may arrive as Buffers');

  for (const type of ['nope', 'constructor', '__proto__', 'toString', 'Hello', 'HELLO', '_hello']) {
    ana.clear();
    ana.send({ t: type });
    assert.equal(ana.error().code, 'unknown_message', `type ${type}`);
  }
  assert.equal(club.log.errors.length, 0, 'none of this is a server error');
  assert.equal(ana.me().balance, 1000);
});

test('ping echoes only small scalars', () => {
  const club = createTestHub();
  const ana = club.client({ name: 'Ana' });
  ana.send({ t: 'ping', c: 'abc' });
  assert.equal(ana.last('pong').c, 'abc');
  ana.send({ t: 'ping', c: { big: 'x'.repeat(1000) } });
  assert.equal(ana.last('pong').c, null);
  ana.send({ t: 'ping', c: 'x'.repeat(65) });
  assert.equal(ana.last('pong').c, null);
  ana.send({ t: 'ping' });
  assert.equal(ana.last('pong').c, null);
  assert.equal(ana.last('pong').s, club.clock.now());
});

test('rate limit: bursts are dropped with a notice, floods get disconnected', () => {
  const club = createTestHub({ config: { RATE_BURST: 10, RATE_PER_SECOND: 5, RATE_KICK_STRIKES: 50 } });
  const ana = club.client({ name: 'Ana' }); // hello used one token
  for (let i = 0; i < 9; i += 1) ana.send({ t: 'ping', c: i });
  assert.equal(ana.all('pong').length, 9);
  ana.send({ t: 'ping', c: 'dropped' });
  ana.send({ t: 'ping', c: 'dropped too' });
  assert.equal(ana.all('pong').length, 9);
  assert.equal(ana.all('error').length, 1, 'one notice, not one per dropped message');
  assert.equal(ana.error().code, 'rate_limited');

  club.clock.advance(1000); // 5 tokens back
  for (let i = 0; i < 5; i += 1) ana.send({ t: 'ping', c: i });
  assert.equal(ana.all('pong').length, 14);
  assert.equal(ana.closed, null);

  for (let i = 0; i < 60; i += 1) ana.send({ t: 'ping', c: i });
  assert.deepEqual(ana.closed, { code: 1008, reason: 'rate limit' });
  const count = ana.messages.length;
  ana.send({ t: 'ping' });
  assert.equal(ana.messages.length, count, 'nothing more is processed after the kick');
});

// ───────────────────────────── room codes ─────────────────────────────

test('room codes: 4 unambiguous uppercase letters, unique, never offensive', () => {
  assert.equal(CODE_ALPHABET.length, 23);
  for (const ambiguous of ['I', 'L', 'O', '0', '1']) assert.ok(!CODE_ALPHABET.includes(ambiguous));
  const taken = new Set();
  for (let i = 0; i < 500; i += 1) {
    const code = generateRoomCode(rng, (candidate) => taken.has(candidate));
    assert.match(code, /^[A-HJKMNP-Z]{4}$/);
    assert.ok(!taken.has(code));
    assert.ok(!CODE_BLOCKLIST.has(code));
    taken.add(code);
  }
  // A blocked or taken code is skipped: script the generator to propose them first.
  const letters = (word) => [...word].map((letter) => CODE_ALPHABET.indexOf(letter));
  const proposals = [...letters('PUTA'), ...letters('ABCD'), ...letters('WXYZ')];
  const scripted = { int: () => proposals.shift() };
  assert.equal(generateRoomCode(scripted, (candidate) => candidate === 'ABCD'), 'WXYZ');
  assert.equal(generateRoomCode({ int: () => 0 }, () => true), null, 'gives up instead of looping forever');

  assert.equal(normalizeRoomCode(' abcd '), 'ABCD');
  assert.equal(normalizeRoomCode('ABCD'), 'ABCD');
  for (const bad of ['ABC', 'ABCDE', 'AB1D', 'AB-D', '', null, 1234, 'x'.repeat(100)]) {
    assert.equal(normalizeRoomCode(bad), null);
  }
});

test('many rooms get distinct codes; the club has a capacity', () => {
  const club = createTestHub({ config: { MAX_ROOMS: 20 } });
  const codes = new Set();
  for (let i = 0; i < 20; i += 1) {
    const host = club.client({ name: `Host ${i}` });
    host.send({ t: 'createRoom' });
    codes.add(host.room().code);
  }
  assert.equal(codes.size, 20);
  const late = club.client({ name: 'Tarde' });
  late.send({ t: 'createRoom' });
  assert.equal(late.error().code, 'club_full');
  assert.equal(late.room(), null);
});
