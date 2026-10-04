// Baccarat — client plugin.
import { createDealer } from '../dealer.js';

const SPOTS = [
  { id: 'player', label: 'Punto', pays: 'Paga 1 a 1' },
  { id: 'tie', label: 'Empate', pays: 'Paga 8 a 1' },
  { id: 'banker', label: 'Banca', pays: 'Paga 0,95 a 1' },
];
const WINNER = { player: 'Gana Punto', banker: 'Gana Banca', tie: 'Empate' };
const LETTER = { player: 'P', banker: 'B', tie: 'E' };

export default {
  id: 'baccarat',
  icon: 'diamond',
  mount(root, api) {
    const { el, clear, formatChips, createButton, createCard } = api.ui;
    let state = null;
    let dealt = false;
    let timers = [];
    const dealer = createDealer(api);

    const statusEl = el('div', { class: 'bc__status' });
    const histEl = el('div', { class: 'bc__history' });
    const sides = {
      player: { hand: api.ui.createHand({ variant: 'spread' }), total: el('span', { class: 'bc__total' }) },
      banker: { hand: api.ui.createHand({ variant: 'spread' }), total: el('span', { class: 'bc__total' }) },
    };
    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
    const spotEls = {};
    const spotsRow = el('div', { class: 'bc__spots' });
    for (const spot of SPOTS) {
      const chips = el('span', { class: 'bc__chips' });
      const btn = el(
        'button',
        { class: `bc__spot bc__spot--${spot.id}`, type: 'button', onClick: () => api.send({ type: 'bet', spot: spot.id, amount: tray.value }) },
        el('strong', null, spot.label),
        el('small', null, spot.pays),
        chips
      );
      spotEls[spot.id] = { btn, chips };
      spotsRow.append(btn);
    }
    const clearBtn = createButton('Limpiar', { variant: 'ghost', icon: 'trash', onClick: () => api.send({ type: 'clear' }) });
    const dealBtn = createButton('Repartir', { variant: 'primary', onClick: () => api.send({ type: 'deal' }) });

    root.append(
      el(
        'div',
        { class: 'bc' },
        dealer,
        el(
          'div',
          { class: 'bc__table felt' },
          statusEl,
          el(
            'div',
            { class: 'bc__hands' },
            el('div', { class: 'bc__side' }, el('span', { class: 'bc__who' }, 'Punto ', sides.player.total), sides.player.hand),
            el('div', { class: 'bc__side' }, el('span', { class: 'bc__who' }, 'Banca ', sides.banker.total), sides.banker.hand)
          ),
          spotsRow,
          histEl
        ),
        el('div', { class: 'bc__controls' }, tray, clearBtn, dealBtn)
      )
    );

    const clock = setInterval(() => {
      if (!state) return;
      if (state.phase === 'betting') {
        const left = state.deadline ? Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000)) : null;
        statusEl.textContent = left === null ? 'Hagan sus apuestas' : `Hagan sus apuestas · se reparte en ${left} s`;
      } else if (state.phase === 'dealing') {
        statusEl.textContent = 'Cartas sobre la mesa…';
      } else {
        statusEl.textContent = state.hands ? WINNER[state.hands.winner] : '';
      }
    }, 250);

    function update(s) {
      state = s;
      const myId = api.me().id;

      if (!s.hands) {
        dealt = false;
        for (const side of Object.values(sides)) {
          clear(side.hand);
          side.total.textContent = '';
        }
      } else {
        if (!dealt) {
          dealt = true;
          for (const key of ['player', 'banker']) {
            clear(sides[key].hand);
            s.hands[key].forEach((card, i) => {
              const node = createCard(card, { size: 'md' });
              const delay = i * 500 + (key === 'banker' ? 250 : 0);
              node.dealIn(delay);
              timers.push(setTimeout(() => api.audio.play('card'), delay));
              sides[key].hand.append(node);
            });
          }
          dealer.say('spin', 'Cartas sobre la mesa. Que gane el nueve.');
        }
        sides.player.total.textContent = s.phase === 'result' ? `· ${s.hands.playerTotal}` : '';
        sides.banker.total.textContent = s.phase === 'result' ? `· ${s.hands.bankerTotal}` : '';
      }

      for (const spot of SPOTS) {
        let total = 0;
        let mine = 0;
        for (const b of s.bets) {
          total += b[spot.id];
          if (b.id === myId) mine = b[spot.id];
        }
        const node = spotEls[spot.id];
        node.chips.textContent = total ? (mine ? `${formatChips(total)} (vos ${formatChips(mine)})` : formatChips(total)) : '';
        node.btn.disabled = s.phase !== 'betting';
        node.btn.classList.toggle('is-win', s.phase === 'result' && s.hands && s.hands.winner === spot.id);
      }

      clear(histEl);
      for (const w of s.history.slice(0, 16)) histEl.append(el('span', { class: `bc__dot bc__dot--${w}` }, LETTER[w]));

      clearBtn.disabled = s.phase !== 'betting' || s.you.total === 0;
      dealBtn.disabled = s.phase !== 'betting' || s.you.total === 0;
      tray.refresh();
    }

    function event(name, payload) {
      if (name !== 'result') return;
      const mine = payload.results.find((r) => r.id === api.me().id);
      if (!mine) return;
      if (mine.net > 0) {
        api.audio.play(mine.net >= 500 ? 'bigwin' : 'win');
        dealer.say(mine.net >= 500 ? 'bigwin' : 'win');
        api.ui.showBanner(root, { title: `+${formatChips(mine.net)}`, subtitle: WINNER[payload.winner], kind: 'win' });
      } else if (mine.net < 0) {
        api.audio.play('lose');
        dealer.say('lose');
        api.ui.showBanner(root, { title: WINNER[payload.winner], subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
      } else {
        api.ui.showBanner(root, { title: WINNER[payload.winner], subtitle: 'Recuperás tu apuesta', kind: 'push' });
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
