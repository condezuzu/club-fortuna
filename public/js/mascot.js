/**
 * Club Fortuna — Don Fortunato, croupier and mascot of the whole app.
 *
 * One instance per browser tab. The app shell places the returned element on the
 * fixed bottom bar, at the left edge of the viewport; games talk to him through
 * say() / play() and players can throw things at him (hit()).
 *
 *   import { createMascot, MASCOT_KINDS, MASCOT_ANIMS } from '/js/mascot.js'
 *   const mascot = createMascot({ audio, getContext })
 *
 *   mascot.say(kind, text?)  a line of that kind (or `text`) in the speech bubble,
 *                            typed out, plus an animation that fits the kind;
 *                            returns the line
 *   mascot.play(anim)        a named animation without speech
 *   mascot.hit(item)         'tomato' | 'cake' | 'rose' | 'water' thrown at him
 *   mascot.destroy()         stops every timer and listener, removes the element
 *
 * On his own he breathes, blinks, glances around, fidgets, tells a joke every
 * 40-70 s (page visible, nothing said in the last 20 s) and dozes off after three
 * quiet minutes; a tap makes him tell a joke. Under reduced motion he holds the
 * key pose of each gesture instead of moving, and lines appear at once.
 *
 * The drawing is one inline SVG (static markup authored in this file) whose part
 * groups are animated by the keyframes in /css/mascot.css; this module only
 * sequences them (data-anim, data-eyes, data-brows, data-mouth ... on the root).
 * Caller-provided strings only ever reach the DOM through textContent.
 */

import { el, prefersReducedMotion } from './ui.js';

/* ==========================================================================
   Lines
   An entry is a string, or [text, anim] when one gesture fits that line best.
   "{name}" is replaced by the local player's name; those lines are only used
   when getContext() provides one.
   ========================================================================== */

const LINES = {
  welcome: [
    'Bienvenido. La casa siempre gana, pero usted insista.',
    'Tome asiento. Las fichas no se pierden solas.',
    '¿Viene a ganar o a hacer donaciones?',
    'Adelante, adelante. Su plata está en buenas manos: las mías.',
    'Pase, pase. Deje la dignidad en el guardarropa, que acá no la va a necesitar.',
    'Bienvenido al Club Fortuna. La fortuna es nuestra; el club, también.',
    ['¡Qué gusto verlo! A su billetera, sobre todo.', 'bow'],
    'Póngase cómodo. Lo vamos a desplumar con la mejor de las sonrisas.',
    ['Ah, {name}. Le guardé la silla. Y un lugar en la lista del prestamista.', 'wave'],
  ],
  bet: [
    'Hagan sus apuestas, no sean tímidos.',
    '¿Eso es todo? Mi abuela apuesta más fuerte.',
    'Apueste con el corazón, que la cabeza ya la perdió.',
    'Hagan juego. La suerte no espera a nadie.',
    'Apueste tranquilo: la plata es de mentira, pero el papelón es de verdad.',
    ['¿Va con todo o va con miedo?', 'point'],
    'Ponga, ponga, que el que no arriesga no pierde… digo, no gana.',
    ['Esa apuesta me dio ternura.', 'laugh'],
  ],
  lose: [
    'Gracias por su generosa contribución.',
    'Uy. Eso dolió hasta acá.',
    'No se preocupe, perder también es un talento.',
    'La casa le agradece. De corazón.',
    '¿Probó con jugar bien?',
    'Otra más y le pongo su nombre a una silla.',
    'Tranquilo, la plata va y viene. Sobre todo se va.',
    'Dicen que el que persevera triunfa. Dicen.',
    'No es mala suerte: es constancia.',
    'Lo importante es competir. Eso dicen los que pierden.',
  ],
  bust: [
    '¡Se pasó! El 21 quedó allá atrás.',
    'Pidió una de más. Clásico.',
    'La avaricia rompe el saco. Y la mano.',
    'Veintidós. Tan cerca y tan pasado.',
    '¿Otra carta? Con esa ya eran multitud.',
    'Se pasó de rosca. Y eso que yo le avisé con la mirada.',
    'Contar hasta 21 no era tan difícil, eh.',
  ],
  win: [
    'Bien jugado. No se acostumbre.',
    'Suerte de principiante, seguro.',
    ['Festeje bajito, que me descuentan del sueldo.', 'cry'],
    'Ganó. Anótelo, que no pasa seguido.',
    'Disfrútelo. Ya vuelve todo a casa.',
    'Mire usted: hasta un reloj parado acierta dos veces por día.',
    'Cobre, cobre. Yo se lo cuido para la próxima mano.',
    'Ganó limpio. Por ahora no llamo a nadie.',
  ],
  bigwin: [
    '¡Epa! ¿Me va a dejar sin trabajo?',
    ['Seguridad… vigilen a este jugador.', 'point'],
    ['Con eso ya me puede dejar propina.', 'bow'],
    ['¡Pare, pare! Que eso sale de mi aguinaldo.', 'cry'],
    ['Me va a hacer llorar. Y yo lloro feo.', 'cry'],
    ['¿Usted cuenta cartas o le reza a alguien?', 'think'],
    'El gerente quiere hablar con usted. Y conmigo. Sobre todo conmigo.',
    'Ganó tanto que me bajó la presión.',
  ],
  push: [
    'Empate. Nadie gana, nadie llora.',
    'Ni para usted ni para mí. Qué aburrido.',
    'Tablas. Le devuelvo lo suyo, muy a mi pesar.',
    'Empatamos. Hagamos de cuenta que nadie vio nada.',
    'Empate: el resultado preferido de nadie.',
    'Ni fu ni fa. Otra mano y vemos.',
  ],
  debt: [
    'El prestamista preguntó por usted. Con nombre y apellido.',
    'Siga así y va a tener que lavar copas.',
    'Debe más de lo que vale la mesa.',
    'Yo que usted no saldría por la puerta de adelante.',
    'Su deuda ya tiene edad para votar.',
    'El prestamista le manda saludos. A usted y a sus rodillas.',
    'Con lo que debe, ya es casi socio del club.',
    'Le fían porque les cae simpático. Aproveche, que no dura.',
    ['{name}… así empiezan las cartas de amor del prestamista.', 'point'],
  ],
  near: [
    '¡Uy, casi! Casi no paga, igual.',
    'Por un pelito. Qué lástima. De verdad.',
    'Casi, casi. El «casi» lo cobramos aparte.',
    'Estuvo tan cerca que hasta yo me asusté.',
    '¡Ay! Por una nada. Una nada carísima.',
    'Le faltó un cachito así. Vuelva a intentar, que yo no me canso.',
  ],
  spin: [
    'Que gire, que gire…',
    ['No va más.', 'point'],
    'Crucen los dedos. O récenle a algo.',
    ['¡No va más! Las manos lejos de las fichas.', 'point'],
    'Y gira, gira… como su suerte.',
    'Mire fijo, a ver si con la mirada la convence.',
  ],
  fold: [
    '¿Se retira? Los valientes mueren una vez; usted, todas las manos.',
    'Sabia decisión. Cobarde, pero sabia.',
    'Soldado que huye sirve para otra mano.',
    '¿Se va al mazo? Las cartas ni se enteraron de que usted jugaba.',
    'Retirada estratégica, le dicen ahora.',
    'Hizo bien. O no. Nunca lo vamos a saber.',
  ],
  jackpot: [
    ['¡EL POZO! No lo puedo creer. Me voy a llorar al baño.', 'cry'],
    ['¡Pozo acumulado! Que alguien me sostenga el moño.', 'dance'],
    ['¡Se llevó el pozo! Baile conmigo, que mañana me echan.', 'dance'],
    ['¡Jackpot! Treinta años acá y nunca me tocó a mí.', 'cry'],
    ['¡Sonó la campana! Brinden por mi futuro desempleo.', 'dance'],
    ['¡El pozo entero! Acuérdese de los amigos… o sea, de mí.', 'dance'],
  ],
  idle: [
    '¿Sabe cómo salir del casino con una pequeña fortuna? Entrando con una grande.',
    'En la ruleta siempre apuesto al verde. Al verde de los billetes de ustedes.',
    'Yo no cuento cartas. Cuento clientes.',
    'Dicen que la plata no da la felicidad. Tráiganmela y lo comprobamos.',
    'Mi señora dice que soy un as. Nunca aclaró de qué palo.',
    'Acá el único que no pierde soy yo. Y eso porque no me dejan jugar.',
    'La suerte es como el colectivo: cuando uno la necesita, pasa llena.',
    'Treinta años repartiendo cartas y todavía no me tocó una buena.',
    'Si me ven dormido, apuesten bajito.',
    'Un consejo gratis: no acepten consejos gratis en un casino.',
  ],
  join: [
    'Entró alguien. Cuenten las fichas, por las dudas.',
    '¡Otro valiente! Pase, que hay silla y hay deuda para todos.',
    'Carne fresca. Digo… ¡bienvenido!',
    'Se suma un jugador. La casa lo recibe con los brazos abiertos. La caja, también.',
    '¡Llegó la alegría! O por lo menos, llegó más plata.',
    'Bienvenido a la mesa. Los demás ya vienen perdiendo, no se apure.',
    'Uno más para la causa. La causa soy yo.',
  ],
  levelup: [
    '¡Subió de nivel! Ahora pierde con más categoría.',
    'Nivel nuevo. Las deudas, las mismas.',
    '¡Felicitaciones! Ya casi es habitué.',
    'Subió de nivel. El club le regala… mi admiración.',
    'Mire cómo crece. Me emociono y todo.',
    'Otro nivel. A este paso le ponemos una placa.',
    'Asciende rápido. Ojalá su saldo copiara el ejemplo.',
  ],
  quota: [
    '¡Llegaron a la cuota! No lo puedo creer. Yo había apostado en contra.',
    '¡Cuota cumplida! El gerente llora; yo bailo.',
    'Lo lograron. Entre todos, pero lo lograron.',
    '¡Cuota alcanzada! Brindo con agua de la canilla, que es lo que me dejan.',
    'Trabajo en equipo, que le dicen. Yo lo llamo milagro.',
    '¡Objetivo cumplido! Hoy nadie lava copas.',
    '¡Bravo! La próxima cuota viene más brava, se lo adelanto.',
  ],
  tip: [
    '¡Muy amable! Con otra igual, casi me alcanza para el café.',
    'Gracias. Yo sabía que usted era gente de bien.',
    '¡Propina! Así da gusto venir a trabajar.',
    'Se agradece. Y no se corte, eh: este bolsillo no tiene fondo.',
    ['¡Qué generosidad! ¿Seguro que no quiere redondear?', 'count'],
    'Mil gracias. Mis hijos comen hoy. No tengo hijos, pero igual.',
    'Así me gusta: gente con clase. Y con billetera.',
    ['Gracias. Me la guardo acá, cerquita del corazón y lejos del gerente.', 'count'],
  ],
  loan: [
    'Firmó con el prestamista. Lea la letra chica… ah, no, ya es tarde.',
    'Plata fresca. Los intereses también vienen frescos.',
    ['El prestamista sonríe. Eso nunca es buena señal.', 'laugh'],
    'Préstamo aprobado. Las rodillas quedan en garantía.',
    'Tome, cuente. Y después cuente los días.',
    '¡Crédito! La palabra más linda y más cara del club.',
    'Yo le cuento los billetes; el prestamista le cuenta los intereses.',
  ],
  rescue: [
    '¡Zafó! No sé cómo, pero zafó.',
    'Rescate cumplido. Vuelva a la mesa antes de que me arrepienta.',
    'Mire usted, tenía talento escondido. Muy escondido.',
    'Se salvó por un pelo. De los pocos que me quedan.',
    '¡Bien ahí! Fichas nuevas, errores viejos.',
    'Lo rescataron. Agradezca y no pregunte.',
    'Sobrevivió. El club le da otra oportunidad de perderlo todo.',
  ],
  rescueFail: [
    'Uy… Ni el rescate le salió.',
    'No se rescata ni solo.',
    'Fracasó con todo éxito.',
    'Tranquilo. Lavar copas también es un oficio digno.',
    'Eso fue difícil de mirar. Y yo miré todo.',
    'Casi lo logra. Bueno, no. Ni cerca.',
    'Pruebe de nuevo. Yo, mientras, le voy enjuagando un vaso.',
  ],
  shop: [
    '¡Linda compra! Lo barato sale caro; lo caro, también.',
    'Gastar acá es la única apuesta segura.',
    'Vendido. No se aceptan devoluciones, ni reclamos, ni lágrimas.',
    '¡Qué elegancia! Ahora pierde, pero con estilo.',
    'Excelente elección. Era lo más caro, ¿no?',
    'Gracias por su compra. La casa gana hasta cuando usted no juega.',
    'Le queda pintado. Lástima el saldo.',
  ],
  rain: [
    '¡Llueven fichas! Que nadie se agache, que las junto yo.',
    '¡Lluvia de fichas! Y yo sin paraguas… ni bolsillos suficientes.',
    'Así da gusto el mal tiempo.',
    '¡Agarren, agarren! Que el generoso se arrepiente rápido.',
    'Tormenta de fichas. El pronóstico decía sequía.',
    '¡Qué despilfarro tan hermoso!',
    'Miren cómo reparte. Así empezó el último que se fundió.',
  ],
  emote: [
    'Lo vi. Los modales, por favor.',
    'Muy expresivo. ¿Apuesta igual que gesticula?',
    'Menos mímica y más fichas.',
    '¡Cuánta emoción! Guárdese algo para cuando pierda.',
    'Me encanta el entusiasmo. No paga nada, pero me encanta.',
    'Yo también sé hacer caras. Mire: esta es la de «no me importa».',
    'Las señas al de al lado están prohibidas. Las señas a mí, también.',
  ],
  highroller: [
    'Sala de límites altos. Acá se pierde en grande, como la gente fina.',
    '¡Adelante, adelante! Cuidado con el escalón… y con las apuestas mínimas.',
    'Bienvenido a la sala VIP. El aire es el mismo, pero sale más caro.',
    'Acá las fichas pesan más. Las deudas, ni le cuento.',
    'Me pongo derecho, que entró gente importante.',
    'Límites altos, caídas largas. Disfrute la vista.',
    'En esta sala no se pregunta el precio. Tampoco el saldo.',
  ],
  poor: [
    ['¿Sin fichas? El prestamista atiende las 24 horas. Qué casualidad.', 'point'],
    'Está seco. Más seco que mi sueldo.',
    'Bolsillos vacíos, corazón contento… No, mentira.',
    'No le queda ni para el colectivo. Pero qué bien que jugó.',
    'Quebró. Tranquilo, le pasa a los mejores. Y a usted.',
    'Sin fichas no hay paraíso. Pero hay rescate: pruebe.',
    '¿Ya miró abajo de la mesa? A veces se cae alguna.',
    'Lo veo liviano de fichas. Liviano como una pluma.',
    ['{name}, {name}… ¿Y ahora con qué apuesta?', 'facepalm'],
  ],
};

