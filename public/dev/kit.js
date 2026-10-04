/**
 * Club Fortuna — component gallery (served at /dev/kit.html).
 * Shows every UI-kit component and state for visual QA. Dev-only page.
 */

import * as ui from '../js/ui.js';
import * as audio from '../js/audio.js';

const { el } = ui;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_NAMES = { S: 'Picas', H: 'Corazones', D: 'Diamantes', C: 'Tréboles' };
const PLAYER_NAMES = ['Agus', 'Flor Díaz', 'Tincho', 'Caro', 'Juan Pablo', 'Mica', 'El Tano', 'Sofi', 'Nico R', 'Lula', 'Beto', 'Vicky'];

/* ---- layout helpers ------------------------------------------------------- */

function section(id, eyebrow, title, ...content) {
  const panel = ui.createPanel({ eyebrow, title, ornate: true, class: 'kit-section' });
  panel.id = id;
  for (const node of content) panel.body.appendChild(node);
  return panel;
}

function demo(label, ...nodes) {
  return el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, label),
    el('div', { class: 'kit-demo__row' }, ...nodes));
}

function demoAligned(label, align, ...nodes) {
  const node = demo(label, ...nodes);
  node.lastChild.classList.add(`kit-demo__row--${align}`);
  return node;
}

function randomCard() {
  return { rank: RANKS[Math.floor(Math.random() * RANKS.length)], suit: SUITS[Math.floor(Math.random() * SUITS.length)] };
}

function swatch(name) {
  return el('div', { class: 'kit-swatch' },
    el('div', { class: 'kit-swatch__color', style: { background: `var(${name})` } }),
    el('div', { class: 'kit-swatch__name' }, name));
}

function swatches(label, names) {
  return el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, label),
    el('div', { class: 'kit-swatches' }, names.map(swatch)));
}

/* ---- hero ----------------------------------------------------------------- */

function hero(sections) {
  const soundLabel = () => (audio.isMuted() ? 'Silenciado' : 'Sonido activado');
  const soundIcon = () => (audio.isMuted() ? 'mute' : 'volume');
  const mute = ui.createButton(soundLabel(), {
    variant: 'ghost', size: 'sm', icon: soundIcon(), sound: false,
    onClick: () => {
      audio.setMuted(!audio.isMuted());
      mute.setIcon(soundIcon()).setLabel(soundLabel());
      audio.play('click');
    },
  });

  const nav = el('nav', { class: 'kit-nav', attrs: { 'aria-label': 'Secciones' } },
    sections.map(([id, label]) => ui.createButton(label, {
      variant: 'secondary', size: 'sm',
      onClick: () => {
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: ui.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      },
    })));

  return el('header', { class: 'kit-hero' },
    el('div', { class: 'sunburst kit-hero__burst' }),
    ui.ornament('emblem'),
    el('div', { class: 'eyebrow' }, 'Sistema de diseño · Kit de componentes'),
    el('h1', { class: 'wordmark kit-hero__title' }, el('span', { class: 'text-brass' }, 'Club Fortuna')),
    el('p', { class: 'kit-hero__lead' }, 'Todas las piezas del club en un solo lugar: cartas, fichas, paño, botones, avisos y sonidos. Tocá cada cosa para probar sus estados.'),
    ui.ornament('rule'),
    nav,
    mute);
}

/* ---- 1. palette & type ---------------------------------------------------- */

