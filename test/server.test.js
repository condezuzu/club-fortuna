'use strict';

/**
 * End-to-end tests against the real server (HTTP + WebSocket) on an ephemeral
 * port, through test/helpers/harness.js.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const WebSocket = require('ws');

const { startServer, connectClient } = require('./helpers/harness');
const { createScriptedRng } = require('./helpers/fakeCtx');
const { start } = require('../server');
const { resolveSafe } = require('../server/static');
const roulette = require('../server/games/roulette');

const FIXTURE_PUBLIC = path.join(__dirname, 'fixtures', 'public');
const RED = new Set(roulette.internals.RED_NUMBERS);
const bet = (spot, amount) => ({ t: 'action', action: { type: 'bet', spot, amount } });

/** Create a room with the given clients in it and seat everybody at the roulette. */
async function seatAtRoulette(clients) {
  const [host, ...guests] = clients;
  host.send({ t: 'createRoom' });
  const { code } = await host.waitForRoom();
  for (const guest of guests) {
    guest.send({ t: 'joinRoom', code });
    await guest.waitForRoom();
  }
  // One at a time: separate sockets race, and the sit order is the table order.
  for (const client of clients) {
    client.send({ t: 'sit', game: 'roulette' });
    await client.waitForGame('roulette');
  }
  for (const client of clients) {
    await client.waitForGame('roulette', (state) => state.players.length === clients.length);
  }
  return code;
}

// ───────────────────────────── HTTP ─────────────────────────────