/** Fallback pool for unknown kinds. */
const NEUTRAL = [
  'Mmm. Interesante.',
  'Siga, siga. Yo observo.',
  'Acá estoy, atento a todo. Sobre todo a su billetera.',
  'Anotado.',
  'Muy bien. O muy mal. Ya veremos.',
  'No me pagan por opinar, pero opino igual.',
];

/** What he says when something lands on him. */
const HIT_LINES = {
  tomato: [
    '¡¿Quién fue?! ¡Este chaleco es de tintorería!',
    '¡Un tomate! ¿Qué soy, una ensalada?',
    'Muy gracioso. Se lo anoto en la cuenta. Con intereses.',
    '¡Seguridad! …Ah, cierto que hoy tienen franco.',
    'Y maduro, encima. Ni para tirar tomates tiene criterio.',
    'Sigan, sigan. Total, la tintorería la paga la casa. O sea, ustedes.',
  ],
  cake: [
    '¡Una torta! ¡En la cara! ¡Con lo que me costó el peinado!',
    'Mmm… crema pastelera. Igual estoy furioso.',
    '¿Es mi cumpleaños? ¡No! ¡Entonces no corresponde!',
    'Esto no lo cubre el convenio.',
    'Rica. Pero la próxima me la sirve en un plato.',
    '¡Mi bigote! ¡Treinta años de bigote arruinados!',
  ],
  water: [
    '¡Pero…! ¡Me empapó el moño!',
    '¡Agua! ¡Con lo que tarda en secarse este bigote!',
    'Yo ya me bañé el sábado, no hacía falta.',
    'Muy refrescante. Ahora corra.',
    '¿Agua? En este club se tira champán, por lo menos.',
    '¡Se me va a encoger el chaleco!',
  ],
  rose: [
    '¡Una rosa! Ay… me pongo colorado.',
    '¿Para mí? Qué detalle. Igual no le perdono la deuda.',
    'Gracias, gracias. Los autógrafos, a la salida.',
    'Una rosa para otra rosa. Bueno, para un clavel.',
    'Me conquistó. Hoy le reparto con cariño. Las cartas, digo.',
    '¡Qué galantería! Hacía años que no me tiraban flores. Tomates, sí.',
  ],
};

/** Woken up by a tap. */
const WOKE_LINES = [
  '¡Eh! No dormía: descansaba los ojos.',
  '¿Eh? ¿Qué? ¡No va más! …Ah, era usted.',
  'Estaba contando ovejas. Perdían todas.',
  '¡Presente! Cinco minutitos más no le hacían mal a nadie.',
];

/** Tapped too many times in a row. */
const POKE_LINES = [
  '¡Basta de toquetear! Soy crupier, no timbre.',
  '¡Las manos en la mesa, donde yo las vea!',
  'Un toque más y le cobro entrada.',
  '¡El bigote no se toca!',
];

/** Every kind accepted by say(). */
export const MASCOT_KINDS = Object.freeze(Object.keys(LINES));

/* ==========================================================================
   Animations
   ms     length of the CSS keyframes (exposed to the stylesheet as --m-dur)
   look   what is held while it plays: eyes / brows / mouth, hands { l, r },
          props { l, r }, gaze [x, y], flush, blush
   cues   [ms, look patch] applied on the way
   sfx    [ms, sound] — only heard when a tap started the animation
   ========================================================================== */

const REST_FACE = { eyes: 'open', brows: 'smug', mouth: 'smirk' };