function paletteSection() {
  const ramp = (prefix, steps) => steps.map((step) => `--${prefix}-${step}`);
  const type = el('div', { class: 'kit-type' },
    el('div', { class: 'eyebrow' }, 'Eyebrow · etiqueta en versalitas'),
    el('h1', null, 'La noche es joven'),
    el('h2', null, 'Elegí tu mesa'),
    el('h3', null, 'Apostá con el equipo'),
    el('h4', null, 'Repartí las ganancias'),
    el('p', null, 'Texto principal en la grotesca de interfaz. ', el('span', { class: 'u-soft' }, 'Texto secundario. '), el('span', { class: 'u-muted' }, 'Texto terciario. '), el('a', { href: '#cartas' }, 'Un enlace')),
    el('div', { class: 'u-row u-wrap u-gap-5' },
      el('span', { class: 'numeral kit-big-number' }, '1.234.567'),
      el('span', { class: 'numeral kit-big-number text-brass' }, '+12.500'),
      el('span', { class: 'room-code kit-big-number' }, 'KQJX')),
    el('p', { class: 'fineprint' }, 'Fichas ficticias · Sin dinero real · Solo por diversión'));

  return section('paleta', 'Fundamentos', 'Paleta y tipografía',
    swatches('Tinta y berenjena', ramp('ink', [950, 900, 850, 800, 750, 700, 600, 500, 400, 300])),
    swatches('Paño esmeralda', ramp('felt', [950, 900, 800, 700, 600, 500, 400, 300])),
    swatches('Bronce y oro', ramp('gold', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900])),
    swatches('Marfil', ramp('ivory', [50, 100, 200, 300, 400])),
    swatches('Sangre de toro', ramp('oxblood', [200, 300, 400, 500, 600, 700, 800])),
    swatches('Semánticos y texto', ['--win', '--danger', '--info', '--text-1', '--text-2', '--text-3', '--text-4']),
    ui.createDivider(),
    el('div', { class: 'kit-demo' }, el('div', { class: 'kit-demo__label' }, 'Tipografía'), type));
}

/* ---- 2. buttons ----------------------------------------------------------- */

function buttonsSection() {
  const variants = [['primary', 'Apostar'], ['secondary', 'Repetir apuesta'], ['ghost', 'Cancelar'], ['danger', 'Salir de la mesa']];
  return section('botones', 'Acciones', 'Botones',
    demo('Variantes', ...variants.map(([variant, label]) => ui.createButton(label, { variant }))),
    demo('Con ícono',
      ui.createButton('Crear sala', { variant: 'primary', icon: 'plus' }),
      ui.createButton('Copiar enlace', { variant: 'secondary', icon: 'link' }),
      ui.createButton('Deshacer', { variant: 'ghost', icon: 'undo' }),
      ui.createButton('Borrar apuestas', { variant: 'danger', icon: 'trash' })),
    demo('Tamaños',
      ui.createButton('Chico', { variant: 'primary', size: 'sm' }),
      ui.createButton('Mediano', { variant: 'primary', size: 'md' }),
      ui.createButton('Grande', { variant: 'primary', size: 'lg' }),
      ui.createButton('Chico', { variant: 'secondary', size: 'sm' }),
      ui.createButton('Mediano', { variant: 'secondary', size: 'md' }),
      ui.createButton('Grande', { variant: 'secondary', size: 'lg' })),
    demo('Deshabilitados', ...variants.map(([variant, label]) => ui.createButton(label, { variant, disabled: true }))),
    demo('Solo ícono (con tooltip)',
      ui.createButton(null, { variant: 'primary', icon: 'check', title: 'Confirmar' }),
      ui.createButton(null, { variant: 'secondary', icon: 'repeat', title: 'Repetir apuesta' }),
      ui.createButton(null, { variant: 'ghost', icon: 'chat', title: 'Abrir el chat' }),
      ui.createButton(null, { variant: 'ghost', icon: 'gift', title: 'Regalar fichas' }),
      ui.createButton(null, { variant: 'ghost', size: 'sm', icon: 'close', title: 'Cerrar' }),
      ui.createButton(null, { variant: 'danger', icon: 'door', title: 'Salir de la sala' })),
    demo('Ancho completo', el('div', { style: { width: 'min(100%, 22rem)' } },
      ui.createButton('Unite a la sala', { variant: 'primary', size: 'lg', block: true, icon: 'forward' }))));
}

/* ---- 3. forms, labels, surfaces ------------------------------------------ */

