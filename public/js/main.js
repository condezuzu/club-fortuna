// Club Fortuna — app shell: connection, saved profile, welcome screen, casino floor,
// table view, and the always-present bottom bar with Don Fortunato and the walking avatars.
import * as ui from './ui.js';
import * as audio from './audio.js';
import * as avatars from './avatars.js';
import { createMascot } from './mascot.js';
import roulette from './games/roulette.js';
import blackjack from './games/blackjack.js';
import slots from './games/slots.js';
import baccarat from './games/baccarat.js';
import poker3 from './games/poker3.js';
import plinko from './games/plinko.js';

const { el, clear, formatChips, toast, createButton } = ui;
const MODULES = { roulette, blackjack, slots, baccarat, poker3, plinko };
const DEFAULT_CHIPS = [5, 25, 100, 500];
const THROW_GLYPH = { tomato: '🍅', rose: '🌹', cake: '🎂', water: '💦' };
const app = document.getElementById('app');

// "?p=2" opens a second, independent profile in the same browser (handy to try the game alone).
const slot = new URLSearchParams(location.search).get('p') || '';
const KEY = { token: `cf_token${slot}`, save: `cf_save${slot}`, name: `cf_name${slot}` };

const S = {
  ws: null,
  online: false,
  replaced: false,
  you: null,
  profile: null, // my profile as last seen outside a room
  catalog: null,
  games: [],
  room: null,
  offset: 0,
  table: null,
  instance: null,
  states: {},
  feedSeen: null,
  nets: new Map(),
  level: null,
  broke: false,
  editor: null,
  card: null, // the profile card that is open, if any
};
let R = {}; // persistent nodes of the room screen
let W = {}; // persistent nodes of the welcome screen

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
const playerOf = (id) => (S.room ? S.room.players.find((p) => p.id === id) || null : null);
const metaOf = (id) => S.games.find((g) => g.id === id) || null;
const moduleOf = (meta) => (meta ? MODULES[meta.base || meta.id] : null);
const safe = (fn) => {
  try {
    fn();
  } catch (err) {
    console.error(err);
  }
};

// ───────────────────────────── bottom bar: mascot + parade ─────────────────────────────

const mascot = createMascot({
  audio,
  getContext: () => {
    const my = me();
    return { name: S.you ? S.you.name : '', debt: my ? my.debt : S.profile ? S.profile.debt : 0 };
  },
});
const parade = avatars.createParade({ onPick: (id) => openProfile(id) });
document.body.append(el('div', { class: 'floorbar' }, el('div', { class: 'floorbar__host' }, mascot), parade));

function syncParade() {
  if (S.room) {
    const list = S.room.players;
    const richest = list.length > 1 ? list.reduce((a, b) => (b.balance > a.balance ? b : a)) : null;
    parade.sync(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        look: p.look,
        level: p.level,
        crown: Boolean(richest && richest.id === p.id && p.balance > 0),
        connected: p.connected,
        debt: p.debt,
      })),
      S.room.you
    );
  } else if (S.you && S.profile) {
    parade.sync(
      [{ id: S.you.id, name: S.you.name, avatar: S.you.avatar, look: S.profile.look, level: S.profile.level, crown: false, connected: true, debt: S.profile.debt }],
      S.you.id
    );
  } else {
    parade.sync([], null);
  }
}

function applyTheme() {
  const id = S.room ? S.room.economy.theme : S.profile ? S.profile.theme : 'theme:emerald';
  document.documentElement.dataset.theme = String(id || 'theme:emerald').split(':')[1] || 'emerald';
}

// ───────────────────────────── connection ─────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => {
    send({
      t: 'hello',
      token: store.get(sessionStorage, KEY.token) || undefined,
      save: store.get(localStorage, KEY.save) || undefined,
      name: store.get(localStorage, KEY.name) || undefined,
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
      S.catalog = m.catalog;
      S.profile = m.profile;
      S.games = (m.games || []).slice().sort((a, b) => a.order - b.order);
      S.offset = m.serverNow - Date.now();
      S.online = true;
      store.set(sessionStorage, KEY.token, m.token);
      if (m.save) store.set(localStorage, KEY.save, m.save);
      if (S.room && !m.room) {
        toast('El club se reinició y la sala se cerró. Tu jugador está a salvo: creá una sala nueva.', { kind: 'info', duration: 8000 });
      }
      setRoom(m.room);
      break;
    case 'save':
      store.set(localStorage, KEY.save, m.save);
      break;
    case 'you':
      S.you = m.you;
      if (m.profile) S.profile = m.profile;
      if (!S.room) {
        refreshWelcome();
        syncParade();
        applyTheme();
      }
      refreshEditor();
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
    case 'throw':
      showThrow(m);
      break;
    case 'rain':
      showRain(m);
      break;
    case 'tip':
      mascot.say('tip');
      toast(`${m.name} le dejó ${formatChips(m.amount)} fichas de propina a Don Fortunato.`, { kind: 'info' });
      break;
    case 'rescueChallenge':
      rescueGame(m);
      break;
    case 'daily':
      audio.play('bigwin');
      ui.celebrate({ kind: 'win', amount: m.bonus });
      toast(
        `¡Bono diario! +${formatChips(m.bonus)} fichas. ${m.streak > 1 ? `Racha de ${m.streak} días: volvé` : 'Volvé'} mañana y el bono crece.`,
        { kind: 'win', duration: 7000 }
      );
      mascot.say('tip', 'Tome, su bono del día. No se lo gaste todo en la primera mano. O sí, usted sabrá.');
      break;
    case 'badge':
      audio.play('bigwin');
      toast(`¡Logro desbloqueado! ${m.badge.glyph} ${m.badge.name}: ${m.badge.desc}.`, { kind: 'win', duration: 7000 });
      mascot.say('levelup');
      if (S.room) parade.cheer(S.room.you);
      break;
    case 'duel':
      duelIncoming(m.duel);
      break;
    case 'duelSent':
      toast(`Retaste a ${m.name} por ${formatChips(m.amount)} fichas. Esperando que conteste…`, { kind: 'info', duration: 5000 });
      break;
    case 'duelOff':
      duelOff(m);
      break;
    case 'duelResult':
      duelResult(m);
      break;
    case 'profileOf':
      if (S.card && S.card.id === m.player.id) S.card.fill(m.player);
      break;
    case 'celebrate': {
      const mine = m.bonuses && S.you && m.bonuses[S.you.id] !== undefined ? m.bonuses[S.you.id] : m.bonus;
      audio.play('jackpot');
      ui.celebrate({ kind: 'jackpot', caption: `¡Cuota ${m.level} cumplida!`, amount: mine });
      toast(
        m.mvp
          ? `¡Cuota cumplida! Figura del equipo: ${m.mvp.name}. Tu parte del bono: ${formatChips(mine)} fichas.`
          : `¡Cuota cumplida! Bono de ${formatChips(mine)} fichas.`,
        { kind: 'win', duration: 7000 }
      );
      mascot.say('quota');
      if (S.room) for (const p of S.room.players) parade.cheer(p.id);
      break;
    }
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
  W = {};
  clear(app);
  const hashCode = (location.hash.slice(1) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  W.name = el('input', {
    class: 'input',
    type: 'text',
    maxLength: 16,
    placeholder: 'Tu nombre',
    value: store.get(localStorage, KEY.name) || (S.you && S.you.name !== 'Invitado' ? S.you.name : ''),
  });
  const code = el('input', { class: 'input input--code', type: 'text', maxLength: 4, placeholder: 'ABCD', value: hashCode });
  W.avatar = el('div', { class: 'welcome__avatar' });
  W.stats = el('p', { class: 'welcome__stats' });

  const go = (msg) => {
    audio.unlock();
    if (!S.online) {
      toast('Conectando con el club…', { kind: 'info' });
      return;
    }
    const value = W.name.value.trim();
    if (!value) {
      toast('Escribí tu nombre para entrar.', { kind: 'error' });
      W.name.focus();
      return;
    }
    store.set(localStorage, KEY.name, value);
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
        el(
          'div',
          { class: 'welcome__me' },
          W.avatar,
          el(
            'div',
            { class: 'welcome__fields' },
            el('label', { class: 'welcome__label' }, 'Nombre', W.name),
            W.stats,
            createButton('Personalizar avatar', { variant: 'ghost', size: 'sm', icon: 'star', onClick: openWardrobe })
          )
        ),
        createButton('Crear sala', { variant: 'primary', size: 'lg', block: true, onClick: () => go({ t: 'createRoom' }) }),
        el('div', { class: 'welcome__or' }, 'o unite con un código'),
        el('div', { class: 'welcome__join' }, code, createButton('Unirme', { variant: 'secondary', size: 'lg', onClick: join })),
        el('p', { class: 'welcome__note' }, 'Fichas ficticias · Sin dinero real · Solo por diversión')
      )
    )
  );
  refreshWelcome();
  (hashCode && W.name.value ? code : W.name).focus();
}