describe('http', () => {
  let server;
  before(async () => {
    server = await startServer({ publicDir: FIXTURE_PUBLIC });
  });
  after(() => server.close());

  test('GET / serves index.html, never cached, with security headers', async () => {
    const res = await server.request('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.match(res.headers['content-security-policy'], /fonts\.googleapis\.com/);
    assert.equal(Number(res.headers['content-length']), res.body.length);
    assert.match(res.text, /fixture-index/);
    assert.equal((await server.request('/index.html')).text, res.text);
  });

  test('correct MIME types', async () => {
    const expected = {
      '/js/app.js': 'text/javascript; charset=utf-8',
      '/css/site.css': 'text/css; charset=utf-8',
      '/logo.svg': 'image/svg+xml',
      '/data.json': 'application/json; charset=utf-8',
      '/index.html': 'text/html; charset=utf-8',
      '/favicon.ico': 'image/x-icon',
      '/con%20espacios.txt': 'text/plain; charset=utf-8',
    };
    for (const [url, type] of Object.entries(expected)) {
      const res = await server.request(url);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers['content-type'], type, url);
      assert.equal(res.headers['cache-control'], 'no-store', url);
    }
    assert.match((await server.request('/js/app.js')).text, /fixture-js/);
  });

  test('query strings are ignored and extension-less routes fall back to the app', async () => {
    assert.match((await server.request('/?sala=ABCD')).text, /fixture-index/);
    assert.match((await server.request('/js/app.js?v=123')).text, /fixture-js/);
    const pretty = await server.request('/sala/ABCD');
    assert.equal(pretty.status, 200);
    assert.match(pretty.text, /fixture-index/);
    assert.equal(pretty.headers['content-type'], 'text/html; charset=utf-8');

    assert.match((await server.request('/js/')).text, /fixture-index/, 'a folder is just another app route');

    for (const missing of ['/css/missing.css', '/js/nope.js', '/img/a.png', '/index.htm']) {
      const res = await server.request(missing);
      assert.equal(res.status, 404, missing);
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  });

  test('GET /healthz reports status as JSON', async () => {
    const res = await server.request('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    const body = JSON.parse(res.text);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'club-fortuna');
    assert.equal(typeof body.uptime, 'number');
    assert.equal(body.rooms, 0);
    assert.equal(body.players, 0);
    assert.ok(body.games.includes('roulette'));
  });

  test('HEAD answers like GET without a body; other methods are refused', async () => {
    const head = await server.request('/js/app.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.ok(Number(head.headers['content-length']) > 0);
    assert.equal((await server.request('/healthz', { method: 'HEAD' })).status, 200);

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = await server.request('/', { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.allow, 'GET, HEAD');
    }
  });

  test('path traversal and odd paths never escape public/', async () => {
    const attacks = [
      '/../outside.txt',
      '/..%2Foutside.txt',
      '/%2e%2e/outside.txt',
      '/%2e%2e%2foutside.txt',
      '/%2E%2E%2Foutside.txt',
      '/js/../../outside.txt',
      '/js/..%2f..%2foutside.txt',
      '//../outside.txt',
      '/..\\outside.txt',
      '/..%5coutside.txt',
      '/%5c..%5coutside.txt',
      '/js\\..\\..\\outside.txt',
      '/....//outside.txt',
      '/./../outside.txt',
      '/%252e%252e/outside.txt',
      '/.hidden/secret.txt',
      '/.hidden%2fsecret.txt',
      '/C:/Windows/win.ini',
      '/c%3A/Windows/win.ini',
      '/index.html::$DATA',
      '/index.html%3A%3A$DATA',
      '/index.html.',
      '/index.html%20',
      '/index.html%00.js',
      '/%00',
      '/NUL',
      '/con',
      '/aux.txt',
      '/%',
      '/%E0%A4%A',
      '/%c0%ae%c0%ae/outside.txt',
    ];
    for (const url of attacks) {
      const res = await server.request(url);
      assert.equal(res.status, 404, `${url} -> ${res.status}`);
      assert.ok(!res.text.includes('TOP-SECRET'), url);
      assert.ok(!res.text.includes('secret'), url);
      assert.ok(!res.text.includes('fixture-index'), `${url} must not be served as the app either`);
    }
  });

  test('resolveSafe unit: stays inside the root', () => {
    const root = path.resolve(FIXTURE_PUBLIC);
    assert.equal(resolveSafe(root, '/'), root);
    assert.equal(resolveSafe(root, '/js/app.js'), path.join(root, 'js', 'app.js'));
    assert.equal(resolveSafe(root, '//js///app.js'), path.join(root, 'js', 'app.js'));
    assert.equal(resolveSafe(root, '/con%20espacios.txt'), path.join(root, 'con espacios.txt'));
    for (const bad of ['/..', '/../', '/a/../b', '/.env', '/a\\b', '/a%5Cb', '/a:b', '/%', '/a%00b', '/a./b', '/a /b', '/lpt1', '/COM1.txt']) {
      assert.equal(resolveSafe(root, bad), null, bad);
    }
  });

  test('GET /ws without an upgrade explains itself', async () => {
    const res = await server.request('/ws');
    assert.equal(res.status, 426);
  });
});

describe('http without a client build', () => {
  let server;
  before(async () => {
    // A folder with no index.html and no favicon.
    server = await startServer({ publicDir: path.join(__dirname, 'fixtures', 'games') });
  });
  after(() => server.close());

  test('missing index and favicon are handled gracefully', async () => {
    assert.equal((await server.request('/')).status, 404);
    assert.equal((await server.request('/sala/ABCD')).status, 404);
    assert.equal((await server.request('/favicon.ico')).status, 204);
    const js = await server.request('/mint.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  });
});

// ───────────────────────────── start() ─────────────────────────────

describe('start()', () => {
  test('listens on an ephemeral port, serves the real public folder and closes cleanly', async () => {
    const app = await start({ port: 0, host: '127.0.0.1', quiet: true });
    try {
      assert.ok(Number.isInteger(app.port) && app.port > 0 && app.port !== 3000);
      assert.equal(app.server.address().port, app.port);
      assert.deepEqual(app.urls, [`http://localhost:${app.port}`]);
      const res = await fetch(`http://127.0.0.1:${app.port}/healthz`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
      // public/package.json is part of the repo: proves the default folder is wired.
      const pkg = await fetch(`http://127.0.0.1:${app.port}/package.json`);
      assert.equal(pkg.status, 200);
      assert.deepEqual(await pkg.json(), { type: 'module' });
    } finally {
      await app.close();
    }
    await assert.rejects(fetch(`http://127.0.0.1:${app.port}/healthz`), 'the port is released');
    await app.close(); // idempotent
  });

  test('two servers can run side by side; a busy port is reported', async () => {
    const first = await start({ port: 0, host: '127.0.0.1', quiet: true });
    const second = await start({ port: 0, host: '127.0.0.1', quiet: true });
    try {
      assert.notEqual(first.port, second.port);
      await assert.rejects(start({ port: first.port, host: '127.0.0.1', quiet: true }), { code: 'EADDRINUSE' });
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('closing the server drops connected clients and cancels game timers', async () => {
    const server = await startServer();
    const ana = await server.join('Ana');
    await seatAtRoulette([ana]);
    ana.send(bet('red', 50)); // a betting countdown is now pending
    await ana.waitForGame('roulette', (state) => state.phase === 'betting');
    await server.close();
    const { code } = await ana.closed;
    assert.ok([1000, 1005, 1006].includes(code));
    // If a timer had survived, the test process would not exit and the runner would report it.
  });
});

// ───────────────────────────── WebSocket ─────────────────────────────

describe('websocket', () => {
  let server;
  before(async () => {
    // Real-time game timers here: these tests are about the transport, and a
    // 30 s betting window must not run out while a client reconnects.
    server = await startServer({ timeScale: 1, config: { HEARTBEAT_MS: 60 } });
  });
  after(() => server.close());

  test('hello over a real socket; the casino floor lists the roulette', async () => {
    const client = await server.connect();
    const welcome = await client.hello({ name: 'Ana', avatar: 5 });
    assert.equal(welcome.you.name, 'Ana');
    assert.equal(welcome.you.avatar, 5);
    assert.match(welcome.token, /^[0-9a-f]{32}$/);
    assert.ok(Math.abs(welcome.serverNow - Date.now()) < 5000);
    assert.equal(welcome.room, null);
    const meta = welcome.games.find((game) => game.id === 'roulette');
    assert.deepEqual(meta, roulette.meta);

    client.send({ t: 'ping', c: 42 });
    const pong = await client.waitFor('pong');
    assert.equal(pong.c, 42);
    assert.ok(Math.abs(pong.s - Date.now()) < 5000);
  });

  test('only /ws accepts websocket upgrades', async () => {
    for (const badPath of ['/', '/socket', '/ws/extra', '/healthz']) {
      await assert.rejects(connectClient(`ws://127.0.0.1:${server.port}${badPath}`), /Unexpected server response/, badPath);
    }
    const ok = await connectClient(`ws://127.0.0.1:${server.port}/ws?from=test`);
    await ok.close();
  });

  test('heartbeat: a socket that stops answering pings is dropped, a healthy one stays', async () => {
    const healthy = await server.join('Sana');
    const dead = await server.connect({ autoPong: false });
    await dead.hello({ name: 'Zombi' });
    const { code } = await dead.closed;
    assert.equal(code, 1006, 'terminated without a close handshake');
    assert.ok(healthy.isOpen);
    healthy.send({ t: 'ping', c: 'still here' });
    await healthy.waitFor((message) => message.t === 'pong' && message.c === 'still here');
  });

  test('a disconnected player shows up as offline and comes back with the token', async () => {
    const ana = await server.join('Ana');
    const beto = await server.join('Beto');
    await seatAtRoulette([ana, beto]);
    ana.send(bet('red', 100));
    await beto.waitForGame('roulette', (state) => state.totals.table === 100);

    await ana.terminate();
    await beto.waitForRoom((room) => room.players[0].connected === false);
    assert.equal(beto.room.players[0].table, 'roulette', 'the seat is kept');

    const back = await server.connect();
    const welcome = await back.hello({ token: ana.token });
    assert.deepEqual(welcome.you, ana.you);
    assert.equal(welcome.room.code, beto.room.code);
    const me = welcome.room.players.find((player) => player.id === ana.you.id);
    assert.equal(me.connected, true);
    assert.equal(me.table, 'roulette');
    assert.equal(me.balance, 900);
    assert.equal(me.stake, 100);
    const state = await back.waitForGame('roulette');
    assert.equal(state.totals.you, 100, 'the bet is still on the layout');
    await beto.waitForRoom((room) => room.players[0].connected === true);
  });

  test('the newest connection of an identity wins; the old one is closed with 4001', async () => {
    const first = await server.join('Ana');
    const second = await server.connect();
    await second.hello({ token: first.token });
    const error = await first.waitForError('replaced');
    assert.match(error.message, /otra pestaña/);
    const { code, reason } = await first.closed;
    assert.equal(code, 4001);
    assert.equal(reason, 'replaced');
    assert.ok(second.isOpen);
  });
});

// ───────────────────────────── full rounds ─────────────────────────────

describe('roulette end to end', () => {
  test('two players play a full round; chips are conserved to the last one', async () => {
    const server = await startServer({ timeScale: 0.1 });
    try {
      const ana = await server.join('Ana');
      const beto = await server.join('Beto');
      await seatAtRoulette([ana, beto]);

      ana.send(bet('red', 100));
      ana.send(bet('straight:17', 25));
      beto.send(bet('black', 200));
      beto.send(bet('dozen:2', 50));
      // One mistake each, to prove rejected bets cost nothing.
      ana.send(bet('split:3-4', 50));
      beto.send(bet('red', 5000));
      await ana.waitForError('game');
      await beto.waitForError('game');

      const betting = await ana.waitForGame('roulette', (state) => state.totals.table === 375);
      assert.equal(betting.phase, 'betting');
      assert.ok(betting.deadline > Date.now() - 1000, 'the deadline is a server timestamp');
      assert.equal(betting.duration, Math.round(30000 * server.timeScale));
      assert.deepEqual(
        betting.players.map((player) => [player.name, player.total]),
        [['Ana', 125], ['Beto', 250]]
      );
      const staked = await ana.waitForRoom((room) => room.players.reduce((sum, player) => sum + player.stake, 0) === 375);
      assert.deepEqual(staked.players.map((player) => [player.balance, player.stake]), [[875, 125], [750, 250]]);
      assert.equal(staked.goal.profit, 0, 'chips on the table are not lost yet');

      ana.send({ t: 'action', action: { type: 'ready' } });
      beto.send({ t: 'action', action: { type: 'ready' } });

      const spin = await ana.waitFor((message) => message.t === 'event' && message.name === 'spin');
      const number = spin.payload.number;
      assert.ok(Number.isInteger(number) && number >= 0 && number <= 36);
      assert.equal((await beto.waitFor((message) => message.t === 'event' && message.name === 'spin')).payload.number, number);

      const result = await ana.waitForGame('roulette', (state) => state.phase === 'result');
      assert.equal(result.result.number, number);
      assert.equal(result.number, number);

      // Payouts computed here, independently from the server.
      const isRed = RED.has(number);
      const isBlack = number !== 0 && !isRed;
      const anaWon = (isRed ? 200 : 0) + (number === 17 ? 25 * 36 : 0);
      const betoWon = (isBlack ? 400 : 0) + (number >= 13 && number <= 24 ? 150 : 0);
      const byName = Object.fromEntries(result.result.results.map((entry) => [entry.name, entry]));
      assert.deepEqual(
        [byName.Ana.wagered, byName.Ana.won, byName.Beto.wagered, byName.Beto.won],
        [125, anaWon, 250, betoWon]
      );

      const settled = await beto.waitForRoom(
        (room) => room.players.every((player) => player.stake === 0 && player.stats.rounds === 1)
      );
      assert.deepEqual(settled.players.map((player) => player.balance), [875 + anaWon, 750 + betoWon]);
      const net = anaWon + betoWon - 375;
      assert.equal(
        settled.players.reduce((sum, player) => sum + player.balance, 0),
        2000 + net,
        'the sum of balances changed exactly by the net payout'
      );
      assert.equal(settled.goal.profit, net);
      assert.deepEqual(settled.players[0].stats, {
        rounds: 1,
        wagered: 125,
        won: anaWon,
        biggestWin: Math.max(0, anaWon - 125),
      });

      const idle = await ana.waitForGame('roulette', (state) => state.phase === 'idle' && state.round === 2);
      assert.deepEqual(idle.history, [number]);
      assert.equal(idle.you.canRebet, true);
      assert.equal(idle.you.rebetTotal, 125);
    } finally {
      await server.close();
    }
  });

  test('a scripted wheel: the countdown spins by itself, a straight hit levels the team up', async () => {
    const rng = createScriptedRng({ ints: [17], fallback: 'random' });
    const server = await startServer({ rng, timeScale: 0.05 });
    try {
      const ana = await server.join('Ana');
      const beto = await server.join('Beto');
      await seatAtRoulette([ana, beto]);
      ana.send(bet('straight:17', 100));
      beto.send(bet('red', 40)); // 17 is black
      await ana.waitForGame('roulette', (state) => state.totals.table === 140);

      // Nobody presses "Listo": the betting countdown (30 s scaled) spins the wheel.
      const spin = await ana.waitFor((message) => message.t === 'event' && message.name === 'spin');
      assert.equal(spin.payload.number, 17);

      const celebrate = await beto.waitFor('celebrate');
      const { bonuses, mvp, ...headline } = celebrate;
      assert.deepEqual(headline, { t: 'celebrate', kind: 'level', level: 1, title: 'Aprendices', bonus: 250, profit: 3460 });
      assert.equal(mvp.name, 'Ana');
      assert.deepEqual(Object.values(bonuses).sort((a, b) => a - b), [100, 400]);
      const room = beto.room;
      assert.deepEqual(room.players.map((player) => player.balance), [900 + 3600 + 400, 960 + 100]);
      assert.equal(room.goal.level, 1);
      assert.equal(room.goal.profit, 3460);
      const kinds = room.feed.map((entry) => entry.kind);
      assert.ok(kinds.includes('win') && kinds.includes('level'));
      assert.equal(room.feed.find((entry) => entry.kind === 'win').text, 'Ana ganó 3.500 fichas en Ruleta');

      // Within the flush that paid the round: room -> game -> event -> celebrate.
      const types = beto.log.map((message) => (message.t === 'event' ? `event:${message.name}` : message.t));
      const at = types.lastIndexOf('celebrate');
      assert.deepEqual(types.slice(at - 3, at + 1), ['room', 'game', 'event:result', 'celebrate']);
    } finally {
      await server.close();
    }
  });

  test('a player who walks out mid-round is still paid', async () => {
    const rng = createScriptedRng({ ints: [3], fallback: 'random' });
    const server = await startServer({ rng, timeScale: 0.1 });
    try {
      const ana = await server.join('Ana');
      const beto = await server.join('Beto');
      const code = await seatAtRoulette([ana, beto]);
      ana.send(bet('red', 300)); // 3 is red
      beto.send(bet('black', 10));
      await beto.waitForGame('roulette', (state) => state.totals.table === 310);
      ana.send({ t: 'leaveRoom' });
      await ana.waitFor('left');

      const view = await beto.waitForGame('roulette', (state) => state.players.some((player) => !player.seated));
      assert.deepEqual(view.players.map((player) => [player.name, player.seated, player.total]), [
        ['Beto', true, 10],
        ['Ana', false, 300],
      ]);
      beto.send({ t: 'action', action: { type: 'ready' } });
      const paid = await beto.waitForRoom((room) => room.goal.profit === 290);
      assert.equal(paid.players.length, 1);

      ana.send({ t: 'joinRoom', code });
      const back = await ana.waitForRoom((room) => room.players.length === 2);
      assert.equal(back.players.find((player) => player.id === ana.you.id).balance, 1300);
    } finally {
      await server.close();
    }
  });
});
