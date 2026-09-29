/* Pocket Logic — app shell: home, daily puzzles, routing, levels, timer, saving, stats, win screen. */
(function (PL) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ORDER = ['flow', 'nonogram', 'bridges', 'beacons'];
  const STORE_KEY = 'pocket-logic:v1';

  let session = null; // the puzzle being played (spec + view, elapsed, hints, …)
  let pending = null; // token for a puzzle that is still being generated
  let saveTimer = 0;

  const ICONS = {
    flow: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#111318"/>
      <g fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 10H54V26" stroke="#f23c32"/><path d="M10 26V54H26" stroke="#2f6bff"/>
        <path d="M26 26H38V42H26" stroke="#f7e03c"/><path d="M54 42V54H42" stroke="#22b14c"/></g>
      <g><circle cx="10" cy="10" r="6" fill="#f23c32"/><circle cx="54" cy="26" r="6" fill="#f23c32"/>
        <circle cx="10" cy="26" r="6" fill="#2f6bff"/><circle cx="26" cy="54" r="6" fill="#2f6bff"/>
        <circle cx="26" cy="26" r="6" fill="#f7e03c"/><circle cx="26" cy="42" r="6" fill="#f7e03c"/>
        <circle cx="54" cy="42" r="6" fill="#22b14c"/><circle cx="42" cy="54" r="6" fill="#22b14c"/></g></svg>`,
    nonogram: (() => {
      const pic = ['.#.#.', '#####', '#####', '.###.', '..#..'];
      let cells = '';
      pic.forEach((row, r) => [...row].forEach((ch, c) => {
        cells += `<rect x="${8 + c * 10}" y="${8 + r * 10}" width="9" height="9" rx="1.5" fill="${ch === '#' ? '#22293b' : '#e7e2d8'}"/>`;
      }));
      return `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#f6f3ec"/>${cells}</svg>`;
    })(),
    bridges: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#e8f1fb"/>
      <g stroke="#2a3142" stroke-width="2.5"><path d="M16 14H48"/><path d="M13 16V48M19 16V48"/><path d="M48 16V48"/><path d="M16 48H48"/></g>
      <g fill="#fff" stroke="#2a3142" stroke-width="2.5"><circle cx="16" cy="14" r="8"/><circle cx="48" cy="14" r="8"/><circle cx="16" cy="48" r="8"/><circle cx="48" cy="48" r="8"/></g>
      <g font-family="system-ui,sans-serif" font-weight="700" font-size="10" fill="#1d2230" text-anchor="middle">
        <text x="16" y="17.5">3</text><text x="48" y="17.5">2</text><text x="16" y="51.5">3</text><text x="48" y="51.5">2</text></g></svg>`,
    beacons: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#1b1e26"/>
      <defs><radialGradient id="bg1"><stop offset="0" stop-color="#ffb300" stop-opacity=".7"/><stop offset="1" stop-color="#ffb300" stop-opacity="0"/></radialGradient></defs>
      <g fill="#2a2e3a">${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${5 + c * 19}" y="${5 + r * 19}" width="16" height="16" rx="3"/>`).join('')).join('')}</g>
      <rect x="43" y="43" width="16" height="16" rx="3" fill="#3a3760"/>
      <circle cx="32" cy="13" r="13" fill="url(#bg1)"/><circle cx="32" cy="13" r="4.5" fill="#ffb300"/>
      <circle cx="13" cy="51" r="13" fill="url(#bg1)"/><circle cx="13" cy="51" r="4.5" fill="#ffb300"/>
      <text x="51" y="55" font-family="system-ui,sans-serif" font-weight="700" font-size="11" fill="#e9ebf0" text-anchor="middle">2</text></svg>`,
  };

  // ------------------------------------------------------------ storage

  const store = (() => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { s = {}; }
    s.progress = s.progress || {};  // "game:size" -> { level, solved, best }
    s.saves = s.saves || {};        // puzzle key  -> { sig, state, elapsed, hints }
    s.lastSize = s.lastSize || {};  // game -> size id
    s.daily = s.daily || {};        // "YYYY-MM-DD" -> { game: { time, hints } }
    s.streak = s.streak || { current: 0, best: 0, last: null };
    s.seen = s.seen || {};          // game -> rules shown once
    return s;
  })();
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* private mode etc. */ } };

  // ------------------------------------------------------------ dates / daily

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftDay = (key, delta) => { const d = parseKey(key); d.setDate(d.getDate() + delta); return dateKey(d); };
  const prettyDate = (key) => parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const dailySize = (game) => game.sizes.find((z) => z.id === game.defaultSize);

  function streakNow() {
    const { last, current } = store.streak, today = dateKey();
    return last === today || last === shiftDay(today, -1) ? current : 0;
  }

  // forget in-progress dailies from earlier days
  for (const k of Object.keys(store.saves)) if (k.startsWith('daily:') && !k.endsWith(dateKey())) delete store.saves[k];

  // ------------------------------------------------------------ theme & sound

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    if (store.theme) document.documentElement.dataset.theme = store.theme;
    else delete document.documentElement.dataset.theme;
    if (session) session.view.refreshTheme();
  }
  $('themeBtn').addEventListener('click', () => {
    const effective = store.theme || (darkQuery.matches ? 'dark' : 'light');
    const next = effective === 'dark' ? 'light' : 'dark';
    store.theme = next === (darkQuery.matches ? 'dark' : 'light') ? null : next;
    persist();
    applyTheme();
  });
  darkQuery.addEventListener('change', () => { if (session) session.view.refreshTheme(); });
  applyTheme();

  function applySound() {
    PL.fx.enabled = store.sound !== false;
    $('soundBtn').setAttribute('aria-pressed', String(PL.fx.enabled));
    $('soundBtn').classList.toggle('muted-icon', !PL.fx.enabled);
  }
  $('soundBtn').addEventListener('click', () => {
    store.sound = store.sound === false;
    persist();
    applySound();
    PL.fx.play('tap');
  });
  applySound();

  // ------------------------------------------------------------ home

  function renderHome() {
    const today = dateKey(), results = store.daily[today] || {};
    $('dailyDate').textContent = prettyDate(today);
    const streak = streakNow();
    $('streak').innerHTML = streak ? `<b>${streak}</b>-day streak` : 'No streak yet';
    $('streak').classList.toggle('lit', streak > 0);

    const daily = $('dailyList');
    daily.innerHTML = '';
    for (const id of ORDER) {
      const g = PL.games[id], r = results[id];
      const busy = !r && store.saves[`daily:${id}:${today}`];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'daily-tile' + (r ? ' done' : '');
      btn.innerHTML = `
        <span class="daily-icon">${ICONS[id]}</span>
        <span class="daily-name">${g.name}</span>
        <span class="daily-state">${r ? `✓ ${PL.formatTime(r.time)}` : busy ? 'Continue' : 'Play'}</span>`;
      btn.setAttribute('aria-label', `Daily ${g.name}: ${r ? `solved in ${PL.formatTime(r.time)}` : busy ? 'in progress' : 'not played'}`);
      btn.addEventListener('click', () => { location.hash = `#/daily/${id}`; });
      daily.appendChild(btn);
    }

    const list = $('gameList');
    list.innerHTML = '';
    for (const id of ORDER) {
      const g = PL.games[id];
      let solved = 0;
      for (const z of g.sizes) solved += (store.progress[`${id}:${z.id}`] || {}).solved || 0;
      const size = g.sizes.find((z) => z.id === store.lastSize[id]) || dailySize(g);
      const next = (store.progress[`${id}:${size.id}`] || {}).level || 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'game-card';
      btn.innerHTML = `
        <div class="game-icon">${ICONS[id]}</div>
        <div>
          <h2>${g.name}${g.original ? ' <span class="badge">Original</span>' : ''}</h2>
          <p>${g.blurb}</p>
          <div class="progress">${solved ? `${solved} solved · next: ${size.label} level ${next}` : `${g.sizes.length} sizes · ∞ levels`}</div>
        </div>`;
      btn.addEventListener('click', () => { location.hash = `#/${id}`; });
      list.appendChild(btn);
    }
  }

  // ------------------------------------------------------------ puzzle specs

  function progressFor(key) {
    return store.progress[key] || (store.progress[key] = { level: 1, solved: 0, best: 0 });
  }

  function levelSpec(game, size) {
    const key = `${game.id}:${size.id}`, level = progressFor(key).level;
    return { mode: 'level', game, size, key, level, seed: PL.seedFor(game.id, size.id, level), label: `Level ${level}` };
  }

  function dailySpec(game, date = dateKey()) {
    return {
      mode: 'daily', game, size: dailySize(game), date,
      key: `daily:${game.id}:${date}`,
      seed: PL.hashString(`daily|${game.id}|${date}`),
      label: prettyDate(date),
    };
  }

  // ------------------------------------------------------------ session

  function saveSession() {
    clearTimeout(saveTimer);
    if (!session || session.solved) return;
    if (!session.view.history.length && !store.saves[session.key]) return; // nothing played yet
    store.saves[session.key] = {
      sig: session.sig,
      state: session.view.serialize(),
      elapsed: Math.round(session.elapsed),
      hints: session.hints,
    };
    persist();
  }
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 400); };

  function endSession() {
    saveSession();
    pending = null;
    if (session) session.view.destroy();
    session = null;
  }

  function startPuzzle(spec) {
    endSession();
    $('win').hidden = true;
    if (spec.mode === 'level') store.lastSize[spec.game.id] = spec.size.id;
    $('levelLabel').textContent = spec.label;
    $('timer').textContent = '0:00';
    $('status').textContent = '';
    $('tools').innerHTML = '';
    $('loading').hidden = false;
    $('skipBtn').hidden = spec.mode !== 'level';
    const token = (pending = {});
    // let the "Generating…" state paint before the (usually instant) generator runs
    setTimeout(() => {
      if (pending !== token) return;
      pending = null;
      const { game, size } = spec;
      const puzzle = game.generate(new PL.RNG(spec.seed), size);
      const sig = PL.hashString(JSON.stringify(puzzle));
      const saved = store.saves[spec.key] && store.saves[spec.key].sig === sig ? store.saves[spec.key] : null;
      $('loading').hidden = true;
      const view = new game.View($('boardWrap'), puzzle, {
        saved: saved && saved.state,
        onChange: () => { updateStatus(); scheduleSave(); },
        onWin: () => onWin(),
        onEvent: (name) => PL.fx.play(name),
      });
      view.syncProgress();
      session = Object.assign({}, spec, {
        view, sig,
        elapsed: saved ? saved.elapsed || 0 : 0,
        hints: saved ? saved.hints || 0 : 0,
        tick: performance.now(),
        solved: false,
      });
      renderTools();
      updateStatus();
      updateTimer();
      if (!store.seen[game.id]) {
        store.seen[game.id] = 1;
        persist();
        openHelp(game);
      }
    }, 16);
  }

  function updateStatus() {
    if (!session) return;
    $('status').textContent = session.solved ? 'Solved!' : session.view.status();
    $('undoBtn').disabled = session.solved || !session.view.history.length;
    for (const id of ['restartBtn', 'hintBtn', 'skipBtn']) $(id).disabled = session.solved;
  }

  function updateTimer() {
    if (session) $('timer').textContent = PL.formatTime(session.elapsed);
  }

  setInterval(() => {
    if (!session) return;
    const now = performance.now();
    const paused = session.solved || document.hidden || !$('win').hidden || document.querySelector('dialog[open]');
    if (!paused) {
      session.elapsed += now - session.tick;
      updateTimer();
    }
    session.tick = now;
  }, 250);

  function renderTools() {
    const box = $('tools');
    box.innerHTML = '';
    for (const t of session.view.tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.active));
      b.textContent = `${t.icon ? t.icon + ' ' : ''}${t.label}`;
      b.addEventListener('click', () => { session.view.setTool(t.id); renderTools(); });
      box.appendChild(b);
    }
  }

  // ------------------------------------------------------------ winning

  function nextDaily(date) {
    const done = store.daily[date] || {};
    return ORDER.find((id) => !done[id]);
  }

  function onWin() {
    const s = session, time = () => PL.formatTime(s.elapsed);
    s.solved = true;
    s.elapsed = Math.round(s.elapsed + performance.now() - s.tick);
    s.tick = performance.now();
    PL.fx.play('win');
    PL.fx.confetti(PL.games.flow.logic.PALETTE.slice(0, 9));
    delete store.saves[s.key];

    let title = 'Solved!', text, stats;
    if (s.mode === 'level') {
      const prog = progressFor(s.key);
      prog.solved++;
      prog.level = s.level + 1;
      const best = !prog.best || s.elapsed < prog.best;
      if (best) prog.best = s.elapsed;
      if (best && prog.solved > 1) title = 'New best time!';
      text = `${s.game.name} ${s.size.label} · Level ${s.level}`;
      stats = [['Time', time()], ['Best', PL.formatTime(prog.best)], ['Hints', s.hints]];
    } else {
      const day = store.daily[s.date] || (store.daily[s.date] = {});
      day[s.game.id] = { time: s.elapsed, hints: s.hints };
      const st = store.streak;
      if (!st.last || s.date > st.last) {
        st.current = st.last === shiftDay(s.date, -1) ? st.current + 1 : 1;
        st.last = s.date;
        st.best = Math.max(st.best, st.current);
      }
      title = nextDaily(s.date) ? 'Daily solved!' : 'All dailies done!';
      text = `${s.game.name} · ${prettyDate(s.date)}`;
      stats = [['Time', time()], ['Streak', `${streakNow()}d`], ['Hints', s.hints]];
    }
    persist();
    updateStatus();
    updateTimer();

    setTimeout(() => {
      if (session !== s) return;
      $('winTitle').textContent = title;
      $('winText').textContent = text;
      $('winStats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
      const next = s.mode === 'daily' ? nextDaily(s.date) : true;
      $('winNext').hidden = !next;
      $('winNext').textContent = s.mode === 'daily' ? (next ? `Next: ${PL.games[next].name}` : '') : 'Next puzzle';
      $('winShare').textContent = 'Share';
      $('win').hidden = false;
      (next ? $('winNext') : $('winShare')).focus();
    }, 650);
  }

  function shareText(s) {
    const url = /^https?:$/.test(location.protocol) ? '\n' + location.href.split('#')[0] : '';
    const hintText = (n) => (n ? ` (${n} hint${n > 1 ? 's' : ''})` : '');
    if (s.mode === 'daily') {
      const day = store.daily[s.date] || {};
      const lines = ORDER.map((id) => {
        const r = day[id];
        return `${r ? '🟩' : '⬜'} ${PL.games[id].name}${r ? ' ' + PL.formatTime(r.time) + hintText(r.hints) : ''}`;
      });
      return `Pocket Logic daily · ${prettyDate(s.date)}\n${lines.join('\n')}\nStreak: ${streakNow()}${url}`;
    }
    return `Pocket Logic · ${s.game.name} ${s.size.label} · Level ${s.level}\nSolved in ${PL.formatTime(s.elapsed)}${s.hints ? hintText(s.hints) : ', no hints'} 🧩${url}`;
  }

  async function share() {
    if (!session) return;
    const text = shareText(session), btn = $('winShare');
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the share sheet
      window.prompt('Copy your result:', text);
    }
  }

  // ------------------------------------------------------------ dialogs

  function openHelp(game) {
    $('helpTitle').textContent = game ? `How to play ${game.name}` : 'About Pocket Logic';
    $('helpBody').innerHTML = game
      ? game.rules + '<p class="muted">Undo, Restart and Hint are below the board. Your progress is saved automatically.</p>'
      : `<p>Every puzzle here is built by code the moment you open it, from a seed made of the game, size and level number. That means unlimited levels, no downloads, and it all works offline.</p>
         <ul>${ORDER.map((id) => `<li><b>${PL.games[id].name}</b> — ${PL.games[id].blurb}</li>`).join('')}</ul>
         <p>Every puzzle is checked by a solver to have exactly one solution. The daily puzzles are the same for everyone each day.</p>`;
    if (!$('helpDialog').open) $('helpDialog').showModal();
  }

  function openStats() {
    let solved = 0;
    const tags = PL.games[ORDER[0]].sizes.map((z) => z.tag);
    const rows = ORDER.map((id) => {
      const g = PL.games[id];
      const cells = g.sizes.map((z) => {
        const p = store.progress[`${id}:${z.id}`] || {};
        solved += p.solved || 0;
        return p.solved
          ? `<td><b>${p.solved}</b><span>${PL.formatTime(p.best)}</span></td>`
          : `<td class="none">—</td>`;
      });
      return `<tr><th scope="row">${g.name}</th>${cells.join('')}</tr>`;
    });
    const dailies = Object.values(store.daily).reduce((n, day) => n + Object.keys(day).length, 0);
    $('statsBody').innerHTML = `
      <dl class="stat-tiles">
        <div><dt>Solved</dt><dd>${solved + dailies}</dd></div>
        <div><dt>Dailies</dt><dd>${dailies}</dd></div>
        <div><dt>Streak</dt><dd>${streakNow()}</dd></div>
        <div><dt>Record</dt><dd>${store.streak.best}</dd></div>
      </dl>
      <table class="stats-grid">
        <caption>Levels solved and best time, by difficulty</caption>
        <thead><tr><th></th>${tags.map((t) => `<th scope="col">${t}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>`;
    $('statsDialog').showModal();
  }

  // ------------------------------------------------------------ screens / routing

  function showHome() {
    endSession();
    $('win').hidden = true;
    $('play').hidden = true;
    $('home').hidden = false;
    $('backBtn').hidden = true;
    $('title').textContent = 'Pocket Logic';
    document.title = 'Pocket Logic';
    renderHome();
  }

  function showPlay(spec) {
    const { game, size } = spec;
    $('home').hidden = true;
    $('play').hidden = false;
    $('backBtn').hidden = false;
    $('title').textContent = game.name;
    document.title = `${game.name} · Pocket Logic`;
    const tabs = $('sizeTabs');
    tabs.innerHTML = '';
    if (spec.mode === 'daily') {
      tabs.innerHTML = `<span class="size-tab daily-chip" aria-selected="true">${size.label} · Daily</span>`;
    } else {
      for (const z of game.sizes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'size-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(z === size));
        b.title = z.tag;
        b.textContent = z.label;
        b.addEventListener('click', () => {
          if (z === size && session) return;
          history.replaceState(null, '', `#/${game.id}/${z.id}`);
          showPlay(levelSpec(game, z));
        });
        tabs.appendChild(b);
      }
    }
    startPuzzle(spec);
  }

  function route() {
    const daily = /^#\/daily\/(\w+)/.exec(location.hash);
    if (daily && PL.games[daily[1]]) return showPlay(dailySpec(PL.games[daily[1]]));
    const m = /^#\/(\w+)(?:\/(\w+))?/.exec(location.hash);
    const game = m && PL.games[m[1]];
    if (!game) return showHome();
    const size =
      game.sizes.find((z) => z.id === m[2]) ||
      game.sizes.find((z) => z.id === store.lastSize[game.id]) ||
      dailySize(game);
    showPlay(levelSpec(game, size));
  }

  // ------------------------------------------------------------ controls

  $('backBtn').addEventListener('click', () => { location.hash = '#/'; });
  $('undoBtn').addEventListener('click', () => { if (session) session.view.undo(); updateStatus(); });
  $('restartBtn').addEventListener('click', () => { if (session) session.view.restart(); });
  $('hintBtn').addEventListener('click', () => {
    if (!session || session.solved) return;
    session.hints++;
    if (!session.view.hint()) session.hints--;
    scheduleSave();
  });
  $('skipBtn').addEventListener('click', () => {
    if (!session || session.solved || session.mode !== 'level') return;
    if (session.view.history.length && !confirm('Skip this puzzle? Your progress on it will be lost.')) return;
    const { game, size, key } = session;
    progressFor(key).level++;
    delete store.saves[key];
    session.solved = true; // don't re-save the skipped board
    persist();
    startPuzzle(levelSpec(game, size));
  });
  $('winNext').addEventListener('click', () => {
    if (!session) return;
    if (session.mode === 'daily') {
      const next = nextDaily(session.date);
      location.hash = next ? `#/daily/${next}` : '#/';
    } else {
      startPuzzle(levelSpec(session.game, session.size));
    }
  });
  $('winHome').addEventListener('click', () => { location.hash = '#/'; });
  $('winShare').addEventListener('click', share);
  $('helpBtn').addEventListener('click', () => openHelp(session ? session.game : null));
  $('statsBtn').addEventListener('click', openStats);

  document.addEventListener('keydown', (e) => {
    if (!session || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); session.view.undo(); updateStatus(); }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
  window.addEventListener('pagehide', saveSession);
  window.addEventListener('hashchange', route);

  // read-only handle for debugging and the browser smoke test
  PL.currentSession = () => session;

  route();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})(globalThis.PL = globalThis.PL || {});