function refreshWelcome() {
  if (!W.avatar || !S.you || !S.profile) return;
  const player = { name: S.you.name, avatar: S.you.avatar, look: S.profile.look };
  if (W.char) W.char.update(player);
  else {
    W.char = avatars.createAvatar(player, { size: 116 });
    W.avatar.append(W.char);
  }
  const p = S.profile;
  W.stats.textContent = `${formatChips(p.balance)} fichas · pico ${formatChips(p.peak)} · Nv ${p.level} ${p.rank}${p.debt > 0 ? ` · debés ${formatChips(p.debt)}` : ''}`;
}

// ───────────────────────────── room ─────────────────────────────

function profileFromRoom(room) {
  const my = room.players.find((p) => p.id === room.you);
  if (!my || !S.profile) return S.profile;
  return {
    ...S.profile,
    balance: my.balance + my.stake,
    peak: my.peak,
    debt: my.debt,
    level: my.level,
    rank: my.rank,
    title: my.title,
    look: my.look,
    stats: my.stats,
    owned: room.economy.owned,
    theme: room.economy.theme,
  };
}

function setRoom(room) {
  const before = S.room;
  if (before && !room) S.profile = profileFromRoom(before);
  S.room = room;
  applyTheme();
  if (!room) {
    S.feedSeen = null;
    S.nets = new Map();
    S.level = null;
    S.broke = false;
    renderWelcome();
    syncParade();
    return;
  }
  if (S.you) {
    const mine = room.players.find((p) => p.id === room.you);
    if (mine) S.you = { ...S.you, name: mine.name, avatar: mine.avatar };
  }
  if (location.hash.slice(1) !== room.code) history.replaceState(null, '', `${location.pathname}${location.search}#${room.code}`);
  if (!R.root || !R.root.isConnected) buildRoom();
  syncTable();
  updateRoom();
  syncParade();
  react(before, room);
  refreshEditor();
  if (S.card) S.card.sync();
}

/** Don Fortunato and the avatars react to what changed between two snapshots. */
function react(before, room) {
  const my = me();
  // Bets that resolved: the contribution moves only then.
  for (const p of room.players) {
    const prev = S.nets.get(p.id);
    if (prev !== undefined && p.net !== prev) {
      if (p.net > prev) parade.cheer(p.id);
      else parade.sad(p.id);
    }
    S.nets.set(p.id, p.net);
  }
  // Feed lines that are new to this client.
  const last = room.feed.length ? room.feed[room.feed.length - 1].id : 0;
  if (S.feedSeen !== null) {
    const kinds = { join: 'join', loan: 'loan', rescue: 'rescue', fail: 'rescueFail', shop: 'shop' };
    const fresh = room.feed.filter((entry) => entry.id > S.feedSeen).reverse();
    const entry = fresh.find((item) => kinds[item.kind] && !(item.kind === 'join' && item.playerId === room.you));
    if (entry) mascot.say(kinds[entry.kind]);
  }
  S.feedSeen = last;
  if (!my) return;
  if (S.level !== null && my.level > S.level) {
    audio.play('bigwin');
    toast(`¡Subiste a nivel ${my.level}! Ahora sos ${my.rank}. Tu límite con el prestamista sube a ${formatChips(room.economy.loanLimit)}.`, {
      kind: 'win',
      duration: 6000,
    });
    mascot.say('levelup');
    parade.cheer(my.id);
  }
  S.level = my.level;
  const broke = my.balance + my.stake < room.rescue.threshold;
  if (broke && !S.broke && before) mascot.say('poor');
  S.broke = broke;
}

