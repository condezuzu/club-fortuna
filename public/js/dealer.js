// The dealer: a character with a speech bubble who comments on the game (and mocks losers).
const LINES = {
  welcome: [
    'Bienvenido. La casa siempre gana, pero usted insista.',
    'Tome asiento. Las fichas no se pierden solas.',
    '¿Viene a ganar o a hacer donaciones?',
    'Adelante, adelante. Su plata está en buenas manos: las mías.',
  ],
  bet: ['Hagan sus apuestas, no sean tímidos.', '¿Eso es todo? Mi abuela apuesta más fuerte.', 'Apueste con el corazón, que la cabeza ya la perdió.'],
  lose: [
    'Gracias por su generosa contribución.',
    'Uy. Eso dolió hasta acá.',
    'No se preocupe, perder también es un talento.',
    'La casa le agradece. De corazón.',
    '¿Probó con jugar bien?',
    'Otra más y le pongo su nombre a una silla.',
    'Tranquilo, la plata va y viene. Sobre todo se va.',
    'Dicen que el que persevera triunfa. Dicen.',
  ],
  bust: ['¡Se pasó! El 21 quedó allá atrás.', 'Pidió una de más. Clásico.', 'La avaricia rompe el saco. Y la mano.'],
  win: [
    'Bien jugado. No se acostumbre.',
    'Suerte de principiante, seguro.',
    'Festeje bajito, que me descuentan del sueldo.',
    'Ganó. Anótelo, que no pasa seguido.',
  ],
  bigwin: ['¡Epa! ¿Me va a dejar sin trabajo?', 'Seguridad… vigilen a este jugador.', 'Con eso ya me puede dejar propina.'],
  push: ['Empate. Nadie gana, nadie llora.', 'Ni para usted ni para mí. Qué aburrido.'],
  debt: [
    'El prestamista preguntó por usted. Con nombre y apellido.',
    'Siga así y va a tener que lavar copas.',
    'Debe más de lo que vale la mesa.',
    'Yo que usted no saldría por la puerta de adelante.',
  ],
  near: ['¡Uy, casi! Casi no paga, igual.', 'Por un pelito. Qué lástima. De verdad.'],
  spin: ['Que gire, que gire…', 'No va más.', 'Crucen los dedos. O récenle a algo.'],
  fold: ['¿Se retira? Los valientes mueren una vez; usted, todas las manos.', 'Sabia decisión. Cobarde, pero sabia.'],
  jackpot: ['¡EL POZO! No lo puedo creer. Me voy a llorar al baño.'],
};

const FACE = `
<svg viewBox="0 0 120 130" aria-hidden="true">
  <defs>
    <linearGradient id="dl-vest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a1420"/><stop offset="1" stop-color="#2c0a11"/></linearGradient>
  </defs>
  <path d="M14 130c0-30 20-44 46-44s46 14 46 44z" fill="#15101a"/>
  <path d="M38 92l22 30 22-30-10-6H48z" fill="#f4eee0"/>
  <path d="M30 96c6-6 12-8 18-9l12 34-18 9H22z" fill="url(#dl-vest)"/>
  <path d="M90 96c-6-6-12-8-18-9L60 121l18 9h20z" fill="url(#dl-vest)"/>
  <path d="M48 93l12 6 12-6-4 10H52z" fill="#d4af37"/>
  <circle cx="60" cy="99" r="3" fill="#8a6d1b"/>
  <rect x="52" y="72" width="16" height="18" rx="6" fill="#e2b48c"/>
  <ellipse cx="60" cy="50" rx="27" ry="30" fill="#f0c7a0"/>
  <path d="M32 44c0-22 14-32 30-32s28 10 26 32c-6-12-16-18-28-18s-22 6-28 18z" fill="#1b1420"/>
  <path d="M40 46q7-5 14 0M66 46q7-5 14 0" stroke="#1b1420" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <ellipse class="dealer__eye" cx="47" cy="53" rx="3" ry="3.4" fill="#1b1420"/>
  <ellipse class="dealer__eye" cx="73" cy="53" rx="3" ry="3.4" fill="#1b1420"/>
  <path d="M44 66c4-3 9-3 16 0 7-3 12-3 16 0-5 3-11 3-16 1-5 2-11 2-16-1z" fill="#1b1420"/>
  <path class="dealer__mouth" d="M51 72q9 7 18 0" stroke="#7a2a2a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>`;

/**
 * createDealer(api) -> element with element.say(kind, text?) and element.destroy().
 * kind is a key of LINES; a debt line sometimes replaces a mocking one when the player owes money.
 */
export function createDealer(api) {
  const { el } = api.ui;
  const bubble = el('div', { class: 'dealer__bubble' });
  const face = el('div', { class: 'dealer__face' });
  face.innerHTML = FACE; // static, trusted markup authored above
  const root = el('div', { class: 'dealer' }, face, el('div', { class: 'dealer__side' }, el('span', { class: 'dealer__name' }, 'Don Fortunato'), bubble));
  let timer = null;
  let last = '';

  root.say = (kind, text) => {
    let pool = LINES[kind] || LINES.welcome;
    const me = api.me();
    if ((kind === 'lose' || kind === 'bust') && me && me.debt > 0 && Math.random() < 0.45) pool = LINES.debt;
    let line = text || pool[Math.floor(Math.random() * pool.length)];
    if (!text && line === last && pool.length > 1) line = pool[(pool.indexOf(line) + 1) % pool.length];
    last = line;
    bubble.textContent = line;
    root.classList.remove('is-talking', 'is-laughing');
    void root.offsetWidth;
    root.classList.add('is-talking');
    if (kind === 'lose' || kind === 'bust' || kind === 'debt' || kind === 'near' || kind === 'fold') root.classList.add('is-laughing');
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove('is-talking', 'is-laughing'), 4500);
  };
  root.destroy = () => clearTimeout(timer);
  root.say('welcome');
  return root;
}
