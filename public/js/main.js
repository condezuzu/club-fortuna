// Club Fortuna — app shell: connection, welcome screen, casino floor and table view.
import * as ui from './ui.js';
import * as audio from './audio.js';
import roulette from './games/roulette.js';
import blackjack from './games/blackjack.js';
import slots from './games/slots.js';
import baccarat from './games/baccarat.js';

const { el, clear, formatChips, toast, createButton } = ui;
const MODULES = { roulette, blackjack, slots, baccarat };
const app = document.getElementById('app');

const S = {
  ws: null,
  online: false,
  replaced: false,
  you: null,
  games: [],
  room: null,
  offset: 0,
  table: null,
  instance: null,
  states: {},
};
let R = {}; // persistent nodes of the room screen

const store = {
  get(area, key) {
    try {
      return area.getItem(key);
    } catch (err) {
      return null;
    }
  },
  set(area, key, value) {
    try {
      area.setItem(key, value);
    } catch (err) {
      /* storage unavailable: play without persistence */
    }
  },
};

const send = (msg) => {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
};
const serverNow = () => Date.now() + S.offset;
const me = () => (S.room ? S.room.players.find((p) => p.id === S.room.you) || null : null);
const safe = (fn) => {
  try {
    fn();
  } catch (err) {
    console.error(err);
  }
};

// ───────────────────────────── connection ─────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => {
    send({
      t: 'hello',
      token: store.get(sessionStorage, 'cf_token') || undefined,
      name: store.get(localStorage, 'cf_name') || undefined,
    });
  };
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    safe(() => handle(msg));
  };
  ws.onclose = () => {
    S.online = false;
    if (S.replaced) return;
    toast('Reconectando…', { kind: 'info', duration: 1400 });
    setTimeout(connect, 1500);
  };
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      S.you = m.you;
      S.games = (m.games || []).slice().sort((a, b) => a.order - b.order);
      S.offset = m.serverNow - Date.now();
      S.online = true;
      store.set(sessionStorage, 'cf_token', m.token);
      setRoom(m.room);
      break;
    case 'you':
      S.you = m.you;
      break;
    case 'room':
      setRoom(m.room);
      break;
    case 'left':
      setRoom(null);
      break;
    case 'game':
      S.states[m.game] = m.state;
      if (S.instance && S.table === m.game && m.state) S.instance.update(m.state);
      break;
    case 'event':
      if (S.instance && S.table === m.game) S.instance.event(m.name, m.payload);
      break;
    case 'chat':
      if (S.room && !S.room.chat.some((c) => c.id === m.msg.id)) {
        S.room.chat.push(m.msg);
        renderChat();
        if (m.msg.from !== S.room.you) audio.play('notify');
      }
      break;
    case 'celebrate':
      audio.play('jackpot');
      ui.celebrate({ kind: 'jackpot', caption: `¡Nuevo rango: ${m.title}!`, amount: m.bonus });
      toast(`¡El equipo subió de nivel! Bono de ${formatChips(m.bonus)} fichas para cada uno.`, { kind: 'win', duration: 6000 });
      break;
    case 'error':
      if (m.code === 'replaced') S.replaced = true;
      toast(m.message, { kind: 'error' });
      break;
    default:
      break;
  }
}

// ───────────────────────────── welcome ─────────────────────────────

