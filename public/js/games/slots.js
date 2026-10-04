// Tragamonedas — client plugin.
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

    const jackpotEl = el('strong', { class: 'sl__jackpot-value' }, '…');
    const reels = [0, 1, 2].map(() => el('div', { class: 'sl__reel' }, GLYPH.seven));
    const msgEl = el('p', { class: 'sl__msg' }, 'Elegí tu apuesta y girá.');
    const payEl = el('div', { class: 'sl__pay' });
    const recentEl = el('div', { class: 'sl__recent' });
    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
    const spinBtn = createButton('Girar', { variant: 'primary', size: 'lg', onClick: () => api.send({ type: 'spin', bet: tray.value }) });

    root.append(
      el(
        'div',
        { class: 'sl' },
        el(
          'div',
          { class: 'sl__machine felt' },
          el('p', { class: 'sl__jackpot' }, 'Pozo del equipo ', jackpotEl),
          el('div', { class: 'sl__reels' }, ...reels),
          msgEl
        ),
        el('div', { class: 'sl__controls' }, tray, spinBtn),
        el('div', { class: 'sl__info' }, el('div', { class: 'panel sl__box' }, el('h3', null, 'Premios'), payEl), el('div', { class: 'panel sl__box' }, el('h3', null, 'Últimas jugadas'), recentEl))
      )
    );

    function showReels(ids) {
      ids.forEach((id, i) => {
        reels[i].textContent = GLYPH[id] || '?';
      });
    }

    function finish(payload) {
      animating = false;
      if (payload.jackpot) {
        api.audio.play('jackpot');
        api.ui.celebrate({ kind: 'jackpot', amount: payload.win });
        msgEl.textContent = `¡POZO! +${formatChips(payload.win)} fichas`;
      } else if (payload.win > 0) {
        api.audio.play(payload.win >= payload.bet * 25 ? 'bigwin' : 'win');
        api.ui.showBanner(root, { title: `+${formatChips(payload.win)}`, subtitle: 'fichas', kind: 'win', duration: 1500 });
        msgEl.textContent = `¡Ganaste ${formatChips(payload.win)} fichas!`;
      } else {
        msgEl.textContent = 'Nada esta vez. ¡Otra!';
      }
      if (state) update(state);
    }

    function animate(payload) {
      animating = true;
      msgEl.textContent = 'Girando…';
      const stopped = [false, false, false];
      const spin = setInterval(() => {
        reels.forEach((reel, i) => {
          if (!stopped[i]) reel.textContent = GLYPH[IDS[Math.floor(Math.random() * IDS.length)]];
        });
        api.audio.play('tick');
      }, 80);
      timers.push(spin);
      [0.5, 0.72, 0.94].forEach((at, i) => {
        timers.push(
          setTimeout(() => {
            stopped[i] = true;
            reels[i].textContent = GLYPH[payload.reels[i]];
            api.audio.play('chip');
            if (i === 2) {
              clearInterval(spin);
              finish(payload);
            }
          }, payload.duration * at)
        );
      });
    }

    function update(s) {
      state = s;
      jackpotEl.textContent = formatChips(s.jackpot);
      spinBtn.disabled = s.spinning || animating;
      tray.refresh();
      if (!animating && s.you.last) showReels(s.you.last.reels);

      clear(payEl);
      for (const row of s.paytable.slice().reverse()) {
        payEl.append(
          el('p', { class: 'sl__row' }, `${GLYPH[row.id]}${GLYPH[row.id]}${GLYPH[row.id]}`, el('strong', null, row.id === 'seven' ? `x${row.pay} + pozo` : `x${row.pay}`))
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
      if (name === 'spin' && payload.playerId === api.me().id) animate(payload);
    }

    return {
      update,
      event,
      destroy() {
        timers.forEach((t) => {
          clearTimeout(t);
          clearInterval(t);
        });
        timers = [];
      },
    };
  },
};
