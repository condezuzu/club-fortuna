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
 *                            typed out, plus an animation that fits the kind
 *   mascot.play(anim)        a named animation without speech
 *   mascot.hit(item)         'tomato' | 'cake' | 'rose' | 'water' thrown at him
 *   mascot.destroy()         stops every timer and listener, removes the element
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
   face   expression held while it plays: eyes / brows / mouth
   hands  hand shapes: l / r (screen left / screen right)
   props  things he holds: l / r
   cues   [ms, patch] changes applied on the way
   ========================================================================== */

const REST_FACE = { eyes: 'open', brows: 'smug', mouth: 'smirk' };

const ANIMS = {
  talk: { ms: 1700, face: { brows: 'up' }, hands: { r: 'spread' } },
  laugh: { ms: 2000, face: { eyes: 'happy', brows: 'up', mouth: 'grin' } },
  shrug: { ms: 1900, face: { brows: 'up', mouth: 'flat' }, hands: { l: 'spread', r: 'spread' } },
  cheer: { ms: 1900, face: { eyes: 'happy', brows: 'up', mouth: 'grin' }, hands: { l: 'spread', r: 'spread' } },
  facepalm: {
    ms: 2400,
    face: { eyes: 'wide', brows: 'sad', mouth: 'oh' },
    hands: { l: 'fist', r: 'spread' },
    cues: [[330, { eyes: 'shut', mouth: 'frown' }]],
  },
  point: { ms: 1900, face: { brows: 'skeptic' }, hands: { l: 'fist', r: 'point' } },
  deal: { ms: 2100, face: { brows: 'up' }, props: { l: 'deck' } },
  shuffle: { ms: 2300, face: { brows: 'up', mouth: 'grin' }, props: { l: 'half', r: 'half' } },
  bow: { ms: 2200, face: { eyes: 'shut', brows: 'up' }, hands: { r: 'spread' } },
  dance: { ms: 3200, face: { eyes: 'happy', brows: 'up', mouth: 'grin' }, hands: { l: 'point', r: 'point' } },
  cry: { ms: 2700, face: { eyes: 'squeeze', brows: 'sad', mouth: 'wail' }, hands: { l: 'fist', r: 'fist' } },
  angry: { ms: 2100, face: { eyes: 'narrow', brows: 'angry', mouth: 'grit' }, hands: { l: 'fist', r: 'fist' }, flush: true },
  wipe: { ms: 2100, face: { eyes: 'shut', brows: 'sad', mouth: 'flat' }, props: { r: 'hanky' } },
  count: { ms: 2500, face: { brows: 'up' }, props: { l: 'bills' } },
  wave: { ms: 1900, face: { brows: 'up', mouth: 'grin' }, hands: { r: 'spread' } },
  sleep: { ms: 0, face: { eyes: 'shut', brows: 'sad', mouth: 'oh' } },
  think: { ms: 2500, face: { brows: 'skeptic', mouth: 'flat' }, hands: { r: 'point' } },
  blush: { ms: 2400, face: { eyes: 'happy', brows: 'sad', mouth: 'grin' }, hands: { r: 'spread' } },
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
const TAP_ANIMS = ['laugh', 'shrug', 'point', 'deal', 'shuffle', 'wave', 'think', 'count', 'bow', 'dance', 'cheer'];

const HIT_ITEMS = ['tomato', 'cake', 'rose', 'water'];

const BUBBLE_MS = 4500;        // how long a line stays up
const IDLE_MIN_MS = 40000;     // idle jokes: every 40-70 s ...
const IDLE_MAX_MS = 70000;
const IDLE_QUIET_MS = 20000;   // ... if nothing was said in the last 20 s
const DOZE_MS = 180000;        // dozes off after 3 minutes without a say()

/* ==========================================================================
   The drawing (viewBox 0 0 104 160, feet on y = 156)
   Arms and legs are authored once, in the "screen-left" frame; the right-hand
   copies live inside a mirroring group, so one set of pivots and one sign
   convention (positive rotation = outwards) serves both sides.
   ========================================================================== */

const MIRROR = 'matrix(-1 0 0 1 104 0)';

function handArt() {
  return `
          <g class="m-hand">
            <g class="m-hand__v m-hand__v--rest">
              <path class="m-skin" d="M17.4 111.6C16.8 115.6 16.9 119.8 18 122.4 19 124.5 21.6 125.3 23.8 124.7 26.2 124.1 27.5 121.5 27.5 118.6 27.5 116.2 27.3 113.9 27.1 111.6Z"/>
              <path class="m-skin" d="M26.3 113.2C28.8 113.7 30.2 116 29.8 118.2 29.5 119.7 27.9 120.1 27.1 118.8 26.6 117.1 26.3 115 26.3 113.2Z"/>
              <path class="m-skin-line" d="M19.9 120.8V123.8M22.3 121.3V124.5M24.7 120.8V123.7"/>
              <path class="m-skin-line" d="M26.7 114.4C26.9 116 27 117.4 27.2 118.6"/>
            </g>
            <g class="m-hand__v m-hand__v--spread">
              <path class="m-finger" d="M25.2 119.2 27.7 125.6" stroke-width="2.7"/>
              <path class="m-finger" d="M23.3 120.4 24 127.2" stroke-width="2.7"/>
              <path class="m-finger" d="M21.2 120.4 20.4 126.8" stroke-width="2.6"/>
              <path class="m-finger" d="M19.3 119.2 17 124.2" stroke-width="2.4"/>
              <path class="m-finger" d="M26.4 115.2 31.2 117.6" stroke-width="2.9"/>
              <ellipse class="m-skin" cx="22.4" cy="116.8" rx="5.4" ry="5.3"/>
              <path class="m-skin-line" d="M19.6 116.4C21.2 118 23.8 118.2 25.4 116.8"/>
            </g>
            <g class="m-hand__v m-hand__v--point">
              <path class="m-finger" d="M24.8 118.4 25 128.6" stroke-width="3"/>
              <path class="m-skin" d="M17.2 111.6H27.3V119C27.3 121.5 25.5 122.8 23 122.8H21.2C18.8 122.8 17 121.4 17 119Z"/>
              <path class="m-skin-line" d="M19.5 119.6V122.4M21.9 119.9V122.7"/>
              <path class="m-skin" d="M26.4 113.4C29.2 114 29.8 117.4 27.6 119.2 26.6 120 25.4 119.4 25.6 118.2Z"/>
              <path class="m-skin-line" d="M26.6 114.6C28.2 115.4 28.4 117.4 27 118.6"/>
            </g>
            <g class="m-hand__v m-hand__v--fist">
              <path class="m-skin" d="M16.8 111.6H27.6V118.6C27.6 121.8 25.3 123.6 22.2 123.6 19.1 123.6 16.6 121.8 16.6 118.6Z"/>
              <path class="m-skin-line" d="M19.3 119.4V122.6M21.9 119.8V123.2M24.5 119.4V122.6"/>
              <path class="m-skin" d="M26.6 114C29.4 114.4 30 118 27.8 119.4 26.8 120 25.6 119.4 25.8 118.2Z"/>
              <path class="m-skin-line" d="M26.8 115C28.4 115.6 28.6 117.8 27.2 118.8"/>
            </g>
            <g class="m-prop m-prop--deck" transform="rotate(64 22.4 117)">
              <rect class="m-card-edge" x="16.9" y="106.6" width="10.6" height="14.6" rx="1.5"/>
              <rect class="m-card-face" x="17.4" y="106" width="10.2" height="14" rx="1.4"/>
              <rect class="m-card-back" x="18.7" y="107.3" width="7.6" height="11.4" rx="0.8"/>
              <path class="m-card-deco" d="M22.5 110.2 24.3 113 22.5 115.8 20.7 113Z"/>
              <path class="m-finger" d="M18.2 121.4 26.8 121.4" stroke-width="2.6"/>
            </g>
            <g class="m-prop m-prop--half" transform="rotate(38 22.4 117)">
              <rect class="m-card-edge" x="17.4" y="110.2" width="10.4" height="13.6" rx="1.5"/>
              <rect class="m-card-face" x="17.8" y="109.6" width="10" height="13.2" rx="1.4"/>
              <rect class="m-card-back" x="19" y="110.8" width="7.6" height="10.8" rx="0.8"/>
              <path class="m-finger" d="M17.6 118.2 20 118.4" stroke-width="2.4"/>
            </g>
            <g class="m-prop m-prop--bills" transform="rotate(66 22.4 117)">
              <rect class="m-bill m-bill--back" x="15.6" y="104.2" width="13.6" height="8.4" rx="1" transform="rotate(-9 22.4 112)"/>
              <rect class="m-bill" x="15.6" y="105.6" width="13.6" height="8.4" rx="1"/>
              <ellipse class="m-bill-mark" cx="22.4" cy="109.8" rx="2.4" ry="2.1"/>
              <path class="m-finger" d="M18.2 115.4 26.6 115.4" stroke-width="2.6"/>
            </g>
            <g class="m-prop m-prop--hanky">
              <path class="m-hanky" d="M14.4 113.6C17 110.2 23.6 109.6 28 111.8 31.6 113.8 32.8 119.6 30.4 123.2 28.2 126.4 22.4 128 18 126.2 13.4 124.2 11.6 117.6 14.4 113.6Z"/>
              <path class="m-hanky-line" d="M17.4 115.8C20 114.4 24.6 114.8 27.4 116.8M17 120.6C20 119.6 24.4 120.2 27.6 122"/>
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

function buildSvg(id) {
  return `
<svg class="mascot__svg" viewBox="0 0 104 160" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-vest" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="m-stop-vest-a"/>
      <stop offset="1" class="m-stop-vest-b"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" class="m-stop-glow-a"/>
      <stop offset="1" class="m-stop-glow-b"/>
    </radialGradient>
    <clipPath id="${id}-face"><path d="M30.2 29C30.2 15.5 39.5 9.5 52 9.5 64.5 9.5 73.8 15.5 73.8 29 75.6 33 76.2 38.6 75.4 43.6 74.2 52.6 69.6 59.6 62.6 63 59.4 64.5 55.8 65.2 52 65.2 48.2 65.2 44.6 64.5 41.4 63 34.4 59.6 29.8 52.6 28.6 43.6 27.8 38.6 28.4 33 30.2 29Z"/></clipPath>
    <clipPath id="${id}-eye-l"><ellipse cx="41" cy="37.8" rx="5.35" ry="6.05"/></clipPath>
    <clipPath id="${id}-eye-r"><ellipse cx="63" cy="37.8" rx="5.35" ry="6.05"/></clipPath>
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
          <path class="m-shirt" d="M30 71.4C36 68.8 44 67.9 52 67.9 60 67.9 68 68.8 74 71.4 77.4 73.3 78.4 77.5 78.4 83L78 108H26L25.6 83C25.6 77.5 26.6 73.3 30 71.4Z"/>
          <path class="m-shirt-line" d="M52 74V92"/>
          <circle class="m-stud" cx="52" cy="79.4" r="0.8"/>
          <circle class="m-stud" cx="52" cy="85.2" r="0.8"/>
          <path fill="url(#${id}-vest)" d="M39.8 68.6C35.4 69.2 31.8 70.4 29.4 72.2 26.8 74.3 26 78.2 25.8 83.4 25.5 91.2 25.3 99.2 26.4 106.2 26.9 109.2 27.8 111.8 28.6 113.4L42 112.6 46.2 118.8 52 113.4 57.8 118.8 62 112.6 75.4 113.4C76.2 111.8 77.1 109.2 77.6 106.2 78.7 99.2 78.5 91.2 78.2 83.4 78 78.2 77.2 74.3 74.6 72.2 72.2 70.4 68.6 69.2 64.2 68.6L52 92.4Z"/>
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
            <path class="m-face" d="M30.2 29C30.2 15.5 39.5 9.5 52 9.5 64.5 9.5 73.8 15.5 73.8 29 75.6 33 76.2 38.6 75.4 43.6 74.2 52.6 69.6 59.6 62.6 63 59.4 64.5 55.8 65.2 52 65.2 48.2 65.2 44.6 64.5 41.4 63 34.4 59.6 29.8 52.6 28.6 43.6 27.8 38.6 28.4 33 30.2 29Z"/>
            <path class="m-face-side" d="M73.8 29C75.6 33 76.2 38.6 75.4 43.6 74.2 52.6 69.6 59.6 62.6 63 67.4 58.4 70.6 52.2 71.6 44.4 72.4 38.8 72.6 33.4 73.8 29Z"/>
            <path class="m-jaw" d="M33.4 54.6C37 61.4 44 65.2 52 65.2 60 65.2 67 61.4 70.6 54.6 66.6 60 59.8 62.8 52 62.8 44.2 62.8 37.4 60 33.4 54.6Z"/>
            <g clip-path="url(#${id}-face)"><path class="m-hair-cast" d="M31.4 30.4C33 27.4 35.6 24 38.6 22.2 42.4 20 48.4 21.6 52 25.8 55.6 21.6 61.6 20 65.4 22.2 68.4 24 71 27.4 72.6 30.4L78 12H26Z"/></g>
            <ellipse class="m-cheek m-cheek--l" cx="34.6" cy="47" rx="3.9" ry="2.6"/>
            <ellipse class="m-cheek m-cheek--r" cx="69.4" cy="47" rx="3.9" ry="2.6"/>

            <path class="m-hair" d="M29.6 38.6C25.8 23.6 31.4 7.6 50 5.6 68.8 3.6 79.6 17.6 74.4 38.6 74.2 33.6 73.4 29.6 71.6 26.6 69.6 23.4 67.2 20.4 64.2 19.6 60.4 18.6 55.4 20.4 52 24 48.6 20.4 43.6 18.6 39.8 19.6 36.8 20.4 34.4 23.4 32.4 26.6 30.6 29.6 29.8 33.6 29.6 38.6Z"/>
            <path class="m-hair-shine" d="M41.6 10.8C50.6 6.8 63.6 8.6 70 17" stroke-width="1.9"/>
            <path class="m-hair-shine m-hair-shine--b" d="M44.4 15C51.4 12.2 60.6 13.4 66 18.6" stroke-width="1.1"/>
            <path class="m-hair-shine m-hair-shine--b" d="M31.4 25.4C31 20 33.4 14.6 37.4 11.6" stroke-width="1.2"/>

            <g class="m-brow m-brow--l"><path d="M33.8 31.4C36.6 27.6 42.6 26 46.6 27.8 48 28.5 47.8 30.8 46.2 31 42.4 30 38.6 30.6 35.2 32.4 34 33 33.2 32.3 33.8 31.4Z"/></g>
            <g class="m-brow m-brow--r"><path d="M70.2 31.4C67.4 27.6 61.4 26 57.4 27.8 56 28.5 56.2 30.8 57.8 31 61.6 30 65.4 30.6 68.8 32.4 70 33 70.8 32.3 70.2 31.4Z"/></g>
            <path class="m-face-line m-eyebag" d="M37.2 44.5Q41 46 44.8 44.5M59.2 44.5Q63 46 66.8 44.5"/>

            <g class="m-eyes-open">
              <g class="m-eye m-eye--l">
                <ellipse class="m-eye-white" cx="41" cy="37.8" rx="5" ry="5.7"/>
                <g clip-path="url(#${id}-eye-l)">
                  <g class="m-pupil"><circle class="m-pupil-dot" cx="41.3" cy="38.5" r="2.7"/><circle class="m-pupil-hi" cx="40.4" cy="37.5" r="0.95"/></g>
                  <g class="m-lid"><rect class="m-lid-skin" x="35" y="25" width="12" height="10.7"/><path class="m-lash" d="M35 35.7H47"/></g>
                </g>
              </g>
              <g class="m-eye m-eye--r">
                <ellipse class="m-eye-white" cx="63" cy="37.8" rx="5" ry="5.7"/>
                <g clip-path="url(#${id}-eye-r)">
                  <g class="m-pupil"><circle class="m-pupil-dot" cx="63.3" cy="38.5" r="2.7"/><circle class="m-pupil-hi" cx="62.4" cy="37.5" r="0.95"/></g>
                  <g class="m-lid"><rect class="m-lid-skin" x="57" y="25" width="12" height="10.7"/><path class="m-lash" d="M57 35.7H69"/></g>
                </g>
              </g>
            </g>
            <path class="m-eyes-alt m-eyes-happy" d="M36.4 39.6Q41 33.6 45.6 39.6M58.4 39.6Q63 33.6 67.6 39.6"/>
            <path class="m-eyes-alt m-eyes-shut" d="M36.4 37.4Q41 41.4 45.6 37.4M58.4 37.4Q63 41.4 67.6 37.4"/>
            <path class="m-eyes-alt m-eyes-squeeze" d="M36.8 34.8 44.8 38 36.8 41.2M67.2 34.8 59.2 38 67.2 41.2"/>

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
                <path class="m-mouth-in" d="M45 62.6C45.4 57.2 48.4 54.8 52 54.8 55.6 54.8 58.6 57.2 59 62.6 56.8 61.2 54.4 60.8 52 60.8 49.6 60.8 47.2 61.2 45 62.6Z"/>
                <ellipse class="m-tongue" cx="52" cy="59.4" rx="2.6" ry="1.2"/>
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
          </g>
        </g>

        <g class="m-arm m-arm--l">${armArt()}
        </g>
        <g transform="${MIRROR}"><g class="m-arm m-arm--r">${armArt()}
        </g></g>
      </g>
    </g>
  </g>

  <g class="m-fx"></g>
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
  let lastSpokeAt = 0;       // any line, his own jokes included
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
    if ('flush' in patch) root.classList.toggle('is-flushed', Boolean(patch.flush));
  }

  function restLook() {
    setLook({
      ...(asleep ? ANIMS.sleep.face : REST_FACE),
      hands: { l: 'rest', r: 'rest' },
      props: { l: null, r: null },
      flush: false,
    });
  }

  /* ---- animations ----------------------------------------------------------- */

  function stopAnim() {
    clock.cancel('anim');
    root.removeAttribute('data-anim');
  }

  function startAnim(name, then) {
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
    setLook({ ...def.face, hands: def.hands, props: def.props, flush: Boolean(def.flush) });
    for (const [at, patch] of def.cues || []) clock.after(at, () => setLook(patch), 'anim');
    clock.after(def.ms, () => {
      root.removeAttribute('data-anim');
      restLook();
      if (typeof then === 'function') then();
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
    clock.after(520, () => root.classList.remove('is-waking'), 'wake');
    restLook();
    return true;
  }

  /* ---- speech --------------------------------------------------------------- */

  function draw(key, pool) {
    const name = playerName();
    const usable = name ? pool : pool.filter((entry) => !lineText(entry).includes('{name}'));
    if (!usable.length) return '';
    const bagKey = `${key}|${name ? 1 : 0}`;
    let bag = bags.get(bagKey);
    if (!bag || !bag.length) {
      bag = shuffled(usable);
      bags.set(bagKey, bag);
    }
    let entry = bag.pop();
    const text = (e) => lineText(e).replace(/\{name\}/g, name);
    if (text(entry) === lastLine && usable.length > 1) {
      if (!bag.length) bag.push(...shuffled(usable.filter((e) => e !== entry)));
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
    root.classList.add('is-speaking');

    const hold = Math.min(9000, BUBBLE_MS + Math.max(0, chars.length - 70) * 50);
    clock.after(hold, () => root.classList.remove('is-speaking', 'is-talking'), 'speech');

    if (reduced) {
      typed.textContent = line;
      rest.textContent = '';
      return 0;
    }
    // quick typewriter: the untyped part is already laid out (invisible), so the
    // bubble has its final size from the first frame
    const step = 30;
    const total = Math.max(240, Math.min(1500, chars.length * 22));
    const perStep = Math.max(1, Math.ceil(chars.length / (total / step)));
    let shown = 0;
    typed.textContent = '';
    rest.textContent = line;
    root.classList.add('is-talking');
    const tick = () => {
      shown = Math.min(chars.length, shown + perStep);
      typed.textContent = chars.slice(0, shown).join('');
      rest.textContent = chars.slice(shown).join('');
      if (shown < chars.length) clock.after(step, tick, 'speech');
      else clock.after(160, () => root.classList.remove('is-talking'), 'speech');
    };
    clock.after(step, tick, 'speech');
    return total;
  }

  /**
   * Say a line and play its gesture.
   * @param {string} kind
   * @param {string} [text] used verbatim when given
   * @param {{ anim?: string, own?: boolean }} [how] own = one of his idle jokes (does not count as activity)
   */
  function speak(kind, text, how = {}) {
    if (destroyed) return '';
    syncReduced();
    let key = Object.prototype.hasOwnProperty.call(LINES, kind) ? kind : null;
    const custom = typeof text === 'string' && text.trim() ? text.trim() : '';

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
    const woke = wake();
    const typing = showLine(line);

    const choices = (key && KIND_ANIMS[key]) || ['talk'];
    if (anim && ANIMS[anim]) {
      startAnim(anim);
    } else if (key && IN_SEQUENCE.has(key)) {
      startAnim(choices[0], () => {
        // the follow-up only if nothing else took over meanwhile
        if (!root.dataset.anim && lastLine === line) startAnim(choices[1]);
      });
      // keep the first gesture going while he is still typing
      void typing;
    } else {
      const options = choices.length > 1 ? choices.filter((name) => name !== lastAnim) : choices;
      startAnim(pickOne(options.length ? options : choices));
    }
    void woke;
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
    restLook();
    void figure.offsetWidth;
    root.dataset.hit = what;
    root.classList.remove('has-rose');

    if (what === 'rose') {
      setLook({ eyes: 'wide', brows: 'up', mouth: 'grin' });
      clock.after(260, () => {
        const [line] = draw('hit-rose', HIT_LINES.rose);
        showLine(line);
        startAnim('blush');
        setLook({ mouth: 'grin' });
      }, 'hit');
      clock.after(260 + ANIMS.blush.ms + 500, () => {
        // tidies up: the rose goes to his buttonhole for a while
        root.removeAttribute('data-hit');
        root.classList.add('has-rose');
        clock.after(40000, () => root.classList.remove('has-rose'), 'rose');
      }, 'hit');
      return;
    }

    setLook({ eyes: 'squeeze', brows: 'up', mouth: 'oh' });
    clock.after(420, () => {
      const [line] = draw(`hit-${what}`, HIT_LINES[what]);
      showLine(line);
      startAnim('angry');
    }, 'hit');
    clock.after(420 + ANIMS.angry.ms + 250, () => {
      startAnim('wipe');
      clock.after(ANIMS.wipe.ms * 0.4, () => root.classList.add('is-cleaning'), 'hit');
      clock.after(ANIMS.wipe.ms * 0.4 + 700, () => {
        root.removeAttribute('data-hit');
        root.classList.remove('is-cleaning');
      }, 'hit');
    }, 'hit');
  }

  /* ---- a life of his own ----------------------------------------------------- */

  function blink() {
    if (reduced || asleep) return;
    root.classList.add('is-blink');
    clock.after(130, () => root.classList.remove('is-blink'), 'blink');
  }

  function glance() {
    const spots = [[0, 0], [0, 0], [0, 0], [1.5, 0.2], [-1.5, 0.2], [1.3, -1], [-1.3, -1], [0.6, 1.1], [1.7, 0.7]];
    const [x, y] = pickOne(spots);
    root.style.setProperty('--m-look-x', String(x));
    root.style.setProperty('--m-look-y', String(y));
  }

  function live() {
    clock.cancel('life');
    const beat = () => {
      syncReduced();
      if (!reduced && !asleep && !frozen) {
        blink();
        if (Math.random() < 0.55) glance();
        if (Math.random() < 0.18) clock.after(260, blink, 'life'); // the odd double blink
      }
      clock.after(rand(2200, 5200), beat, 'life');
    };
    clock.after(rand(900, 2200), beat, 'life');

    const joke = () => {
      const quiet = Date.now() - lastSpokeAt >= IDLE_QUIET_MS;
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (visible && quiet && !asleep && !root.dataset.anim && !root.dataset.hit) speak('idle', undefined, { own: true });
      clock.after(rand(IDLE_MIN_MS, IDLE_MAX_MS), joke, 'life');
    };
    clock.after(rand(IDLE_MIN_MS, IDLE_MAX_MS), joke, 'life');
  }

  /* ---- taps ------------------------------------------------------------------ */

  function tap() {
    if (destroyed) return;
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
      const [line] = draw('woke', WOKE_LINES);
      showLine(line);
      startAnim('shrug');
      return;
    }
    if (taps.length >= 6) {
      taps = [];
      const [line] = draw('poke', POKE_LINES);
      showLine(line);
      startAnim('angry');
      return;
    }
    speak('idle', undefined, { anim: pickOne(TAP_ANIMS.filter((name) => name !== lastAnim)) });
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
    if (destroyed || !ANIMS[anim]) return;
    syncReduced();
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