function formsSection() {
  const nameField = ui.createField('Tu nombre', ui.createInput({ placeholder: 'Cómo te decimos', maxLength: 16, value: 'Agus' }), { hint: 'Hasta 16 caracteres.' });
  const codeField = ui.createField('Código de sala', ui.createInput({ code: true, placeholder: 'ABCD', maxLength: 4 }));
  const errorField = ui.createField('Monto a regalar', ui.createInput({ value: '99999', inputMode: 'numeric' }));
  errorField.setHint('No te alcanza el saldo.', true);
  errorField.querySelector('input').setAttribute('aria-invalid', 'true');
  const chat = el('textarea', { class: 'input', placeholder: 'Escribí un mensaje…', rows: 2 });

  const segmentedValue = el('span', { class: 'u-muted' }, 'Elegiste: actividad');
  const segmented = ui.createSegmented({
    ariaLabel: 'Panel lateral',
    value: 'feed',
    options: [
      { value: 'feed', label: 'Actividad', icon: 'sparkle' },
      { value: 'chat', label: 'Chat', icon: 'chat' },
      { value: 'team', label: 'Equipo', icon: 'users' },
    ],
    onChange: (value) => {
      segmentedValue.textContent = `Elegiste: ${{ feed: 'actividad', chat: 'chat', team: 'equipo' }[value]}`;
    },
  });

  const meter = ui.createMeter({ value: 0.42, label: 'Meta del equipo' });
  const meterLg = ui.createMeter({ value: 0.78, size: 'lg', label: 'Meta del equipo' });

  const pill = el('span', { class: 'pill pill--gold' }, ui.icon('users'), '4 / 8 jugadores');
  const pillCode = el('span', { class: 'pill' }, 'Sala', el('span', { class: 'room-code' }, 'KQJX'));

  return section('formularios', 'Interfaz', 'Campos, etiquetas y superficies',
    el('div', { class: 'kit-grid kit-demo' }, nameField, codeField, errorField, ui.createField('Chat', chat)),
    demo('Control segmentado', segmented, segmentedValue),
    demo('Insignias',
      ui.createBadge('Tu turno', { variant: 'gold', icon: 'clock' }),
      ui.createBadge('Ganó', { variant: 'win' }),
      ui.createBadge('Perdió', { variant: 'danger' }),
      ui.createBadge('Empate', { variant: 'info' }),
      ui.createBadge('Desconectado', { variant: 'muted', icon: 'offline' }),
      ui.createBadge('Nivel 3', { variant: 'solid', icon: 'crown' }),
      ui.createBadge('Neutro')),
    demo('Cápsulas y montos',
      pill, pillCode,
      el('span', { class: 'pill' }, ui.createChipAmount(12500)),
      ui.createChipAmount(750, { signed: true, tone: 'win' }),
      ui.createChipAmount(-200, { tone: 'loss' }),
      ui.createChipAmount(1250000, { compact: true })),
    el('div', { class: 'kit-demo' }, el('div', { class: 'kit-demo__label' }, 'Medidor de la meta'), meter, meterLg),
    demo('Cargando', ui.createSpinner(), el('span', { class: 'u-muted' }, 'Conectando con el club…')),
    el('div', { class: 'kit-demo' }, el('div', { class: 'kit-demo__label' }, 'Divisores'),
      ui.createDivider(), ui.createDivider({ label: 'o unite con un código' })),
    el('div', { class: 'kit-demo' }, el('div', { class: 'kit-demo__label' }, 'Paneles'),
      el('div', { class: 'kit-grid' },
        ui.createPanel({ eyebrow: 'Panel', title: 'Simple', content: el('p', { class: 'u-soft' }, 'Superficie básica con filete de bronce.') }),
        ui.createPanel({ eyebrow: 'Panel', title: 'Elevado', raised: true, content: el('p', { class: 'u-soft' }, 'Para menús y tarjetas destacadas.') }),
        ui.createPanel({ eyebrow: 'Panel', title: 'Ornamentado', ornate: true, content: el('p', { class: 'u-soft' }, 'Esquinas art déco escalonadas.') }))),
    demo('Ornamentos', ui.ornament('fan'), ui.ornament('sunburst'), ui.ornament('rule'), ui.ornament('emblem')));
}

/* ---- 4. cards ------------------------------------------------------------- */

