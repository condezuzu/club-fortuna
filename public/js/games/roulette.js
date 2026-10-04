// Ruleta — client plugin.
import { createWheel } from '../wheel.js';
import { createDealer } from '../dealer.js';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const PHASE_TEXT = { idle: 'Hagan sus apuestas', betting: 'Hagan sus apuestas', spinning: 'No va más…', result: 'Resultado' };

export default {
  id: 'roulette',
  icon: 'star',
  art() {
    const wheel = createWheel({});
    wheel.settle(17);
    return wheel;
  },
  mount(root, api) {
    const { el, clear, formatChips, formatCompact, createButton, createChip } = api.ui;
    const dealer = createDealer(api);
    const values = api.meta.chips || [5, 25, 100, 500];
    let state = null;
    let spunRound = null;

    const phaseEl = el('div', { class: 'rl__phase' });
    const timeEl = el('div', { class: 'rl__time' });
    const numEl = el('div', { class: 'rl__number' }, '–');
    const histEl = el('div', { class: 'rl__history' });
    const teamEl = el('div', { class: 'rl__team' });
    const board = el('div', { class: 'rl__board' });
    const spots = new Map();
    const shown = new Map();

    function showNumber(n, final) {
      const none = n === null || n === undefined;
      numEl.textContent = none ? '–' : String(n);
      numEl.className = `rl__number${none ? '' : ` rl__number--${colorOf(n)}`}${final ? ' is-final' : ''}`;
    }

    const wheel = createWheel({
      onTick: () => api.audio.play('tick'),
      onLand: (n) => {
        showNumber(n, true);
        api.audio.play('flip');
      },
    });

    function addSpot(id, label, cls, style) {
      const chips = el('span', { class: 'rl__chips' });
      const btn = el(
        'button',
        {
          class: `rl__spot ${cls || ''}`,
          type: 'button',
          style,
          onClick: () => {
            api.fx.bet(tray, btn, tray.value);
            api.send({ type: 'bet', spot: id, amount: tray.value });
          },
        },
        el('span', { class: 'rl__label' }, label),
        chips
      );
      spots.set(id, { btn, chips });
      board.append(btn);
    }

    addSpot('straight:0', '0', 'rl__spot--green', { gridColumn: '1', gridRow: '1 / span 3' });
    for (let n = 1; n <= 36; n += 1) {
      addSpot(`straight:${n}`, String(n), `rl__spot--${colorOf(n)}`, {
        gridColumn: String(Math.ceil(n / 3) + 1),
        gridRow: String(3 - ((n - 1) % 3)),
      });
    }
    addSpot('column:3', '2:1', 'rl__spot--out', { gridColumn: '14', gridRow: '1' });
    addSpot('column:2', '2:1', 'rl__spot--out', { gridColumn: '14', gridRow: '2' });
    addSpot('column:1', '2:1', 'rl__spot--out', { gridColumn: '14', gridRow: '3' });
    addSpot('dozen:1', '1ª docena', 'rl__spot--out', { gridColumn: '2 / span 4', gridRow: '4' });
    addSpot('dozen:2', '2ª docena', 'rl__spot--out', { gridColumn: '6 / span 4', gridRow: '4' });
    addSpot('dozen:3', '3ª docena', 'rl__spot--out', { gridColumn: '10 / span 4', gridRow: '4' });
    [
      ['low', '1-18', ''],
      ['even', 'Par', ''],
      ['red', 'Rojo', 'rl__spot--red'],
      ['black', 'Negro', 'rl__spot--black'],
      ['odd', 'Impar', ''],
      ['high', '19-36', ''],
    ].forEach(([id, label, cls], i) => {
      addSpot(id, label, `rl__spot--out ${cls}`, { gridColumn: `${2 + i * 2} / span 2`, gridRow: '5' });
    });

    const tray = api.ui.createChipTray({ values, value: values[1], onChange() {}, getBalance: () => api.me().balance });
    const undoBtn = createButton('Deshacer', { variant: 'ghost', size: 'sm', icon: 'undo', onClick: () => api.send({ type: 'undo' }) });
    const clearBtn = createButton('Limpiar', { variant: 'ghost', size: 'sm', icon: 'trash', onClick: () => api.send({ type: 'clear' }) });
    const rebetBtn = createButton('Repetir', { variant: 'secondary', size: 'sm', icon: 'repeat', onClick: () => api.send({ type: 'rebet' }) });
    const readyBtn = createButton('¡Listo, que gire!', {
      variant: 'primary',
      onClick: () => api.send({ type: 'ready', ready: !(state && state.you.ready) }),
    });
    const totalEl = el('span', { class: 'rl__total' });

    root.append(
      el(
        'div',
        { class: 'rl' },
        el(
          'div',
          { class: 'rl__stage felt' },
          el('div', { class: 'rl__wheel' }, wheel, numEl),
          el('div', { class: 'rl__info' }, phaseEl, timeEl, histEl, teamEl)
        ),
        el('div', { class: 'rl__play' }, el('div', { class: 'rl__scroll' }, board), el('div', { class: 'rl__controls' }, tray, undoBtn, clearBtn, rebetBtn, totalEl, readyBtn))
      )
    );

    const clock = setInterval(() => {
      if (state && state.phase === 'betting' && state.deadline) {
        timeEl.textContent = `Gira en ${Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000))} s`;
      } else {
        timeEl.textContent = '';
      }
    }, 250);

    function update(s) {
      const first = state === null;
      state = s;
      const myId = api.me().id;
      phaseEl.textContent = PHASE_TEXT[s.phase] || '';

      if (s.phase === 'spinning') {
        if (spunRound !== s.round) {
          spunRound = s.round;
          showNumber(null, false);
          wheel.spin(s.number, Math.max(0, s.deadline - api.serverNow()));
          dealer.say('spin');
          api.audio.play('spin');
        }
      } else if (s.phase === 'result') {
        if (spunRound !== s.round) {
          spunRound = s.round; // joined after the spin: just show where the ball is
          wheel.settle(s.number);
        }
        showNumber(s.number, true);
      } else if (first) {
        if (s.history.length) {
          wheel.settle(s.history[0]);
          showNumber(s.history[0], false);
        } else {
          wheel.clear();
        }
      } else {
        numEl.classList.remove('is-final');
      }

      clear(histEl);
      for (const n of s.history.slice(0, 14)) histEl.append(el('span', { class: `rl__hist rl__hist--${colorOf(n)}` }, String(n)));

      const totals = new Map();
      for (const p of s.players) {
        for (const b of p.bets) {
          const t = totals.get(b.spot) || { total: 0, mine: false };
          t.total += b.amount;
          if (p.id === myId) t.mine = true;
          totals.set(b.spot, t);
        }
      }
      const winning = new Set(s.phase === 'result' && s.result ? s.result.winningSpots.concat(`straight:${s.number}`) : []);
      for (const [id, spot] of spots) {
        const t = totals.get(id);
        const sig = t ? `${t.total}:${t.mine}` : '';
        if (shown.get(id) !== sig) {
          shown.set(id, sig);
          clear(spot.chips);
          if (t) {
            const chip = createChip(t.total, { size: 'sm', label: formatCompact(t.total), color: t.mine ? api.me().avatar : undefined });
            chip.classList.add('rl__chip');
            if (t.mine) chip.classList.add('is-mine');
            spot.chips.append(chip);
          }
        }
        spot.btn.classList.toggle('is-win', winning.has(id));
        spot.btn.disabled = !s.you.canBet;
      }

      undoBtn.disabled = !s.you.canUndo;
      clearBtn.disabled = !s.you.canClear;
      rebetBtn.disabled = !s.you.canRebet;
      readyBtn.disabled = !s.you.canReady && !s.you.ready;
      readyBtn.setLabel(s.you.ready ? 'Esperando al resto…' : '¡Listo, que gire!');
      totalEl.textContent = `Tu apuesta: ${formatChips(s.totals.you)}`;
      tray.refresh();

      clear(teamEl);
      const showResult = s.phase === 'result' && s.result;
      const rows = showResult ? s.result.results : s.players.filter((p) => p.total > 0);
      for (const p of rows) {
        teamEl.append(
          el(
            'span',
            { class: 'rl__member' },
            api.bust(p, 24),
            `${p.name} `,
            showResult
              ? el('strong', { class: p.net >= 0 ? 'is-up' : 'is-down' }, `${p.net >= 0 ? '+' : ''}${formatChips(p.net)}`)
              : el('strong', null, `${formatChips(p.total)}${p.ready ? ' ✓' : ''}`)
          )
        );
      }
    }

    function event(name, payload) {
      if (name !== 'result') return;
      const mine = payload.results.find((r) => r.id === api.me().id);
      if (!mine) return;
      if (mine.net > 0) {
        api.audio.play(mine.net >= mine.wagered * 5 ? 'bigwin' : 'win');
        dealer.say(mine.net >= mine.wagered * 5 ? 'bigwin' : 'win');
        api.ui.showBanner(root, { title: `+${formatChips(mine.net)}`, subtitle: `Salió el ${payload.number}`, kind: 'win' });
        api.fx.pay(spots.get(`straight:${payload.number}`).btn, mine.won);
        if (mine.net >= mine.wagered * 5) api.ui.celebrate({ kind: 'bigwin', amount: mine.net });
      } else if (mine.net < 0) {
        api.audio.play('lose');
        dealer.say('lose');
        api.ui.showBanner(root, { title: `Salió el ${payload.number}`, subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
        api.fx.take(board, -mine.net);
      } else {
        dealer.say('push');
      }
    }

    return {
      update,
      event,
      destroy() {
        clearInterval(clock);
        wheel.destroy();
        dealer.destroy();
      },
    };
  },
};