function renderWelcome() {
  unmount();
  S.table = null;
  R = {};
  clear(app);
  const hashCode = (location.hash.slice(1) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const name = el('input', {
    class: 'input',
    type: 'text',
    maxLength: 16,
    placeholder: 'Tu nombre',
    value: store.get(localStorage, 'cf_name') || '',
  });
  const code = el('input', { class: 'input input--code', type: 'text', maxLength: 4, placeholder: 'ABCD', value: hashCode });

  const go = (msg) => {
    audio.unlock();
    if (!S.online) {
      toast('Conectando con el club…', { kind: 'info' });
      return;
    }
    const value = name.value.trim();
    if (!value) {
      toast('Escribí tu nombre para entrar.', { kind: 'error' });
      name.focus();
      return;
    }
    store.set(localStorage, 'cf_name', value);
    send({ t: 'profile', name: value });
    send(msg);
  };
  const join = () => {
    const value = code.value.trim().toUpperCase();
    if (value.length !== 4) {
      toast('El código de sala son 4 letras.', { kind: 'error' });
      code.focus();
      return;
    }
    go({ t: 'joinRoom', code: value });
  };
  code.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') join();
  });

  app.append(
    el(
      'div',
      { class: 'welcome' },
      el(
        'div',
        { class: 'welcome__card panel panel--ornate' },
        el('p', { class: 'welcome__eyebrow' }, 'Casino cooperativo'),
        el('h1', { class: 'welcome__title' }, 'Club Fortuna'),
        el('p', { class: 'welcome__lead' }, 'Armá una sala, invitá a tus amigos y jueguen juntos contra la casa.'),
        el('label', { class: 'welcome__label' }, 'Nombre', name),
        createButton('Crear sala', { variant: 'primary', size: 'lg', block: true, onClick: () => go({ t: 'createRoom' }) }),
        el('div', { class: 'welcome__or' }, 'o unite con un código'),
        el('div', { class: 'welcome__join' }, code, createButton('Unirme', { variant: 'secondary', size: 'lg', onClick: join })),
        el('p', { class: 'welcome__note' }, 'Fichas ficticias · Sin dinero real · Solo por diversión')
      )
    )
  );
  (hashCode && name.value ? code : name).focus();
}

// ───────────────────────────── room ─────────────────────────────

function setRoom(room) {
  S.room = room;
  if (!room) {
    renderWelcome();
    return;
  }
  if (location.hash.slice(1) !== room.code) history.replaceState(null, '', `#${room.code}`);
  if (!R.root || !R.root.isConnected) buildRoom();
  syncTable();
  updateRoom();
}

function buildRoom() {
  clear(app);
  R = {};
  R.code = el('strong', { class: 'hud__code' });
  R.balance = el('strong', { class: 'hud__balance' });
  R.rescue = createButton('Rescate', { variant: 'danger', size: 'sm', icon: 'lifebuoy', onClick: () => send({ t: 'rescue' }) });
  R.mute = createButton(null, {
    variant: 'ghost',
    size: 'sm',
    icon: audio.isMuted() ? 'mute' : 'volume',
    ariaLabel: 'Sonido',
    onClick: () => {
      audio.setMuted(!audio.isMuted());
      R.mute.setIcon(audio.isMuted() ? 'mute' : 'volume');
    },
  });
  const copy = createButton('Invitar', {
    variant: 'secondary',
    size: 'sm',
    icon: 'link',
    onClick: () => {
      const url = `${location.origin}/#${S.room.code}`;
      const done = () => toast('Link de invitación copiado. Pasáselo a tus amigos.', { kind: 'info' });
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast(url));
      else toast(url, { duration: 8000 });
    },
  });
  const leave = createButton('Salir', { variant: 'ghost', size: 'sm', onClick: () => send({ t: 'leaveRoom' }) });

  R.main = el('main', { class: 'room__main' });
  R.players = el('div', { class: 'side__list' });
  R.feed = el('div', { class: 'side__feed' });
  R.chatList = el('div', { class: 'side__chat' });
  R.chatInput = el('input', { class: 'input', type: 'text', maxLength: 200, placeholder: 'Escribí un mensaje…' });
  const chatForm = el(
    'form',
    {
      class: 'chat-form',
      onSubmit: (event) => {
        event.preventDefault();
        const text = R.chatInput.value.trim();
        if (text) send({ t: 'chat', text });
        R.chatInput.value = '';
      },
    },
    R.chatInput,
    createButton(null, { variant: 'primary', size: 'sm', icon: 'send', type: 'submit', ariaLabel: 'Enviar' })
  );

  R.root = el(
    'div',
    { class: 'room' },
    el(
      'header',
      { class: 'hud' },
      el('span', { class: 'hud__brand' }, 'Club Fortuna'),
      el('span', { class: 'hud__item' }, 'Sala ', R.code),
      copy,
      el('span', { class: 'hud__spacer' }),
      R.rescue,
      el('span', { class: 'hud__item hud__item--chips' }, ui.icon('chip'), R.balance),
      R.mute,
      leave
    ),
    el(
      'div',
      { class: 'room__body' },
      R.main,
      el(
        'aside',
        { class: 'side' },
        el('section', { class: 'side__box panel' }, el('h3', { class: 'side__title' }, 'Equipo'), R.players),
        el('section', { class: 'side__box panel' }, el('h3', { class: 'side__title' }, 'Novedades'), R.feed),
        el('section', { class: 'side__box panel side__box--chat' }, el('h3', { class: 'side__title' }, 'Chat'), R.chatList, chatForm)
      )
    )
  );
  app.append(R.root);
}