function cardsSection() {
  const felt = el('div', { class: 'felt kit-felt' });

  for (const suit of SUITS) {
    felt.appendChild(el('div', { class: 'kit-demo' },
      el('div', { class: 'kit-demo__label' }, SUIT_NAMES[suit]),
      el('div', { class: 'kit-cards' }, RANKS.map((rank) => ui.createCard({ rank, suit })))));
  }

  // sizes and back
  felt.appendChild(demoAligned('Tamaños · sm, md, lg · dorso', 'end',
    ui.createCard({ rank: 'A', suit: 'S' }, { size: 'sm' }),
    ui.createCard({ rank: '10', suit: 'H' }, { size: 'sm' }),
    ui.createCard({ rank: 'K', suit: 'D' }, { size: 'sm' }),
    ui.createCard(null, { size: 'sm' }),
    ui.createCard({ rank: 'A', suit: 'S' }, { size: 'md' }),
    ui.createCard({ rank: '10', suit: 'H' }, { size: 'md' }),
    ui.createCard({ rank: 'Q', suit: 'C' }, { size: 'md' }),
    ui.createCard(null, { size: 'md' }),
    ui.createCard({ rank: 'A', suit: 'H' }, { size: 'lg' }),
    ui.createCard({ rank: '9', suit: 'D' }, { size: 'lg' }),
    ui.createCard({ rank: 'K', suit: 'S' }, { size: 'lg' }),
    ui.createCard({ rank: 'Q', suit: 'H' }, { size: 'lg' }),
    ui.createCard({ rank: 'J', suit: 'C' }, { size: 'lg' }),
    ui.createCard(null, { size: 'lg' })));

  // states
  const selected = ui.createCard({ rank: 'J', suit: 'H' }, { interactive: true });
  selected.classList.add('is-selected');
  const winner = ui.createCard({ rank: 'A', suit: 'D' });
  winner.classList.add('is-winner');
  const dimmed = ui.createCard({ rank: '7', suit: 'C' });
  dimmed.classList.add('is-dimmed');
  const hover = ui.createCard({ rank: '5', suit: 'S' }, { interactive: true });
  hover.addEventListener('click', () => hover.classList.toggle('is-selected'));
  felt.appendChild(demo('Estados · seleccionada, ganadora, atenuada, interactiva (tocala)', selected, winner, dimmed, hover,
    ui.createCard({ rank: '8', suit: 'D' }, { simple: true }), ui.createCard({ rank: 'Q', suit: 'S' }, { simple: true })));

  // hands
  const handOf = (variant, cards) => {
    const hand = ui.createHand({ variant });
    for (const card of cards) hand.appendChild(ui.createCard(card));
    return hand;
  };
  const sample = [{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }, { rank: '7', suit: 'D' }, { rank: '10', suit: 'C' }, { rank: '3', suit: 'H' }];
  felt.appendChild(demoAligned('Manos · .hand, .hand--tight, .hand--pile, .hand--spread', 'end',
    handOf(null, sample.slice(0, 3)), handOf('tight', sample), handOf('pile', sample.slice(0, 4)), handOf('spread', sample.slice(0, 3))));
  felt.appendChild(demoAligned('Abanico · .hand--fan (3, 5 y 7 cartas)', 'end',
    handOf('fan', sample.slice(0, 3)), handOf('fan', sample),
    handOf('fan', [...sample, { rank: 'Q', suit: 'S' }, { rank: '9', suit: 'C' }])));

  // deal & flip
  const table = ui.createHand({ variant: 'spread' });
  let dealt = [];
  const deal = () => {
    ui.clear(table);
    dealt = [];
    for (let i = 0; i < 5; i++) {
      const faceDown = i === 4;
      const card = ui.createCard(faceDown ? null : randomCard());
      card.dealIn(i * 130);
      setTimeout(() => audio.play('card'), i * 130);
      table.appendChild(card);
      dealt.push(card);
    }
  };
  const flipAll = () => {
    audio.play('flip');
    dealt.forEach((card, i) => setTimeout(() => {
      if (!card.card) card.setCard(randomCard());
      else card.flip();
    }, i * 70));
  };
  deal();
  felt.appendChild(el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, 'Repartir y dar vuelta · la última sale tapada (card = null) y se revela con setCard()'),
    table,
    el('div', { class: 'kit-demo__row' },
      ui.createButton('Repartí', { variant: 'primary', icon: 'cards', sound: false, onClick: deal }),
      ui.createButton('Dar vuelta', { variant: 'secondary', icon: 'repeat', sound: false, onClick: flipAll }))));

  return section('cartas', 'Mesa', 'Cartas sobre el paño', felt);
}

/* ---- 5. chips ------------------------------------------------------------- */

