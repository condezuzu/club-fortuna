// Club Fortuna — app shell: connection, welcome screen, casino floor and table view.
import * as ui from './ui.js';
import * as audio from './audio.js';
import roulette from './games/roulette.js';
import blackjack from './games/blackjack.js';
import slots from './games/slots.js';
import baccarat from './games/baccarat.js';
import poker3 from './games/poker3.js';

const { el, clear, formatChips, toast, createButton } = ui;
const MODULES = { roulette, blackjack, slots, baccarat, poker3 };
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
    case 'emote':
      showEmote(m);
      break;
    case 'rescueChallenge':
      rescueGame(m);
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
  R.level = el('span', { class: 'hud__level' });
  R.debt = el('span', { class: 'hud__debt' });
  R.emotes = el('div', { class: 'emote-bar' });
  const bank = createButton('Banco', { variant: 'ghost', size: 'sm', icon: 'chip', onClick: bankModal });
  const shop = createButton('Tienda', { variant: 'ghost', size: 'sm', icon: 'crown', onClick: shopModal });
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
      R.level,
      R.debt,
      R.rescue,
      bank,
      shop,
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
        el('section', { class: 'side__box panel' }, el('h3', { class: 'side__title' }, 'Equipo'), R.players, R.emotes),
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
  flashBalance(my.balance);
  const base = (room.economy && room.economy.xpBase) || 200;
  const next = base * (my.level + 1) * (my.level + 1);
  R.level.textContent = `Nv ${my.level} · ${my.rank}`;
  R.level.title = `Apostaste ${formatChips(my.stats.wagered)} fichas. Próximo nivel a las ${formatChips(next)}.`;
  R.debt.textContent = my.debt > 0 ? `Debés ${formatChips(my.debt)}` : '';
  renderEmotes();
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
  const list = S.room.players;
  const richest = list.length > 1 ? list.reduce((a, b) => (b.balance > a.balance ? b : a)) : null;
  for (const p of list) {
    const mine = p.id === S.room.you;
    const crown = richest && richest.id === p.id && p.balance > 0;
    R.players.append(
      el(
        'div',
        { class: `member${p.connected ? '' : ' member--off'}${crown ? ' member--crown' : ''}${p.level >= 6 ? ' member--elite' : ''}` },
        el('div', { class: 'member__avatar' }, ui.createAvatar(p, { size: 'sm' }), crown ? el('span', { class: 'member__crown', title: 'El más rico de la sala' }, '👑') : null),
        el(
          'div',
          { class: 'member__text' },
          el('span', { class: 'member__name' }, mine ? `${p.name} (vos)` : p.name, el('span', { class: 'member__level' }, `Nv ${p.level}`)),
          el('span', { class: 'member__title' }, p.title || p.rank),
          el('span', { class: 'member__meta' }, p.connected ? tableName(p.table) : 'Desconectado')
        ),
        el(
          'div',
          { class: 'member__money' },
          el('span', { class: 'member__chips' }, formatChips(p.balance)),
          p.debt > 0 ? el('span', { class: 'member__debt' }, `debe ${formatChips(p.debt)}`) : null
        ),
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

// ───────────────────────────── economy & social ─────────────────────────────

let lastBalance = null;
function flashBalance(balance) {
  if (lastBalance !== null && balance !== lastBalance) {
    const cls = balance > lastBalance ? 'is-gain' : 'is-loss';
    R.balance.classList.remove('is-gain', 'is-loss');
    void R.balance.offsetWidth;
    R.balance.classList.add(cls);
  }
  lastBalance = balance;
}

function renderEmotes() {
  const eco = S.room.economy;
  if (!eco) return;
  const key = eco.owned.join(',');
  if (R.emotes.dataset.key === key && R.emotes.children.length) return;
  R.emotes.dataset.key = key;
  clear(R.emotes);
  const all = eco.emotes.concat(eco.owned.includes(eco.vip.id) ? eco.vipEmotes : []);
  for (const emote of all) {
    R.emotes.append(el('button', { class: 'emote-btn', type: 'button', 'aria-label': `Emote ${emote}`, onClick: () => send({ t: 'emote', emote }) }, emote));
  }
}

function showEmote(m) {
  audio.play('notify');
  const node = el(
    'div',
    { class: 'emote-pop', style: { left: `${12 + Math.random() * 60}%` } },
    el('span', { class: 'emote-pop__face' }, m.emote),
    el('span', { class: 'emote-pop__name', style: { background: ui.avatarColor(m.avatar) } }, m.name)
  );
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

const SUITS = ['♠', '♥', '♦', '♣'];
function rescueGame(m) {
  const show = el('div', { class: 'rescue__show' }, '¿Listo?');
  const dots = el('div', { class: 'rescue__dots' });
  const pad = el('div', { class: 'rescue__pad' });
  const answer = [];
  let modal = null;
  let timers = [];
  SUITS.forEach((suit, i) => {
    pad.append(
      el(
        'button',
        {
          class: `rescue__key${i === 1 || i === 2 ? ' rescue__key--red' : ''}`,
          type: 'button',
          disabled: true,
          onClick: () => {
            audio.play('chip');
            answer.push(i);
            dots.textContent = answer.map((v) => SUITS[v]).join(' ');
            if (answer.length === m.sequence.length) {
              send({ t: 'rescue', answer });
              modal.close();
            }
          },
        },
        suit
      )
    );
  });
  modal = ui.openModal({
    title: 'Rescate: ganátelo',
    size: 'sm',
    content: el(
      'div',
      { class: 'rescue' },
      el('p', { class: 'rescue__lead' }, `Memorizá los ${m.sequence.length} palos en orden y repetilos. Si fallás, no hay fichas.`),
      show,
      dots,
      pad
    ),
    actions: [{ label: 'Me rindo', variant: 'ghost' }],
    onClose: () => timers.forEach(clearTimeout),
  });
  m.sequence.forEach((value, i) => {
    timers.push(
      setTimeout(() => {
        show.textContent = SUITS[value];
        show.className = `rescue__show is-on${value === 1 || value === 2 ? ' rescue__key--red' : ''}`;
        audio.play('card');
      }, 900 + i * m.showMs)
    );
    timers.push(setTimeout(() => show.classList.remove('is-on'), 900 + i * m.showMs + m.showMs * 0.75));
  });
  timers.push(
    setTimeout(() => {
      show.textContent = '¡Tu turno!';
      show.className = 'rescue__show';
      pad.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }, 900 + m.sequence.length * m.showMs)
  );
}

function bankModal() {
  const my = me();
  const eco = S.room.economy;
  const room = Math.max(0, Math.floor((eco.loanLimit - my.debt) / (1 + eco.loanInterest)));
  const input = el('input', { class: 'input', type: 'number', min: eco.loanMin, step: 50, value: Math.min(500, Math.max(eco.loanMin, room)) });
  ui.openModal({
    title: 'El prestamista',
    size: 'sm',
    content: el(
      'div',
      { class: 'bank' },
      el('p', null, `"Yo le presto, cómo no. Me devuelve un ${Math.round(eco.loanInterest * 100)}% más, y hasta que pague me quedo con el ${Math.round(eco.garnish * 100)}% de lo que gane."`),
      el('p', { class: 'bank__row' }, 'Deuda actual', el('strong', { class: my.debt > 0 ? 'is-down' : '' }, formatChips(my.debt))),
      el('p', { class: 'bank__row' }, 'Límite de deuda (sube con tu nivel)', el('strong', null, formatChips(eco.loanLimit))),
      el('p', { class: 'bank__row' }, 'Podés pedir hasta', el('strong', null, formatChips(room))),
      el('label', { class: 'welcome__label' }, 'Monto', input),
      el('p', { class: 'bank__note' }, 'Con deuda no podés comprar en la tienda. Y todos ven cuánto debés.')
    ),
    actions: [
      { label: 'Cerrar', variant: 'ghost' },
      {
        label: 'Pagar deuda',
        variant: 'secondary',
        onClick: () => {
          if (my.debt > 0) send({ t: 'repay', amount: Math.max(1, Math.floor(Number(input.value)) || my.debt) });
        },
      },
      { label: 'Pedir préstamo', variant: 'primary', onClick: () => send({ t: 'loan', amount: Math.floor(Number(input.value)) }) },
    ],
  });
}

function shopModal() {
  const eco = S.room.economy;
  const my = me();
  const list = el('div', { class: 'shop' });
  const row = (item, note) => {
    const owned = eco.owned.includes(item.id);
    const equipped = eco.equipped === item.id;
    let button;
    if (!owned) {
      button = createButton(`${formatChips(item.price)}`, { variant: 'primary', size: 'sm', icon: 'chip', disabled: my.balance < item.price || my.debt > 0, onClick: () => { send({ t: 'buy', item: item.id }); handle.close(); } });
    } else if (item.id === eco.vip.id) {
      button = el('span', { class: 'shop__owned' }, 'Tuyo');
    } else {
      button = createButton(equipped ? 'Puesto' : 'Usar', { variant: 'secondary', size: 'sm', disabled: equipped, onClick: () => { send({ t: 'equip', item: item.id }); handle.close(); } });
    }
    list.append(el('div', { class: 'shop__row' }, el('div', null, el('strong', null, item.name), el('small', null, note)), button));
  };
  for (const title of eco.titles) row(title, 'Título que todos ven junto a tu nombre');
  row(eco.vip, `Emotes exclusivos: ${eco.vipEmotes.join(' ')}`);
  const handle = ui.openModal({
    title: 'Tienda del club',
    size: 'md',
    content: el('div', null, el('p', { class: 'bank__note' }, my.debt > 0 ? 'Tenés deuda: primero pagale al prestamista.' : 'Gastá tus fichas en algo que se note.'), list),
    actions: [{ label: 'Cerrar', variant: 'ghost' }],
  });
}

document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
renderWelcome();
connect();
