// Póker de 3 cartas — client plugin.
import { createDealer } from '../dealer.js';

const RESULT = { win: 'Gana', lose: 'Pierde', push: 'Empate', fold: 'Se retiró', noqualify: 'El crupier no califica' };

export default {
  id: 'poker3',
  icon: 'cards',
  mount(root, api) {
    const { el, clear, formatChips, createButton, createCard } = api.ui;
    let state = null;
    let seen = {};
    let timers = [];

    const dealer = createDealer(api);
    const statusEl = el('div', { class: 'bj__status' });
    const dealerHand = api.ui.createHand({ variant: 'spread' });
    const dealerLabel = el('span', { class: 'bj__total' });
    const handsEl = el('div', { class: 'bj__hands' });

    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
    const betBtn = createButton('Apostar', { variant: 'secondary', icon: 'plus', onClick: () => api.send({ type: 'bet', amount: tray.value }) });
    const clearBtn = createButton('Limpiar', { variant: 'ghost', icon: 'trash', onClick: () => api.send({ type: 'clear' }) });
    const dealBtn = createButton('Repartir', { variant: 'primary', onClick: () => api.send({ type: 'deal' }) });
    const betting = el('div', { class: 'bj__controls' }, tray, betBtn, clearBtn, dealBtn);
    const playBtn = createButton('Jugar', { variant: 'primary', size: 'lg', onClick: () => api.send({ type: 'play' }) });
    const foldBtn = createButton('Retirarse', { variant: 'danger', size: 'lg', onClick: () => api.send({ type: 'fold' }) });
    const deciding = el('div', { class: 'bj__controls' }, playBtn, foldBtn);
    const rules = el(
      'p',
      { class: 'pk__rules' },
      'El crupier califica con Q o mejor. Bono a la apuesta inicial: escalera x1, trío x4, escalera de color x5.'
    );

    root.append(
      el(
        'div',
        { class: 'bj' },
        dealer,
        el(
          'div',
          { class: 'bj__table felt' },
          el('div', { class: 'bj__dealer' }, el('span', { class: 'bj__who' }, 'Crupier ', dealerLabel), dealerHand),
          statusEl,
          handsEl
        ),
        betting,
        deciding,
        rules
      )
    );

    function renderCards(container, key, cards) {
      const before = seen[key] || 0;
      const sig = cards.map((c) => (c ? c.rank + c.suit : '?')).join(',');
      if (seen[`${key}:sig`] === sig) return;
      if (before === cards.length && cards.length > 0 && seen[`${key}:sig`]) api.audio.play('flip');
      seen[`${key}:sig`] = sig;
      clear(container);
      cards.forEach((card, i) => {
        const node = createCard(card, { size: 'md' });
        if (i >= before) {
          node.dealIn(i * 160);
          timers.push(setTimeout(() => api.audio.play('card'), i * 160));
        }
        container.append(node);
      });
      seen[key] = cards.length;
    }

    const clock = setInterval(() => {
      if (!state) return;
      const left = state.deadline ? Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000)) : null;
      if (state.phase === 'betting') statusEl.textContent = state.bets.length ? `Apuestas · se reparte en ${left} s` : 'Poné tu apuesta inicial';
      else if (state.phase === 'deciding') statusEl.textContent = state.you.deciding ? `¿Jugás o te retirás? · ${left} s` : `Esperando decisiones · ${left} s`;
      else statusEl.textContent = 'Resultado';
    }, 250);

    function update(s) {
      if (s.phase === 'betting' && (!state || state.phase !== 'betting')) seen = {};
      state = s;
      const myId = api.me().id;

      renderCards(dealerHand, 'dealer', s.dealer.cards);
      dealerLabel.textContent = s.dealer.hand ? `· ${s.dealer.hand}` : '';

      const slots = new Map();
      for (const child of [...handsEl.children]) slots.set(child.dataset.key, child);
      const keys = new Set();
      const rows = s.phase === 'betting' ? s.bets.map((b) => ({ ...b, betting: true })) : s.hands;
      if (rows.length === 0) {
        clear(handsEl);
        handsEl.append(el('p', { class: 'bj__empty' }, 'Elegí una ficha y apostá para empezar la mano.'));
      }
      for (const h of rows) {
        const key = `${h.betting ? 'b' : 'h'}:${h.id}`;
        keys.add(key);
        let seat = slots.get(key);
        if (!seat) {
          if (handsEl.querySelector('.bj__empty')) clear(handsEl);
          seat = el('div', { class: 'bj__seat', dataset: { key } });
          seat.hand = api.ui.createHand({ variant: 'spread' });
          seat.info = el('div', { class: 'bj__info' });
          seat.append(seat.hand, seat.info);
          handsEl.append(seat);
        }
        seat.className = `bj__seat${h.id === myId ? ' is-me' : ''}${h.result ? ` is-${h.result}` : ''}`;
        clear(seat.info);
        if (h.betting) {
          seat.info.append(api.ui.createChipStack(h.amount, { size: 'sm', color: h.avatar }), el('span', { class: 'bj__who' }, h.name));
        } else {
          renderCards(seat.hand, h.id, h.cards);
          const net = h.payout - h.ante - h.play;
          const label = h.result ? RESULT[h.result] : h.decision === 'play' ? 'Juega' : h.decision === 'fold' ? 'Se retiró' : '';
          seat.info.append(
            el('span', { class: 'bj__who' }, h.hand ? `${h.name} · ${h.hand}` : h.name),
            el('span', { class: 'bj__bet' }, `Apuesta ${formatChips(h.ante + h.play)}`),
            label ? el('span', { class: 'bj__badge' }, h.result ? `${label} ${net > 0 ? '+' : ''}${formatChips(net)}` : label) : null
          );
        }
      }
      for (const [key, node] of slots) if (!keys.has(key)) node.remove();

      betting.hidden = s.phase !== 'betting';
      deciding.hidden = !s.you.deciding;
      clearBtn.disabled = s.you.bet === 0;
      dealBtn.disabled = s.you.bet === 0;
      betBtn.setLabel(s.you.bet ? `Apostar más (llevás ${formatChips(s.you.bet)})` : 'Apostar');
      tray.refresh();
    }

    function event(name, payload) {
      if (name === 'deal') dealer.say('bet', 'Cartas en la mesa. ¿Tiene con qué?');
      if (name !== 'result') return;
      const mine = payload.hands.find((h) => h.id === api.me().id);
      if (!mine) return;
      if (mine.result === 'fold') {
        dealer.say('fold');
        api.audio.play('lose');
      } else if (mine.net > 0) {
        api.audio.play(mine.net >= 500 ? 'bigwin' : 'win');
        dealer.say(mine.net >= 500 ? 'bigwin' : 'win');
        api.ui.showBanner(root, { title: `+${formatChips(mine.net)}`, subtitle: RESULT[mine.result], kind: 'win' });
      } else if (mine.net < 0) {
        api.audio.play('lose');
        dealer.say('lose');
        api.ui.showBanner(root, { title: 'Gana la casa', subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
      } else {
        dealer.say('push');
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