const ANIMS = {
  talk: { ms: 1700, look: { brows: 'up', hands: { r: 'spread' } } },
  laugh: { ms: 2000, look: { eyes: 'happy', brows: 'up', mouth: 'grin' } },
  shrug: { ms: 1900, look: { brows: 'up', mouth: 'flat', hands: { l: 'spread', r: 'spread' } } },
  cheer: { ms: 1900, look: { eyes: 'happy', brows: 'up', mouth: 'grin', hands: { l: 'spread', r: 'spread' } } },
  facepalm: {
    ms: 2400,
    look: { eyes: 'wide', brows: 'sad', mouth: 'oh', hands: { l: 'fist', r: 'spread' } },
    cues: [[420, { eyes: 'shut', mouth: 'frown' }]],
  },
  point: { ms: 1900, look: { brows: 'skeptic', hands: { l: 'fist', r: 'point' }, gaze: [1.6, -0.3] } },
  deal: {
    ms: 2100,
    look: { brows: 'up', gaze: [0.5, 1.5] },
    cues: [
      [200, { props: { l: 'deck' } }],
      [420, { gaze: [1.8, 0.2] }],
      [1500, { gaze: [0, 0], mouth: 'grin' }],
      [1810, { props: { l: null } }],
    ],
    sfx: [[400, 'card'], [757, 'card'], [1114, 'card']],
  },
  shuffle: {
    ms: 2300,
    look: { brows: 'up', gaze: [0, 1.7] },
    cues: [
      [230, { props: { l: 'half', r: 'half' } }],
      [1500, { gaze: [0, 0], mouth: 'grin', props: { l: 'deck', r: null } }],
      [1980, { props: { l: null } }],
    ],
    sfx: [[340, 'flip'], [560, 'flip'], [780, 'flip'], [1000, 'flip'], [1560, 'card']],
  },
  bow: {
    ms: 2200,
    look: { eyes: 'shut', brows: 'up', hands: { r: 'spread' } },
    cues: [[1500, { eyes: 'happy', mouth: 'grin' }]],
  },
  dance: { ms: 3200, look: { eyes: 'happy', brows: 'up', mouth: 'grin', hands: { l: 'point', r: 'point' } } },
  cry: { ms: 2700, look: { eyes: 'squeeze', brows: 'sad', mouth: 'wail', hands: { l: 'spread', r: 'spread' } } },
  angry: { ms: 2100, look: { eyes: 'narrow', brows: 'angry', mouth: 'grit', hands: { l: 'fist', r: 'fist' }, flush: true } },
  wipe: {
    ms: 2100,
    look: { eyes: 'shut', brows: 'sad', mouth: 'flat' },
    cues: [[230, { props: { r: 'hanky' } }], [1780, { props: { r: null } }]],
  },
  count: {
    ms: 2500,
    look: { brows: 'up', gaze: [0.4, 1.7] },
    cues: [[240, { props: { l: 'bills' } }], [2050, { gaze: [0, 0], mouth: 'grin' }], [2150, { props: { l: null } }]],
    sfx: [[400, 'tick'], [750, 'tick'], [1100, 'tick'], [1450, 'tick'], [1800, 'tick']],
  },
  wave: { ms: 1900, look: { eyes: 'happy', brows: 'up', mouth: 'grin', hands: { r: 'spread' } } },
  sleep: { ms: 0, look: { eyes: 'shut', brows: 'sad', mouth: 'oh' } },
  think: {
    ms: 2500,
    look: { brows: 'skeptic', mouth: 'flat', hands: { r: 'point' }, gaze: [-1.5, -1.5] },
    cues: [[2050, { gaze: [0, 0] }]],
  },
  blush: { ms: 2400, look: { eyes: 'happy', brows: 'sad', mouth: 'grin', hands: { r: 'spread' }, blush: true } },
  twirl: { ms: 1900, look: { brows: 'skeptic', gaze: [1.4, -0.5] } },
  bowtie: { ms: 1800, look: { eyes: 'shut', brows: 'up' } },
};

/** Every animation accepted by play(). */
export const MASCOT_ANIMS = Object.freeze(Object.keys(ANIMS));

/** kind -> animations that fit it (one is picked; a line may bring its own). */
const KIND_ANIMS = {
  welcome: ['wave', 'bow'],
  bet: ['deal', 'point'],
  lose: ['laugh', 'shrug'],
  bust: ['laugh', 'facepalm'],
  win: ['shrug', 'point'],
  bigwin: ['cry', 'facepalm'],
  push: ['shrug', 'think'],
  debt: ['count', 'point'],
  near: ['laugh', 'shrug'],
  spin: ['think', 'point'],
  fold: ['laugh', 'shrug'],
  jackpot: ['dance', 'cry'],
  idle: ['talk', 'laugh'], // tells the joke, then laughs at it (see IN_SEQUENCE)
  join: ['wave', 'bow'],
  levelup: ['cheer', 'bow'],
  quota: ['dance', 'cheer'],
  tip: ['bow', 'count'],
  loan: ['count', 'point'],
  rescue: ['cheer', 'shrug'],
  rescueFail: ['facepalm', 'laugh'],
  shop: ['count', 'bow'],
  rain: ['cheer', 'dance'],
  emote: ['wave', 'laugh'],
  highroller: ['bow', 'shuffle'],
  poor: ['shrug', 'think'],
};

/** Kinds whose two animations play one after the other instead of being alternatives. */
const IN_SEQUENCE = new Set(['idle']);

/** Gestures for the joke he tells when somebody taps him. */
const TAP_ANIMS = ['laugh', 'shrug', 'point', 'deal', 'shuffle', 'wave', 'think', 'count', 'bow', 'dance', 'cheer', 'twirl'];

/** Small things he does on his own, without a word. */
const FIDGETS = ['twirl', 'bowtie'];

const HIT_ITEMS = ['tomato', 'cake', 'rose', 'water'];

const BUBBLE_MS = 4500;        // how long a line stays up
const MAX_TEXT = 240;          // a caller's own text is cut to this many characters
const IDLE_MIN_MS = 40000;     // idle jokes: every 40-70 s ...
const IDLE_MAX_MS = 70000;
const IDLE_QUIET_MS = 20000;   // ... if nothing was said in the last 20 s
const FIDGET_MIN_MS = 16000;   // a fidget every 16-34 s while nothing else is going on
const FIDGET_MAX_MS = 34000;
const DOZE_MS = 180000;        // dozes off after 3 minutes without a say()

/* ==========================================================================
   The drawing (viewBox 0 0 104 160, feet on y = 156)
   Arms and legs are authored once, in the "screen-left" frame; the right-hand
   copies live inside a mirroring group, so one set of pivots and one sign
   convention (positive rotation = outwards) serves both sides.
   ========================================================================== */

const MIRROR = 'matrix(-1 0 0 1 104 0)';

const FACE_PATH =
  'M30.2 29C30.2 15.5 39.5 9.5 52 9.5 64.5 9.5 73.8 15.5 73.8 29 75.6 33 76.2 38.6 75.4 43.6 74.2 52.6 69.6 59.6 62.6 63 59.4 64.5 55.8 65.2 52 65.2 48.2 65.2 44.6 64.5 41.4 63 34.4 59.6 29.8 52.6 28.6 43.6 27.8 38.6 28.4 33 30.2 29Z';

const CARD_ART =
  '<rect class="m-card-edge" x="-4.7" y="-6.3" width="9.4" height="12.6" rx="1.5"/><rect class="m-card-face" x="-4.3" y="-6" width="8.6" height="12" rx="1.2"/><rect class="m-card-back" x="-3" y="-4.7" width="6" height="9.4" rx="0.7"/><path class="m-card-deco" d="M0-2.3 1.5 0 0 2.3-1.5 0Z"/>';

const BILL_ART =
  '<rect class="m-bill" x="-6.2" y="-3.7" width="12.4" height="7.4" rx="0.9"/><ellipse class="m-bill-mark" cx="0" cy="0" rx="2.1" ry="1.9"/>';

const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i + 1)).join('');

function handArt() {
  return `
          <g class="m-hand">
            <g class="m-hand__v m-hand__v--rest">
              <path class="m-skin" d="M17.6 111.6C16.9 115.2 16.7 119.4 17.9 122.2 18.9 124.5 21.5 125.4 23.7 124.8 26.1 124.2 27.4 121.8 27.6 119 27.7 116.4 27.4 113.9 27 111.6Z"/>
              <path class="m-skin" d="M26.5 113.4C28.7 113.8 30.4 115.7 30.4 117.9 30.4 119.5 28.8 120.3 27.8 119.1 27 118.1 26.6 115.9 26.5 113.4Z"/>
              <path class="m-skin-line" d="M19.9 120.8V123.9M22.3 121.3V124.5M24.7 120.8V123.7"/>
              <path class="m-skin-line" d="M26.8 114.6C26.9 116.2 27.2 117.6 27.6 118.6"/>
            </g>
            <g class="m-hand__v m-hand__v--spread">
              <path class="m-finger" d="M25.2 119.2 27.7 125.6" stroke-width="2.7"/>
              <path class="m-finger" d="M23.3 120.4 24 127.2" stroke-width="2.7"/>
              <path class="m-finger" d="M21.2 120.4 20.4 126.8" stroke-width="2.6"/>
              <path class="m-finger" d="M19.3 119.2 17 124.2" stroke-width="2.4"/>
              <path class="m-finger" d="M26.4 115.2 31.2 117.6" stroke-width="2.9"/>
              <ellipse class="m-skin" cx="22.4" cy="116.8" rx="5.4" ry="5.3"/>
              <path class="m-skin-line" d="M19.6 116.6C21.2 118.2 23.8 118.4 25.4 117"/>
            </g>
            <g class="m-hand__v m-hand__v--point">
              <path class="m-finger" d="M19.6 118.4 19.4 128.8" stroke-width="3"/>
              <path class="m-finger" d="M18.4 115.2 12.8 113.2" stroke-width="2.8"/>
              <path class="m-skin" d="M17.2 111.6H27.3V119C27.3 121.5 25.5 122.8 23.6 122.8H21.2C18.8 122.8 17 121.4 17 119Z"/>
              <path class="m-skin-line" d="M22.5 119.6V122.4M24.9 119.6V122.2M21.2 118.6V121"/>
            </g>
            <g class="m-hand__v m-hand__v--fist">
              <path class="m-skin" d="M16.8 111.6H27.6V118.6C27.6 121.8 25.3 123.6 22.2 123.6 19.1 123.6 16.6 121.8 16.6 118.6Z"/>
              <path class="m-skin-line" d="M19.3 119.4V122.6M21.9 119.8V123.2M24.5 119.4V122.6"/>
              <path class="m-skin" d="M26.6 114C29.4 114.4 30 118 27.8 119.4 26.8 120 25.6 119.4 25.8 118.2Z"/>
              <path class="m-skin-line" d="M26.8 115C28.4 115.6 28.6 117.8 27.2 118.8"/>
            </g>
            <g class="m-prop m-prop--deck"><g transform="translate(26.8 117.9) rotate(75)">
              <rect class="m-card-edge" x="-5.5" y="-7.5" width="11.6" height="15" rx="1.6"/>
              <rect class="m-card-face" x="-5.3" y="-7.6" width="10.6" height="14.4" rx="1.4"/>
              <rect class="m-card-back" x="-3.9" y="-6.2" width="7.8" height="11.6" rx="0.8"/>
              <path class="m-card-deco" d="M0-3.2 2-.4 0 2.4-2-.4Z"/>
              <ellipse class="m-skin" cx="-1.6" cy="6.6" rx="3.4" ry="1.9"/>
            </g></g>
            <g class="m-prop m-prop--half"><g transform="translate(24.4 121.6) rotate(128)">
              <rect class="m-card-edge" x="-5.1" y="-6.3" width="10.8" height="12.8" rx="1.5"/>
              <rect class="m-card-face" x="-4.9" y="-6.4" width="9.8" height="12.2" rx="1.3"/>
              <rect class="m-card-back" x="-3.6" y="-5.1" width="7.2" height="9.6" rx="0.8"/>
              <ellipse class="m-skin" cx="-1" cy="5.6" rx="3.2" ry="1.8"/>
            </g></g>
            <g class="m-prop m-prop--bills"><g transform="translate(26.6 118.4) rotate(66)">
              <rect class="m-bill m-bill--back" x="-7" y="-5.4" width="14" height="8.2" rx="1" transform="rotate(-10)"/>
              <rect class="m-bill m-bill--back" x="-7" y="-4.6" width="14" height="8.2" rx="1" transform="rotate(-4)"/>
              <rect class="m-bill" x="-7" y="-3.9" width="14" height="8.2" rx="1"/>
              <ellipse class="m-bill-mark" cx="0" cy="0.2" rx="2.4" ry="2.1"/>
              <ellipse class="m-skin" cx="-3.4" cy="4.2" rx="3.2" ry="1.9"/>
            </g></g>
            <g class="m-prop m-prop--hanky">
              <path class="m-hanky" d="M12.6 113.4C15.4 109.2 24 108.4 28.8 111.2 32.8 113.6 34 120 31.2 124.2 28.6 128 22 129.8 17 127.6 11.6 125.2 9.4 118 12.6 113.4Z"/>
              <path class="m-hanky-line" d="M16.4 115.8C19.4 114 24.8 114.6 28 117M15.8 121.2C19.4 119.8 24.6 120.6 28.2 123"/>
            </g>
          </g>`;
}

