// Ruleta — client plugin (simple version: number ticker instead of an animated wheel).
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const PHASE_TEXT = { idle: 'Hagan sus apuestas', betting: 'Hagan sus apuestas', spinning: 'No va más…', result: 'Resultado' };

export default {
  id: 'roulette',
  icon: 'star',
  mount(root, api) {
    const { el, clear, formatChips, createButton } = api.ui;
    let state = null;
    let ticker = null;
    let tickedRound = null;

    const phaseEl = el('div', { class: 'rl__phase' });
    const timeEl = el('div', { class: 'rl__time' });
    const numEl = el('div', { class: 'rl__number' }, '–');
    const histEl = el('div', { class: 'rl__history' });
    const teamEl = el('div', { class: 'rl__team' });
    const board = el('div', { class: 'rl__board' });
    const spots = new Map();

    function addSpot(id, label, cls, style) {
      const chips = el('span', { class: 'rl__chips' });
      const btn = el(
        'button',
        {
          class: `rl__spot ${cls || ''}`,
          type: 'button',
          style,
          onClick: () => api.send({ type: 'bet', spot: id, amount: tray.value }),
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

    const tray = api.ui.createChipTray({ values: [5, 25, 100, 500], value: 25, onChange() {}, getBalance: () => api.me().balance });
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
        el('div', { class: 'rl__top felt' }, el('div', { class: 'rl__status' }, phaseEl, timeEl), numEl, histEl),
        el('div', { class: 'rl__scroll' }, board),
        el('div', { class: 'rl__controls' }, tray, undoBtn, clearBtn, rebetBtn, totalEl, readyBtn),
        teamEl
      )
    );

    function showNumber(n, final) {
      numEl.textContent = n === null || n === undefined ? '–' : String(n);
      numEl.className = `rl__number${n === null || n === undefined ? '' : ` rl__number--${colorOf(n)}`}${final ? ' is-final' : ''}`;
    }

    function stopTicker() {
      if (ticker) clearTimeout(ticker);
      ticker = null;
    }

    function startTicker(endAt, final) {
      stopTicker();
      const tick = () => {
        const left = endAt - api.serverNow();
        if (left <= 300) {
          ticker = null;
          showNumber(final, true);
          api.audio.play('flip');
          return;
        }
        showNumber(Math.floor(Math.random() * 37), false);
        api.audio.play('tick');
        ticker = setTimeout(tick, left > 5000 ? 70 : left > 2500 ? 130 : left > 1200 ? 240 : 380);
      };
      tick();
    }

    const clock = setInterval(() => {
      if (state && state.phase === 'betting' && state.deadline) {
        timeEl.textContent = `${Math.max(0, Math.ceil((state.deadline - api.serverNow()) / 1000))} s`;
      } else {
        timeEl.textContent = '';
      }
    }, 250);

    function update(s) {
      state = s;
      const myId = api.me().id;
      phaseEl.textContent = PHASE_TEXT[s.phase] || '';

      if (s.phase === 'spinning') {
        if (tickedRound !== s.round) {
          tickedRound = s.round;
          startTicker(s.deadline, s.number);
        }
      } else if (s.phase === 'result') {
        stopTicker();
        showNumber(s.number, true);
      } else {
        stopTicker();
        showNumber(s.history.length ? s.history[0] : null, false);
      }

      clear(histEl);
      for (const n of s.history.slice(0, 12)) histEl.append(el('span', { class: `rl__hist rl__hist--${colorOf(n)}` }, String(n)));

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
        spot.chips.textContent = t ? formatChips(t.total) : '';
        spot.chips.className = `rl__chips${t ? ' is-on' : ''}${t && t.mine ? ' is-mine' : ''}`;
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
            api.ui.createAvatar(p, { size: 'xs' }),
            `${p.name} `,
            showResult
              ? el('strong', { class: p.net >= 0 ? 'is-up' : 'is-down' }, `${p.net >= 0 ? '+' : ''}${formatChips(p.net)}`)
              : el('strong', null, `${formatChips(p.total)}${p.ready ? ' ✓' : ''}`)
          )
        );
      }
    }

    function event(name, payload) {
      if (name === 'bet') api.audio.play('chip');
      if (name === 'result') {
        const mine = payload.results.find((r) => r.id === api.me().id);
        if (!mine) return;
        if (mine.net > 0) {
          api.audio.play(mine.net >= 500 ? 'bigwin' : 'win');
          api.ui.showBanner(root, { title: `+${formatChips(mine.net)}`, subtitle: `Salió el ${payload.number}`, kind: 'win' });
          if (mine.net >= 500) api.ui.celebrate({ kind: 'bigwin', amount: mine.net });
        } else if (mine.net < 0) {
          api.audio.play('lose');
          api.ui.showBanner(root, { title: `Salió el ${payload.number}`, subtitle: `${formatChips(mine.net)} fichas`, kind: 'lose' });
        }
      }
    }

    return {
      update,
      event,
      destroy() {
        stopTicker();
        clearInterval(clock);
      },
    };
  },
};
