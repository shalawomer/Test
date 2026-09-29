/* Nonogram — paint cells so every row/column matches its run-length clues.
 * Generator: random picture -> run the line solver -> flip an undecided cell and repeat
 * until the picture is solvable by line logic alone (so the answer is unique, no guessing). */
(function (PL) {
  'use strict';

  const EMPTY = 0, FILL = 1, CROSS = 2;

  // ---------------------------------------------------------------- logic

  function runLengths(get, n) {
    const out = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (get(i)) run++;
      else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
  }

  function cluesOf(grid, w, h) {
    const rows = [], cols = [];
    for (let r = 0; r < h; r++) rows.push(runLengths((i) => grid[r * w + i] === 1, w));
    for (let c = 0; c < w; c++) cols.push(runLengths((i) => grid[i * w + c] === 1, h));
    return { rows, cols };
  }

  const sameRuns = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  /**
   * Solve one line. `line` holds -1 (unknown), 0 (empty), 1 (filled).
   * Returns a new line with every cell forced by the clue, or null on contradiction.
   */
  function solveLine(line, clue) {
    const n = line.length, k = clue.length, W = k + 1;
    const zeros = new Int16Array(n + 1);
    for (let i = 0; i < n; i++) zeros[i + 1] = zeros[i] + (line[i] === 0 ? 1 : 0);
    const memo = new Int8Array((n + 1) * W).fill(-1);

    const fits = (pos, len) =>
      pos + len <= n && zeros[pos + len] === zeros[pos] && (pos + len === n || line[pos + len] !== 1);

    // Can cells pos..n-1 hold blocks b..k-1?
    function ok(pos, b) {
      if (pos >= n) return b === k;
      const key = pos * W + b;
      if (memo[key] !== -1) return memo[key] === 1;
      let r = false;
      if (line[pos] !== 1 && ok(pos + 1, b)) r = true;
      else if (b < k && fits(pos, clue[b]) && ok(Math.min(pos + clue[b] + 1, n), b + 1)) r = true;
      memo[key] = r ? 1 : 0;
      return r;
    }
    if (!ok(0, 0)) return null;

    const canFill = new Uint8Array(n), canEmpty = new Uint8Array(n);
    const seen = new Uint8Array((n + 1) * W);
    (function mark(pos, b) {
      if (pos >= n) return;
      const key = pos * W + b;
      if (seen[key]) return;
      seen[key] = 1;
      if (line[pos] !== 1 && ok(pos + 1, b)) { canEmpty[pos] = 1; mark(pos + 1, b); }
      if (b < k && fits(pos, clue[b])) {
        const len = clue[b], nx = Math.min(pos + len + 1, n);
        if (ok(nx, b + 1)) {
          for (let i = pos; i < pos + len; i++) canFill[i] = 1;
          if (pos + len < n) canEmpty[pos + len] = 1;
          mark(nx, b + 1);
        }
      }
    })(0, 0);

    const out = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      if (!canFill[i] && !canEmpty[i]) return null;
      out[i] = canFill[i] && canEmpty[i] ? -1 : canFill[i] ? 1 : 0;
    }
    return out;
  }

  /** Iterated line solving. Returns {ok, solved, grid} where grid has -1 for undecided cells. */
  function lineSolve(rows, cols, w, h, start) {
    const g = start ? Int8Array.from(start) : new Int8Array(w * h).fill(-1);
    const dirtyR = new Uint8Array(h).fill(1), dirtyC = new Uint8Array(w).fill(1);
    const line = (len) => new Int8Array(len);
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < h; r++) {
        if (!dirtyR[r]) continue;
        dirtyR[r] = 0;
        const cur = line(w);
        for (let c = 0; c < w; c++) cur[c] = g[r * w + c];
        const res = solveLine(cur, rows[r]);
        if (!res) return { ok: false, solved: false, grid: g };
        for (let c = 0; c < w; c++) {
          if (cur[c] === -1 && res[c] !== -1) { g[r * w + c] = res[c]; dirtyC[c] = 1; changed = true; }
        }
      }
      for (let c = 0; c < w; c++) {
        if (!dirtyC[c]) continue;
        dirtyC[c] = 0;
        const cur = line(h);
        for (let r = 0; r < h; r++) cur[r] = g[r * w + c];
        const res = solveLine(cur, cols[c]);
        if (!res) return { ok: false, solved: false, grid: g };
        for (let r = 0; r < h; r++) {
          if (cur[r] === -1 && res[r] !== -1) { g[r * w + c] = res[r]; dirtyR[r] = 1; changed = true; }
        }
      }
    }
    return { ok: true, solved: g.every((v) => v !== -1), grid: g };
  }

  function randomPicture(rng, w, h) {
    const g = new Uint8Array(w * h);
    const style = rng.int(3);
    const density = 0.5 + rng.next() * 0.14;
    if (style === 0) {
      // plain noise
      for (let i = 0; i < g.length; i++) g[i] = rng.chance(density) ? 1 : 0;
    } else if (style === 1) {
      // blobby: noise + one majority smoothing pass (reads more like a picture)
      const noise = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) noise[i] = rng.chance(density + 0.04) ? 1 : 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          let s = 0, t = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
              t++; s += noise[rr * w + cc];
            }
          }
          g[r * w + c] = s * 2 > t || (s * 2 === t && rng.chance(0.5)) ? 1 : 0;
        }
      }
    } else {
      // mirrored left/right with a little asymmetry
      const half = Math.ceil(w / 2);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < half; c++) {
          const v = rng.chance(density) ? 1 : 0;
          g[r * w + c] = v;
          g[r * w + (w - 1 - c)] = rng.chance(0.9) ? v : 1 - v;
        }
      }
    }
    return g;
  }

  function generate(rng, size) {
    const w = size.n, h = size.n;
    for (;;) {
      const g = randomPicture(rng, w, h);
      for (let fix = 0; fix < w * h; fix++) {
        const { rows, cols } = cluesOf(g, w, h);
        const res = lineSolve(rows, cols, w, h);
        if (res.solved) return { w, h, rows, cols, solution: g };
        const open = [];
        for (let i = 0; i < res.grid.length; i++) if (res.grid[i] === -1) open.push(i);
        g[rng.pick(open)] ^= 1;
      }
    }
  }

  function isSolved(puzzle, cells) {
    const { w, h, rows, cols } = puzzle;
    for (let r = 0; r < h; r++) if (!sameRuns(runLengths((i) => cells[r * w + i] === FILL, w), rows[r])) return false;
    for (let c = 0; c < w; c++) if (!sameRuns(runLengths((i) => cells[i * w + c] === FILL, h), cols[c])) return false;
    return true;
  }

  // ---------------------------------------------------------------- view

  class NonogramView extends PL.BoardView {
    constructor(host, puzzle, opts) {
      super(host, puzzle, opts);
      this.cells = new Uint8Array(puzzle.w * puzzle.h);
      this.tool = FILL;
      this.hover = null;
      this.drag = null;
      if (opts && opts.saved) this.deserialize(opts.saved);
    }

    serialize() { return Array.from(this.cells).join(''); }
    deserialize(s) {
      if (typeof s !== 'string' || s.length !== this.cells.length) return;
      for (let i = 0; i < s.length; i++) this.cells[i] = Math.min(2, +s[i] || 0);
    }
    reset() { this.cells.fill(EMPTY); }
    isSolved() { return isSolved(this.puzzle, this.cells); }

    get tools() {
      return [
        { id: 'fill', label: 'Fill', icon: '■', active: this.tool === FILL },
        { id: 'cross', label: 'Mark', icon: '✕', active: this.tool === CROSS },
      ];
    }
    setTool(id) { this.tool = id === 'cross' ? CROSS : FILL; }

    status() {
      const { w, h, rows, cols } = this.puzzle;
      let done = 0;
      for (let r = 0; r < h; r++) if (this.lineDone(true, r)) done++;
      for (let c = 0; c < w; c++) if (this.lineDone(false, c)) done++;
      return `Lines ${done}/${rows.length + cols.length}`;
    }

    lineDone(isRow, k) {
      const { w, h, rows, cols } = this.puzzle;
      return isRow
        ? sameRuns(runLengths((i) => this.cells[k * w + i] === FILL, w), rows[k])
        : sameRuns(runLengths((i) => this.cells[i * w + k] === FILL, h), cols[k]);
    }

    layout(W, H) {
      const { w, h, rows, cols } = this.puzzle;
      const rc = Math.max(1, ...rows.map((r) => r.length));
      const cc = Math.max(1, ...cols.map((c) => c.length));
      const f = 0.6;
      let cell = Math.floor(Math.min(W / (w + rc * f + 0.3), H / (h + cc * f + 0.3), 46));
      cell = Math.max(cell, 12);
      this.cs = cell;
      this.slot = cell * f;
      this.ox = Math.round(rc * this.slot + cell * 0.25);
      this.oy = Math.round(cc * this.slot + cell * 0.25);
      return { width: this.ox + w * cell + 2, height: this.oy + h * cell + 2 };
    }

    cellAt(p) {
      const c = Math.floor((p.x - this.ox) / this.cs), r = Math.floor((p.y - this.oy) / this.cs);
      if (r < 0 || c < 0 || r >= this.puzzle.h || c >= this.puzzle.w) return null;
      return { r, c };
    }

    onHover(p) {
      const cell = p && this.cellAt(p);
      const key = cell ? cell.r * 1000 + cell.c : -1;
      if (key !== this._hoverKey) { this._hoverKey = key; this.hover = cell; this.requestDraw(); }
    }

    onDown(p, e) {
      const cell = this.cellAt(p);
      if (!cell) return;
      const i = cell.r * this.puzzle.w + cell.c;
      const tool = e.button === 2 || this.tool === CROSS ? CROSS : FILL;
      const target = this.cells[i] === tool ? EMPTY : tool;
      this.pushHistory();
      this.drag = { start: cell, tool, target, base: this.cells.slice(), axis: null };
      this.hover = cell;
      this.paintTo(cell);
    }

    onDrag(p) {
      if (!this.drag) return;
      const cell = this.cellAt(p);
      if (!cell) return;
      this.hover = cell;
      this.paintTo(cell);
    }

    onUp() {
      if (!this.drag) return;
      const changed = this.cells.some((v, i) => v !== this.drag.base[i]);
      this.drag = null;
      if (changed) this.commit(); else this.dropHistory();
      this.requestDraw();
    }

    paintTo(cell) {
      const d = this.drag, w = this.puzzle.w;
      let { r, c } = cell;
      if (!d.axis && (r !== d.start.r || c !== d.start.c)) {
        d.axis = Math.abs(r - d.start.r) > Math.abs(c - d.start.c) ? 'v' : 'h';
      }
      if (d.axis === 'h') r = d.start.r;
      if (d.axis === 'v') c = d.start.c;
      this.cells.set(d.base);
      const sr = d.start.r, sc = d.start.c;
      const steps = Math.max(Math.abs(r - sr), Math.abs(c - sc));
      for (let s = 0; s <= steps; s++) {
        const rr = sr + Math.sign(r - sr) * s, cc = sc + Math.sign(c - sc) * s;
        const i = rr * w + cc, b = d.base[i];
        const paint = s === 0 || (d.target === EMPTY ? b === d.tool : b === EMPTY);
        if (paint) this.cells[i] = d.target;
      }
      this.requestDraw();
    }

    hint() {
      if (this.won) return false;
      const { w, h, rows, cols, solution } = this.puzzle;
      // 1) fix a mistake if there is one
      for (let i = 0; i < this.cells.length; i++) {
        const v = this.cells[i];
        if ((v === FILL && !solution[i]) || (v === CROSS && solution[i])) {
          return this.applyHint(i, solution[i] ? FILL : CROSS);
        }
      }
      // 2) otherwise reveal a cell that line logic can deduce from what's already on the board
      const known = new Int8Array(w * h).fill(-1);
      for (let i = 0; i < known.length; i++) {
        if (this.cells[i] === FILL) known[i] = 1;
        else if (this.cells[i] === CROSS) known[i] = 0;
      }
      const lines = [];
      for (let r = 0; r < h; r++) lines.push({ clue: rows[r], idx: Array.from({ length: w }, (_, c) => r * w + c) });
      for (let c = 0; c < w; c++) lines.push({ clue: cols[c], idx: Array.from({ length: h }, (_, r) => r * w + c) });
      let empty = -1;
      for (const { clue, idx } of lines) {
        const cur = Int8Array.from(idx, (i) => known[i]);
        const res = solveLine(cur, clue);
        if (!res) continue;
        for (let k = 0; k < idx.length; k++) {
          if (cur[k] !== -1 || res[k] === -1) continue;
          if (res[k] === 1) return this.applyHint(idx[k], FILL); // prefer revealing a filled cell
          if (empty < 0) empty = idx[k];
        }
      }
      if (empty >= 0) return this.applyHint(empty, CROSS);
      for (let i = 0; i < solution.length; i++) {
        if (solution[i] && this.cells[i] !== FILL) return this.applyHint(i, FILL);
      }
      return false;
    }

    applyHint(i, value) {
      this.pushHistory();
      this.cells[i] = value;
      this.flash(i);
      this.commit();
      return true;
    }

    render(ctx, now) {
      const { w, h, rows, cols } = this.puzzle;
      const C = this.colors, cs = this.cs, ox = this.ox, oy = this.oy;
      const gw = w * cs, gh = h * cs;

      // clue gutters
      ctx.fillStyle = C.cellAlt;
      ctx.fillRect(0, oy, ox - 2, gh);
      ctx.fillRect(ox, 0, gw, oy - 2);

      // board
      ctx.fillStyle = C.cell;
      ctx.fillRect(ox, oy, gw, gh);

      const hv = this.hover;
      if (hv && !this.won) {
        ctx.fillStyle = C.highlight;
        ctx.fillRect(0, oy + hv.r * cs, ox + gw, cs);
        ctx.fillRect(ox + hv.c * cs, 0, cs, oy + gh);
      }

      // cells
      const pad = Math.max(1, Math.round(cs * 0.06));
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const v = this.cells[r * w + c], x = ox + c * cs, y = oy + r * cs;
          if (v === FILL) {
            ctx.fillStyle = C.fill;
            ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);
          } else if (v === CROSS && !this.won) {
            ctx.strokeStyle = C.muted;
            ctx.lineWidth = Math.max(1.2, cs * 0.07);
            ctx.lineCap = 'round';
            const m = cs * 0.3;
            ctx.beginPath();
            ctx.moveTo(x + m, y + m); ctx.lineTo(x + cs - m, y + cs - m);
            ctx.moveTo(x + cs - m, y + m); ctx.lineTo(x + m, y + cs - m);
            ctx.stroke();
          }
        }
      }

      // hint flashes
      for (const f of this.flashes) {
        const i = f.data, x = ox + (i % w) * cs, y = oy + Math.floor(i / w) * cs;
        ctx.globalAlpha = this.flashAlpha(f, now);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = Math.max(2, cs * 0.12);
        ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.globalAlpha = 1;
      }

      // grid lines
      if (!this.won) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        for (let c = 1; c < w; c++) if (c % 5) { ctx.moveTo(ox + c * cs + 0.5, oy); ctx.lineTo(ox + c * cs + 0.5, oy + gh); }
        for (let r = 1; r < h; r++) if (r % 5) { ctx.moveTo(ox, oy + r * cs + 0.5); ctx.lineTo(ox + gw, oy + r * cs + 0.5); }
        ctx.stroke();
        ctx.strokeStyle = C.gridStrong;
        ctx.beginPath();
        for (let c = 5; c < w; c += 5) { ctx.moveTo(ox + c * cs + 0.5, oy); ctx.lineTo(ox + c * cs + 0.5, oy + gh); }
        for (let r = 5; r < h; r += 5) { ctx.moveTo(ox, oy + r * cs + 0.5); ctx.lineTo(ox + gw, oy + r * cs + 0.5); }
        ctx.stroke();
      }
      ctx.strokeStyle = C.gridStrong;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + 0.5, oy + 0.5, gw, gh);

      // clues
      const fs = Math.min(cs * 0.52, this.slot * 0.9);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < h; r++) {
        const clue = rows[r].length ? rows[r] : [0];
        ctx.fillStyle = this.lineDone(true, r) ? C.clueDone : C.clue;
        ctx.font = this.font(clue.some((v) => v > 9) ? fs * 0.86 : fs, 650);
        for (let k = 0; k < clue.length; k++) {
          const x = ox - cs * 0.15 - (clue.length - k - 0.5) * this.slot;
          ctx.fillText(String(clue[k]), x, oy + r * cs + cs / 2 + 1);
        }
      }
      for (let c = 0; c < w; c++) {
        const clue = cols[c].length ? cols[c] : [0];
        ctx.fillStyle = this.lineDone(false, c) ? C.clueDone : C.clue;
        ctx.font = this.font(clue.some((v) => v > 9) ? fs * 0.86 : fs, 650);
        for (let k = 0; k < clue.length; k++) {
          const y = oy - cs * 0.15 - (clue.length - k - 0.5) * this.slot;
          ctx.fillText(String(clue[k]), ox + c * cs + cs / 2, y + 1);
        }
      }
    }
  }

  PL.register({
    id: 'nonogram',
    name: 'Nonogram',
    blurb: 'Paint the hidden picture. Numbers give the runs of filled cells in each line.',
    sizes: [
      { id: '5', label: '5×5', tag: 'Easy', n: 5 },
      { id: '10', label: '10×10', tag: 'Medium', n: 10 },
      { id: '15', label: '15×15', tag: 'Hard', n: 15 },
      { id: '20', label: '20×20', tag: 'Expert', n: 20 },
    ],
    defaultSize: '10',
    rules: `
      <p>Fill cells so that every row and column matches its clue.</p>
      <p>A clue like <b>3 1</b> means: a run of 3 filled cells, then at least one gap, then a run of 1 — in that order.</p>
      <p>Tap or drag to fill. Switch to <b>Mark ✕</b> (or right‑click) to note cells you know are empty. Drags lock to a single row or column.</p>
      <p>Every puzzle is solvable one line at a time — no guessing needed.</p>`,
    generate,
    View: NonogramView,
    logic: { cluesOf, solveLine, lineSolve, isSolved, runLengths },
  });
})(globalThis.PL = globalThis.PL || {});