function armArt() {
  return `
        <path class="m-sleeve-edge" d="M27 75 23 94.6" stroke-width="13.8"/>
        <path class="m-sleeve" d="M26.7 74.7 22.7 94.3" stroke-width="12.4"/>
        <path class="m-garter" d="M18.6 82.6 31.2 85.2"/>
        <path class="m-garter-hi" d="M19.8 82.3 24.6 83.3"/>
        <g class="m-fore">
          <path class="m-sleeve-edge" d="M23 94.6 22.5 108" stroke-width="12.4"/>
          <path class="m-sleeve" d="M22.7 94.3 22.2 107.7" stroke-width="11"/>
          <circle class="m-sleeve" cx="22.8" cy="94.4" r="6.1"/>
          <path class="m-sleeve-fold" d="M18.4 97.2C20.6 98.4 24.4 98.4 27 97"/>
          <rect class="m-cuff" x="15.9" y="107" width="13" height="6" rx="1.9"/>
          <circle class="m-gold" cx="17.9" cy="110" r="1.05"/>${handArt()}
        </g>`;
}

function legArt() {
  return `
      <path class="m-shoe" d="M34 145.6H50.6V152.8C50.6 154.6 49.6 155.6 48 155.6H27.4C24.2 155.6 23.4 152.3 25.9 150.6 28.6 148.8 31.8 148 34 145.6Z"/>
      <path class="m-spat" d="M35 147.6C37.6 149.4 42 150 45.8 149.4L46 154.4H36.2C33.2 154.4 32.4 150.2 35 147.6Z"/>
      <path class="m-shoe-shine" d="M27 151.6C28.4 150.5 30 149.9 31.6 149.6"/>
      <path class="m-trouser" d="M28.6 110H52.9V121C52.3 130 51.3 139 50.3 147.6H34.2C32.2 136 30 123 28.6 110Z"/>
      <path class="m-trouser-shade" d="M52.9 121C52.3 130 51.3 139 50.3 147.6H46.9C47.9 138 48.7 129 48.9 119.4Z"/>
      <path class="m-trouser-crease" d="M40.4 117C40.9 127 41.6 137 42.3 146.4"/>`;
}

/** Things that live on his head: marks, steam and whatever was thrown at him. */
function headFxArt() {
  return `
            <g class="m-snot"><circle class="m-snot-bubble" cx="59.4" cy="49.6" r="4.2"/><path class="m-snot-hi" d="M57.4 47.4Q58.6 46.2 60.2 46.4"/></g>
            <path class="m-sweat" d="M72.4 14.6C74.4 17.8 75 19.6 72.4 21.4 69.8 19.6 70.4 17.8 72.4 14.6Z"/>
            <path class="m-vein" d="M62.6 14.4Q65.4 14.6 65.6 11.6M68.6 11.6Q68.8 14.6 71.6 14.4M71.6 17.4Q68.8 17.2 68.6 20.2M65.6 20.2Q65.4 17.2 62.6 17.4"/>
            <g class="m-steam m-steam--l1"><circle cx="22.6" cy="34.6" r="3.3"/><circle cx="19" cy="33" r="2.5"/><circle cx="20.6" cy="37.2" r="2.1"/></g>
            <g class="m-steam m-steam--l2"><circle cx="22.6" cy="34.6" r="2.7"/><circle cx="19.4" cy="33.4" r="2"/><circle cx="20.8" cy="36.8" r="1.7"/></g>
            <g class="m-steam m-steam--r1"><circle cx="81.4" cy="34.6" r="3.3"/><circle cx="85" cy="33" r="2.5"/><circle cx="83.4" cy="37.2" r="2.1"/></g>
            <g class="m-steam m-steam--r2"><circle cx="81.4" cy="34.6" r="2.7"/><circle cx="84.6" cy="33.4" r="2"/><circle cx="83.2" cy="36.8" r="1.7"/></g>

            <g class="m-splat m-splat--tomato">
              <path class="m-tomato m-bit m-bit--1" d="M45 22.6C46.4 21.2 48.6 22.2 48.2 24 47.8 25.8 45.2 26 44.4 24.6 44 23.8 44.4 23.2 45 22.6Z"/>
              <path class="m-tomato m-bit m-bit--2" d="M70.4 21C71.8 20.2 73.4 21.6 72.8 23 72.2 24.4 70 24.2 69.6 22.8 69.4 22 69.8 21.4 70.4 21Z"/>
              <path class="m-tomato m-bit m-bit--3" d="M71 42.4C72.2 41.8 73.4 43 72.8 44.2 72.2 45.2 70.6 45 70.2 43.8 70 43.2 70.4 42.6 71 42.4Z"/>
              <path class="m-tomato" d="M48.2 25.6C50.6 21.6 54.6 24.6 56.6 21.2 59.2 17.2 64.2 20.8 63.4 24.8 67.4 23.6 71.2 27.6 68.4 31.6 72.2 34.6 69.4 40.4 65.2 39.6 64.4 44.4 58.2 44.6 56.2 40.8 52.2 43.8 47.2 41.6 48.2 36.8 43.4 35.8 43.9 27.7 48.2 25.6Z"/>
              <path class="m-tomato m-drip m-drip--1" d="M53.2 40V46.8A2 2 0 0 0 57.2 46.8V40Z"/>
              <path class="m-tomato m-drip m-drip--2" d="M62 38.4V43.2A1.6 1.6 0 0 0 65.2 43.2V38.4Z"/>
              <path class="m-tomato-dark" d="M52.6 30.6C53.8 27.8 57.2 26.8 59.6 28.2 62.4 29.8 63 33.4 61.2 35.6 59.2 38 55.4 37.8 53.6 35.6 52.4 34.2 52 32.2 52.6 30.6Z"/>
              <path class="m-tomato-hi" d="M49.4 28.6C50.6 26.8 52.4 26 54 26.4M64.4 27.4C65.6 27.4 66.6 28.2 66.8 29.4"/>
              <ellipse class="m-seed" cx="55.4" cy="31" rx="1" ry="0.65" transform="rotate(-25 55.4 31)"/>
              <ellipse class="m-seed" cx="58.9" cy="33.4" rx="1" ry="0.65" transform="rotate(30 58.9 33.4)"/>
              <ellipse class="m-seed" cx="56" cy="35.2" rx="0.9" ry="0.6" transform="rotate(-60 56 35.2)"/>
            </g>

            <g class="m-splat m-splat--cake">
              <path class="m-cream m-bit m-bit--1" d="M33.4 24.4C35 23 37.4 24.2 36.8 26.2 36.2 28 33.4 28.2 32.6 26.6 32.2 25.8 32.8 24.9 33.4 24.4Z"/>
              <path class="m-cream m-bit m-bit--2" d="M72.6 22.4C74.2 21.6 75.8 23.2 75.2 24.8 74.6 26.2 72.2 26 71.8 24.4 71.6 23.6 72 22.8 72.6 22.4Z"/>
              <path class="m-cream m-bit m-bit--3" d="M74.4 47.4C75.8 46.8 77 48.2 76.4 49.4 75.8 50.6 74 50.4 73.6 49 73.4 48.4 73.8 47.7 74.4 47.4Z"/>
              <path class="m-cream" d="M35.4 31.4C36.4 25.4 44.4 26.9 47 23.8 50.8 19.4 60 20.4 62.8 24.8 67.8 23.4 73.4 28.4 71 34.4 74.4 39 71.4 46.4 66 46.8 65 52 57.4 54 53.4 50 49.4 54 41.4 52.4 40.4 47 34 46.4 32 39 35 35.4 33.8 34 34.2 32.4 35.4 31.4Z"/>
              <path class="m-cream m-drip m-drip--1" d="M43.8 49V55.6A2.1 2.1 0 0 0 48 55.6V49Z"/>
              <path class="m-cream m-drip m-drip--2" d="M60.6 49.4V53.8A1.7 1.7 0 0 0 64 53.8V49.4Z"/>
              <path class="m-cream-line" d="M40.6 34.4C43.6 31.2 48.6 31.4 50.6 34.4M55 30.2C58 28 62.6 28.8 64.4 31.8M44.6 43.6C47.6 45.8 51.6 45.6 54 43.2M58.4 41C61 42.4 64 41.6 65.4 39.6"/>
              <path class="m-frosting" d="M37.4 38.6C38.4 36.6 41.4 36.8 42 38.8 42.6 40.8 40.2 42.2 38.6 41.2 37.6 40.6 37 39.6 37.4 38.6ZM63.4 44.6C64.6 43.2 67 43.8 67.2 45.6 67.4 47.2 65.6 48.2 64.2 47.4 63.2 46.8 62.8 45.6 63.4 44.6ZM49.6 26.4C50.8 25.4 52.6 26.2 52.4 27.8 52.2 29.2 50.4 29.8 49.4 28.8 48.8 28.2 48.9 27 49.6 26.4Z"/>
              <path class="m-cherry-stem" d="M58.2 22.4C58.8 19.8 60.8 18.4 62.8 18.2"/>
              <circle class="m-cherry" cx="57.8" cy="25.2" r="3.3"/>
              <circle class="m-cherry-hi" cx="56.7" cy="24.1" r="0.95"/>
              <g class="m-peek">
                <circle class="m-face" cx="40.8" cy="38" r="5"/>
                <circle class="m-face" cx="63.2" cy="38" r="5"/>
                <ellipse class="m-eye-white" cx="40.8" cy="38.4" rx="3.6" ry="3.7"/>
                <ellipse class="m-eye-white" cx="63.2" cy="38.4" rx="3.6" ry="3.7"/>
                <circle class="m-pupil-dot" cx="41.6" cy="38.9" r="2"/>
                <circle class="m-pupil-dot" cx="62.4" cy="38.9" r="2"/>
                <path class="m-lash" d="M36.6 35 45 37.6M67.4 35 59 37.6"/>
              </g>
            </g>

            <g class="m-splat m-splat--water">
              <path class="m-water m-splash" d="M52 4.5C57 10.5 62 9.5 66 5.5 67 12.5 73 14.5 79 12.5 77 19.5 81 24.5 87 25.5 81 29.5 80 36.5 84 42.5 76 41.5 71 45.5 71 52.5 65 47.5 58 48.5 55 55.5 51 48.5 44 47.5 39 52.5 38 45.5 32 41.5 25 43.5 28 36.5 26 29.5 19 26.5 25 23.5 28 17.5 26 11.5 32 13.5 38 11.5 40 5.5 44 9.5 48 10.5 52 4.5Z"/>
              <path class="m-wet-hair" d="M36.4 20.4 37.8 30.2 41 21.6 43.6 32.4 46.6 22.4 49.6 30.4 52 24.4 54.4 30.4 57.4 22.4 60.4 32.4 63 21.6 66.2 30.2 67.6 20.4 52 16Z"/>
              <path class="m-water m-drop m-drop--1" d="M43.6 32.4C45.2 35 45.6 36.4 43.6 37.8 41.6 36.4 42 35 43.6 32.4Z"/>
              <path class="m-water m-drop m-drop--2" d="M60.4 32.4C62 35 62.4 36.4 60.4 37.8 58.4 36.4 58.8 35 60.4 32.4Z"/>
              <path class="m-water m-drop m-drop--3" d="M33.4 54.4C35 57 35.4 58.4 33.4 59.8 31.4 58.4 31.8 57 33.4 54.4Z"/>
              <path class="m-water m-drop m-drop--4" d="M70.6 54.4C72.2 57 72.6 58.4 70.6 59.8 68.6 58.4 69 57 70.6 54.4Z"/>
              <path class="m-water m-drop m-drop--5" d="M52 64.4C53.6 67 54 68.4 52 69.8 50 68.4 50.4 67 52 64.4Z"/>
            </g>

            <g class="m-splat m-splat--rose">
              <path class="m-stem" d="M39.4 60.6 66.4 57.8"/>
              <path class="m-leaf" d="M46.6 59.8Q49.2 55 53.6 56.6 51.4 60.6 46.6 59.8Z"/>
              <path class="m-leaf" d="M64.4 58.2 66.6 62.4 68.4 58.6Z"/>
              <circle class="m-rose" cx="69.6" cy="57" r="4.7"/>
              <path class="m-rose-line" d="M67.2 56.2C68.2 54.2 71.2 54.2 72 56.2 72.8 58.2 70.6 59.8 69 58.6 68 57.8 68.6 56.6 69.8 56.8"/>
            </g>`;
}

