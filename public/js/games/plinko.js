// Plinko — client plugin. The server decides the whole path of every ball; this
// module only draws it: a canvas board where the balls of everybody at the table fall.
import { createDealer } from '../dealer.js';

const RISK_LABEL = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
// Nominal timings (ms). Only their proportions matter: the real duration of each
// ball comes from the server.
const STEP = 290; // one row
const LAND = 550; // from the last peg into the slot
const ENTRY = 0.6; // the first fall onto the top peg, in steps
const TRAIL = 7;
const STORE_KEY = 'cf_plinko';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Deterministic pseudo-random number in [0, 1) from an integer (so a ball looks the same on every screen). */
function noise(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function multLabel(mult, tight) {
  const text = mult >= 1000 ? `${mult / 1000}K` : String(mult).replace('.', ',');
  return tight ? text : `${text}×`;
}

/** Slot colours: brass in the middle, hot oxblood at the edges. */
function slotColors(slot, rows) {
  const t = Math.abs(slot - rows / 2) / (rows / 2);
  const hue = (45 - 55 * t + 360) % 360;
  return {
    top: `hsl(${hue} ${70 + 12 * t}% ${58 - 12 * t}%)`,
    bottom: `hsl(${hue} ${72 + 10 * t}% ${40 - 12 * t}%)`,
    text: t > 0.45 ? '#fff6e6' : '#2a1c05',
    solid: `hsl(${hue} ${72 + 10 * t}% ${50 - 10 * t}%)`,
  };
}

const ART = `
<svg viewBox="0 0 120 96" aria-hidden="true">
  <g fill="#f4eee0">
    ${[0, 1, 2, 3, 4]
      .map((r) =>
        Array.from({ length: r + 3 }, (_, i) => `<circle cx="${60 + (i - (r + 2) / 2) * 15}" cy="${12 + r * 13}" r="2.3"/>`).join('')
      )
      .join('')}
  </g>
  ${[0, 1, 2, 3, 4, 5]
    .map((s) => {
      const c = slotColors(s, 5);
      return `<rect x="${60 + (s - 2.5) * 15 - 6.5}" y="76" width="13" height="12" rx="3" fill="${c.solid}"/>`;
    })
    .join('')}
  <circle cx="67" cy="43" r="5.5" fill="#d4af37" stroke="#fff6d6" stroke-width="1.2"/>
  <circle cx="65.2" cy="41.2" r="1.6" fill="#fff" opacity=".85"/>
</svg>`;

export default {
  id: 'plinko',
  icon: 'star',
  help: [
    "Elegí la apuesta, la cantidad de filas y el riesgo, y soltá la bolita (también con la barra espaciadora). En cada clavo rebota a la izquierda o a la derecha con la misma chance.",
    "El casillero donde cae paga su multiplicador sobre tu apuesta: x2 duplica, x0,5 te devuelve la mitad.",
    "Con más riesgo, el centro paga menos y los bordes muchísimo más: hasta x1.000 con 16 filas y riesgo alto.",
    "Podés tener hasta 10 bolitas en el aire, o dejarlo en \"Auto\". Todos ven caer las bolitas de todos.",
  ],
  art(ui) {
    const node = ui.el('div', { class: 'art-plinko' });
    node.innerHTML = ART; // static markup authored above
    return node;
  },
  mount(root, api) {
    const { el, clear, formatChips, createButton } = api.ui;
    const dealer = createDealer(api);
    const values = api.meta.chips || [5, 25, 100, 500];
    const reduced = api.ui.prefersReducedMotion();
    const myId = () => api.me().id;

    let state = null;
    let rows = 12;
    let risk = 'medium';
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && [8, 12, 16].includes(saved.rows)) rows = saved.rows;
      if (saved && RISK_LABEL[saved.risk]) risk = saved.risk;
    } catch (err) {
      /* no storage: defaults */
    }
    let geom = null;
    let pegLayer = null;
    let balls = [];
    let floaters = [];
    let sparks = [];
    const pegFlash = new Map();
    const slotHit = new Map();
    let raf = 0;
    let lastTick = 0;
    let lastSay = 0;
    let auto = null;
    let best = 0;
    let holdUntil = 0; // rows / risk stay locked from the click until the ball shows up
    let settle = null;

    // ── DOM ──────────────────────────────────────────────────────────────
    const canvas = el('canvas', { class: 'pl__canvas', attrs: { role: 'img', 'aria-label': 'Tablero de plinko' } });
    const g = canvas.getContext('2d');
    const boardEl = el('div', { class: 'pl__board' }, canvas);
    const tray = api.ui.createChipTray({ values, value: values[1], onChange: () => refresh(), getBalance: () => api.me().balance });
    const rowsSeg = api.ui.createSegmented({
      options: [8, 12, 16].map((value) => ({ value, label: String(value) })),
      value: rows,
      ariaLabel: 'Filas',
      onChange: (value) => {
        rows = value;
        remember();
        relayout();
      },
    });
    const riskSeg = api.ui.createSegmented({
      options: Object.keys(RISK_LABEL).map((value) => ({ value, label: RISK_LABEL[value] })),
      value: risk,
      ariaLabel: 'Riesgo',
      onChange: (value) => {
        risk = value;
        remember();
        draw(performance.now());
      },
    });
    const dropBtn = createButton('SOLTAR', { variant: 'primary', size: 'lg', block: true, sound: false, onClick: () => drop() });
    dropBtn.classList.add('pl__drop');
    const autoBtn = createButton('Auto', { variant: 'secondary', icon: 'repeat', block: true, onClick: () => setAuto(!auto) });
    autoBtn.classList.add('pl__auto');
    const airEl = el('span', { class: 'pl__air' });
    const bestEl = el('span', { class: 'pl__best' });
    const recentEl = el('div', { class: 'pl__recent-list' });
    const group = (label, control) => el('div', { class: 'pl__group' }, el('span', { class: 'pl__label' }, label), control);

    root.append(
      el(
        'div',
        { class: 'pl' },
        el(
          'div',
          { class: 'pl__side panel' },
          group('Apuesta por bolita', tray),
          group('Filas', rowsSeg),
          group('Riesgo', riskSeg),
          dropBtn,
          autoBtn,
          el('p', { class: 'pl__meta' }, airEl, bestEl),
          el('p', { class: 'pl__hint' }, 'Más riesgo: el medio paga menos y los bordes mucho más. Barra espaciadora para soltar.')
        ),
        el('div', { class: 'pl__stage felt' }, boardEl),
        el('div', { class: 'pl__recent panel' }, el('h3', { class: 'pl__recent-title' }, 'Últimas'), recentEl)
      )
    );

    function remember() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ rows, risk }));
      } catch (err) {
        /* no storage */
      }
    }

    // ── geometry ─────────────────────────────────────────────────────────
    const mults = () => (state && state.tables && state.tables[rows] ? state.tables[rows][risk] : null);

    function relayout() {
      const width = Math.floor(boardEl.clientWidth);
      if (width < 120) {
        geom = null;
        return;
      }
      const maxHeight = clamp(window.innerHeight - 330, 300, 600);
      const padX = 10;
      const top = 44;
      const dx = (width - 2 * padX) / (rows + 1);
      const slotH = clamp(dx * 0.82, 22, 40);
      const dy = Math.min(dx * 0.92, (maxHeight - top - slotH - 26) / rows);
      const pegR = clamp(dx * 0.115, 2.4, 6);
      const ballR = clamp(Math.min(dx, dy) * 0.27, 4, 11);
      const slotTop = top + (rows - 1) * dy + dy * 0.78 + 4;
      const height = Math.ceil(slotTop + slotH + 12);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      geom = { width, height, dpr, cx: width / 2, top, dx, dy, pegR, ballR, slotTop, slotH, reach: pegR + ballR };

      // The pegs never change: paint them once.
      pegLayer = document.createElement('canvas');
      pegLayer.width = canvas.width;
      pegLayer.height = canvas.height;
      const p = pegLayer.getContext('2d');
      p.setTransform(dpr, 0, 0, dpr, 0, 0);
      const chuteW = ballR * 3.4;
      const chuteH = Math.max(14, top - geom.reach - 12);
      const brass = p.createLinearGradient(geom.cx - chuteW / 2, 0, geom.cx + chuteW / 2, 0);
      brass.addColorStop(0, '#7a5a17');
      brass.addColorStop(0.3, '#f2d47a');
      brass.addColorStop(0.6, '#c79a2e');
      brass.addColorStop(1, '#6b4c12');
      p.fillStyle = brass;
      p.beginPath();
      p.moveTo(geom.cx - chuteW * 0.8, 0);
      p.lineTo(geom.cx + chuteW * 0.8, 0);
      p.lineTo(geom.cx + chuteW / 2, chuteH);
      p.lineTo(geom.cx - chuteW / 2, chuteH);
      p.closePath();
      p.fill();
      p.fillStyle = 'rgba(0, 0, 0, 0.7)';
      p.beginPath();
      p.ellipse(geom.cx, chuteH, chuteW / 2 - 2, 3.5, 0, 0, Math.PI * 2);
      p.fill();
      for (let r = 0; r < rows; r += 1) {
        for (let i = 0; i < r + 3; i += 1) {
          const x = pegX(r, i);
          const y = rowY(r);
          p.beginPath();
          p.arc(x, y + pegR * 0.7, pegR * 1.05, 0, Math.PI * 2);
          p.fillStyle = 'rgba(0, 0, 0, 0.32)';
          p.fill();
          const shade = p.createRadialGradient(x - pegR * 0.35, y - pegR * 0.4, pegR * 0.1, x, y, pegR);
          shade.addColorStop(0, '#fffdf4');
          shade.addColorStop(0.55, '#e9dcbd');
          shade.addColorStop(1, '#a8915c');
          p.beginPath();
          p.arc(x, y, pegR, 0, Math.PI * 2);
          p.fillStyle = shade;
          p.fill();
        }
      }
      draw(performance.now());
    }

    const rowY = (r) => geom.top + r * geom.dy;
    const pegX = (r, i) => geom.cx + (i - (r + 2) / 2) * geom.dx;
    const slotX = (slot) => geom.cx + (slot - rows / 2) * geom.dx;
    /** Centre of a ball resting on the peg it hits at row r after j moves to the right. */
    const contact = (r, j) => ({ x: geom.cx + (j - r / 2) * geom.dx, y: rowY(r) - geom.reach });

    // ── balls ────────────────────────────────────────────────────────────
    function addBall(payload) {
      const mine = payload.playerId === myId();
      if (!geom || !(mine || (payload.rows === rows && payload.risk === risk)) || payload.rows !== rows) return;
      const rights = [0];
      for (let i = 0; i < payload.path.length; i += 1) rights.push(rights[i] + (payload.path[i] === 'R' ? 1 : 0));
      balls.push({
        ...payload,
        mine,
        color: api.ui.avatarColor(payload.avatar),
        start: performance.now(),
        rights,
        hop: -2,
        landed: 0,
        trail: [],
      });
      lockSelectors();
      loop();
    }

    /** Where a ball is `elapsed` ms after its release. hop: -1 entry, 0..rows-2 between pegs, rows-1 into the slot. */
    function locate(ball, elapsed) {
      const unit = ball.duration / (rows * STEP + LAND);
      const tEntry = ENTRY * STEP * unit;
      const tHop = STEP * unit;
      const first = contact(0, 0);
      if (elapsed < tEntry) {
        const p = elapsed / tEntry;
        const fromY = Math.max(6, geom.top - geom.reach - 14);
        const sway = (noise(ball.id * 7 + 1) - 0.5) * geom.dx * 0.5;
        return { x: first.x + sway * (1 - p) * (1 - p), y: fromY + (first.y - fromY) * p * p, hop: -1 };
      }
      const since = elapsed - tEntry;
      const hop = Math.min(rows - 1, Math.floor(since / tHop));
      const last = hop === rows - 1;
      const span = last ? ball.duration - tEntry - (rows - 1) * tHop : tHop;
      const p = clamp((since - hop * tHop) / span, 0, 1);
      const from = contact(hop, ball.rights[hop]);
      const to = last
        ? { x: slotX(ball.slot), y: geom.slotTop + geom.slotH * 0.42 }
        : contact(hop + 1, ball.rights[hop + 1]);
      // A bounce: up off the peg, then gravity. v and gravity are chosen so that the arc
      // peaks `lift` above the peg and ends exactly on the next one at p = 1.
      const lift = geom.dy * (0.15 + 0.17 * noise(ball.id * 31 + hop));
      const fall = to.y - from.y;
      const v = 2 * lift + Math.sqrt(4 * lift * lift + 4 * lift * fall);
      const y = from.y - v * p + (fall + v) * p * p;
      return { x: from.x + (to.x - from.x) * p, y, hop };
    }

    function tick(now) {
      if (now - lastTick < 48) return;
      lastTick = now;
      api.audio.play('tick');
    }

    function land(ball, now) {
      ball.landed = now;
      slotHit.set(ball.slot, now);
      const colors = slotColors(ball.slot, rows);
      const x = slotX(ball.slot);
      floaters.push({
        x,
        y: geom.slotTop - 4,
        text: ball.mine ? (ball.win > 0 ? `+${formatChips(ball.win)}` : '0') : multLabel(ball.mult, false),
        color: ball.mine ? (ball.win >= ball.bet ? '#ffe9a3' : '#f0a9a9') : colors.top,
        start: now,
      });
      if (ball.mult >= 10 && !reduced) {
        for (let i = 0; i < 16; i += 1) {
          const angle = -Math.PI / 2 + (noise(ball.id * 53 + i) - 0.5) * 2.2;
          const speed = 90 + noise(ball.id * 97 + i) * 170;
          sparks.push({ x, y: geom.slotTop, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, start: now, color: colors.top });
        }
      }
      if (!ball.mine) return;
      best = Math.max(best, ball.mult);
      const rect = canvas.getBoundingClientRect();
      if (ball.win > ball.bet) api.fx.pay({ x: rect.left + x, y: rect.top + geom.slotTop }, ball.win);
      if (ball.mult >= 100) {
        api.audio.play('jackpot');
        api.ui.celebrate({ kind: 'jackpot', amount: ball.win });
      } else if (ball.mult >= 10) {
        api.audio.play('bigwin');
        api.ui.celebrate({ kind: 'bigwin', amount: ball.win });
      } else if (ball.mult >= 2) {
        api.audio.play('win');
      } else {
        api.audio.play('chip');
      }
      if (ball.mult >= 10 || now - lastSay > 6000) {
        const kind = ball.mult >= 10 ? 'bigwin' : ball.mult >= 2 ? 'win' : ball.mult < 1 ? (Math.random() < 0.5 ? 'lose' : 'near') : null;
        if (kind && (ball.mult >= 10 || Math.random() < 0.5)) {
          lastSay = now;
          dealer.say(kind);
        }
      }
      lockSelectors();
      refresh();
    }

    // ── drawing ──────────────────────────────────────────────────────────
    function roundRect(x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function draw(now) {
      if (!geom) return false;
      const { dpr, width, height, dx, pegR, ballR, slotTop, slotH } = geom;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      g.drawImage(pegLayer, 0, 0, width, height);
      let busy = false;

      // pegs that were just hit
      for (const [key, at] of pegFlash) {
        const age = now - at;
        if (age > 320) {
          pegFlash.delete(key);
          continue;
        }
        busy = true;
        const [r, i] = key.split(':').map(Number);
        const f = 1 - age / 320;
        g.beginPath();
        g.arc(pegX(r, i), rowY(r), pegR * (1.2 + 2.2 * (1 - f)), 0, Math.PI * 2);
        g.fillStyle = `rgba(255, 226, 140, ${0.55 * f})`;
        g.fill();
        g.beginPath();
        g.arc(pegX(r, i), rowY(r), pegR * 1.15, 0, Math.PI * 2);
        g.fillStyle = `rgba(255, 255, 255, ${0.9 * f})`;
        g.fill();
      }

      // slots
      const table = mults();
      const tight = dx < 30;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let slot = 0; slot <= rows; slot += 1) {
        const hitAge = slotHit.has(slot) ? now - slotHit.get(slot) : Infinity;
        let press = 0;
        let flash = 0;
        if (hitAge < 340) {
          busy = true;
          press = Math.sin(Math.PI * clamp(hitAge / 260, 0, 1)) * 5;
          flash = 1 - hitAge / 340;
        } else if (hitAge !== Infinity) {
          slotHit.delete(slot);
        }
        const colors = slotColors(slot, rows);
        const w = dx - Math.max(2, dx * 0.1);
        const x = slotX(slot) - w / 2;
        const y = slotTop + press;
        const fill = g.createLinearGradient(0, y, 0, y + slotH);
        fill.addColorStop(0, colors.top);
        fill.addColorStop(1, colors.bottom);
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        roundRect(x, slotTop + 4, w, slotH, Math.min(7, w * 0.22));
        g.fill();
        g.fillStyle = fill;
        roundRect(x, y, w, slotH, Math.min(7, w * 0.22));
        g.fill();
        if (flash > 0) {
          g.fillStyle = `rgba(255, 255, 255, ${0.55 * flash})`;
          g.fill();
        }
        if (table) {
          g.fillStyle = colors.text;
          g.font = `800 ${clamp(dx * 0.3, 8, 13)}px Inter, system-ui, sans-serif`;
          g.fillText(multLabel(table[slot], tight), slotX(slot), y + slotH / 2 + 0.5);
        }
      }

      // balls
      balls = balls.filter((ball) => {
        const elapsed = now - ball.start;
        if (ball.landed) {
          const fade = 1 - (now - ball.landed) / 260;
          if (fade <= 0) return false;
          busy = true;
          paintBall(slotX(ball.slot), slotTop + slotH * 0.42, ballR * (0.7 + 0.3 * fade), ball.color, fade);
          return true;
        }
        // A tab that was in the background wakes up with balls that landed long ago: drop them quietly.
        if (elapsed > ball.duration + 1500) return false;
        busy = true;
        if (elapsed >= ball.duration) {
          land(ball, now);
          return true;
        }
        const at = locate(ball, elapsed);
        if (at.hop !== ball.hop) {
          ball.hop = at.hop;
          if (at.hop >= 0) {
            pegFlash.set(`${at.hop}:${ball.rights[at.hop] + 1}`, now);
            if (ball.mine || balls.length < 4) tick(now);
          }
        }
        ball.trail.push(at.x, at.y);
        if (ball.trail.length > TRAIL * 2) ball.trail.splice(0, 2);
        for (let i = 0; i < ball.trail.length - 2; i += 2) {
          const k = (i / 2 + 1) / TRAIL;
          g.beginPath();
          g.arc(ball.trail[i], ball.trail[i + 1], ballR * (0.35 + 0.5 * k), 0, Math.PI * 2);
          g.fillStyle = ball.color;
          g.globalAlpha = 0.22 * k;
          g.fill();
        }
        g.globalAlpha = 1;
        paintBall(at.x, at.y, ballR, ball.color, 1);
        return true;
      });

      // sparks
      sparks = sparks.filter((s) => {
        const t = (now - s.start) / 1000;
        if (t > 0.75) return false;
        busy = true;
        g.globalAlpha = 1 - t / 0.75;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(s.x + s.vx * t, s.y + s.vy * t + 420 * t * t, 2.2, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        return true;
      });

      // floating results
      floaters = floaters.filter((f) => {
        const p = (now - f.start) / 1200;
        if (p >= 1) return false;
        busy = true;
        g.globalAlpha = 1 - p * p;
        g.font = `800 ${clamp(dx * 0.42, 12, 18)}px Inter, system-ui, sans-serif`;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        const y = f.y - 38 * (1 - (1 - p) * (1 - p));
        const x = clamp(f.x, 26, width - 26);
        g.strokeText(f.text, x, y);
        g.fillStyle = f.color;
        g.fillText(f.text, x, y);
        g.globalAlpha = 1;
        return true;
      });
      return busy;
    }

    function paintBall(x, y, r, color, alpha) {
      g.globalAlpha = alpha * 0.35;
      g.beginPath();
      g.arc(x, y, r * 1.9, 0, Math.PI * 2);
      const halo = g.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
      halo.addColorStop(0, color);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = halo;
      g.fill();
      g.globalAlpha = alpha;
      g.beginPath();
      g.arc(x, y + r * 0.55, r * 0.95, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.fill();
      const shade = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      shade.addColorStop(0, '#ffffff');
      shade.addColorStop(0.28, color);
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.fillStyle = shade;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      g.stroke();
      g.globalAlpha = 1;
    }

    function loop() {
      if (raf) return;
      const frame = (now) => {
        raf = 0;
        const busy = draw(now);
        if (busy) raf = requestAnimationFrame(frame);
        else {
          lockSelectors();
          if (geom && Math.floor(boardEl.clientWidth) !== geom.width) relayout();
        }
      };
      raf = requestAnimationFrame(frame);
    }

    // ── controls ─────────────────────────────────────────────────────────
    const mineInAir = () => {
      const now = performance.now();
      return balls.filter((ball) => ball.mine && !ball.landed && now - ball.start < ball.duration + 400).length;
    };

    function lockSelectors() {
      const locked = mineInAir() > 0 || performance.now() < holdUntil;
      for (const node of [rowsSeg, riskSeg]) {
        node.classList.toggle('is-locked', locked);
        node.style.pointerEvents = locked ? 'none' : '';
      }
    }

    function refresh() {
      if (!state) return;
      const flying = Math.max(state.flying, mineInAir());
      const bet = tray.value;
      dropBtn.disabled = flying >= state.maxBalls || api.me().balance < bet;
      airEl.textContent = `En el aire: ${flying}/${state.maxBalls}`;
      bestEl.textContent = best ? ` · Tu mejor caída: ${multLabel(best, false)}` : '';
      tray.refresh();
    }

    function drop() {
      if (!state || !geom) return false;
      const bet = tray.value;
      if (api.me().balance < bet || Math.max(state.flying, mineInAir()) >= state.maxBalls) return false;
      const rect = canvas.getBoundingClientRect();
      api.fx.bet(tray, { x: rect.left + geom.cx, y: rect.top + 8 }, bet);
      api.send({ type: 'drop', bet, rows, risk });
      holdUntil = performance.now() + 700;
      lockSelectors();
      setTimeout(lockSelectors, 750);
      return true;
    }

    function setAuto(on) {
      clearInterval(auto);
      auto = null;
      if (on) {
        auto = setInterval(() => {
          if (!state) return;
          if (api.me().balance < tray.value) setAuto(false);
          else drop();
        }, 520);
        drop();
      }
      autoBtn.classList.toggle('is-on', Boolean(auto));
      autoBtn.setLabel(auto ? 'Auto: frenar' : 'Auto');
    }

    const onKey = (event) => {
      if (event.code !== 'Space' || /INPUT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
      event.preventDefault();
      drop();
    };
    document.addEventListener('keydown', onKey);
    const observer = new ResizeObserver(() => {
      if (mineInAir() === 0 && balls.length === 0) relayout();
    });
    observer.observe(boardEl);

    function renderRecent(list) {
      clear(recentEl);
      if (list.length === 0) recentEl.append(el('p', { class: 'side__empty' }, 'Nadie soltó todavía.'));
      for (const item of list.slice(0, 12)) {
        const colors = slotColors(item.slot, item.rows);
        recentEl.append(
          el(
            'div',
            { class: `pl__result${item.playerId === myId() ? ' is-mine' : ''}`, title: `${item.name}: ${formatChips(item.bet)} → ${formatChips(item.win)} (${item.rows} filas, riesgo ${RISK_LABEL[item.risk].toLowerCase()})` },
            api.bust({ id: item.playerId, name: item.name, avatar: item.avatar }, 20),
            el('strong', { style: { background: colors.solid, color: colors.text } }, multLabel(item.mult, false))
          )
        );
      }
    }

    function update(s) {
      const first = state === null;
      state = s;
      if (first || !geom) relayout();
      renderRecent(s.recent);
      refresh();
      // The counters also depend on the local animation, which does not run in a background tab.
      clearTimeout(settle);
      settle = setTimeout(() => {
        lockSelectors();
        refresh();
      }, 650);
    }

    function event(name, payload) {
      if (name === 'drop') addBall(payload);
    }

    return {
      update,
      event,
      destroy() {
        cancelAnimationFrame(raf);
        clearInterval(auto);
        clearTimeout(settle);
        observer.disconnect();
        document.removeEventListener('keydown', onKey);
        dealer.destroy();
      },
    };
  },
};
