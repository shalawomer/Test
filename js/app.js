/* Pocket Logic — app shell: home screen, routing, levels, timer, saving, win screen. */
(function (PL) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ORDER = ['flow', 'nonogram', 'bridges', 'beacons'];
  const STORE_KEY = 'pocket-logic:v1';

  let session = null; // the puzzle being played: { game, size, key, level, view, elapsed, hints, ... }
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
    s.progress = s.progress || {};
    s.saves = s.saves || {};
    s.lastSize = s.lastSize || {};
    return s;
  })();
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* private mode etc. */ } };

  // ------------------------------------------------------------ theme

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

  // ------------------------------------------------------------ home

  function renderHome() {
    const list = $('gameList');
    list.innerHTML = '';
    for (const id of ORDER) {
      const g = PL.games[id];
      let solved = 0;
      for (const z of g.sizes) solved += (store.progress[`${id}:${z.id}`] || {}).solved || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'game-card';
      btn.innerHTML = `
        <div class="game-icon">${ICONS[id]}</div>
        <div>
          <h2>${g.name}${g.original ? ' <span class="badge">Original</span>' : ''}</h2>
          <p>${g.blurb}</p>
          <div class="progress">${solved ? `${solved} solved · ` : ''}${g.sizes.length} sizes · ∞ levels</div>
        </div>`;
      btn.addEventListener('click', () => { location.hash = `#/${id}`; });
      list.appendChild(btn);
    }
  }

  // ------------------------------------------------------------ session

  function saveSession() {
    clearTimeout(saveTimer);
    if (!session || session.solved) return;
    store.saves[session.key] = {
      level: session.level,
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

  function progressFor(key) {
    return store.progress[key] || (store.progress[key] = { level: 1, solved: 0, best: 0 });
  }

  function startPuzzle(game, size) {
    endSession();
    $('win').hidden = true;
    store.lastSize[game.id] = size.id;
    const key = `${game.id}:${size.id}`;
    const level = progressFor(key).level;
    $('levelLabel').textContent = `Level ${level}`;
    $('timer').textContent = '0:00';
    $('status').textContent = '';
    $('tools').innerHTML = '';
    $('loading').hidden = false;
    const token = (pending = {});
    // let the "Generating…" state paint before the (usually instant) generator runs
    setTimeout(() => {
      if (pending !== token) return;
      pending = null;
      const puzzle = game.generate(new PL.RNG(PL.seedFor(game.id, size.id, level)), size);
      const saved = store.saves[key] && store.saves[key].level === level ? store.saves[key] : null;
      $('loading').hidden = true;
      const view = new game.View($('boardWrap'), puzzle, {
        saved: saved && saved.state,
        onChange: () => { updateStatus(); scheduleSave(); },
        onWin: () => onWin(),
      });
      session = {
        game, size, key, level, view,
        elapsed: saved ? saved.elapsed || 0 : 0,
        hints: saved ? saved.hints || 0 : 0,
        tick: performance.now(),
        solved: false,
      };
      renderTools();
      updateStatus();
      updateTimer();
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
    if (!session.solved && !document.hidden && $('win').hidden) {
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

  function onWin() {
    const s = session;
    s.solved = true;
    s.elapsed += performance.now() - s.tick;
    s.tick = performance.now();
    const prog = progressFor(s.key);
    prog.solved++;
    prog.level = s.level + 1;
    const best = !prog.best || s.elapsed < prog.best;
    if (best) prog.best = Math.round(s.elapsed);
    delete store.saves[s.key];
    persist();
    updateStatus();
    updateTimer();
    setTimeout(() => {
      if (session !== s) return;
      $('winTitle').textContent = best && prog.solved > 1 ? 'New best time!' : 'Solved!';
      $('winText').textContent = `${s.game.name} ${s.size.label} · Level ${s.level}`;
      $('winStats').innerHTML = `
        <div><dt>Time</dt><dd>${PL.formatTime(s.elapsed)}</dd></div>
        <div><dt>Best</dt><dd>${PL.formatTime(prog.best)}</dd></div>
        <div><dt>Hints</dt><dd>${s.hints}</dd></div>`;
      $('win').hidden = false;
      $('winNext').focus();
    }, 500);
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

  function showPlay(game, size) {
    $('home').hidden = true;
    $('play').hidden = false;
    $('backBtn').hidden = false;
    $('title').textContent = game.name;
    document.title = `${game.name} · Pocket Logic`;
    const tabs = $('sizeTabs');
    tabs.innerHTML = '';
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
        showPlay(game, z);
      });
      tabs.appendChild(b);
    }
    startPuzzle(game, size);
  }

  function route() {
    const m = /^#\/(\w+)(?:\/(\w+))?/.exec(location.hash);
    const game = m && PL.games[m[1]];
    if (!game) return showHome();
    const size =
      game.sizes.find((z) => z.id === m[2]) ||
      game.sizes.find((z) => z.id === store.lastSize[game.id]) ||
      game.sizes.find((z) => z.id === game.defaultSize);
    showPlay(game, size);
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
    if (!session || session.solved) return;
    if (session.view.history.length && !confirm('Skip this puzzle? Your progress on it will be lost.')) return;
    const { game, size, key } = session;
    progressFor(key).level++;
    delete store.saves[key];
    session.solved = true; // don't re-save the skipped board
    persist();
    startPuzzle(game, size);
  });
  $('winNext').addEventListener('click', () => { if (session) startPuzzle(session.game, session.size); });
  $('winHome').addEventListener('click', () => { location.hash = '#/'; });

  $('helpBtn').addEventListener('click', () => {
    const game = session ? session.game : null;
    $('helpTitle').textContent = game ? `How to play ${game.name}` : 'About Pocket Logic';
    $('helpBody').innerHTML = game
      ? game.rules + '<p class="muted">Undo, Restart and Hint are below the board. Your progress is saved automatically.</p>'
      : `<p>Every puzzle here is built by code the moment you open it, from a seed made of the game, size and level number. That means unlimited levels, no downloads, and it all works offline.</p>
         <ul>${ORDER.map((id) => `<li><b>${PL.games[id].name}</b> — ${PL.games[id].blurb}</li>`).join('')}</ul>
         <p>Nonogram, Bridges and Beacons puzzles are checked by a solver to have exactly one solution.</p>`;
    $('helpDialog').showModal();
  });

  document.addEventListener('keydown', (e) => {
    if (!session || $('helpDialog').open) return;
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