function buildRoom() {
  clear(app);
  R = { cards: new Map() };
  R.code = el('strong', { class: 'hud__code' });
  R.balance = el('strong', { class: 'hud__balance' });
  R.debt = el('span', { class: 'hud__debt' });
  R.wallet = el('div', { class: 'hud__wallet', title: 'Tus fichas' }, ui.icon('chip'), el('div', { class: 'hud__money' }, R.balance, R.debt));
  R.rescue = createButton('Rescate', { variant: 'danger', size: 'sm', icon: 'lifebuoy', onClick: () => send({ t: 'rescue' }) });
  R.daily = createButton('Bono diario', { variant: 'primary', size: 'sm', icon: 'gift', onClick: () => send({ t: 'daily' }) });
  R.daily.classList.add('hud__daily');
  R.meBust = el('span', { class: 'hud__bust' });
  R.meName = el('span', { class: 'hud__name' });
  R.meLevel = el('span', { class: 'hud__level' });
  R.meBar = el('span', { class: 'hud__xp' }, el('i'));
  const meBtn = el(
    'button',
    { class: 'hud__me', type: 'button', title: 'Tu perfil', onClick: () => openProfile(S.room.you) },
    R.meBust,
    el('span', { class: 'hud__who' }, R.meName, R.meLevel, R.meBar)
  );
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

  R.main = el('main', { class: 'room__main' });
  R.players = el('div', { class: 'side__list' });
  R.emotes = el('div', { class: 'emote-bar' });
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
      el('span', { class: 'hud__room' }, 'Sala ', R.code),
      copy,
      el('span', { class: 'hud__spacer' }),
      R.daily,
      R.rescue,
      R.wallet,
      meBtn,
      createButton('Tienda', { variant: 'ghost', size: 'sm', icon: 'crown', onClick: openShop }),
      createButton('Banco', { variant: 'ghost', size: 'sm', icon: 'chip', onClick: openBank }),
      R.mute,
      createButton('Salir', { variant: 'ghost', size: 'sm', icon: 'close', onClick: () => send({ t: 'leaveRoom' }) })
    ),
    el(
      'div',
      { class: 'room__body' },
      R.main,
      el(
        'aside',
        { class: 'side' },
        el(
          'section',
          { class: 'side__box panel' },
          el(
            'div',
            { class: 'side__head' },
            el('h3', { class: 'side__title' }, 'Equipo'),
            createButton('Podio', { variant: 'ghost', size: 'sm', icon: 'trophy', onClick: openPodium })
          ),
          R.players,
          R.emotes
        ),
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
  const want = my && moduleOf(metaOf(my.table)) ? my.table : null;
  if (R.view && want === S.table) return;
  unmount();
  S.table = want;
  if (want) buildTable(want);
  else buildFloor();
}

function denomination(amount) {
  let value = ui.CHIP_VALUES[0];
  for (const v of ui.CHIP_VALUES) if (amount >= v) value = v;
  return value;
}

/** Flying chips: bets going out, winnings coming to the wallet, losses going to the dealer. */
const fx = {
  bet(from, to, value) {
    audio.play('chip');
    if (from && to) ui.flyChip(from, to, { value, size: 'sm', duration: 380 });
  },
  pay(from, amount) {
    if (!from || !R.wallet || !(amount > 0)) return;
    audio.play('chips');
    const wallet = R.wallet;
    Promise.resolve(
      ui.flyChip(from, wallet, {
        value: denomination(amount / 3),
        size: 'sm',
        count: Math.min(10, 3 + Math.floor(Math.log10(amount + 1) * 1.6)),
        duration: 680,
        stagger: 55,
      })
    ).then(() => {
      wallet.classList.remove('is-pop');
      void wallet.offsetWidth;
      wallet.classList.add('is-pop');
    });
  },
  take(from, amount) {
    if (!from || !(amount > 0)) return;
    ui.flyChip(from, mascot, {
      value: denomination(amount / 2),
      size: 'sm',
      count: Math.min(6, 2 + Math.floor(Math.log10(amount + 1))),
      duration: 600,
      stagger: 60,
    });
  },
};

function buildTable(id) {
  const meta = metaOf(id);
  const mod = moduleOf(meta);
  const kind = meta.base || meta.id;
  R.view = 'table';
  R.cards = new Map();
  clear(R.main);
  const stage = el('div', { class: `game-stage game-${kind}${meta.tier === 'high' ? ' game-stage--high' : ''}` });
  R.main.append(
    el(
      'div',
      { class: 'table-bar' },
      createButton('Volver al salón', { variant: 'ghost', size: 'sm', icon: 'back', onClick: () => send({ t: 'stand' }) }),
      el('h2', { class: 'table-bar__title' }, meta.name),
      meta.tier === 'high' ? el('span', { class: 'table-bar__tier' }, 'High Limit') : null,
      el('span', { class: 'table-bar__limits' }, `Apuestas de ${formatChips(meta.minBet)} a ${formatChips(meta.maxBet)}`),
      el('span', { class: 'hud__spacer' }),
      Array.isArray(mod.help)
        ? createButton('Cómo se juega', {
            variant: 'secondary',
            size: 'sm',
            icon: 'info',
            onClick: () =>
              ui.openModal({
                title: `Cómo se juega: ${meta.name}`,
                size: 'md',
                content: el(
                  'div',
                  { class: 'rules' },
                  ...mod.help.map((line) => el('p', null, line)),
                  el('p', { class: 'rules__limits' }, `En esta mesa las apuestas van de ${formatChips(meta.minBet)} a ${formatChips(meta.maxBet)} fichas.`)
                ),
                actions: [{ label: 'Entendido', variant: 'primary' }],
              }),
          })
        : null
    ),
    stage
  );
  const api = {
    send: (action) => send({ t: 'action', action }),
    me: () => me() || { id: S.you.id, name: S.you.name, avatar: S.you.avatar, balance: 0, debt: 0 },
    players: () => (S.room ? S.room.players : []),
    player: playerOf,
    meta: { ...meta, chips: meta.chips || DEFAULT_CHIPS },
    serverNow,
    ui,
    audio,
    fx,
    dealer: { say: (k, text) => mascot.say(k, text), play: (anim) => mascot.play(anim) },
    bust: (p, size) => avatars.createBust(playerOf(p.id) || p, { size: size || 28 }),
  };
  try {
    S.instance = mod.mount(stage, api);
    if (S.states[id]) S.instance.update(S.states[id]);
  } catch (err) {
    console.error(err);
    toast('No pudimos abrir la mesa.', { kind: 'error' });
  }
  if (meta.tier === 'high') mascot.say('highroller');
}

function buildFloor() {
  R.view = 'floor';
  R.cards = new Map();
  clear(R.main);
  R.quota = el('section', { class: 'quota panel panel--ornate' });
  const lobby = (title, sub, tier) => {
    const grid = el('div', { class: `games games--${tier}` });
    for (const meta of S.games.filter((g) => (g.tier || 'main') === tier)) grid.append(gameCard(meta));
    return el(
      'section',
      { class: `lobby lobby--${tier}` },
      el('header', { class: 'lobby__head' }, el('h2', { class: 'lobby__title' }, title), el('p', { class: 'lobby__sub' }, sub)),
      grid
    );
  };
  R.main.append(R.quota, lobby('Salón principal', 'Mesas para todo el equipo', 'main'));
  const high = S.games.filter((g) => g.tier === 'high');
  if (high.length) {
    const min = Math.min(...high.map((g) => g.minBalance || 0));
    R.main.append(lobby('Salón High Limit', `Solo para quien tenga ${formatChips(min)} fichas o más en la mano`, 'high'));
  }
  R.main.append(el('p', { class: 'floor__note' }, 'Fichas ficticias · Sin dinero real · Solo por diversión'));
}

function gameCard(meta) {
  const mod = moduleOf(meta);
  const seated = el('div', { class: 'game-card__seated' });
  const button = createButton('Sentarse', { variant: 'primary', block: true, onClick: () => send({ t: 'sit', game: meta.id }) });
  let art = null;
  if (mod && typeof mod.art === 'function') {
    safe(() => {
      art = mod.art(ui);
    });
  }
  const card = el(
    'article',
    { class: `game-card panel${meta.tier === 'high' ? ' game-card--high' : ''}` },
    el('div', { class: `game-card__art game-card__art--${meta.base || meta.id}` }, art || ui.icon(mod ? mod.icon : 'clock')),
    el('h3', { class: 'game-card__name' }, meta.name),
    el('p', { class: 'game-card__tagline' }, meta.tagline),
    el('p', { class: 'game-card__limits' }, `Apuestas de ${formatChips(meta.minBet)} a ${formatChips(meta.maxBet)}`),
    seated,
    button
  );
  R.cards.set(meta.id, { card, seated, button, meta, mod });
  return card;
}

function updateRoom() {
  const room = S.room;
  const my = me();
  if (!room || !my) return;
  R.code.textContent = room.code;
  R.balance.textContent = formatChips(my.balance);
  flashBalance(my.balance);
  R.debt.textContent = my.debt > 0 ? `debés ${formatChips(my.debt)}` : '';
  R.rescue.hidden = !(room.rescue && my.balance + my.stake < room.rescue.threshold);
  paintDaily();

  if (R.meChar) R.meChar.update(my);
  else {
    R.meChar = avatars.createBust(my, { size: 34 });
    R.meBust.append(R.meChar);
  }
  R.meName.textContent = my.name;
  R.meLevel.textContent = `Nv ${my.level} · ${my.title || my.rank}`;
  const base = S.catalog.xpBase;
  const from = base * my.level * my.level;
  const to = base * (my.level + 1) * (my.level + 1);
  R.meBar.firstChild.style.width = `${Math.max(0, Math.min(100, ((my.stats.wagered - from) / (to - from)) * 100))}%`;
  R.meBar.title = `Apostaste ${formatChips(my.stats.wagered)} fichas. Próximo nivel a las ${formatChips(to)}.`;

  renderPlayers();
  renderEmotes();
  renderFeed();
  renderChat();
  if (R.view === 'floor') {
    renderQuota();
    renderGames();
  }
}

/** The daily bonus button shows up only while there is a bonus to claim. */
function paintDaily() {
  if (!R.daily || !S.room) return;
  const daily = S.room.daily;
  const ready = Boolean(daily) && serverNow() >= daily.availableAt;
  R.daily.hidden = !ready;
  if (ready) R.daily.setLabel(`Bono diario +${formatChips(daily.bonus)}`);
}
setInterval(paintDaily, 30000);

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

function tableName(id) {
  const meta = metaOf(id);
  return meta ? meta.name : 'En el salón';
}

function renderPlayers() {
  clear(R.players);
  const list = S.room.players;
  const richest = list.length > 1 ? list.reduce((a, b) => (b.balance > a.balance ? b : a)) : null;
  for (const p of list) {
    const mine = p.id === S.room.you;
    const crown = Boolean(richest && richest.id === p.id && p.balance > 0);
    R.players.append(
      el(
        'button',
        {
          class: `member${p.connected ? '' : ' member--off'}${crown ? ' member--crown' : ''}${p.level >= 6 ? ' member--elite' : ''}`,
          type: 'button',
          title: `Ver el perfil de ${p.name}`,
          onClick: () => openProfile(p.id),
        },
        el(
          'span',
          { class: 'member__avatar' },
          avatars.createBust(p, { size: 36 }),
          crown ? el('span', { class: 'member__crown', title: 'El más rico de la sala' }, '👑') : null
        ),
        el(
          'span',
          { class: 'member__text' },
          el('span', { class: 'member__name' }, mine ? `${p.name} (vos)` : p.name, el('span', { class: 'member__level' }, `Nv ${p.level}`)),
          el('span', { class: 'member__title' }, p.title || p.rank),
          el('span', { class: 'member__meta' }, p.connected ? tableName(p.table) : 'Desconectado')
        ),
        el(
          'span',
          { class: 'member__money' },
          el('span', { class: 'member__chips' }, formatChips(p.balance)),
          el('span', { class: 'member__peak', title: 'Lo máximo que llegó a tener' }, `pico ${formatChips(p.peak)}`),
          p.debt > 0 ? el('span', { class: 'member__debt' }, `debe ${formatChips(p.debt)}`) : null
        )
      )
    );
  }
}

function renderEmotes() {
  const owned = S.room.economy.owned;
  const key = owned.join(',');
  if (R.emotes.dataset.key === key && R.emotes.children.length) return;
  R.emotes.dataset.key = key;
  clear(R.emotes);
  const all = S.catalog.emotes.concat(owned.includes(S.catalog.vip.id) ? S.catalog.vipEmotes : []);
  for (const emote of all) {
    R.emotes.append(
      el('button', { class: 'emote-btn', type: 'button', 'aria-label': `Emote ${emote}`, onClick: () => send({ t: 'emote', emote }) }, emote)
    );
  }
}

function renderFeed() {
  clear(R.feed);
  const items = S.room.feed
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 14);
  if (items.length === 0) R.feed.append(el('p', { class: 'side__empty' }, 'Todavía no pasó nada.'));
  for (const item of items) R.feed.append(el('p', { class: `feed__item feed__item--${item.kind || 'info'}` }, item.text));
}

