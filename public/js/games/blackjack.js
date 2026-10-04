// Blackjack — client plugin.
const STATUS = { stand: 'Se planta', bust: 'Se pasó', blackjack: 'Blackjack' };
const RESULT = { win: 'Gana', lose: 'Pierde', push: 'Empate', blackjack: '¡Blackjack!' };

export default {
  id: 'blackjack',
  icon: 'spade',
  mount(root, api) {
    const { el, clear, formatChips, createButton, createCard } = api.ui;
    let state = null;
    let seen = {};

    const statusEl = el('div', { class: 'bj__status' });
    const dealerHand = api.ui.createHand({ variant: 'spread' });
    const dealerTotal = el('span', { class: 'bj__total' });
    const handsEl = el('div', { class: 'bj__hands' });

    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
    const betBtn = createButton('Apostar', { variant: 'secondary', icon: 'plus', onClick: () => api.send({ type: 'bet', amount: tray.value }) });
    const clearBtn = createButton('Limpiar', { variant: 'ghost', icon: 'trash', onClick: () => api.send({ type: 'clear' }) });
    const dealBtn = createButton('Repartir', { variant: 'primary', onClick: () => api.send({ type: 'deal' }) });
    const betting = el('div', { class: 'bj__controls' }, tray, betBtn, clearBtn, dealBtn);

    const hitBtn = createButton('Pedir', { variant: 'primary', size: 'lg', onClick: () => api.send({ type: 'hit' }) });
    const standBtn = createButton('Plantarse', { variant: 'secondary', size: 'lg', onClick: () => api.send({ type: 'stand' }) });
    const doubleBtn = createButton('Doblar', { variant: 'secondary', size: 'lg', onClick: () => api.send({ type: 'double' }) });
    const playing = el('div', { class: 'bj__controls' }, hitBtn, standBtn, doubleBtn);

    root.append(
      el(
        'div',
        { class: 'bj' },
        el(
          'div',
          { class: 'bj__table felt' },
          el('div', { class: 'bj__dealer' }, el('span', { class: 'bj__who' }, 'Crupier ', dealerTotal), dealerHand),
          statusEl,
          handsEl
        ),
        betting,
        playing
      )
    );

    function renderCards(container, key, cards) {
      clear(container);
      const before = seen[key] || 0;
      cards.forEach((card, i) => {
        const node = createCard(card, { size: 'md' });
        if (i >= before) {
          node.dealIn((i - before) * 140);
          api.audio.play('card');
        }
        container.append(node);
      });
      seen[key] = cards.length;
    }

    const clock = setInterval(() => {
      if (!state) return;
      let text = '';
      const left = state.deadline ? Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000)) : null;
      if (state.phase === 'betting') {
        text = state.bets.length ? `Hagan sus apuestas · se reparte en ${left} s` : 'Hagan sus apuestas';
      } else if (state.phase === 'playing') {
        const hand = state.hands.find((h) => h.id === state.turn);
        text = state.you.myTurn ? `Tu turno · ${left} s` : `Turno de ${hand ? hand.name : '…'} · ${left} s`;
      } else if (state.phase === 'dealer') {
        text = 'Juega el crupier';
      } else {
        text = 'Resultado';
      }
      statusEl.textContent = text;
    }, 250);

    function update(s) {
      if (s.phase === 'betting') seen = {};
      state = s;
      const myId = api.me().id;

      renderCards(dealerHand, 'dealer', s.dealer.cards);
      dealerTotal.textContent = s.dealer.total === null ? '' : `· ${s.dealer.total}`;

      clear(handsEl);
      if (s.phase === 'betting') {
        if (s.bets.length === 0) handsEl.append(el('p', { class: 'bj__empty' }, 'Elegí una ficha y apostá para empezar la mano.'));
        for (const b of s.bets) {
          handsEl.append(
            el(
              'div',
              { class: `bj__seat${b.id === myId ? ' is-me' : ''}` },
              api.ui.createChipStack(b.amount, { size: 'sm', color: b.avatar }),
              el('span', { class: 'bj__who' }, b.name)
            )
          );
        }
      } else {
        for (const h of s.hands) {
          const hand = api.ui.createHand({ variant: 'spread' });
          renderCards(hand, h.id, h.cards);
          const label = h.result ? RESULT[h.result] : STATUS[h.status] || '';
          const net = h.result ? h.payout - h.bet : 0;
          handsEl.append(
            el(
              'div',
              { class: `bj__seat${h.id === myId ? ' is-me' : ''}${h.id === s.turn ? ' is-turn' : ''}${h.result ? ` is-${h.result}` : ''}` },
              hand,
              el('span', { class: 'bj__who' }, `${h.name} · ${h.total}`),
              el('span', { class: 'bj__bet' }, `Apuesta ${formatChips(h.bet)}`),
              label ? el('span', { class: 'bj__badge' }, h.result && net !== 0 ? `${label} ${net > 0 ? '+' : ''}${formatChips(net)}` : label) : null
            )
          );
        }
      }

      betting.hidden = s.phase !== 'betting';
      playing.hidden = !s.you.myTurn;
      clearBtn.disabled = s.you.bet === 0;
      dealBtn.disabled = s.you.bet === 0;
      doubleBtn.disabled = !s.you.canDouble;
      betBtn.setLabel(s.you.bet ? `Apostar más (llevás ${formatChips(s.you.bet)})` : 'Apostar');
      tray.refresh();
    }

    function event(name, payload) {
      if (name !== 'result') return;
      const mine = payload.hands.find((h) => h.id === api.me().id);
      if (!mine) return;
      if (mine.net > 0) {
        api.audio.play('win');
        api.ui.showBanner(root, { title: RESULT[mine.result], subtitle: `+${formatChips(mine.net)} fichas`, kind: 'win' });
      } else if (mine.net < 0) {
        api.audio.play('lose');
        api.ui.showBanner(root, { title: 'Gana la casa', subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
      } else {
        api.ui.showBanner(root, { title: 'Empate', subtitle: 'Recuperás tu apuesta', kind: 'push' });
      }
    }

    return {
      update,
      event,
      destroy() {
        clearInterval(clock);
      },
    };
  },
};