/** Free particles: not attached to his body, so they do not jump or lean with him. */
function fxArt() {
  return `
    ${times(3, (i) => `<g class="m-fly m-fly--card${i}">${CARD_ART}</g>`)}
    ${times(7, (i) => `<g class="m-fly m-fly--stream m-fly--s${i}">${CARD_ART}</g>`)}
    ${times(5, (i) => `<g class="m-fly m-fly--bill m-fly--b${i}">${BILL_ART}</g>`)}
    ${times(6, (i) => `<g class="m-spark m-spark--${i}"><path d="M0-4.8 1.15-1.15 4.8 0 1.15 1.15 0 4.8-1.15 1.15-4.8 0-1.15-1.15Z"/></g>`)}
    ${times(3, (i) => `<g class="m-note m-note--${i}"><ellipse cx="-1.8" cy="0" rx="2.2" ry="1.6" transform="rotate(-20 -1.8 0)"/><path d="M-0.2 0.2V-8.6L4.8-10V-7.2L0.9-6.1V0.2Z"/></g>`)}
    ${times(3, (i) => `<g class="m-heart m-heart--${i}"><path d="M0 3.6C-5.6-0.6-3.3-5.4 0-2.5 3.3-5.4 5.6-0.6 0 3.6Z"/></g>`)}
    ${times(3, (i) => `<g class="m-zzz m-zzz--${i}"><path d="M-2.8-3H2.8L-2.8 3H2.8"/></g>`)}
    ${times(3, (i) => `<g class="m-dot m-dot--${i}"><circle r="1"/></g>`)}
    <g class="m-bang"><path d="M0-7.4V0.4"/><circle cx="0" cy="4.2" r="1.4"/></g>
    <g class="m-sigh"><path d="M-4.2 1.6C-6 1.6-6.2-1.4-4.2-1.8-4-4.2-0.8-4.8 0.4-2.8 2.6-3.8 4.8-1.8 3.8 0.2 4.8 1.6 3.6 2.6 2.4 2.2 1.2 3.4-0.8 3.2-1.2 2Z"/></g>`;
}

