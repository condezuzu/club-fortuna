// Tragamonedas — client plugin.
import { createDealer } from '../dealer.js';

const GLYPH = { cherry: '🍒', lemon: '🍋', bell: '🔔', star: '⭐', diamond: '💎', seven: '7️⃣' };
const IDS = Object.keys(GLYPH);

export default {
  id: 'slots',
  icon: 'crown',
  mount(root, api) {
    const { el, clear, formatChips, createButton } = api.ui;
    let state = null;
    let animating = false;
    let timers = [];
    let shownJackpot = 0;

    const dealer = createDealer(api);
    const jackpotEl = el('strong', { class: 'sl__jackpot-value' }, '…');
    const reels = [0, 1, 2].map(() => el('div', { class: 'sl__reel' }, el('span', { class: 'sl__glyph' }, GLYPH.seven)));
    const glyphs = reels.map((reel) => reel.firstChild);
    const lights = el('div', { class: 'sl__lights' }, ...Array.from({ length: 14 }, () => el('i')));
    const msgEl = el('p', { class: 'sl__msg' }, 'Elegí tu apuesta y girá.');
    const payEl = el('div', { class: 'sl__pay' });
    const recentEl = el('div', { class: 'sl__recent' });
    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
    const spinBtn = createButton('GIRAR', { variant: 'primary', size: 'lg', sound: false, onClick: spin });
    spinBtn.classList.add('sl__spin');
    const machine = el(
      'div',
      { class: 'sl__machine felt' },
      lights,
      el('p', { class: 'sl__jackpot' }, 'Pozo del equipo ', jackpotEl),
      el('div', { class: 'sl__window' }, el('div', { class: 'sl__reels' }, ...reels), el('div', { class: 'sl__payline' })),
      msgEl
    );

    root.append(
      el(
        'div',
        { class: 'sl' },
        dealer,
        machine,
        el('div', { class: 'sl__controls' }, tray, spinBtn),
        el(
          'div',
          { class: 'sl__info' },
          el('div', { class: 'panel sl__box' }, el('h3', null, 'Premios'), payEl),
          el('div', { class: 'panel sl__box' }, el('h3', null, 'Últimas jugadas del equipo'), recentEl)
        )
      )
    );

    function spin() {
      if (animating) return;
      api.audio.play('chips');
      api.send({ type: 'spin', bet: tray.value });
    }
    const onKey = (event) => {
      if (event.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(event.target.tagName)) {
        event.preventDefault();
        if (!spinBtn.disabled) spin();
      }
    };
    document.addEventListener('keydown', onKey);

    function later(fn, ms) {
      const t = setTimeout(fn, ms);
      timers.push(t);
      return t;
    }

    function finish(payload) {
      animating = false;
      machine.classList.remove('is-hot', 'is-spinning');
      const near = payload.win === 0 && (payload.reels[0] === payload.reels[1] || payload.reels[1] === payload.reels[2]);
      if (payload.jackpot) {
        machine.classList.add('is-jackpot');
        reels.forEach((reel) => reel.classList.add('is-win'));
        api.audio.play('jackpot');
        api.ui.celebrate({ kind: 'jackpot', amount: payload.win });
        msgEl.textContent = `¡¡POZO!! +${formatChips(payload.win)} fichas`;
        dealer.say('jackpot');
      } else if (payload.win > 0) {
        const big = payload.win >= payload.bet * 25;
        machine.classList.add('is-winning');
        const three = payload.reels[0] === payload.reels[2];
        reels.forEach((reel, i) => reel.classList.toggle('is-win', three || i < 2));
        api.audio.play(big ? 'bigwin' : 'win');
        if (big) api.ui.celebrate({ kind: 'bigwin', amount: payload.win });
        api.ui.showBanner(machine, { title: `+${formatChips(payload.win)}`, subtitle: big ? '¡Premio gordo!' : 'fichas', kind: 'win', duration: 1600 });
        msgEl.textContent = `¡Ganaste ${formatChips(payload.win)} fichas!`;
        dealer.say(big ? 'bigwin' : 'win');
      } else if (near) {
        machine.classList.add('is-near');
        api.audio.play('lose');
        msgEl.textContent = '¡Uuuy, casi! Estuvo ahí nomás.';
        dealer.say('near');
      } else {
        msgEl.textContent = 'Nada esta vez. ¡Otra!';
        if (Math.random() < 0.5) dealer.say('lose');
      }
      later(() => machine.classList.remove('is-winning', 'is-near', 'is-jackpot'), 2200);
      if (state) update(state);
    }

    function animate(payload) {
      animating = true;
      spinBtn.disabled = true;
      machine.classList.remove('is-winning', 'is-near', 'is-jackpot');
      machine.classList.add('is-spinning');
      reels.forEach((reel) => {
        reel.classList.remove('is-win', 'is-stop');
        reel.classList.add('is-rolling');
      });
      msgEl.textContent = 'Girando…';
      const stopped = [false, false, false];
      const roll = setInterval(() => {
        glyphs.forEach((glyph, i) => {
          if (!stopped[i]) glyph.textContent = GLYPH[IDS[Math.floor(Math.random() * IDS.length)]];
        });
      }, 70);
      timers.push(roll);
      const hot = payload.reels[0] === payload.reels[1];
      const stops = hot ? [0.3, 0.48, 0.97] : [0.3, 0.48, 0.66];
      let tickDelay = 110;
      const tick = () => {
        if (!animating) return;
        api.audio.play('tick');
        later(tick, tickDelay);
      };
      tick();
      stops.forEach((at, i) => {
        later(() => {
          stopped[i] = true;
          glyphs[i].textContent = GLYPH[payload.reels[i]];
          reels[i].classList.remove('is-rolling');
          reels[i].classList.add('is-stop');
          api.audio.play('chip');
          if (i === 1 && hot) {
            machine.classList.add('is-hot');
            msgEl.textContent = `${GLYPH[payload.reels[0]]}${GLYPH[payload.reels[1]]} … ¿sale la tercera?`;
            tickDelay = 190;
            api.audio.play('notify');
          }
          if (i === 2) {
            clearInterval(roll);
            finish(payload);
          }
        }, payload.duration * at);
      });
    }

    function update(s) {
      state = s;
      if (s.jackpot !== shownJackpot) {
        jackpotEl.textContent = formatChips(s.jackpot);
        if (shownJackpot && s.jackpot > shownJackpot) {
          jackpotEl.classList.remove('is-bump');
          void jackpotEl.offsetWidth;
          jackpotEl.classList.add('is-bump');
        }
        shownJackpot = s.jackpot;
      }
      spinBtn.disabled = s.spinning || animating;
      tray.refresh();
      if (!animating && s.you.last) s.you.last.reels.forEach((id, i) => (glyphs[i].textContent = GLYPH[id]));

      clear(payEl);
      for (const row of s.paytable.slice().reverse()) {
        payEl.append(
          el('p', { class: 'sl__row' }, `${GLYPH[row.id]}${GLYPH[row.id]}${GLYPH[row.id]}`, el('strong', null, row.id === 'seven' ? `x${row.pay} + POZO` : `x${row.pay}`))
        );
      }
      payEl.append(el('p', { class: 'sl__row' }, `${GLYPH.cherry}${GLYPH.cherry} + cualquiera`, el('strong', null, `x${s.twoCherriesPay}`)));

      clear(recentEl);
      if (s.recent.length === 0) recentEl.append(el('p', { class: 'sl__row' }, 'Todavía nadie giró.'));
      for (const r of s.recent) {
        recentEl.append(
          el(
            'p',
            { class: 'sl__row' },
            `${r.name}: ${r.reels.map((id) => GLYPH[id]).join('')}`,
            el('strong', { class: r.win > 0 ? 'is-up' : 'is-down' }, r.win > 0 ? `+${formatChips(r.win)}` : `-${formatChips(r.bet)}`)
          )
        );
      }
    }

    function event(name, payload) {
      if (name !== 'spin') return;
      if (payload.playerId === api.me().id) animate(payload);
      else if (payload.jackpot) api.audio.play('jackpot');
    }

    return {
      update,
      event,
      destroy() {
        document.removeEventListener('keydown', onKey);
        timers.forEach((t) => {
          clearTimeout(t);
          clearInterval(t);
        });
        timers = [];
        animating = false;
        dealer.destroy();
      },
    };
  },
};
