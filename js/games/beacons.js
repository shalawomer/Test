/* Beacons — an original rule set.
 *   1. Exactly one beacon in every row and every column.
 *   2. Beacons never touch, not even diagonally.
 *   3. A number is the walking distance (up/down/left/right steps) to the nearest beacon.
 * Generator: enumerate every legal beacon layout for the size, pick one, then add distance
 * clues until only that layout survives and strip clues that turn out to be redundant. */
(function (PL) {
  'use strict';

  const EMPTY = 0, MARK = 1, BEACON = 2;
  const cache = {};

  // ---------------------------------------------------------------- logic

  /** All placements as a flat Int8Array: layout p has its beacon in row r at column flat[p*n + r]. */
  function placements(n) {
    if (cache[n]) return cache[n];
    const out = [], cols = new Int8Array(n), used = new Uint8Array(n);
    (function rec(r) {
      if (r === n) { for (let i = 0; i < n; i++) out.push(cols[i]); return; }
      for (let c = 0; c < n; c++) {
        if (used[c] || (r > 0 && Math.abs(c - cols[r - 1]) < 2)) continue;
        used[c] = 1; cols[r] = c;
        rec(r + 1);
        used[c] = 0;
      }
    })(0);
    return (cache[n] = { n, count: out.length / n, flat: Int8Array.from(out) });
  }

  function distance(flat, base, n, r, c) {
    let best = 99;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - r) + Math.abs(flat[base + i] - c);
      if (d < best) best = d;
    }
    return best;
  }

  function consistent(P, p, clues) {
    const base = p * P.n;
    for (let k = 0; k < clues.length; k++) {
      const q = clues[k];
      if (distance(P.flat, base, P.n, q.r, q.c) !== q.d) return false;
    }
    return true;
  }

  function countSolutions(n, clues, limit = 2) {
    const P = placements(n);
    let found = 0;
    for (let p = 0; p < P.count && found < limit; p++) if (consistent(P, p, clues)) found++;
    return found;
  }

  function generate(rng, size) {
    const n = size.n, P = placements(n);
    const sol = rng.int(P.count), base = sol * n;
    const beacons = Array.from(P.flat.slice(base, base + n));

    const cands = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (beacons[r] !== c) cands.push({ r, c, d: distance(P.flat, base, n, r, c) });
    rng.shuffle(cands);

    // add clues until the layout is pinned down
    let alive = [];
    for (let p = 0; p < P.count; p++) alive.push(p);
    const clues = [];
    for (const q of cands) {
      if (alive.length === 1) break;
      const next = alive.filter((p) => distance(P.flat, p * n, n, q.r, q.c) === q.d);
      if (next.length < alive.length) { clues.push(q); alive = next; }
    }

    // drop clues that aren't needed, but keep a few extras on easier sizes
    for (const q of rng.shuffle(clues.slice())) {
      if (clues.length <= size.minClues) break;
      const rest = clues.filter((x) => x !== q);
      if (countSolutions(n, rest, 2) === 1) clues.splice(clues.indexOf(q), 1);
    }
    clues.sort((a, b) => a.r - b.r || a.c - b.c);
    return { n, clues, solution: beacons };
  }

  /** Rule check on a board of EMPTY / MARK / BEACON cells. */
  function isSolved(puzzle, cells) {
    const { n, clues } = puzzle;
    const pos = [];
    const rowSeen = new Uint8Array(n), colSeen = new Uint8Array(n);
    for (let i = 0; i < n * n; i++) {
      if (cells[i] !== BEACON) continue;
      const r = (i / n) | 0, c = i % n;
      if (rowSeen[r] || colSeen[c]) return false;
      rowSeen[r] = colSeen[c] = 1;
      pos.push([r, c]);
    }
    if (pos.length !== n) return false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (Math.abs(pos[a][0] - pos[b][0]) <= 1 && Math.abs(pos[a][1] - pos[b][1]) <= 1) return false;
      }
    }
    return clues.every((q) => nearest(pos, q.r, q.c) === q.d);
  }

  function nearest(pos, r, c) {
    let best = Infinity;
    for (const [pr, pc] of pos) best = Math.min(best, Math.abs(pr - r) + Math.abs(pc - c));
    return best;
  }

  // ---------------------------------------------------------------- view

  class BeaconsView extends PL.BoardView {
    constructor(host, puzzle, opts) {
      super(host, puzzle, opts);
      this.canvas.classList.add('rounded');
      const n = puzzle.n;
      this.cells = new Uint8Array(n * n);
      this.clueAt = new Int16Array(n * n).fill(-1);
      puzzle.clues.forEach((q, k) => { this.clueAt[q.r * n + q.c] = k; });
      this.drag = null;
      if (opts && opts.saved) this.deserialize(opts.saved);
    }

    serialize() { return Array.from(this.cells).join(''); }
    deserialize(s) {
      if (typeof s !== 'string' || s.length !== this.cells.length) return;
      for (let i = 0; i < s.length; i++) this.cells[i] = this.clueAt[i] >= 0 ? EMPTY : Math.min(2, +s[i] || 0);
    }
    reset() { this.cells.fill(EMPTY); }
    isSolved() { return isSolved(this.puzzle, this.cells); }

    beacons() {
      const out = [], n = this.puzzle.n;
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === BEACON) out.push([(i / n) | 0, i % n]);
      return out;
    }

    progress() {
      const b = this.beacons();
      return b.length ? this.puzzle.clues.reduce((n, q) => n + (nearest(b, q.r, q.c) === q.d ? 1 : 0), 0) : 0;
    }

    status() { return `Beacons ${this.beacons().length}/${this.puzzle.n}`; }

    layout(W, H) {
      const n = this.puzzle.n;
      const cs = Math.max(24, Math.floor(Math.min(W / n, H / n, 76)));
      this.cs = cs;
      return { width: cs * n, height: cs * n };
    }

    cellAt(p) {
      const n = this.puzzle.n;
      const c = Math.floor(p.x / this.cs), r = Math.floor(p.y / this.cs);
      return r < 0 || c < 0 || r >= n || c >= n ? -1 : r * n + c;
    }

    onDown(p) {
      const i = this.cellAt(p);
      if (i < 0 || this.clueAt[i] >= 0) return;
      this.pushHistory();
      this.drag = { start: i, last: i, base: this.cells.slice(), paint: null };
    }

    onDrag(p) {
      const d = this.drag;
      if (!d) return;
      const i = this.cellAt(p);
      if (i < 0 || i === d.last) return;
      d.last = i;
      if (d.paint === null) {
        // dragging paints marks (or erases them when the drag started on a mark)
        const s = d.base[d.start];
        d.paint = s === MARK ? EMPTY : MARK;
        if (s !== BEACON) this.cells[d.start] = d.paint;
      }
      if (this.clueAt[i] < 0 && d.base[i] === (d.paint === MARK ? EMPTY : MARK)) this.cells[i] = d.paint;
      this.requestDraw();
    }

    onUp() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.paint === null) this.cells[d.start] = (this.cells[d.start] + 1) % 3; // tap: empty → ✕ → beacon
      if (this.cells.some((v, i) => v !== d.base[i])) this.commit(); else { this.dropHistory(); this.requestDraw(); }
    }

    hint() {
      if (this.won) return false;
      const { n, solution } = this.puzzle;
      const isSol = (i) => solution[(i / n) | 0] === i % n;
      let target = -1, value = BEACON;
      for (let i = 0; i < this.cells.length && target < 0; i++) {
        if (this.cells[i] === BEACON && !isSol(i)) { target = i; value = MARK; }
      }
      for (let i = 0; i < this.cells.length && target < 0; i++) {
        if (this.cells[i] === MARK && isSol(i)) target = i;
      }
      if (target < 0) {
        // reveal the beacon next to the most clue information
        let best = -1;
        for (let r = 0; r < n; r++) {
          const i = r * n + solution[r];
          if (this.cells[i] === BEACON) continue;
          const score = this.puzzle.clues.reduce((s, q) => s + (Math.abs(q.r - r) + Math.abs(q.c - solution[r]) === q.d ? 1 : 0), 0);
          if (score > best) { best = score; target = i; }
        }
      }
      if (target < 0) return false;
      this.pushHistory();
      this.cells[target] = value;
      this.flash(target);
      this.commit('hint');
      return true;
    }

    render(ctx, now) {
      const { n, clues } = this.puzzle;
      const C = this.colors, cs = this.cs, gap = Math.max(2, cs * 0.06), rad = cs * 0.16;
      const beacons = this.beacons();

      // conflicts
      const bad = new Set();
      beacons.forEach(([r, c], a) => {
        beacons.forEach(([r2, c2], b) => {
          if (a >= b) return;
          if (r === r2 || c === c2 || (Math.abs(r - r2) <= 1 && Math.abs(c - c2) <= 1)) { bad.add(a); bad.add(b); }
        });
      });

      ctx.fillStyle = C.board;
      ctx.fillRect(0, 0, n * cs, n * cs);

      const tile = (r, c, fill) => {
        const x = c * cs + gap / 2, y = r * cs + gap / 2, s = cs - gap;
        ctx.fillStyle = fill;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, s, s, rad); else ctx.rect(x, y, s, s);
        ctx.fill();
      };

      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) tile(r, c, this.clueAt[r * n + c] >= 0 ? C.tileClue : C.tile);

      for (const f of this.flashes) {
        const i = f.data;
        ctx.globalAlpha = 0.6 * this.flashAlpha(f, now);
        tile((i / n) | 0, i % n, C.accent);
        ctx.globalAlpha = 1;
      }

      // clues
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = this.font(cs * 0.46, 750);
      for (const q of clues) {
        const d = beacons.length ? nearest(beacons, q.r, q.c) : Infinity;
        ctx.fillStyle = d < q.d ? C.danger : d === q.d ? C.clueDone : C.clue;
        ctx.fillText(String(q.d), (q.c + 0.5) * cs, (q.r + 0.5) * cs + 1);
      }

      // assist: tiles ruled out by the beacons already placed (same row/column or touching)
      if (!this.won) {
        ctx.fillStyle = C.muted;
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < this.cells.length; i++) {
          if (this.cells[i] !== EMPTY || this.clueAt[i] >= 0) continue;
          const r = (i / n) | 0, c = i % n;
          if (!beacons.some(([br, bc]) => br === r || bc === c || (Math.abs(br - r) <= 1 && Math.abs(bc - c) <= 1))) continue;
          ctx.beginPath();
          ctx.arc((c + 0.5) * cs, (r + 0.5) * cs, Math.max(1.5, cs * 0.045), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // marks
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = Math.max(1.5, cs * 0.05);
      ctx.lineCap = 'round';
      for (let i = 0; i < this.cells.length; i++) {
        if (this.cells[i] !== MARK) continue;
        const x = (i % n + 0.5) * cs, y = (((i / n) | 0) + 0.5) * cs, m = cs * 0.12;
        ctx.beginPath();
        ctx.moveTo(x - m, y - m); ctx.lineTo(x + m, y + m);
        ctx.moveTo(x + m, y - m); ctx.lineTo(x - m, y + m);
        ctx.stroke();
      }

      // beacons
      beacons.forEach(([r, c], k) => {
        const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
        const color = bad.has(k) ? C.danger : C.beacon;
        const g = ctx.createRadialGradient(x, y, cs * 0.05, x, y, cs * 0.5);
        g.addColorStop(0, bad.has(k) ? 'rgba(224,49,49,0.35)' : C.beaconGlow);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - cs / 2, y - cs / 2, cs, cs);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, cs * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(x - cs * 0.06, y - cs * 0.06, cs * 0.06, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  PL.register({
    id: 'beacons',
    name: 'Beacons',
    original: true,
    blurb: 'An original rule: one beacon per row and column, and numbers tell the distance to the nearest one.',
    sizes: [
      { id: '6', label: '6×6', tag: 'Easy', n: 6, minClues: 6 },
      { id: '7', label: '7×7', tag: 'Medium', n: 7, minClues: 6 },
      { id: '8', label: '8×8', tag: 'Hard', n: 8, minClues: 5 },
      { id: '9', label: '9×9', tag: 'Expert', n: 9, minClues: 0 },
    ],
    defaultSize: '7',
    rules: `
      <p>Place beacons on the grid so that:</p>
      <ul>
        <li>Every <b>row</b> and every <b>column</b> has exactly one beacon.</li>
        <li>Beacons never touch — not even diagonally.</li>
        <li>Each number is the distance to the <b>nearest</b> beacon, counted in up/down/left/right steps. Number tiles never hold a beacon.</li>
      </ul>
      <p>A <b>3</b> means no beacon is 1 or 2 steps away, but at least one is exactly 3 steps away.</p>
      <p>Tap a tile to cycle empty → ✕ → beacon. Drag to mark several tiles with ✕. Small dots show tiles your beacons already rule out.</p>
      <p>Every puzzle has exactly one solution.</p>`,
    generate,
    View: BeaconsView,
    logic: { placements, countSolutions, isSolved, distance },
  });
})(globalThis.PL = globalThis.PL || {});