function chipsSection() {
  const felt = el('div', { class: 'felt kit-felt' });

  for (const size of ['lg', 'md', 'sm']) {
    felt.appendChild(demo(`Denominaciones · ${size}`, ...ui.CHIP_VALUES.map((value) => ui.createChip(value, { size }))));
  }
  felt.appendChild(demo('Teñidas con los 12 colores de jugador',
    ...ui.AVATAR_COLORS.map((color, i) => ui.createChip([5, 25, 100, 500][i % 4], { color }))));
  felt.appendChild(demo('Teñidas · sm, sin número',
    ...ui.AVATAR_COLORS.map((color, i) => ui.createChip(1, { color: i, size: 'sm', label: false }))));

  felt.appendChild(demoAligned('Pilas · createChipStack', 'end',
    ...[5, 37, 130, 475, 1250, 2375, 8000, 23600].map((amount) => ui.createChipStack(amount))));
  felt.appendChild(demoAligned('Pilas · tamaños y tinte de jugador', 'end',
    ui.createChipStack(650, { size: 'sm' }),
    ui.createChipStack(650, { size: 'md' }),
    ui.createChipStack(650, { size: 'lg' }),
    ui.createChipStack(300, { color: ui.avatarColor(0), size: 'sm' }),
    ui.createChipStack(300, { color: ui.avatarColor(4), size: 'sm' }),
    ui.createChipStack(425, { color: ui.avatarColor(7) }),
    ui.createChipStack(425, { color: ui.avatarColor(2) }),
    ui.createChipStack(2000, { max: 8, label: 'Pozo' })));

  // tray with a live balance
  let balance = 640;
  const balanceText = ui.createChipAmount(balance);
  const chosen = el('span', { class: 'u-soft' });
  const tray = ui.createChipTray({
    values: [5, 25, 100, 500, 1000, 5000],
    value: 25,
    getBalance: () => balance,
    onChange: (value) => {
      chosen.textContent = `Ficha elegida: ${ui.formatChips(value)}`;
    },
  });
  chosen.textContent = `Ficha elegida: ${ui.formatChips(tray.value)}`;
  const range = el('input', {
    class: 'kit-range', type: 'range', min: '0', max: '6000', step: '5', value: String(balance),
    attrs: { 'aria-label': 'Saldo de prueba' },
    onInput: () => {
      balance = Number(range.value);
      balanceText.setAmount(balance, { animate: false });
      tray.refresh();
    },
  });
  felt.appendChild(el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, 'Bandeja · movés el saldo y se atenúan las que no alcanzan (flechas del teclado para elegir)'),
    el('div', { class: 'kit-demo__row' }, tray),
    el('div', { class: 'kit-demo__row' }, el('span', { class: 'u-soft' }, 'Saldo'), balanceText, range, chosen),
    el('div', { class: 'kit-demo__row' }, ui.createChipTray({ values: [1, 5, 25, 100], value: 5, size: 'sm' }), ui.createChipTray({ values: [25, 100, 500], value: 100, size: 'lg' }))));

  // flying chips between bet spots
  const spotA = el('div', { class: 'bet-spot kit-spot' }, el('span', { class: 'felt-print' }, 'Apuesta'));
  const spotB = el('div', { class: 'bet-spot kit-spot is-active' }, el('span', { class: 'felt-print' }, 'Activa'));
  const stackA = ui.createChipStack(0, { size: 'sm' });
  const stackB = ui.createChipStack(0, { size: 'sm', color: ui.avatarColor(5) });
  spotA.appendChild(stackA);
  spotB.appendChild(stackB);
  let betA = 0;
  let betB = 0;
  const betButton = ui.createButton('Apostá 125', {
    variant: 'primary', sound: false,
    onClick: () => {
      audio.play('chips');
      ui.flyChip(betButton, spotA, { value: 100, count: 3 }).then(() => {
        betA += 125;
        stackA.setAmount(betA, { animate: true });
      });
      ui.flyChip(betButton, spotB, { value: 25, count: 3, color: ui.avatarColor(5) }).then(() => {
        betB += 125;
        stackB.setAmount(betB, { animate: true });
      });
    },
  });
  const collectButton = ui.createButton('Cobrar', {
    variant: 'secondary', sound: false,
    onClick: () => {
      if (!betA && !betB) return;
      audio.play('chips');
      ui.flyChip(spotA, collectButton, { value: 100, count: 4 });
      ui.flyChip(spotB, collectButton, { value: 25, count: 4, color: ui.avatarColor(5) });
      betA = 0;
      betB = 0;
      stackA.setAmount(0);
      stackB.setAmount(0);
    },
  });
  felt.appendChild(el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, 'Casilleros (.bet-spot) y fichas en vuelo (flyChip)'),
    el('div', { class: 'kit-spots' }, spotA, spotB),
    el('div', { class: 'kit-demo__row' }, betButton, collectButton)));

  return section('fichas', 'Mesa', 'Fichas', felt);
}