function buildSvg(id) {
  return `
<svg class="mascot__svg" viewBox="0 0 104 160" overflow="visible" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-vest" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="m-stop-vest-a"/>
      <stop offset="1" class="m-stop-vest-b"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" class="m-stop-glow-a"/>
      <stop offset="1" class="m-stop-glow-b"/>
    </radialGradient>
    <clipPath id="${id}-face"><path d="${FACE_PATH}"/></clipPath>
    <clipPath id="${id}-eye-l"><ellipse cx="40.8" cy="37.6" rx="5.65" ry="6.35"/></clipPath>
    <clipPath id="${id}-eye-r"><ellipse cx="63.2" cy="37.6" rx="5.65" ry="6.35"/></clipPath>
  </defs>

  <ellipse class="m-glow" cx="52" cy="84" rx="58" ry="80" fill="url(#${id}-glow)"/>
  <ellipse class="m-shadow" cx="52" cy="155.4" rx="27" ry="3.4"/>

  <g class="m-all">
    <g class="m-leg m-leg--l">${legArt()}
    </g>
    <g transform="${MIRROR}"><g class="m-leg m-leg--r">${legArt()}
    </g></g>
    <path class="m-trouser m-hips" d="M28.4 105H75.6V116Q52 123.5 28.4 116Z"/>

    <g class="m-breath">
      <g class="m-upper">
        <g class="m-torso">
          <path class="m-skin-shade" d="M45.4 57H58.6V68.6Q52 71.6 45.4 68.6Z"/>
          <path class="m-shirt" d="M31 71.8C36.6 69.2 44 68.3 52 68.3 60 68.3 67.4 69.2 73 71.8 76 73.6 76.9 77.5 76.9 83L76.6 108H27.4L27.1 83C27.1 77.5 28 73.6 31 71.8Z"/>
          <path class="m-shirt-line" d="M52 74V92"/>
          <circle class="m-stud" cx="52" cy="79.4" r="0.8"/>
          <circle class="m-stud" cx="52" cy="85.2" r="0.8"/>
          <path class="m-vest" fill="url(#${id}-vest)" d="M39.8 68.6C35.4 69.2 31.8 70.4 29.4 72.2 26.8 74.3 26 78.2 25.8 83.4 25.5 91.2 25.3 99.2 26.4 106.2 26.9 109.2 27.8 111.8 28.6 113.4L42 112.6 46.2 118.8 52 113.4 57.8 118.8 62 112.6 75.4 113.4C76.2 111.8 77.1 109.2 77.6 106.2 78.7 99.2 78.5 91.2 78.2 83.4 78 78.2 77.2 74.3 74.6 72.2 72.2 70.4 68.6 69.2 64.2 68.6L52 92.4Z"/>
          <path class="m-vest-shade" d="M25.8 83.4C25.5 91.2 25.3 99.2 26.4 106.2 26.9 109.2 27.8 111.8 28.6 113.4L35.6 113C32.6 104 32 93 33 81.4 30.2 80.4 27.4 81 25.8 83.4Z"/>
          <path class="m-vest-shade m-vest-shade--r" d="M78.2 83.4C78.5 91.2 78.7 99.2 77.6 106.2 77.1 109.2 76.2 111.8 75.4 113.4L66.4 112.9C70.4 104 71.4 93 70.6 81.4 73.6 80.4 76.6 81 78.2 83.4Z"/>
          <path class="m-vest-line" d="M39.8 68.6 52 92.4 64.2 68.6"/>
          <path class="m-vest-line" d="M52 92.4V113.4"/>
          <path class="m-vest-hi" d="M43.4 78.6 49.4 90.2"/>
          <path class="m-vest-line m-vest-pocket" d="M32.8 101.4H42.4M61.6 101.4H71.2"/>
          <path class="m-chain" d="M52.8 103.6C55.4 109.6 61 109.4 64.6 102"/>
          <circle class="m-gold" cx="52" cy="97" r="1.5"/>
          <circle class="m-gold" cx="52" cy="103" r="1.5"/>
          <circle class="m-gold" cx="52" cy="109" r="1.5"/>
          <g class="m-boutonniere">
            <path class="m-leaf" d="M35.4 84.4Q32.2 86.4 31.8 90.2 35.8 89 36.6 85.4Z"/>
            <circle class="m-rose" cx="36.6" cy="81.8" r="3.3"/>
            <path class="m-rose-line" d="M35 81.2C35.8 79.8 37.8 79.8 38.4 81.2 38.9 82.6 37.4 83.6 36.4 82.8"/>
          </g>
          <path class="m-collar" d="M45.6 64.4 51.6 69.4 46.2 73.4 41.8 67.4Z"/>
          <path class="m-collar" d="M58.4 64.4 52.4 69.4 57.8 73.4 62.2 67.4Z"/>
          <g class="m-bowtie">
            <path class="m-gold" d="M50.8 70.3 41.3 65.5C40 64.9 39.1 65.6 39.1 66.9V74.1C39.1 75.4 40 76.1 41.3 75.5L50.8 71.3Z"/>
            <path class="m-gold" d="M53.2 70.3 62.7 65.5C64 64.9 64.9 65.6 64.9 66.9V74.1C64.9 75.4 64 76.1 62.7 75.5L53.2 71.3Z"/>
            <path class="m-gold-shade" d="M50.8 70.6 44.6 69.2 41 71.2 44.8 72.4 50.8 71.2ZM53.2 70.6 59.4 69.2 63 71.2 59.2 72.4 53.2 71.2Z"/>
            <rect class="m-gold-dark" x="49.2" y="67.6" width="5.6" height="5.8" rx="1.8"/>
            <path class="m-gold-hi" d="M41 67.4 46 69.6M63 67.4 58 69.6"/>
          </g>
        </g>

        <g class="m-headwrap">
          <g class="m-head">
            <ellipse class="m-face" cx="28.2" cy="38.8" rx="3.9" ry="5.1"/>
            <ellipse class="m-face" cx="75.8" cy="38.8" rx="3.9" ry="5.1"/>
            <path class="m-face-line" d="M27.5 36.8Q26 38.9 27.5 41.2M76.5 36.8Q78 38.9 76.5 41.2"/>
            <path class="m-face" d="${FACE_PATH}"/>
            <path class="m-face-side" d="M73.8 29C75.6 33 76.2 38.6 75.4 43.6 74.2 52.6 69.6 59.6 62.6 63 67.4 58.4 70.6 52.2 71.6 44.4 72.4 38.8 72.6 33.4 73.8 29Z"/>
            <path class="m-jaw" d="M33.4 54.6C37 61.4 44 65.2 52 65.2 60 65.2 67 61.4 70.6 54.6 66.6 60 59.8 62.8 52 62.8 44.2 62.8 37.4 60 33.4 54.6Z"/>
            <g clip-path="url(#${id}-face)"><path class="m-hair-cast" d="M31.4 30.4C33 27.4 35.6 24 38.6 22.2 42.4 20 48.4 21.6 52 25.8 55.6 21.6 61.6 20 65.4 22.2 68.4 24 71 27.4 72.6 30.4L78 12H26Z"/></g>
            <ellipse class="m-cheek m-cheek--l" cx="34.6" cy="47.2" rx="3.9" ry="2.6"/>
            <ellipse class="m-cheek m-cheek--r" cx="69.4" cy="47.2" rx="3.9" ry="2.6"/>

            <path class="m-hair" d="M29.6 38.6C25.8 23.6 31.4 7.6 50 5.6 68.8 3.6 79.6 17.6 74.4 38.6 74.2 33.6 73.4 29.6 71.6 26.6 69.6 23.4 67.2 20.4 64.2 19.6 60.4 18.6 55.4 20.4 52 24 48.6 20.4 43.6 18.6 39.8 19.6 36.8 20.4 34.4 23.4 32.4 26.6 30.6 29.6 29.8 33.6 29.6 38.6Z"/>
            <path class="m-hair-shine" d="M41.6 10.8C50.6 6.8 63.6 8.6 70 17" stroke-width="1.9"/>
            <path class="m-hair-shine m-hair-shine--b" d="M44.4 15C51.4 12.2 60.6 13.4 66 18.6" stroke-width="1.1"/>
            <path class="m-hair-shine m-hair-shine--b" d="M31.4 25.4C31 20 33.4 14.6 37.4 11.6" stroke-width="1.2"/>

            <g class="m-brow m-brow--l"><path d="M33.8 31.2C36.6 27.4 42.6 25.8 46.6 27.6 48 28.3 47.8 30.6 46.2 30.8 42.4 29.8 38.6 30.4 35.2 32.2 34 32.8 33.2 32.1 33.8 31.2Z"/></g>
            <g class="m-brow m-brow--r"><path d="M70.2 31.2C67.4 27.4 61.4 25.8 57.4 27.6 56 28.3 56.2 30.6 57.8 30.8 61.6 29.8 65.4 30.4 68.8 32.2 70 32.8 70.8 32.1 70.2 31.2Z"/></g>
            <path class="m-face-line m-eyebag" d="M37.6 45Q40.8 46.2 44 45M60 45Q63.2 46.2 66.4 45"/>

            <g class="m-eyes-open">
              <g class="m-eye m-eye--l">
                <ellipse class="m-eye-white" cx="40.8" cy="37.6" rx="5.3" ry="6"/>
                <g clip-path="url(#${id}-eye-l)">
                  <g class="m-pupil"><circle class="m-pupil-dot" cx="41.1" cy="38.5" r="2.9"/><circle class="m-pupil-hi" cx="40.1" cy="37.4" r="1"/></g>
                  <g class="m-lid"><rect class="m-lid-skin" x="34" y="22" width="13.6" height="13.3"/><path class="m-lash" d="M34 35.3H47.6"/></g>
                </g>
              </g>
              <g class="m-eye m-eye--r">
                <ellipse class="m-eye-white" cx="63.2" cy="37.6" rx="5.3" ry="6"/>
                <g clip-path="url(#${id}-eye-r)">
                  <g class="m-pupil"><circle class="m-pupil-dot" cx="63.5" cy="38.5" r="2.9"/><circle class="m-pupil-hi" cx="62.5" cy="37.4" r="1"/></g>
                  <g class="m-lid"><rect class="m-lid-skin" x="56.4" y="22" width="13.6" height="13.3"/><path class="m-lash" d="M56.4 35.3H70"/></g>
                </g>
              </g>
            </g>
            <path class="m-eyes-alt m-eyes-happy" d="M36 39.8Q40.8 33.2 45.6 39.8M58.4 39.8Q63.2 33.2 68 39.8"/>
            <path class="m-eyes-alt m-eyes-shut" d="M36 37.2Q40.8 41.6 45.6 37.2M58.4 37.2Q63.2 41.6 68 37.2"/>
            <path class="m-eyes-alt m-eyes-squeeze" d="M36.6 34.6 44.8 37.8 36.6 41M67.4 34.6 59.2 37.8 67.4 41"/>

            <path class="m-nose" d="M52 39.4C54.7 39.4 57 42.5 57 45.6 57 48.5 54.8 49.9 52 49.9 49.2 49.9 47 48.5 47 45.6 47 42.5 49.3 39.4 52 39.4Z"/>
            <path class="m-nose-shade" d="M47.2 46.6C47.8 48.9 49.8 49.9 52 49.9 54.2 49.9 56.2 48.9 56.8 46.6 55.6 48 53.9 48.6 52 48.6 50.1 48.6 48.4 48 47.2 46.6Z"/>
            <ellipse class="m-nose-hi" cx="50.4" cy="43.6" rx="1.6" ry="1.2"/>

            <path class="m-face-line m-chin" d="M49.2 63Q52 64 54.8 63"/>
            <g class="m-mouths">
              <g class="m-mouth m-mouth--smirk">
                <path class="m-lip" d="M46.6 58Q52.8 62 58.6 57.2"/>
                <path class="m-face-line" d="M58.4 55.6Q60.2 56.6 59.6 58.6"/>
              </g>
              <g class="m-mouth m-mouth--flat">
                <path class="m-lip" d="M47.6 59.4 56.6 58.8"/>
              </g>
              <g class="m-mouth m-mouth--frown">
                <path class="m-lip" d="M46.8 61Q52 57 57.2 61"/>
              </g>
              <g class="m-mouth m-mouth--oh">
                <ellipse class="m-mouth-in" cx="52" cy="59.3" rx="3.2" ry="3.4"/>
              </g>
              <g class="m-mouth m-mouth--open">
                <path class="m-mouth-in" d="M46.2 56Q52 54.2 57.8 56 58.6 62.9 52 62.9 45.4 62.9 46.2 56Z"/>
                <path class="m-teeth" d="M47.2 56Q52 54.6 56.8 56L56.5 57.6Q52 56.4 47.5 57.6Z"/>
                <ellipse class="m-tongue" cx="52" cy="61.1" rx="3.2" ry="1.5"/>
              </g>
              <g class="m-mouth m-mouth--grin">
                <path class="m-mouth-in" d="M44.6 55.8Q52 57.6 59.4 55.8 59.4 63.3 52 63.3 44.6 63.3 44.6 55.8Z"/>
                <path class="m-teeth" d="M45.4 56.3Q52 58 58.6 56.3L58.3 58.5Q52 59.8 45.7 58.5Z"/>
                <ellipse class="m-tongue" cx="52" cy="61.9" rx="3.4" ry="1.3"/>
              </g>
              <g class="m-mouth m-mouth--wail">
                <path class="m-mouth-in" d="M45 62.8C45.4 57.2 48.4 54.6 52 54.6 55.6 54.6 58.6 57.2 59 62.8 56.8 61.4 54.4 61 52 61 49.6 61 47.2 61.4 45 62.8Z"/>
                <ellipse class="m-tongue" cx="52" cy="59.6" rx="2.6" ry="1.2"/>
              </g>
              <g class="m-mouth m-mouth--grit">
                <rect class="m-teeth m-teeth--grit" x="46.2" y="56.4" width="11.6" height="5" rx="1.6"/>
                <path class="m-grit-line" d="M49.1 56.6V61.2M52 56.6V61.2M54.9 56.6V61.2M46.4 58.9H57.6"/>
              </g>
            </g>

            <g class="m-stache">
              <path class="m-hair" d="M52 49.4C49.6 47.2 44 47 40.6 49.6 38 51.6 35.3 51.3 34.1 48.6 33.7 47.6 33.5 46.8 33.1 46.2 30.8 51.6 35 57.5 41.6 56.5 46.2 55.8 50.2 53.7 52 52.6 53.8 53.7 57.8 55.8 62.4 56.5 69 57.5 73.2 51.6 70.9 46.2 70.5 46.8 70.3 47.6 69.9 48.6 68.7 51.3 66 51.6 63.4 49.6 60 47 54.4 47.2 52 49.4Z"/>
              <path class="m-hair-shine m-hair-shine--b" d="M41 50.8C43.6 49.2 47.4 49.4 49.8 50.8M54.2 50.8C56.6 49.4 60.4 49.2 63 50.8" stroke-width="0.9"/>
            </g>
${headFxArt()}
          </g>
        </g>

        <g class="m-arm m-arm--l">${armArt()}
        </g>
        <g transform="${MIRROR}"><g class="m-arm m-arm--r">${armArt()}
        </g></g>

        <g class="m-tears">
          <path class="m-tear-stream" d="M36.2 40.4C29 30.6 20.6 33.6 18.4 45 17.4 50 17.2 56 17.2 62"/>
          <path class="m-tear-stream" d="M67.8 40.4C75 30.6 83.4 33.6 85.6 45 86.6 50 86.8 56 86.8 62"/>
          <path class="m-tear-drop m-tear-drop--1" d="M17.2 62C19 65 19.4 66.6 17.2 68.2 15 66.6 15.4 65 17.2 62Z"/>
          <path class="m-tear-drop m-tear-drop--2" d="M86.8 62C88.6 65 89 66.6 86.8 68.2 84.6 66.6 85 65 86.8 62Z"/>
          <path class="m-tear-drop m-tear-drop--3" d="M21.2 56C22.8 58.6 23.2 60 21.2 61.4 19.2 60 19.6 58.6 21.2 56Z"/>
          <path class="m-tear-drop m-tear-drop--4" d="M82.8 56C84.4 58.6 84.8 60 82.8 61.4 80.8 60 81.2 58.6 82.8 56Z"/>
        </g>
      </g>
    </g>
  </g>

  <g class="m-fx">${fxArt()}
  </g>
</svg>`;
}