function renderChat() {
  if (!R.chatList || !S.room) return;
  clear(R.chatList);
  const msgs = S.room.chat.slice(-40);
  if (msgs.length === 0) R.chatList.append(el('p', { class: 'side__empty' }, 'Saludá a la mesa.'));
  for (const msg of msgs) {
    R.chatList.append(el('p', { class: 'chat__msg' }, el('strong', { style: { color: ui.avatarColor(msg.avatar) } }, `${msg.name}: `), msg.text));
  }
  R.chatList.scrollTop = R.chatList.scrollHeight;
}

/** The team quota, and who is actually pulling the cart. */
function renderQuota() {
  const g = S.room.goal;
  const players = S.room.players.slice().sort((a, b) => b.net - a.net);
  const span = Math.max(1, (g.target || 0) - (g.prevTarget || 0));
  const pct = Math.max(0, Math.min(100, ((g.profit - (g.prevTarget || 0)) / span) * 100));
  const positive = players.filter((p) => p.net > 0);
  const others = g.profit - players.reduce((sum, p) => sum + p.net, 0);

  const fill = el('div', { class: 'quota__fill', style: { width: `${pct}%` } });
  for (const p of positive) {
    fill.append(
      el('i', {
        class: 'quota__seg',
        title: `${p.name}: +${formatChips(p.net)}`,
        style: { flexGrow: String(p.net), background: ui.avatarColor(p.avatar) },
      })
    );
  }

  const legend = el('div', { class: 'quota__legend' });
  players.forEach((p, index) => {
    const mvp = index === 0 && p.net > 0;
    legend.append(
      el(
        'button',
        { class: `quota__who${mvp ? ' is-mvp' : ''}`, type: 'button', onClick: () => openProfile(p.id) },
        avatars.createBust(p, { size: 30 }),
        el('span', { class: 'quota__name' }, p.name, mvp ? el('em', null, 'Figura') : null),
        el('strong', { class: p.net > 0 ? 'is-up' : p.net < 0 ? 'is-down' : '' }, `${p.net > 0 ? '+' : ''}${formatChips(p.net)}`)
      )
    );
  });
  if (others !== 0) {
    legend.append(
      el(
        'span',
        { class: 'quota__who quota__who--gone' },
        el('span', { class: 'quota__name' }, 'Los que se fueron'),
        el('strong', { class: others > 0 ? 'is-up' : 'is-down' }, `${others > 0 ? '+' : ''}${formatChips(others)}`)
      )
    );
  }

  clear(R.quota);
  R.quota.append(
    el('p', { class: 'quota__eyebrow' }, `Cuota del equipo · ${g.level} ${g.level === 1 ? 'cumplida' : 'cumplidas'}`),
    el(
      'div',
      { class: 'quota__head' },
      el('h2', { class: 'quota__title' }, formatChips(g.profit), el('small', null, ` de ${formatChips(g.target)}`)),
      el(
        'p',
        { class: 'quota__text' },
        'Ganancia del equipo contra la casa. Al cumplir la cuota hay bono para todos, y se reparte según lo que aportó cada uno.'
      )
    ),
    el('div', { class: 'quota__bar' }, fill),
    legend
  );
}