/* ---- 6. time & players ---------------------------------------------------- */

function playersSection() {
  const countdowns = [ui.createCountdown({ size: 'sm' }), ui.createCountdown({ tick: true }), ui.createCountdown({ size: 'lg' })];
  const startAll = (ms) => {
    const endsAt = Date.now() + ms;
    for (const countdown of countdowns) countdown.start(endsAt, ms, Date.now);
  };
  startAll(12000);

  const players = PLAYER_NAMES.map((name, avatar) => ({ id: `p${avatar}`, name, avatar, balance: 1000 + avatar * 375, connected: true }));
  const active = ui.createNameplate(players[4], { showBalance: true, active: true });
  const me = ui.createNameplate(players[0], { showBalance: true, me: true });
  const offline = ui.createNameplate({ ...players[7], connected: false }, { meta: 'Desconectada' });
  const withNode = ui.createNameplate(players[2], { meta: ui.createChipAmount(2400) });
  const longName = ui.createNameplate({ name: 'Maximiliano Fernández', avatar: 9 }, { meta: 'Apostó 250' });

  return section('jugadores', 'Mesa', 'Tiempo y jugadores',
    demo('Cuenta regresiva · se pone bordó en los últimos 5 s (la mediana hace tic)',
      ...countdowns,
      ui.createButton('12 s', { variant: 'secondary', size: 'sm', onClick: () => startAll(12000) }),
      ui.createButton('7 s', { variant: 'secondary', size: 'sm', onClick: () => startAll(7000) }),
      ui.createButton('Detener', { variant: 'ghost', size: 'sm', onClick: () => countdowns.forEach((c) => c.stop()) })),
    demo('Avatares · 12 esmaltes', ...players.map((player) => ui.createAvatar(player))),
    demoAligned('Tamaños · xs, sm, md, lg, xl · turno · desconectado', 'end',
      ...['xs', 'sm', 'md', 'lg', 'xl'].map((size, i) => ui.createAvatar(players[i + 3], { size })),
      ui.createAvatar(players[1], { size: 'lg', active: true }),
      ui.createAvatar({ ...players[6], connected: false }, { size: 'lg' })),
    el('div', { class: 'felt felt--flat kit-felt' },
      demo('Placas de jugador sobre el paño', me, active, withNode, offline, longName)));
}

/* ---- 7. feedback ---------------------------------------------------------- */