/* ==========================================================================
   Small helpers
   ========================================================================== */

const rand = (min, max) => min + Math.random() * (max - min);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const lineText = (entry) => (Array.isArray(entry) ? entry[0] : entry);
const lineAnim = (entry) => (Array.isArray(entry) ? entry[1] : null);

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Timers that can be cancelled by group and paused as a whole (freeze). */
function createClock() {
  const timers = new Set();
  let paused = false;
  const arm = (t) => {
    t.since = Date.now();
    t.id = setTimeout(() => {
      timers.delete(t);
      t.fn();
    }, t.left);
  };
  return {
    after(ms, fn, group) {
      const t = { fn, group, left: Math.max(0, ms), since: 0, id: 0 };
      timers.add(t);
      if (!paused) arm(t);
      return t;
    },
    cancel(group) {
      for (const t of [...timers]) {
        if (group !== undefined && t.group !== group) continue;
        clearTimeout(t.id);
        timers.delete(t);
      }
    },
    pause() {
      if (paused) return;
      paused = true;
      for (const t of timers) {
        clearTimeout(t.id);
        t.left = Math.max(0, t.left - (Date.now() - t.since));
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const t of timers) arm(t);
    },
  };
}

let instances = 0;

/* ==========================================================================
   createMascot
   ========================================================================== */

/**
 * @param {{ audio?: { play(name: string): void }, getContext?: () => ({ name?: string, debt?: number }),
 *           reducedMotion?: boolean }} [opts]
 *   reducedMotion forces the reduced-motion behaviour on or off (default: follow the OS setting).
 * @returns {HTMLElement} element with class "mascot" and say / play / hit / destroy
 */
