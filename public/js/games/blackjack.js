// Blackjack — client plugin.
import { createDealer } from '../dealer.js';

const STATUS = { stand: 'Se planta', bust: 'Se pasó', blackjack: 'Blackjack' };
const RESULT = { win: 'Gana', lose: 'Pierde', push: 'Empate', blackjack: '¡Blackjack!' };
const ARC = `
<svg class="table-arc" viewBox="0 0 600 90" aria-hidden="true">
  <path id="bj-arc" d="M30 20 Q300 110 570 20" fill="none"/>
  <text><textPath href="#bj-arc" startOffset="50%" text-anchor="middle">BLACKJACK PAGA 3 A 2 · EL CRUPIER SE PLANTA EN 17</textPath></text>
</svg>`;

export default {
  id: 'blackjack',
  icon: 'spade',
  art(ui) {
    return ui.el(
      'div',
      { class: 'art-cards' },
      ui.createCard({ rank: 'A', suit: 'S' }, { size: 'sm' }),
      ui.createCard({ rank: 'K', suit: 'H' }, { size: 'sm' })
    );
  },
  mount(root, api) {
    const { el, clear, formatChips, createButton, createCard } = api.ui;
    const dealer = createDealer(api);
    const values = api.meta.chips || [5, 25, 100, 500];
    let state = null;
    let seen = {};
    let timers = [];

    const statusEl = el('div', { class: 'bj__status' });
    const dealerHand = api.ui.createHand({ variant: 'spread' });
    const dealerTotal = el('span', { class: 'bj__total' });
    const handsEl = el('div', { class: 'bj__hands' });
    const arc = el('div', { class: 'bj__arc' });
    arc.innerHTML = ARC; // static markup authored above

    const tray = api.ui.createChipTray({ values, value: values[1], onChange() {}, getBalance: () => api.me().balance });
    const betBtn = createButton('Apostar', {
      variant: 'secondary',
      icon: 'plus',
      sound: false,
      onClick: () => {
        api.fx.bet(tray, handsEl.querySelector('.bj__seat.is-me .bj__circle') || handsEl, tray.value);
        api.send({ type: 'bet', amount: tray.value });
      },
    });
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
          arc,
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
          timers.push(setTimeout(() => api.audio.play('card'), (i - before) * 140));
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

    function seat(cls, ...children) {
      return el('div', { class: `bj__seat ${cls}` }, ...children);
    }

    function update(s) {
      if (s.phase === 'betting') seen = {};
      if (state && state.phase === 'playing' && s.phase !== 'playing' && s.phase !== 'betting') api.audio.play('flip');
      if (state && state.phase !== 'playing' && s.phase === 'playing') dealer.say('bet', 'Cartas repartidas. ¿Pide o se planta?');
      const myId = api.me().id;
      const mineBefore = state && state.hands ? state.hands.find((h) => h.id === myId) : null;
      const mineNow = s.hands.find((h) => h.id === myId);
      if (mineNow && mineNow.status === 'bust' && (!mineBefore || mineBefore.status !== 'bust')) dealer.say('bust');
      state = s;

      renderCards(dealerHand, 'dealer', s.dealer.cards);
      dealerTotal.textContent = s.dealer.total === null ? '' : `· ${s.dealer.total}`;

      clear(handsEl);
      if (s.phase === 'betting') {
        const mine = s.bets.find((b) => b.id === myId);
        if (!mine) {
          handsEl.append(
            seat('is-me is-empty', el('div', { class: 'bj__circle' }, el('span', { class: 'bj__hint' }, 'Tu apuesta')), el('span', { class: 'bj__who' }, api.me().name))
          );
        }
        for (const b of s.bets) {
          handsEl.append(
            seat(
              b.id === myId ? 'is-me' : '',
              el('div', { class: 'bj__circle' }, api.ui.createChipStack(b.amount, { size: 'sm', color: b.avatar })),
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
            seat(
              `${h.id === myId ? 'is-me' : ''}${h.id === s.turn ? ' is-turn' : ''}${h.result ? ` is-${h.result}` : ''}`,
              hand,
              el('span', { class: 'bj__who' }, `${h.name} · ${h.total}`),
              el('div', { class: 'bj__circle bj__circle--sm' }, api.ui.createChipStack(h.bet, { size: 'sm', color: h.avatar })),
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
      const from = handsEl.querySelector('.bj__seat.is-me') || handsEl;
      if (mine.net > 0) {
        api.audio.play(mine.result === 'blackjack' ? 'bigwin' : 'win');
        dealer.say(mine.result === 'blackjack' ? 'bigwin' : 'win');
        api.ui.showBanner(root, { title: RESULT[mine.result], subtitle: `+${formatChips(mine.net)} fichas`, kind: 'win' });
        api.fx.pay(from, mine.net);
      } else if (mine.net < 0) {
        api.audio.play('lose');
        dealer.say('lose');
        api.ui.showBanner(root, { title: 'Gana la casa', subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
        api.fx.take(from, -mine.net);
      } else {
        dealer.say('push');
        api.ui.showBanner(root, { title: 'Empate', subtitle: 'Recuperás tu apuesta', kind: 'push' });
      }
    }

    return {
      update,
      event,
      destroy() {
        clearInterval(clock);
        timers.forEach(clearTimeout);
        dealer.destroy();
      },
    };
  },
};