function renderGames() {
  const my = me();
  for (const { seated, button, meta, mod, card } of R.cards.values()) {
    const here = ((S.room.tables[meta.id] || {}).seated || []).map(playerOf).filter(Boolean);
    clear(seated);
    for (const p of here) seated.append(avatars.createBust(p, { size: 26 }));
    const missing = meta.minBalance ? meta.minBalance - my.balance : 0;
    const locked = missing > 0;
    card.classList.toggle('is-locked', locked);
    button.disabled = !mod || locked;
    button.setLabel(!mod ? 'Próximamente' : locked ? `Te faltan ${formatChips(missing)}` : 'Sentarse');
  }
}

// ───────────────────────────── profile card (stats + history + actions) ─────────────────────────────

function ago(ts) {
  const seconds = Math.max(0, Math.round((serverNow() - ts) / 1000));
  if (seconds < 60) return 'recién';
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} d`;
}

function openProfile(id) {
  const first = playerOf(id);
  if (!first) return;
  const mine = id === S.room.you;
  const char = avatars.createAvatar(first, { size: 132 });
  const head = el('div', { class: 'pcard__head' });
  const stats = el('div', { class: 'pcard__stats' });
  const actions = el('div', { class: 'pcard__actions' });
  const history = el('div', { class: 'pcard__history' }, el('p', { class: 'side__empty' }, 'Cargando…'));
  const badgesTitle = el('h4', { class: 'pcard__subtitle' }, 'Logros');
  const badgesEl = el('div', { class: 'pcard__badges' });
  const paintBadges = (have) => {
    const all = S.catalog.badges || [];
    badgesTitle.textContent = `Logros · ${have.length} de ${all.length}`;
    clear(badgesEl);
    for (const badge of all) {
      const on = have.includes(badge.id);
      badgesEl.append(
        el(
          'button',
          {
            class: `pcard__badge${on ? ' is-on' : ''}`,
            type: 'button',
            title: `${badge.name}: ${badge.desc}`,
            'aria-label': `${badge.name}${on ? '' : ' (sin desbloquear)'}`,
            onClick: () => toast(`${badge.glyph} ${badge.name}: ${badge.desc}${on ? '' : ' (todavía no)'}`, { kind: on ? 'win' : 'info' }),
          },
          on ? badge.glyph : '?'
        )
      );
    }
  };
  paintBadges([]);
  const stat = (label, value, cls) => el('div', { class: 'pcard__stat' }, el('span', null, label), el('strong', { class: cls || '' }, value));
  let details = null;
  let modal = null;
  const close = () => modal && modal.close();

  const sync = () => {
    const p = playerOf(id);
    if (!p) return;
    char.update(p);
    clear(head);
    head.append(el('h3', { class: 'pcard__name' }, p.name), el('p', { class: 'pcard__rank' }, `Nivel ${p.level} · ${p.rank}`));
    if (p.title) head.append(el('p', { class: 'pcard__title' }, p.title));
    head.append(el('p', { class: 'pcard__where' }, p.connected ? tableName(p.table) : 'Desconectado'));
    clear(stats);
    stats.append(
      stat('Fichas', formatChips(p.balance)),
      stat('Pico de fichas', formatChips(p.peak), 'is-gold'),
      stat('Aporte a la cuota', `${p.net > 0 ? '+' : ''}${formatChips(p.net)}`, p.net > 0 ? 'is-up' : p.net < 0 ? 'is-down' : ''),
      stat('Deuda', formatChips(p.debt), p.debt > 0 ? 'is-down' : ''),
      stat('Apostado', formatChips(p.stats.wagered)),
      stat('Cobrado', formatChips(p.stats.won)),
      stat('Mayor premio', formatChips(p.stats.biggestWin)),
      stat('Propinas al crupier', formatChips(details ? details.tips : 0))
    );
    clear(actions);
    if (mine) {
      actions.append(
        createButton('Vestuario', { variant: 'primary', size: 'sm', icon: 'star', onClick: () => { close(); openWardrobe(); } }),
        createButton('Tienda', { variant: 'secondary', size: 'sm', icon: 'crown', onClick: () => { close(); openShop(); } }),
        createButton('Banco', { variant: 'secondary', size: 'sm', icon: 'chip', onClick: () => { close(); openBank(); } })
      );
    } else {
      actions.append(createButton('Regalar fichas', { variant: 'primary', size: 'sm', icon: 'gift', onClick: () => giftModal(p) }));
      actions.append(
        createButton('Retar a duelo', {
          variant: 'secondary',
          size: 'sm',
          icon: 'dice',
          onClick: () => {
            close();
            duelModal(p);
          },
        })
      );
      if (p.debt > 0) actions.append(createButton('Pagarle la deuda', { variant: 'secondary', size: 'sm', onClick: () => debtModal(p) }));
      for (const item of S.catalog.throwables) {
        actions.append(
          el(
            'button',
            {
              class: 'throw-btn',
              type: 'button',
              title: `Tirarle: ${item.name}`,
              onClick: () => {
                send({ t: 'throw', to: id, item: item.id });
                close();
              },
            },
            el('span', null, THROW_GLYPH[item.id] || '❓'),
            el('small', null, formatChips(item.price))
          )
        );
      }
    }
  };

  const fill = (data) => {
    details = data;
    sync();
    paintBadges(data.badges || []);
    clear(history);
    if (!data.history.length) history.append(el('p', { class: 'side__empty' }, 'Todavía no jugó ninguna mano.'));
    for (const entry of data.history) {
      const net = entry.r - entry.w;
      history.append(
        el(
          'div',
          { class: 'pcard__row' },
          el('span', { class: 'pcard__game' }, entry.g),
          el('span', { class: 'pcard__bet' }, `apostó ${formatChips(entry.w)}`),
          el('strong', { class: net > 0 ? 'is-up' : net < 0 ? 'is-down' : '' }, `${net > 0 ? '+' : ''}${formatChips(net)}`),
          el('span', { class: 'pcard__when' }, ago(entry.t))
        )
      );
    }
  };

  modal = ui.openModal({
    title: mine ? 'Tu perfil' : 'Perfil',
    size: 'md',
    content: el(
      'div',
      { class: 'pcard' },
      el('div', { class: 'pcard__top' }, el('div', { class: 'pcard__avatar' }, char), head),
      stats,
      actions,
      badgesTitle,
      badgesEl,
      el('h4', { class: 'pcard__subtitle' }, 'Últimas jugadas'),
      history
    ),
    actions: [{ label: 'Cerrar', variant: 'ghost' }],
    onClose: () => {
      if (S.card && S.card.id === id) S.card = null;
    },
  });
  S.card = { id, fill, sync };
  sync();
  send({ t: 'profileOf', id });
}

function amountModal({ title, label, value, action, onSubmit }) {
  const input = el('input', { class: 'input', type: 'number', min: 1, step: 1, value });
  ui.openModal({
    title,
    size: 'sm',
    content: el('label', { class: 'welcome__label' }, label, input),
    actions: [
      { label: 'Cancelar', variant: 'ghost' },
      {
        label: action,
        variant: 'primary',
        onClick: () => {
          const amount = Math.floor(Number(input.value));
          if (!(amount >= 1)) return false;
          onSubmit(amount);
          return true;
        },
      },
    ],
  });
}

function giftModal(p) {
  amountModal({
    title: `Regalar fichas a ${p.name}`,
    label: 'Cantidad de fichas',
    value: 100,
    action: 'Regalar',
    onSubmit: (amount) => send({ t: 'gift', to: p.id, amount }),
  });
}

function debtModal(p) {
  amountModal({
    title: `Pagar la deuda de ${p.name}`,
    label: `Debe ${formatChips(p.debt)} fichas. ¿Cuánto ponés?`,
    value: Math.min(p.debt, me().balance),
    action: 'Pagar',
    onSubmit: (amount) => send({ t: 'repayFor', to: p.id, amount }),
  });
}

// ───────────────────────────── podium ─────────────────────────────

/** Who stands out in the room, category by category. */
function openPodium() {
  const players = S.room.players;
  const top = (value) => players.reduce((best, p) => (value(p) > value(best) ? p : best), players[0]);
  const rows = [];
  const add = (glyph, title, pick, value, show) => {
    const p = top(pick);
    if (!p || (show && !show(p))) return;
    rows.push(
      el(
        'button',
        { class: 'podium__row', type: 'button', onClick: () => { modal.close(); openProfile(p.id); } },
        el('span', { class: 'podium__glyph' }, glyph),
        el('span', { class: 'podium__text' }, el('small', null, title), el('strong', null, p.name)),
        avatars.createBust(p, { size: 34 }),
        el('span', { class: 'podium__value' }, value(p))
      )
    );
  };
  const signed = (n) => `${n > 0 ? '+' : ''}${formatChips(n)}`;
  add('👑', 'El más rico', (p) => p.balance, (p) => formatChips(p.balance));
  add('📈', 'El pico más alto', (p) => p.peak, (p) => formatChips(p.peak));
  add('⭐', 'Figura del equipo', (p) => p.net, (p) => signed(p.net), (p) => p.net > 0);
  add('💥', 'El mayor premio', (p) => p.stats.biggestWin, (p) => signed(p.stats.biggestWin), (p) => p.stats.biggestWin > 0);
  add('🎲', 'El más timbero', (p) => p.stats.wagered, (p) => `${formatChips(p.stats.wagered)} apostadas`, (p) => p.stats.wagered > 0);
  add('🎖️', 'El de más nivel', (p) => p.level, (p) => `Nv ${p.level} · ${p.rank}`, (p) => p.level > 0);
  add('🏅', 'El de más logros', (p) => p.badges, (p) => `${p.badges} ${p.badges === 1 ? 'logro' : 'logros'}`, (p) => p.badges > 0);
  add('🎩', 'El más generoso con el crupier', (p) => p.tips, (p) => formatChips(p.tips), (p) => p.tips > 0);
  add('💸', 'El más endeudado', (p) => p.debt, (p) => `debe ${formatChips(p.debt)}`, (p) => p.debt > 0);
  add('🧂', 'El más salado', (p) => -p.net, (p) => signed(p.net), (p) => p.net < 0);
  const modal = ui.openModal({
    title: 'Podio de la sala',
    size: 'md',
    content: el('div', { class: 'podium' }, ...(rows.length ? rows : [el('p', { class: 'side__empty' }, 'Todavía no hay nada que premiar. A jugar.')])),
    actions: [{ label: 'Cerrar', variant: 'ghost' }],
  });
}

// ───────────────────────────── duels ─────────────────────────────

function duelModal(p) {
  const my = me();
  amountModal({
    title: `Duelo a cara o cruz con ${p.name}`,
    label: 'Cada uno pone esta cantidad de fichas. El que gana se lleva todo.',
    value: Math.max(10, Math.min(100, my.balance, p.balance)),
    action: 'Retar',
    onSubmit: (amount) => send({ t: 'duel', to: p.id, amount }),
  });
}

let duelPrompt = null;

function duelIncoming(duel) {
  audio.play('notify');
  const from = playerOf(duel.from) || { name: duel.name, avatar: duel.avatar };
  const left = el('strong', { class: 'duel-ask__time' }, `${Math.ceil(duel.ttlMs / 1000)} s`);
  const until = Date.now() + duel.ttlMs;
  const timer = setInterval(() => {
    left.textContent = `${Math.max(0, Math.ceil((until - Date.now()) / 1000))} s`;
  }, 500);
  const answer = (accept) => () => {
    send({ t: 'duelAnswer', id: duel.id, accept });
  };
  const modal = ui.openModal({
    title: '¡Te retaron a duelo!',
    size: 'sm',
    dismissible: false,
    content: el(
      'div',
      { class: 'duel-ask' },
      avatars.createAvatar(from, { size: 110 }),
      el('p', null, el('strong', null, duel.name), ' te reta a cara o cruz por ', el('strong', { class: 'is-gold' }, formatChips(duel.amount)), ' fichas cada uno.'),
      el('p', { class: 'duel-ask__note' }, 'Se decide con una moneda. Tenés ', left, ' para contestar.')
    ),
    actions: [
      { label: 'Ni loco', variant: 'ghost', onClick: answer(false) },
      { label: '¡Acepto!', variant: 'primary', onClick: answer(true) },
    ],
    onClose: () => clearInterval(timer),
  });
  duelPrompt = { id: duel.id, close: () => modal.close() };
}

function duelOff(m) {
  if (duelPrompt && duelPrompt.id === m.id) {
    duelPrompt.close();
    duelPrompt = null;
    if (m.reason !== 'declined') toast('El duelo se cayó.', { kind: 'info' });
    return;
  }
  if (m.reason === 'declined') {
    toast(`${m.name} no aceptó el duelo. 🐔`, { kind: 'info', duration: 5000 });
    mascot.say('fold', `${m.name} arrugó. Los valientes mueren una vez; los otros, cada vez que los retan.`);
  } else if (m.reason === 'expired') {
    toast(`${m.name} no contestó el duelo a tiempo.`, { kind: 'info' });
  } else {
    toast('El duelo se cayó: alguno se quedó sin las fichas.', { kind: 'info' });
  }
}

function duelResult(m) {
  if (duelPrompt && duelPrompt.id === m.id) duelPrompt = null;
  const mine = S.room && (m.winner.id === S.room.you || m.loser.id === S.room.you);
  const won = S.room && m.winner.id === S.room.you;
  const winner = playerOf(m.winner.id) || m.winner;
  const loser = playerOf(m.loser.id) || m.loser;
  const reduced = ui.prefersReducedMotion();
  const flipMs = reduced ? 0 : 1900;

  const coin = el(
    'div',
    { class: `duel__coin${Math.random() < 0.5 ? ' duel__coin--tails' : ''}` },
    el('div', { class: 'duel__face duel__face--front' }, avatars.createBust(winner, { size: 96 })),
    el('div', { class: 'duel__face duel__face--back' }, avatars.createBust(loser, { size: 96 }))
  );
  const verdict = el('div', { class: 'duel__verdict' });
  const overlay = el(
    'div',
    { class: 'duel', onClick: () => overlay.remove() },
    el(
      'div',
      { class: 'duel__box' },
      el('p', { class: 'duel__title' }, 'Duelo a cara o cruz'),
      el('p', { class: 'duel__names' }, el('strong', null, winner.name), ' vs ', el('strong', null, loser.name), ` · ${formatChips(m.amount)} fichas cada uno`),
      coin,
      verdict
    )
  );
  document.body.append(overlay);
  if (!reduced) audio.play('spin');
  setTimeout(() => {
    overlay.classList.add('is-done');
    verdict.append(
      el('strong', { class: 'duel__winner' }, `¡Ganó ${winner.name}!`),
      el('span', { class: mine ? (won ? 'is-up' : 'is-down') : '' }, mine ? (won ? `+${formatChips(m.amount)} fichas para vos` : `-${formatChips(m.amount)} fichas`) : `Se lleva ${formatChips(m.amount)} fichas de ${loser.name}`)
    );
    parade.cheer(m.winner.id);
    parade.sad(m.loser.id);
    if (mine) {
      audio.play(won ? 'bigwin' : 'lose');
      mascot.say(won ? 'win' : 'lose');
      if (won) ui.celebrate({ kind: 'win', amount: m.amount });
    } else {
      audio.play('notify');
      mascot.say('emote', `${loser.name} acaba de regalarle ${formatChips(m.amount)} fichas a ${winner.name}. Qué generosidad.`);
    }
  }, flipMs);
  setTimeout(() => overlay.remove(), flipMs + 3200);
}

// ───────────────────────────── wardrobe ─────────────────────────────

function editorState() {
  const my = me();
  return {
    player: { name: S.you.name, avatar: my ? my.avatar : S.you.avatar, look: my ? my.look : S.profile.look },
    owned: S.room ? S.room.economy.owned : S.profile.owned,
    balance: my ? my.balance : S.profile.balance,
    canBuy: Boolean(my) && my.debt === 0,
    lockedReason: my ? 'Con deuda no hay compras: primero pagale al prestamista.' : 'Entrá a una sala para comprar accesorios.',
  };
}

function refreshEditor() {
  if (S.editor && S.you && S.profile) S.editor.refresh(editorState());
}

function openWardrobe() {
  if (!S.you || !S.profile || !S.catalog) {
    toast('Conectando con el club…', { kind: 'info' });
    return;
  }
  const editor = avatars.createLookEditor({
    ...editorState(),
    catalog: S.catalog.cosmetics,
    onChange: (look, avatar) => send({ t: 'look', look, avatar }),
    onBuy: (itemId) => send({ t: 'buy', item: itemId }),
  });
  S.editor = editor;
  ui.openModal({
    title: 'Vestuario',
    size: 'lg',
    content: editor,
    actions: [{ label: 'Listo', variant: 'primary' }],
    onClose: () => {
      if (typeof editor.destroy === 'function') editor.destroy();
      S.editor = null;
    },
  });
}

// ───────────────────────────── shop & bank ─────────────────────────────

const THEME_SWATCH = { emerald: '#186f50', crimson: '#861c2e', royal: '#1f50ad', purple: '#5a24a6', midnight: '#293041' };

function openShop() {
  const eco = S.room.economy;
  const cat = S.catalog;
  const my = me();
  let modal = null;
  const close = () => modal && modal.close();
  const buy = (item) => () => {
    send({ t: 'buy', item });
    close();
  };
  const section = (title, hint, ...rows) =>
    el('section', { class: 'shop__section' }, el('h4', { class: 'shop__title' }, title), hint ? el('p', { class: 'shop__hint' }, hint) : null, ...rows);
  const priceButton = (price, onClick, disabled) =>
    createButton(formatChips(price), { variant: 'primary', size: 'sm', icon: 'chip', disabled: disabled || my.balance < price, onClick });
  const row = (lead, name, note, control) =>
    el('div', { class: 'shop__row' }, lead, el('div', { class: 'shop__text' }, el('strong', null, name), note ? el('small', null, note) : null), control);
  const inDebt = my.debt > 0;

  const titles = cat.titles.map((item) => {
    const owned = eco.owned.includes(item.id);
    const control = !owned
      ? priceButton(item.price, buy(item.id), inDebt)
      : createButton(eco.title === item.id ? 'Quitar' : 'Usar', {
          variant: 'secondary',
          size: 'sm',
          onClick: () => {
            send({ t: 'equip', item: eco.title === item.id ? null : item.id });
            close();
          },
        });
    return row(null, item.name, owned ? 'Ya es tuyo' : 'Título que todos ven junto a tu nombre', control);
  });

  const themes = cat.themes.map((item) => {
    const key = item.id.split(':')[1];
    const owned = item.price === 0 || eco.owned.includes(item.id);
    const control = !owned
      ? priceButton(item.price, buy(item.id), inDebt)
      : createButton(eco.theme === item.id ? 'Puesto' : 'Usar', {
          variant: 'secondary',
          size: 'sm',
          disabled: eco.theme === item.id,
          onClick: () => {
            send({ t: 'equip', item: item.id });
            close();
          },
        });
    return row(el('span', { class: 'shop__swatch', style: { background: THEME_SWATCH[key] || '#186f50' } }), item.name, 'El color de tus mesas', control);
  });

  const vipOwned = eco.owned.includes(cat.vip.id);
  const vip = row(
    el('span', { class: 'shop__glyph' }, cat.vipEmotes[0]),
    cat.vip.name,
    cat.vipEmotes.join(' '),
    vipOwned ? el('span', { class: 'shop__owned' }, 'Tuyo') : priceButton(cat.vip.price, buy(cat.vip.id), inDebt)
  );

  const rain = row(
    el('span', { class: 'shop__glyph' }, '💸'),
    'Lluvia de fichas',
    `Hacé llover: ${formatChips(cat.rain.each)} fichas para cada compañero`,
    priceButton(cat.rain.cost, () => {
      send({ t: 'rain' });
      close();
    })
  );
  const tips = row(
    el('span', { class: 'shop__glyph' }, '🎩'),
    'Propina para Don Fortunato',
    'No cambia tu suerte. Pero se pone contento.',
    el(
      'div',
      { class: 'shop__group' },
      ...cat.tips.map((amount) =>
        priceButton(amount, () => {
          send({ t: 'tip', amount });
          close();
        })
      )
    )
  );
  const throws = row(
    el('span', { class: 'shop__glyph' }, '🎯'),
    'Tirarle algo a Don Fortunato',
    'Para tirarle a un compañero, tocá su avatar.',
    el(
      'div',
      { class: 'shop__group' },
      ...cat.throwables.map((item) =>
        el(
          'button',
          {
            class: 'throw-btn',
            type: 'button',
            title: item.name,
            disabled: my.balance < item.price,
            onClick: () => {
              send({ t: 'throw', to: 'dealer', item: item.id });
              close();
            },
          },
          el('span', null, THROW_GLYPH[item.id] || '❓'),
          el('small', null, formatChips(item.price))
        )
      )
    )
  );

  modal = ui.openModal({
    title: 'Tienda del club',
    size: 'lg',
    content: el(
      'div',
      { class: 'shop' },
      el(
        'p',
        { class: 'shop__balance' },
        'Tus fichas: ',
        el('strong', null, formatChips(my.balance)),
        inDebt ? el('span', { class: 'is-down' }, ' · con deuda no se compran títulos, paños ni accesorios') : null
      ),
      section(
        'Vestuario',
        'Sombreros, lentes, mascotas y auras para tu avatar.',
        row(
          el('span', { class: 'shop__glyph' }, '🧢'),
          'Ropa y accesorios',
          'Probátelos antes de comprar',
          createButton('Abrir vestuario', {
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
              close();
              openWardrobe();
            },
          })
        )
      ),
      section('Para lucirse', null, rain, tips, throws),
      section('Títulos', null, ...titles),
      section('Paños', null, ...themes),
      section('Emotes', null, vip)
    ),
    actions: [{ label: 'Cerrar', variant: 'ghost' }],
  });
}

function openBank() {
  const my = me();
  const cat = S.catalog;
  const limit = S.room.economy.loanLimit;
  const room = Math.max(0, Math.floor((limit - my.debt) / (1 + cat.loanInterest)));
  const input = el('input', { class: 'input', type: 'number', min: cat.loanMin, step: 50, value: Math.min(500, Math.max(cat.loanMin, room)) });
  ui.openModal({
    title: 'El prestamista',
    size: 'sm',
    content: el(
      'div',
      { class: 'bank' },
      el(
        'p',
        null,
        `"Yo le presto, cómo no. Me devuelve un ${Math.round(cat.loanInterest * 100)}% más, y hasta que pague me quedo con el ${Math.round(cat.garnish * 100)}% de lo que gane."`
      ),
      el('p', { class: 'bank__row' }, 'Deuda actual', el('strong', { class: my.debt > 0 ? 'is-down' : '' }, formatChips(my.debt))),
      el('p', { class: 'bank__row' }, 'Límite de deuda (sube con tu nivel)', el('strong', null, formatChips(limit))),
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

// ───────────────────────────── rescue minigame ─────────────────────────────

const SUITS = ['♠', '♥', '♦', '♣'];
function rescueGame(m) {
  const show = el('div', { class: 'rescue__show' }, '¿Listo?');
  const dots = el('div', { class: 'rescue__dots' });
  const pad = el('div', { class: 'rescue__pad' });
  const answer = [];
  let modal = null;
  const timers = [];
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
      pad.querySelectorAll('button').forEach((b) => {
        b.disabled = false;
      });
    }, 900 + m.sequence.length * m.showMs)
  );
}

// ───────────────────────────── effects ─────────────────────────────

function showEmote(m) {
  audio.play('notify');
  parade.emote(m.from, m.emote);
  const node = el(
    'div',
    { class: 'emote-pop', style: { left: `${12 + Math.random() * 60}%` } },
    el('span', { class: 'emote-pop__face' }, m.emote),
    el('span', { class: 'emote-pop__name', style: { background: ui.avatarColor(m.avatar) } }, m.name)
  );
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
  if (Math.random() < 0.2) mascot.say('emote');
}

function showThrow(m) {
  const toDealer = m.to === 'dealer';
  audio.play('notify');
  parade.throwAt(m.from, m.to, m.item, {
    target: toDealer ? mascot : undefined,
    onImpact: () => {
      audio.play(m.item === 'rose' ? 'win' : 'lose');
      if (toDealer) mascot.hit(m.item);
    },
  });
  if (S.room && m.to === S.room.you) toast(`${m.name} te tiró: ${THROW_GLYPH[m.item] || ''}`, { kind: m.item === 'rose' ? 'win' : 'info' });
}

function showRain(m) {
  audio.play('chips');
  mascot.say('rain');
  toast(S.room && m.from === S.room.you ? '¡Hiciste llover fichas sobre el equipo!' : `¡${m.name} hizo llover fichas! +${formatChips(m.each)} para vos.`, {
    kind: 'win',
    duration: 5000,
  });
  if (S.room) for (const p of S.room.players) if (p.id !== m.from) parade.cheer(p.id);
  if (ui.prefersReducedMotion()) return;
  const layer = el('div', { class: 'rain' });
  const values = [5, 25, 100, 500, 1000];
  for (let i = 0; i < 44; i += 1) {
    const chip = ui.createChip(values[i % values.length], { size: 'sm', decorative: true });
    chip.classList.add('rain__chip');
    chip.style.left = `${Math.random() * 100}%`;
    chip.style.animationDelay = `${Math.random() * 1.4}s`;
    chip.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    layer.append(chip);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4600);
}

document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
renderWelcome();
syncParade();
connect();