function unmount() {
  if (S.instance) safe(() => S.instance.destroy());
  S.instance = null;
  if (S.table) delete S.states[S.table];
}

function syncTable() {
  const my = me();
  const want = my && MODULES[my.table] ? my.table : null;
  if (R.view && want === S.table) return;
  unmount();
  S.table = want;
  if (want) buildTable(want);
  else buildFloor();
}

function buildTable(id) {
  const meta = S.games.find((g) => g.id === id) || { id, name: id };
  R.view = 'table';
  clear(R.main);
  const stage = el('div', { class: `game-stage game-${id}` });
  R.main.append(
    el(
      'div',
      { class: 'table-bar' },
      createButton('Volver al salón', { variant: 'ghost', size: 'sm', icon: 'back', onClick: () => send({ t: 'stand' }) }),
      el('h2', { class: 'table-bar__title' }, meta.name)
    ),
    stage
  );
  const api = {
    send: (action) => send({ t: 'action', action }),
    me: () => me() || { id: S.you.id, name: S.you.name, avatar: S.you.avatar, balance: 0 },
    players: () => (S.room ? S.room.players : []),
    player: (pid) => (S.room ? S.room.players.find((p) => p.id === pid) || null : null),
    meta,
    serverNow,
    ui,
    audio,
  };
  try {
    S.instance = MODULES[id].mount(stage, api);
    if (S.states[id]) S.instance.update(S.states[id]);
  } catch (err) {
    console.error(err);
    toast('No pudimos abrir la mesa.', { kind: 'error' });
  }
}

function buildFloor() {
  R.view = 'floor';
  clear(R.main);
  R.goal = el('section', { class: 'goal panel panel--ornate' });
  R.games = el('div', { class: 'games' });
  R.main.append(R.goal, R.games, el('p', { class: 'floor__note' }, 'Fichas ficticias · Sin dinero real · Solo por diversión'));
}

function updateRoom() {
  const room = S.room;
  const my = me();
  if (!room || !my) return;
  R.code.textContent = room.code;
  R.balance.textContent = formatChips(my.balance);
  R.rescue.hidden = !(room.rescue && my.balance + my.stake < room.rescue.threshold);
  renderPlayers();
  renderFeed();
  renderChat();
  if (R.view === 'floor') {
    renderGoal();
    renderGames();
  }
}

function tableName(id) {
  const meta = S.games.find((g) => g.id === id);
  return meta ? meta.name : 'En el salón';
}

function renderPlayers() {
  clear(R.players);
  for (const p of S.room.players) {
    const mine = p.id === S.room.you;
    R.players.append(
      el(
        'div',
        { class: `member${p.connected ? '' : ' member--off'}` },
        ui.createAvatar(p, { size: 'sm' }),
        el(
          'div',
          { class: 'member__text' },
          el('span', { class: 'member__name' }, mine ? `${p.name} (vos)` : p.name),
          el('span', { class: 'member__meta' }, p.connected ? tableName(p.table) : 'Desconectado')
        ),
        el('span', { class: 'member__chips' }, formatChips(p.balance)),
        mine
          ? null
          : createButton(null, { variant: 'ghost', size: 'sm', icon: 'gift', ariaLabel: `Regalar fichas a ${p.name}`, onClick: () => giftModal(p) })
      )
    );
  }
}

