'use strict';

/**
 * Hostile clients against the real server. Whatever arrives on the socket,
 * the process must stay up, nobody's chips may move, and well-behaved clients
 * must not notice. (If a handler threw outside its try/catch the test process
 * itself, which hosts the server, would crash and fail the run.)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers/harness');

/** Send something and wait until the server has answered it with an error of the given code. */
async function expectError(client, message, code) {
  client.drain();
  if (typeof message === 'string' || Buffer.isBuffer(message)) client.sendRaw(message);
  else client.send(message);
  const error = await client.waitForError(undefined, { label: `error for ${JSON.stringify(message).slice(0, 80)}` });
  assert.equal(error.code, code, `${JSON.stringify(message).slice(0, 120)} -> ${error.code}: ${error.message}`);
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0);
  return error;
}

describe('hostile input', () => {
  let server;
  let ana; // seated at the roulette with Beto: the victims
  let beto;
  let mallory; // in the same room, not seated

  before(async () => {
    // Real-time game timers (nothing here should ever start a round) and a
    // generous rate limit so the abuse below is judged on its own merits.
    server = await startServer({ timeScale: 1, config: { RATE_BURST: 2000, RATE_PER_SECOND: 2000 } });
    ana = await server.join('Ana');
    beto = await server.join('Beto');
    mallory = await server.join('Mallory');
    ana.send({ t: 'createRoom' });
    const { code } = await ana.waitForRoom();
    for (const client of [beto, mallory]) {
      client.send({ t: 'joinRoom', code });
      await client.waitForRoom();
    }
    for (const client of [ana, beto]) {
      client.send({ t: 'sit', game: 'roulette' });
      await client.waitForGame('roulette');
    }
    await ana.waitForRoom((room) => room.players.length === 3 && room.tables.roulette.seated.length === 2);
  });
  after(() => server.close());

  /** Nothing moved: three players, 1000 chips each, nothing at stake, table idle. */
  async function assertUntouched() {
    await ana.settle();
    await mallory.settle();
    const response = await server.request('/healthz');
    assert.equal(response.status, 200, 'the server is alive');
    assert.deepEqual(
      ana.room.players.map((player) => [player.name, player.balance, player.stake]),
      [['Ana', 1000, 0], ['Beto', 1000, 0], ['Mallory', 1000, 0]]
    );
    assert.equal(ana.games.roulette.phase, 'idle');
    assert.equal(ana.games.roulette.totals.table, 0);
  }

  test('garbage frames: not JSON, not objects, no type', async () => {
    const frames = ['hola', '{', '}{', '[]', '[1,2,3]', 'null', 'true', '42', '"t"', '{"t":5}', '{"t":null}', '{"t":["hello"]}',
      '{"type":"hello"}', '{"t":{"t":"ping"}}', '\u0000', '{"t":"ping"', "{'t':'ping'}", 'undefined', 'NaN'];
    for (const frame of frames) await expectError(mallory, frame, 'bad_message');
    await expectError(mallory, ' '.repeat(100), 'bad_message');
    await assertUntouched();
  });

  test('binary frames are refused', async () => {
    mallory.drain();
    mallory.sendRaw(Buffer.from(JSON.stringify({ t: 'ping', c: 1 })), { binary: true });
    assert.equal((await mallory.waitForError()).code, 'bad_message');
    mallory.sendRaw(Buffer.from([0, 1, 2, 3, 255, 254]), { binary: true });
    assert.equal((await mallory.waitForError()).code, 'bad_message');
    await assertUntouched();
  });

  test('unknown message types, including prototype property names', async () => {
    for (const t of ['nope', 'constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'HELLO', 'Ping', ' ping', 'ping ', '']) {
      await expectError(mallory, { t }, 'unknown_message');
    }
    await expectError(mallory, '{"t":"__proto__","__proto__":{"t":"gift"}}', 'unknown_message');
    await assertUntouched();
  });

  test('prototype pollution attempts do not stick', async () => {
    mallory.drain();
    mallory.sendRaw('{"t":"ping","c":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    await mallory.waitFor('pong');
    mallory.sendRaw('{"t":"action","action":{"type":"bet","spot":"red","amount":5,"__proto__":{"amount":999}}}');
    await mallory.waitForError('not_seated');
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    await assertUntouched();
  });

  test('wrong types in every field of every message', async () => {
    const junk = [null, 42, -1, 1.5, true, [], ['x'], {}, { a: 1 }, 'x'.repeat(300)];
    for (const value of junk) {
      await expectError(mallory, { t: 'sit', game: value }, 'unknown_game');
      await expectError(mallory, { t: 'action', action: value }, 'bad_action');
      await expectError(mallory, { t: 'action', action: { type: value } }, 'bad_action');
      await expectError(mallory, { t: 'gift', to: value, amount: 10 }, 'bad_target');
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        await expectError(mallory, { t: 'gift', to: ana.you.id, amount: value }, 'bad_amount');
      }
      if (typeof value !== 'string') await expectError(mallory, { t: 'chat', text: value }, 'bad_chat');
      await expectError(mallory, { t: 'joinRoom', code: value }, 'bad_code');
      if (typeof value !== 'string') await expectError(mallory, { t: 'profile', name: value, avatar: 1 }, 'bad_name');
      if (!(Number.isInteger(value) && value >= 0 && value <= 11)) {
        await expectError(mallory, { t: 'profile', name: 'Mallory', avatar: value }, 'bad_avatar');
      }
    }
    await expectError(mallory, { t: 'chat', text: 'x'.repeat(201) }, 'bad_chat');
    await expectError(mallory, { t: 'hello', name: 'Otra vez' }, 'already_hello');
    await assertUntouched();
    assert.equal(ana.room.players[2].name, 'Mallory', 'rejected profiles changed nothing');
  });

  test('acting without a seat or without a room', async () => {
    await expectError(mallory, { t: 'action', action: { type: 'bet', spot: 'red', amount: 100 } }, 'not_seated');
    await expectError(mallory, { t: 'action', action: { type: 'ready' } }, 'not_seated');
    await expectError(mallory, { t: 'action', action: { type: 'rebet' } }, 'not_seated');

    const loner = await server.join('Solo');
    await expectError(loner, { t: 'sit', game: 'roulette' }, 'not_in_room');
    await expectError(loner, { t: 'stand' }, 'not_in_room');
    await expectError(loner, { t: 'action', action: { type: 'bet', spot: 'red', amount: 100 } }, 'not_in_room');
    await expectError(loner, { t: 'chat', text: 'hola' }, 'not_in_room');
    await expectError(loner, { t: 'gift', to: ana.you.id, amount: 10 }, 'not_in_room');
    await expectError(loner, { t: 'rescue' }, 'not_in_room');

    const silent = await server.connect(); // never says hello
    for (const t of ['createRoom', 'joinRoom', 'leaveRoom', 'sit', 'stand', 'action', 'chat', 'gift', 'rescue', 'profile']) {
      await expectError(silent, { t, code: ana.room.code, game: 'roulette', to: ana.you.id, amount: 5 }, 'hello_required');
    }
    await assertUntouched();
  });

  test('bet amounts: negative, fractional, huge, non-numeric', async () => {
    const amounts = [0, -1, -100, -1e9, 0.5, 4.999, 99.5, 1e9, 1e21, 1e308, Number.MAX_SAFE_INTEGER, 9007199254740993,
      '100', '1e3', null, true, false, [], [100], {}, { valueOf: 100 }];
    for (const amount of amounts) {
      await expectError(ana, { t: 'action', action: { type: 'bet', spot: 'red', amount } }, 'game');
    }
    // Things JSON cannot express arrive as raw text.
    for (const raw of ['NaN', 'Infinity', '-Infinity', '0x10', '1e', '--1', '١٠٠']) {
      await expectError(ana, `{"t":"action","action":{"type":"bet","spot":"red","amount":${raw}}}`, 'bad_message');
    }
    await expectError(ana, '{"t":"action","action":{"type":"bet","spot":"red","amount":1e400}}', 'game');
    await expectError(ana, '{"t":"action","action":{"type":"bet","spot":"red","amount":-0}}', 'game');
    await expectError(ana, { t: 'action', action: { type: 'bet', spot: 'red' } }, 'game');
    await assertUntouched();
  });

  test('bet spots: illegal geometry and non-strings', async () => {
    const spots = ['split:3-4', 'corner:3-4-6-7', 'street:2-3-4', 'straight:37', 'straight:-1', 'column:4', 'dozen:0',
      'RED', 'green', '', 'red ', 'constructor', '__proto__', 'x'.repeat(5000), null, 17, ['red'], { id: 'red' }, true];
    for (const spot of spots) {
      await expectError(ana, { t: 'action', action: { type: 'bet', spot, amount: 10 } }, 'game');
    }
    for (const type of ['spin', 'resolve', 'reset', 'credit', 'win', 'setNumber', 'onSit', 'view', 'dispose']) {
      await expectError(ana, { t: 'action', action: { type, number: 17, amount: 1000 } }, 'game');
    }
    await assertUntouched();
  });

  test('spoofed identities: you cannot bet, gift or act as somebody else', async () => {
    // Mallory is not seated: naming Ana in the payload does not borrow her seat.
    await expectError(
      mallory,
      { t: 'action', playerId: ana.you.id, id: ana.you.id, action: { type: 'bet', spot: 'red', amount: 100, playerId: ana.you.id } },
      'not_seated'
    );
    // A gift "from Ana to Mallory" sent by Mallory is a gift from Mallory to herself.
    await expectError(mallory, { t: 'gift', from: ana.you.id, playerId: ana.you.id, to: mallory.you.id, amount: 500 }, 'bad_target');
    await expectError(mallory, { t: 'gift', to: 'p000000000000', amount: 10 }, 'bad_target');
    await expectError(mallory, { t: 'rescue', playerId: ana.you.id, for: ana.you.id }, 'rescue_not_needed');

    // Public ids are not credentials: using one as a token gives a brand-new identity.
    const impostor = await server.connect();
    const welcome = await impostor.hello({ token: ana.you.id, name: 'Ana' });
    assert.notEqual(welcome.you.id, ana.you.id);
    assert.notEqual(welcome.token, ana.token);
    assert.equal(welcome.room, null);
    assert.ok(ana.isOpen, 'the real Ana was not kicked out');

    // A seated player naming somebody else in the action still bets with their own chips.
    beto.send({ t: 'action', action: { type: 'bet', spot: 'black', amount: 50, playerId: ana.you.id, id: ana.you.id } });
    const state = await beto.waitForGame('roulette', (view) => view.totals.table === 50);
    assert.deepEqual(state.players.map((player) => [player.name, player.total]), [['Ana', 0], ['Beto', 50]]);
    beto.send({ t: 'action', action: { type: 'clear', playerId: ana.you.id } });
    await beto.waitForGame('roulette', (view) => view.totals.table === 0);
    await assertUntouched();
  });

  test('tokens never leak to other players', async () => {
    await ana.settle();
    const everythingMallorySaw = JSON.stringify(mallory.log);
    assert.ok(!everythingMallorySaw.includes(ana.token));
    assert.ok(!everythingMallorySaw.includes(beto.token));
    assert.ok(everythingMallorySaw.includes(mallory.token), 'only her own, in her welcome');
    assert.ok(everythingMallorySaw.includes(ana.you.id), 'public ids are public');
  });

  test('deeply nested and oddly shaped JSON is handled', async () => {
    const deep = `${'{"a":'.repeat(2000)}1${'}'.repeat(2000)}`;
    await expectError(ana, `{"t":"action","action":{"type":"bet","amount":10,"spot":${deep}}}`, 'game');
    await expectError(ana, `{"t":"action","action":${'['.repeat(3000)}${']'.repeat(3000)}}`, 'bad_action');
    await expectError(ana, `{"t":"sit","game":${deep}}`, 'unknown_game');
    await expectError(ana, { t: 'action', action: { type: 'bet', spot: 'red', amount: -10, extra: 'x'.repeat(10000) } }, 'game');
    const longKey = { t: 'action', action: { type: 'ready' } };
    longKey.action['k'.repeat(8000)] = 1;
    await expectError(ana, longKey, 'game');
    await assertUntouched();
  });

  test('an oversized frame closes that socket only (1009)', async () => {
    const big = await server.join('Grande');
    big.send({ t: 'chat', text: 'x'.repeat(17 * 1024) });
    const { code } = await big.closed;
    assert.equal(code, 1009);
    await assertUntouched();
  });

  test('invalid UTF-8 in a text frame closes that socket only (1007)', async () => {
    const broken = await server.join('Roto');
    broken.sendRaw(Buffer.from([0x7b, 0x22, 0x74, 0x22, 0x3a, 0xff, 0xfe, 0xfd]), { binary: false });
    const { code } = await broken.closed;
    assert.equal(code, 1007);
    await assertUntouched();
  });
});

describe('flooding', () => {
  test('a flood is throttled, then disconnected; everybody else keeps playing', async () => {
    const server = await startServer(); // real rate limits: burst 40, 20 per second
    try {
      const ana = await server.join('Ana');
      const flooder = await server.join('Flood');
      ana.send({ t: 'createRoom' });
      await ana.waitForRoom();

      for (let i = 0; i < 2000; i += 1) flooder.send({ t: 'ping', c: i });
      const { code } = await flooder.closed;
      assert.equal(code, 1008, 'closed for policy violation');
      const pongs = flooder.log.filter((message) => message.t === 'pong').length;
      assert.ok(pongs >= 39 && pongs <= 100, `only the burst was served (${pongs} pongs)`);
      const notices = flooder.log.filter((message) => message.t === 'error' && message.code === 'rate_limited');
      assert.ok(notices.length >= 1 && notices.length <= 5, 'throttle notices are themselves throttled');

      await ana.settle();
      assert.equal((await server.request('/healthz')).status, 200);
      assert.equal(ana.room.players[0].balance, 1000);
    } finally {
      await server.close();
    }
  });

  test('a normal burst of clicks is not punished', async () => {
    const server = await startServer({ timeScale: 1 });
    try {
      const ana = await server.join('Ana');
      ana.send({ t: 'createRoom' });
      await ana.waitForRoom();
      ana.send({ t: 'sit', game: 'roulette' });
      await ana.waitForGame('roulette');
      for (let i = 0; i < 30; i += 1) ana.send({ t: 'action', action: { type: 'bet', spot: `straight:${i}`, amount: 5 } });
      const state = await ana.waitForGame('roulette', (view) => view.totals.you === 150);
      assert.equal(state.players[0].bets.length, 30);
      assert.equal(ana.log.filter((message) => message.t === 'error').length, 0);
    } finally {
      await server.close();
    }
  });

  test('many connections at once are all served', async () => {
    const server = await startServer();
    try {
      const clients = await Promise.all(Array.from({ length: 40 }, (_, i) => server.join(`Jugador ${i}`)));
      assert.equal(new Set(clients.map((client) => client.you.id)).size, 40);
      assert.equal(new Set(clients.map((client) => client.token)).size, 40);
      const health = JSON.parse((await server.request('/healthz')).text);
      assert.equal(health.players, 40);
    } finally {
      await server.close();
    }
  });

  test('connections beyond the limit are turned away', async () => {
    const server = await startServer({ config: { MAX_CONNECTIONS: 3 } });
    try {
      const inside = await Promise.all([server.join('A'), server.join('B'), server.join('C')]);
      const extra = await server.connect();
      const { code } = await extra.closed;
      assert.equal(code, 1013);
      assert.ok(inside.every((client) => client.isOpen));
    } finally {
      await server.close();
    }
  });
});