function feedbackSection() {
  // toasts
  const toasts = demo('Toasts',
    ui.createButton('Info', { variant: 'secondary', icon: 'info', onClick: () => ui.toast('Flor se unió a la sala.') }),
    ui.createButton('Premio', { variant: 'secondary', icon: 'trophy', onClick: () => ui.toast('¡Ganaste 1.250 fichas en la ruleta!', { kind: 'win' }) }),
    ui.createButton('Error', { variant: 'secondary', icon: 'warning', onClick: () => ui.toast('No te alcanza el saldo para esa apuesta.', { kind: 'error' }) }),
    ui.createButton('Texto largo', { variant: 'ghost', onClick: () => ui.toast('El equipo llegó a Apostadores: cada jugador recibe un bono de 500 fichas para seguir jugando.', { kind: 'win', duration: 6000 }) }));

  // modals
  const confirmModal = () => ui.openModal({
    title: '¿Salir de la mesa?',
    content: 'Tus apuestas en juego se resuelven igual y las fichas vuelven a tu saldo.',
    actions: [
      { label: 'Quedarme', variant: 'ghost' },
      { label: 'Salir', variant: 'danger', onClick: () => { ui.toast('Te levantaste de la mesa.'); } },
    ],
  });
  const giftModal = () => {
    const input = ui.createInput({ inputMode: 'numeric', placeholder: '100', ariaLabel: 'Monto' });
    const field = ui.createField('Monto', input, { hint: 'Tenés 640 fichas.' });
    const body = el('div', { class: 'u-stack u-gap-4' },
      el('div', { class: 'u-row' }, ui.createAvatar({ name: 'Flor Díaz', avatar: 1 }), el('span', null, 'Le mandás fichas a ', el('strong', null, 'Flor Díaz'), '.')),
      field);
    ui.openModal({
      title: 'Regalar fichas',
      content: body,
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: 'Enviar', variant: 'primary', icon: 'gift',
          onClick: () => {
            const amount = Number(input.value);
            if (!Number.isInteger(amount) || amount < 1 || amount > 640) {
              field.setHint('Poné un monto entero entre 1 y 640.', true);
              input.setAttribute('aria-invalid', 'true');
              input.focus();
              return false;
            }
            ui.toast(`Le regalaste ${ui.formatChips(amount)} fichas a Flor.`, { kind: 'win' });
            audio.play('notify');
            return true;
          },
        },
      ],
    });
  };
  const lockedModal = () => ui.openModal({
    title: 'Reconectando…',
    dismissible: false,
    size: 'sm',
    content: el('div', { class: 'u-row u-gap-3' }, ui.createSpinner(), el('span', null, 'Este diálogo no se cierra con Escape.')),
    actions: [{ label: 'Entendido', variant: 'primary' }],
  });
  const modals = demo('Modales · foco atrapado, Escape y clic afuera cierran',
    ui.createButton('Confirmación', { variant: 'secondary', onClick: confirmModal }),
    ui.createButton('Con formulario', { variant: 'secondary', icon: 'gift', onClick: giftModal }),
    ui.createButton('No descartable', { variant: 'ghost', onClick: lockedModal }));

  // banners on a felt stage
  const stage = el('div', { class: 'felt kit-stage' },
    el('div', { class: 'felt-print' }, 'Blackjack paga 3 a 2'),
    ui.createHand());
  stage.lastChild.append(ui.createCard({ rank: 'A', suit: 'S' }), ui.createCard({ rank: 'K', suit: 'H' }));
  const banner = (opts, sound) => () => {
    ui.showBanner(stage, opts);
    if (sound) audio.play(sound);
  };
  const banners = el('div', { class: 'kit-demo' },
    el('div', { class: 'kit-demo__label' }, 'Cartel de mesa · showBanner'),
    stage,
    el('div', { class: 'kit-demo__row' },
      ui.createButton('Ganaste', { variant: 'secondary', sound: false, onClick: banner({ title: '¡Blackjack!', subtitle: 'Cobrás 375 fichas', kind: 'win' }, 'win') }),
      ui.createButton('Perdiste', { variant: 'secondary', sound: false, onClick: banner({ title: 'Te pasaste', subtitle: 'La casa se lleva 250', kind: 'lose' }, 'lose') }),
      ui.createButton('Empate', { variant: 'secondary', onClick: banner({ title: 'Empate', subtitle: 'Recuperás tu apuesta', kind: 'push' }) }),
      ui.createButton('Info', { variant: 'secondary', onClick: banner({ title: 'Hagan sus apuestas', kind: 'info' }) })));

  // celebrate
  const party = demo('Festejos · celebrate (no corre con "reducir movimiento")',
    ui.createButton('Premio', { variant: 'secondary', icon: 'sparkle', sound: false, onClick: (ev) => { ui.celebrate({ kind: 'win', from: ev.currentTarget }); audio.play('win'); } }),
    ui.createButton('Gran premio', { variant: 'secondary', icon: 'trophy', sound: false, onClick: () => { ui.celebrate({ kind: 'bigwin', amount: 12500 }); audio.play('bigwin'); } }),
    ui.createButton('Jackpot', { variant: 'primary', icon: 'crown', sound: false, onClick: () => { ui.celebrate({ kind: 'jackpot', amount: 250000 }); audio.play('jackpot'); } }));

  // rolling numbers
  let total = 1000;
  const figure = el('span', { class: 'numeral kit-big-number text-brass' });
  ui.animateNumber(figure, total);
  const inline = ui.createChipAmount(total);
  const bump = (delta) => () => {
    total = Math.max(0, total + delta);
    ui.animateNumber(figure, total);
    inline.setAmount(total, { flash: true });
  };
  const numbers = demo('Números que ruedan · animateNumber',
    figure, el('span', { class: 'pill' }, inline),
    ui.createButton('+250', { variant: 'secondary', size: 'sm', sound: 'chip', onClick: bump(250) }),
    ui.createButton('+12.500', { variant: 'secondary', size: 'sm', sound: 'chips', onClick: bump(12500) }),
    ui.createButton('−400', { variant: 'ghost', size: 'sm', onClick: bump(-400) }));

  return section('avisos', 'Respuesta', 'Avisos, modales y festejos', toasts, modals, banners, party, numbers);
}

