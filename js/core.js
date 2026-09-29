/* Pocket Logic — shared core: seeded randomness, game registry, board view base.
 * Plain script (no modules) so the app also runs from file:// and in Node tests. */
(function (PL) {
  'use strict';

  // ---------------------------------------------------------------- seeds / RNG

  /** 32-bit string hash (cyrb53, folded). Same input -> same seed on every device. */
  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ (h2 >>> 1)) >>> 0;
  }

  /** mulberry32 — tiny, fast, good enough for level generation. */
  class RNG {
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(n) { return Math.floor(this.next() * n); }
    range(lo, hi) { return lo + this.int(hi - lo + 1); }
    chance(p) { return this.next() < p; }
    pick(arr) { return arr[this.int(arr.length)]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
  }

  PL.RNG = RNG;
  PL.hashString = hashString;
  PL.seedFor = (gameId, sizeId, level) => hashString(`${gameId}|${sizeId}|${level}`);

  // ---------------------------------------------------------------- registry

  PL.games = PL.games || {};
  PL.register = (game) => { PL.games[game.id] = game; };

  // ---------------------------------------------------------------- helpers

  /** Orthogonal neighbours of cell i on a w×h grid. */
  PL.neighbors4 = function (i, w, h) {
    const r = (i / w) | 0, c = i - r * w, out = [];
    if (r > 0) out.push(i - w);
    if (r < h - 1) out.push(i + w);
    if (c > 0) out.push(i - 1);
    if (c < w - 1) out.push(i + 1);
    return out;
  };

  PL.formatTime = function (ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  // ---------------------------------------------------------------- theme

  const THEME_VARS = [
    'ink', 'muted', 'accent', 'accent-soft', 'danger', 'ok', 'board', 'cell', 'cell-alt',
    'grid', 'grid-strong', 'fill', 'clue', 'clue-done', 'highlight', 'flow-board', 'flow-grid',
    'island', 'island-done', 'bridge', 'beacon', 'beacon-glow', 'tile', 'tile-clue', 'font',
  ];

  /** Canvas colours come from CSS custom properties so light/dark themes stay in one place. */
  PL.theme = function () {
    const cs = getComputedStyle(document.documentElement), out = {};
    for (const v of THEME_VARS) out[v.replace(/-(\w)/g, (_, ch) => ch.toUpperCase())] = cs.getPropertyValue('--' + v).trim();
    return out;
  };

  // ---------------------------------------------------------------- board view

  /**
   * Base class for a canvas puzzle board. Subclasses implement:
   *   layout(w, h) -> {width, height}   geometry for the available CSS size
   *   render(ctx)                        draw everything
   *   onDown(p, e) / onDrag(p, e) / onUp(p, e) / onHover(p)
   *   serialize() / deserialize(s) / reset() / isSolved() / hint() / status()
   */
  class BoardView {
    constructor(host, puzzle, opts) {
      this.host = host;
      this.puzzle = puzzle;
      this.opts = opts || {};
      this.history = [];
      this.won = false;
      this.dpr = 1;
      this.cssW = 0;
      this.cssH = 0;
      this.flashes = [];
      this.colors = PL.theme();
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'board-canvas';
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute('aria-label', 'Puzzle board');
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this._raf = 0;
      this._pointer = null;

      this._h = {
        down: (e) => this._down(e),
        move: (e) => this._move(e),
        up: (e) => this._up(e),
        leave: () => this.onHover(null),
        menu: (e) => e.preventDefault(),
      };
      const cv = this.canvas;
      cv.addEventListener('pointerdown', this._h.down);
      cv.addEventListener('pointermove', this._h.move);
      cv.addEventListener('pointerup', this._h.up);
      cv.addEventListener('pointercancel', this._h.up);
      cv.addEventListener('pointerleave', this._h.leave);
      cv.addEventListener('contextmenu', this._h.menu);
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(host);
    }

    destroy() {
      this._ro.disconnect();
      cancelAnimationFrame(this._raf);
      this.canvas.remove();
    }

    refreshTheme() {
      this.colors = PL.theme();
      this.requestDraw();
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      const { width, height } = this.layout(Math.floor(rect.width), Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.dpr = dpr;
      this.cssW = width;
      this.cssH = height;
      this.draw();
    }

    requestDraw() {
      if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }

    draw() {
      if (!this.cssW) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      const now = performance.now();
      this.flashes = this.flashes.filter((f) => now - f.t < f.dur);
      this.render(ctx, now);
      if (this.flashes.length) this.requestDraw();
    }

    /** Highlight something briefly (hints, blocked moves). Returns 0..1 fade for a flash. */
    flash(data, dur = 1400) { this.flashes.push({ data, t: performance.now(), dur }); this.requestDraw(); }
    flashAlpha(f, now) { const k = (now - f.t) / f.dur; return Math.max(0, Math.sin(Math.min(1, k) * Math.PI)); }

    font(px, weight = 600) { return `${weight} ${Math.round(px)}px ${this.colors.font || 'system-ui, sans-serif'}`; }

    // --- pointer plumbing -------------------------------------------------
    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    _down(e) {
      if (this.won || this._pointer !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this._pointer = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* not critical */ }
      this.onDown(this._pos(e), e);
    }
    _move(e) {
      if (this._pointer === e.pointerId) this.onDrag(this._pos(e), e);
      else if (e.pointerType === 'mouse' && this._pointer === null) this.onHover(this._pos(e));
    }
    _up(e) {
      if (this._pointer !== e.pointerId) return;
      this._pointer = null;
      this.onUp(this._pos(e), e);
    }

    // --- state / history --------------------------------------------------
    pushHistory() {
      this.history.push(this.serialize());
      if (this.history.length > 400) this.history.shift();
    }
    dropHistory() { this.history.pop(); }

    /** Report a feedback event ('tap', 'good', 'hint', 'bad') to the app (sounds, haptics). */
    emit(name) { if (this.opts.onEvent) this.opts.onEvent(name); }

    /** Remember the current progress count so the next commit can tell whether it went up. */
    syncProgress() { this._progress = this.progress(); }

    /**
     * Call after every committed player action. Plays 'good' when a unit of progress was
     * completed (a line, pipe, island…), otherwise `kind` (default 'tap'; 'quiet' plays nothing).
     */
    commit(kind) {
      this.requestDraw();
      const p = this.progress(), up = this._progress !== undefined && p > this._progress;
      this._progress = p;
      if (this.opts.onChange) this.opts.onChange();
      if (!this.won && this.isSolved()) {
        this.won = true;
        this.requestDraw();
        if (this.opts.onWin) this.opts.onWin();
        return;
      }
      if (kind !== 'quiet') this.emit(kind === 'hint' ? 'hint' : up ? 'good' : kind || 'tap');
    }

    undo() {
      if (this.won || !this.history.length) return false;
      this.deserialize(this.history.pop());
      this.commit();
      return true;
    }

    restart() {
      if (this.won) return;
      this.pushHistory();
      this.reset();
      this.commit();
    }

    /** Count of completed units (lines, pipes, islands…); drives the "good" feedback. */
    progress() { return 0; }
    get tools() { return []; }
    setTool() {}
    onHover() {}
  }

  PL.BoardView = BoardView;
})(globalThis.PL = globalThis.PL || {});