export function createMascot(opts = {}) {
  const audio = opts && opts.audio && typeof opts.audio.play === 'function' ? opts.audio : null;
  const getContext = opts && typeof opts.getContext === 'function' ? opts.getContext : null;
  const forcedReduced = opts && typeof opts.reducedMotion === 'boolean' ? opts.reducedMotion : null;

  instances += 1;
  const figure = el('div', {
    class: 'mascot__figure',
    attrs: { role: 'button', tabindex: '0', 'aria-label': 'Don Fortunato, el crupier. Tocalo para que cuente un chiste.' },
  });
  figure.innerHTML = buildSvg(`mascot${instances}`); // static, trusted markup authored above

  const typed = el('span', { class: 'mascot__typed' });
  const rest = el('span', { class: 'mascot__rest' });
  const spoken = el('span', { class: 'mascot__sr' });
  const bubble = el(
    'div',
    { class: 'mascot__bubble', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } },
    el('span', { class: 'mascot__name', attrs: { 'aria-hidden': 'true' } }, 'Don Fortunato'),
    el('span', { class: 'mascot__line', attrs: { 'aria-hidden': 'true' } }, typed, rest),
    spoken
  );
  const root = el('div', { class: 'mascot' }, figure, bubble);

  const clock = createClock();
  const bags = new Map();
  let destroyed = false;
  let reduced = false;
  let asleep = false;
  let frozen = false;
  let lastLine = '';
  let lastAnim = '';
  let lastSpokeAt = 0; // any line, his own jokes included
  let lastTapAt = 0;
  let taps = [];

  /* ---- context, sound ------------------------------------------------------ */

  function context() {
    if (!getContext) return {};
    try {
      const ctx = getContext();
      return ctx && typeof ctx === 'object' ? ctx : {};
    } catch {
      return {};
    }
  }

  function playerName() {
    const raw = context().name;
    if (typeof raw !== 'string') return '';
    const name = raw.replace(/\s+/g, ' ').trim();
    return Array.from(name).slice(0, 18).join('');
  }

  function sound(name) {
    if (!audio) return;
    try {
      audio.play(name);
    } catch {
      /* sound must never break him */
    }
  }

  function syncReduced() {
    reduced = forcedReduced !== null ? forcedReduced : prefersReducedMotion();
    root.classList.toggle('is-reduced', reduced);
    return reduced;
  }

  /* ---- face, hands, props --------------------------------------------------- */

  function setLook(patch) {
    if (!patch) return;
    const data = root.dataset;
    if (patch.eyes) data.eyes = patch.eyes;
    if (patch.brows) data.brows = patch.brows;
    if (patch.mouth) data.mouth = patch.mouth;
    if (patch.hands) {
      if (patch.hands.l) data.handL = patch.hands.l;
      if (patch.hands.r) data.handR = patch.hands.r;
    }
    if (patch.props) {
      if ('l' in patch.props) data.propL = patch.props.l || 'none';
      if ('r' in patch.props) data.propR = patch.props.r || 'none';
    }
    if (patch.gaze) {
      root.style.setProperty('--m-look-x', String(patch.gaze[0]));
      root.style.setProperty('--m-look-y', String(patch.gaze[1]));
    }
    if ('flush' in patch) root.classList.toggle('is-flushed', Boolean(patch.flush));
    if ('blush' in patch) root.classList.toggle('is-blushing', Boolean(patch.blush));
  }

  function restLook() {
    setLook({
      ...(asleep ? ANIMS.sleep.look : REST_FACE),
      hands: { l: 'rest', r: 'rest' },
      props: { l: null, r: null },
      gaze: [0, 0],
      flush: false,
      blush: false,
    });
  }

  /* ---- animations ----------------------------------------------------------- */

  function stopAnim() {
    clock.cancel('anim');
    root.removeAttribute('data-anim');
  }

  /**
   * @param {string} name
   * @param {{ then?: () => void, loud?: boolean }} [how] loud = with his own sound effects
   */
  function startAnim(name, how = {}) {
    const def = ANIMS[name];
    if (!def || destroyed) return;
    if (name === 'sleep') {
      fallAsleep();
      return;
    }
    wake();
    stopAnim();
    restLook();
    void figure.offsetWidth; // restart the keyframes when the same animation repeats
    root.style.setProperty('--m-dur', `${def.ms}ms`);
    root.dataset.anim = name;
    lastAnim = name;
    setLook({ flush: false, blush: false, ...def.look });
    for (const [at, patch] of def.cues || []) clock.after(at, () => setLook(patch), 'anim');
    if (how.loud && !reduced) for (const [at, sfx] of def.sfx || []) clock.after(at, () => sound(sfx), 'anim');
    clock.after(def.ms, () => {
      root.removeAttribute('data-anim');
      restLook();
      if (typeof how.then === 'function') how.then();
    }, 'anim');
  }

  /* ---- sleep ---------------------------------------------------------------- */

  function armDoze() {
    clock.cancel('doze');
    clock.after(DOZE_MS, function doze() {
      // never mid-sentence: wait for the bubble and the gesture to finish
      if (root.classList.contains('is-speaking') || root.dataset.anim || root.dataset.hit) clock.after(6000, doze, 'doze');
      else fallAsleep();
    }, 'doze');
  }

  function fallAsleep() {
    if (asleep || destroyed) return;
    stopAnim();
    asleep = true;
    root.classList.add('is-asleep');
    restLook();
  }

  function wake() {
    if (!asleep) return false;
    asleep = false;
    root.classList.remove('is-asleep');
    root.classList.add('is-waking');
    clock.cancel('wake');
    clock.after(560, () => root.classList.remove('is-waking'), 'wake');
    restLook();
    return true;
  }

  /* ---- speech --------------------------------------------------------------- */

  /** Next line of a pool: a shuffled bag per pool, never the line that was just said. */
  function draw(key, pool) {
    const name = playerName();
    const usable = name ? pool : pool.filter((entry) => !lineText(entry).includes('{name}'));
    if (!usable.length) return ['', null];
    const text = (entry) => lineText(entry).replace(/\{name\}/g, name);
    const bagKey = `${key}|${name ? 1 : 0}`;
    let bag = bags.get(bagKey);
    if (!bag || !bag.length) {
      bag = shuffled(usable);
      bags.set(bagKey, bag);
    }
    let entry = bag.pop();
    if (text(entry) === lastLine && usable.length > 1) {
      if (!bag.length) bag.push(...shuffled(usable.filter((other) => other !== entry)));
      const other = bag.pop();
      bag.unshift(entry);
      entry = other;
    }
    return [text(entry), lineAnim(entry)];
  }

  function showLine(line) {
    clock.cancel('speech');
    lastLine = line;
    lastSpokeAt = Date.now();
    const chars = Array.from(line);
    spoken.textContent = `Don Fortunato: ${line}`;
    root.classList.remove('is-talking');
    root.classList.add('is-speaking');

    const hold = Math.min(9000, BUBBLE_MS + Math.max(0, chars.length - 70) * 50);
    clock.after(hold, () => root.classList.remove('is-speaking', 'is-talking'), 'speech');

    if (reduced) {
      typed.textContent = line;
      rest.textContent = '';
      return;
    }
    // quick typewriter: the untyped part is already laid out (invisible), so the
    // bubble has its final size from the first frame. Progress follows the wall
    // clock, so throttled timers (a background tab) cannot stretch it.
    const total = Math.max(240, Math.min(1500, chars.length * 22));
    const startedAt = Date.now();
    typed.textContent = '';
    rest.textContent = line;
    root.classList.add('is-talking');
    const tick = () => {
      const shown = Math.min(chars.length, Math.max(1, Math.ceil((chars.length * (Date.now() - startedAt)) / total)));
      typed.textContent = chars.slice(0, shown).join('');
      rest.textContent = chars.slice(shown).join('');
      if (shown < chars.length) clock.after(30, tick, 'speech');
      else clock.after(180, () => root.classList.remove('is-talking'), 'speech');
    };
    clock.after(30, tick, 'speech');
  }

  /**
   * Say a line and play its gesture.
   * @param {string} kind
   * @param {string} [text] used verbatim when given
   * @param {{ anim?: string, own?: boolean, loud?: boolean }} [how]
   *   own = one of his idle jokes (does not count as activity); loud = with sound effects
   */
  function speak(kind, text, how = {}) {
    if (destroyed) return '';
    syncReduced();
    let key = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(LINES, kind) ? kind : null;
    const given = typeof text === 'string' || typeof text === 'number' ? String(text).replace(/\s+/g, ' ').trim() : '';
    const custom = Array.from(given).length > MAX_TEXT ? `${Array.from(given).slice(0, MAX_TEXT - 1).join('').trimEnd()}…` : given;

    // owing money, a loss sometimes earns a debt line instead
    if (!custom && (key === 'lose' || key === 'bust') && Number(context().debt) > 0 && Math.random() < 0.45) key = 'debt';

    let line = custom;
    let anim = how.anim || null;
    if (!line) {
      const [picked, hint] = draw(key || 'neutral', key ? LINES[key] : NEUTRAL);
      line = picked;
      if (!anim) anim = hint;
    }
    if (!line) return '';

    if (!how.own) armDoze();
    wake();
    showLine(line);

    const choices = (key && KIND_ANIMS[key]) || ['talk'];
    if (anim && ANIMS[anim]) {
      startAnim(anim, { loud: how.loud });
    } else if (key && IN_SEQUENCE.has(key)) {
      startAnim(choices[0], {
        // the follow-up only if nothing else took over meanwhile
        then: () => {
          if (!root.dataset.anim && !root.dataset.hit && lastLine === line) startAnim(choices[1]);
        },
      });
    } else {
      const fresh = choices.filter((name) => name !== lastAnim);
      startAnim(pickOne(fresh.length ? fresh : choices), { loud: how.loud });
    }
    return line;
  }

  /* ---- things thrown at him -------------------------------------------------- */

  function clearHit() {
    clock.cancel('hit');
    root.removeAttribute('data-hit');
    root.classList.remove('is-cleaning');
  }

  function hit(item) {
    if (destroyed) return;
    syncReduced();
    const what = HIT_ITEMS.includes(item) ? item : 'tomato';
    armDoze();
    wake();
    stopAnim();
    clearHit();
    clock.cancel('rose');
    root.classList.remove('has-rose');
    restLook();
    void figure.offsetWidth;
    root.dataset.hit = what;

    if (what === 'rose') {
      setLook({ eyes: 'wide', brows: 'up', mouth: 'grin' });
      clock.after(300, () => {
        showLine(draw('hit-rose', HIT_LINES.rose)[0]);
        startAnim('blush');
      }, 'hit');
      clock.after(300 + ANIMS.blush.ms + 700, () => {
        // tidies up: the rose goes to his buttonhole for a while
        root.removeAttribute('data-hit');
        root.classList.add('has-rose');
        clock.after(45000, () => root.classList.remove('has-rose'), 'rose');
      }, 'hit');
      return;
    }

    setLook({ eyes: 'squeeze', brows: 'up', mouth: 'oh' });
    clock.after(480, () => {
      showLine(draw(`hit-${what}`, HIT_LINES[what])[0]);
      startAnim('angry');
    }, 'hit');
    clock.after(480 + ANIMS.angry.ms + 300, () => {
      startAnim('wipe');
      clock.after(ANIMS.wipe.ms * 0.34, () => root.classList.add('is-cleaning'), 'hit');
      clock.after(ANIMS.wipe.ms * 0.34 + 800, () => {
        root.removeAttribute('data-hit');
        root.classList.remove('is-cleaning');
      }, 'hit');
    }, 'hit');
  }

  /* ---- a life of his own ----------------------------------------------------- */

  function blink() {
    if (reduced || asleep || destroyed) return;
    root.classList.add('is-blink');
    clock.after(120, () => root.classList.remove('is-blink'), 'blink');
  }

  function glance() {
    if (root.dataset.anim || root.dataset.hit) return; // the gesture owns his eyes
    const spots = [[0, 0], [0, 0], [0, 0], [1.6, 0.2], [-1.6, 0.2], [1.3, -1.1], [-1.3, -1.1], [0.7, 1.2], [1.8, 0.7]];
    setLook({ gaze: pickOne(spots) });
  }

  function live() {
    clock.cancel('life');
    const beat = () => {
      syncReduced();
      if (!reduced && !asleep) {
        blink();
        if (Math.random() < 0.6) glance();
        if (Math.random() < 0.18) clock.after(250, blink, 'life'); // the odd double blink
      }
      clock.after(rand(2200, 5200), beat, 'life');
    };
    clock.after(rand(900, 2200), beat, 'life');

    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const busy = () => Boolean(root.dataset.anim || root.dataset.hit || root.classList.contains('is-speaking'));

    // a joke of his own every 40-70 s, if the page is visible and nothing was said lately
    const joke = () => {
      const quiet = Date.now() - lastSpokeAt >= IDLE_QUIET_MS;
      if (visible() && quiet && !asleep && !busy()) speak('idle', undefined, { own: true });
      clock.after(rand(IDLE_MIN_MS, IDLE_MAX_MS), joke, 'life');
    };
    clock.after(rand(IDLE_MIN_MS, IDLE_MAX_MS), joke, 'life');

    // and now and then he twirls his moustache or straightens his bow tie
    const fidget = () => {
      if (visible() && !reduced && !asleep && !busy()) startAnim(pickOne(FIDGETS));
      clock.after(rand(FIDGET_MIN_MS, FIDGET_MAX_MS), fidget, 'life');
    };
    clock.after(rand(FIDGET_MIN_MS, FIDGET_MAX_MS), fidget, 'life');
  }

  /* ---- taps ------------------------------------------------------------------ */

  function tap() {
    if (destroyed || frozen) return;
    const now = Date.now();
    if (now - lastTapAt < 420) return;
    lastTapAt = now;
    taps = taps.filter((at) => now - at < 7000);
    taps.push(now);
    sound('click');
    syncReduced();
    armDoze();
    if (asleep) {
      wake();
      showLine(draw('woke', WOKE_LINES)[0]);
      startAnim('shrug');
      return;
    }
    if (taps.length >= 6) {
      taps = [];
      clearHit();
      showLine(draw('poke', POKE_LINES)[0]);
      startAnim('angry');
      return;
    }
    speak('idle', undefined, { anim: pickOne(TAP_ANIMS.filter((name) => name !== lastAnim)), loud: true });
  }

  const onClick = () => tap();
  const onKey = (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    if (!ev.repeat) tap();
  };
  figure.addEventListener('click', onClick);
  figure.addEventListener('keydown', onKey);

  /* ---- public API ------------------------------------------------------------- */

  root.say = (kind, text) => speak(kind, text);

  root.play = (anim) => {
    if (destroyed || !Object.prototype.hasOwnProperty.call(ANIMS, anim)) return;
    syncReduced();
    if (anim !== 'sleep') armDoze();
    startAnim(anim);
  };

  root.hit = hit;

  /** Dev helper: pause / resume every keyframe and timer so a pose can be inspected. */
  root.freeze = (on = true) => {
    frozen = Boolean(on);
    root.classList.toggle('is-frozen', frozen);
    if (frozen) clock.pause();
    else clock.resume();
  };

  root.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clock.cancel();
    figure.removeEventListener('click', onClick);
    figure.removeEventListener('keydown', onKey);
    root.remove();
  };

  syncReduced();
  restLook();
  armDoze();
  live();
  return root;
}