/* ---- 8. icons ------------------------------------------------------------- */

function iconsSection() {
  const grid = el('div', { class: 'kit-icons' },
    ui.ICON_NAMES.map((name) => el('div', { class: 'kit-icon' }, ui.icon(name), el('span', { class: 'kit-icon__name' }, name))));
  const suits = demo('Palos en línea · createSuit',
    ...SUITS.map((suit) => el('span', { class: 'kit-big-number' }, ui.createSuit(suit))),
    el('span', { class: 'u-soft' }, 'Escalera de ', ui.createSuit('H'), ' al rey'));
  return section('iconos', 'Iconografía', 'Íconos', grid, ui.createDivider(), suits);
}

/* ---- 9. sound ------------------------------------------------------------- */

function soundSection() {
  const labels = {
    chip: 'Ficha', chips: 'Fichas', card: 'Carta', flip: 'Dar vuelta', tick: 'Tic', spin: 'Giro',
    win: 'Premio', bigwin: 'Gran premio', lose: 'Derrota', click: 'Clic', notify: 'Aviso', jackpot: 'Jackpot',
  };
  const buttons = audio.SOUND_NAMES.map((name) => ui.createButton(labels[name] || name, {
    variant: 'secondary', icon: 'play', sound: false,
    onClick: () => {
      audio.unlock();
      audio.play(name);
    },
  }));
  const volume = el('input', {
    class: 'kit-range', type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(audio.getVolume() * 100)),
    attrs: { 'aria-label': 'Volumen' },
    onInput: () => audio.setVolume(Number(volume.value) / 100),
    onChange: () => audio.play('chip'),
  });
  return section('sonidos', 'Audio', 'Sonidos sintetizados',
    demo('Efectos · audio.play(nombre)', ...buttons),
    demo('Volumen general', ui.icon('volume'), volume),
    el('p', { class: 'u-muted' }, 'El audio se desbloquea con el primer toque o tecla. Si está silenciado (botón de arriba), play() no hace nada.'));
}

/* ---- boot ----------------------------------------------------------------- */

function boot() {
  const root = document.getElementById('kit');
  if (!root) return;
  ui.clear(root);

  const builders = [
    ['paleta', 'Paleta', paletteSection],
    ['botones', 'Botones', buttonsSection],
    ['formularios', 'Campos', formsSection],
    ['cartas', 'Cartas', cardsSection],
    ['fichas', 'Fichas', chipsSection],
    ['jugadores', 'Jugadores', playersSection],
    ['avisos', 'Avisos', feedbackSection],
    ['iconos', 'Íconos', iconsSection],
    ['sonidos', 'Sonidos', soundSection],
  ];

  root.appendChild(hero(builders.map(([id, label]) => [id, label])));
  for (const [id, , build] of builders) {
    try {
      root.appendChild(build());
    } catch (err) {
      console.error(`[kit] section "${id}" failed`, err);
      root.appendChild(ui.createPanel({ title: `Error en la sección ${id}`, content: String(err && err.message ? err.message : err) }));
    }
  }

  root.appendChild(el('footer', { class: 'kit-footer' },
    ui.ornament('fan'),
    el('p', { class: 'fineprint' }, 'Fichas ficticias · Sin dinero real · Solo por diversión')));
}

boot();