function giftModal(p) {
  const input = el('input', { class: 'input', type: 'number', min: 1, step: 1, value: 100 });
  ui.openModal({
    title: `Regalar fichas a ${p.name}`,
    size: 'sm',
    content: el('label', { class: 'welcome__label' }, 'Cantidad de fichas', input),
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      {
        label: 'Regalar',
        variant: 'primary',
        onClick: () => {
          const amount = Math.floor(Number(input.value));
          if (!(amount >= 1)) return false;
          send({ t: 'gift', to: p.id, amount });
          return true;
        },
      },
    ],
  });
}

function renderFeed() {
  clear(R.feed);
  const items = S.room.feed.slice().sort((a, b) => b.ts - a.ts).slice(0, 12);
  if (items.length === 0) R.feed.append(el('p', { class: 'side__empty' }, 'Todavía no pasó nada.'));
  for (const item of items) R.feed.append(el('p', { class: `feed__item feed__item--${item.kind || 'info'}` }, item.text));
}

function renderChat() {
  if (!R.chatList || !S.room) return;
  clear(R.chatList);
  const msgs = S.room.chat.slice(-40);
  if (msgs.length === 0) R.chatList.append(el('p', { class: 'side__empty' }, 'Saludá a la mesa.'));
  for (const msg of msgs) {
    R.chatList.append(
      el('p', { class: 'chat__msg' }, el('strong', { style: { color: ui.avatarColor(msg.avatar) } }, `${msg.name}: `), msg.text)
    );
  }
  R.chatList.scrollTop = R.chatList.scrollHeight;
}

function renderGoal() {
  const g = S.room.goal;
  clear(R.goal);
  const span = Math.max(1, (g.target || 0) - (g.prevTarget || 0));
  const pct = Math.max(0, Math.min(100, ((g.profit - (g.prevTarget || 0)) / span) * 100));
  R.goal.append(
    el('p', { class: 'goal__eyebrow' }, `Meta del equipo · Nivel ${g.level}`),
    el('h2', { class: 'goal__title' }, g.title),
    el('div', { class: 'goal__bar' }, el('div', { class: 'goal__fill', style: { width: `${pct}%` } })),
    el(
      'p',
      { class: 'goal__text' },
      `Ganancia del equipo: ${formatChips(g.profit)}`,
      g.target ? ` de ${formatChips(g.target)} · Próximo rango: ${g.nextTitle}` : ''
    )
  );
}

function renderGames() {
  clear(R.games);
  for (const meta of S.games) {
    const mod = MODULES[meta.id];
    const seated = ((S.room.tables[meta.id] || {}).seated || []).map((pid) => S.room.players.find((p) => p.id === pid)).filter(Boolean);
    R.games.append(
      el(
        'article',
        { class: 'game-card panel' },
        el('div', { class: 'game-card__art' }, ui.icon(mod ? mod.icon : 'clock')),
        el('h3', { class: 'game-card__name' }, meta.name),
        el('p', { class: 'game-card__tagline' }, meta.tagline),
        el('p', { class: 'game-card__limits' }, `Apuestas de ${formatChips(meta.minBet)} a ${formatChips(meta.maxBet)}`),
        el('div', { class: 'game-card__seated' }, ...seated.map((p) => ui.createAvatar(p, { size: 'xs' }))),
        createButton(mod ? 'Sentarse' : 'Próximamente', {
          variant: 'primary',
          block: true,
          disabled: !mod,
          onClick: () => send({ t: 'sit', game: meta.id }),
        })
      )
    );
  }
}

document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
renderWelcome();
connect();
