/* Flow — connect matching dots with pipes that fill the whole board.
 * Generator: random Hamiltonian path (backbite moves) cut into pieces. A piece is cut
 * whenever it would touch itself, so no pipe can be "short-cut", which keeps puzzles tight. */
(function (PL) {
  'use strict';

  const PALETTE = [
    '#f23c32', '#2f6bff', '#22b14c', '#f7e03c', '#ff8c1a', '#29d3e6', '#e53ad9', '#9b2d3a',
    '#8a3ffc', '#f2f2f2', '#8e8e99', '#a6e22e', '#c9a36b', '#3346c4', '#169c90', '#ff8fc7',
  ];

  // ---------------------------------------------------------------- logic

  function hamiltonianPath(rng, w, h) {
    const path = [];
    for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) path.push(r * w + (r % 2 ? w - 1 - k : k));
    const steps = w * h * 25;
    for (let s = 0; s < steps; s++) {
      if (rng.chance(0.5)) path.reverse();
      const nb = PL.neighbors4(path[0], w, h);
      const x = nb[rng.int(nb.length)];
      if (x === path[1]) continue;
      const i = path.indexOf(x);
      // backbite: link head to x, drop edge (i-1, i) -> reverse prefix [0, i)
      for (let a = 0, b = i - 1; a < b; a++, b--) { const t = path[a]; path[a] = path[b]; path[b] = t; }
    }
    return path;
  }

  function touchesSelf(cell, seg, owner, id, w, h) {
    const prev = seg[seg.length - 1];
    for (const nb of PL.neighbors4(cell, w, h)) if (nb !== prev && owner[nb] === id) return true;
    return false;
  }

  /** Cut the Hamiltonian path into short self-avoiding pieces (length >= 3). */
  function cutPath(rng, path, w, h) {
    const owner = new Int32Array(w * h).fill(-1);
    const segs = [];
    let cur = [], limit = rng.range(3, 6);
    for (const cell of path) {
      if (cur.length >= 3 && (cur.length >= limit || touchesSelf(cell, cur, owner, segs.length, w, h))) {
        segs.push(cur);
        cur = [];
        limit = rng.range(3, 6);
      }
      cur.push(cell);
      owner[cell] = segs.length;
    }
    if (cur.length >= 3) { segs.push(cur); return segs; }
    // leftover stub: glue it onto the previous piece if that stays self-avoiding
    const prev = segs[segs.length - 1], id = segs.length - 1;
    for (const cell of cur) {
      if (touchesSelf(cell, prev, owner, id, w, h)) return null;
      prev.push(cell);
      owner[cell] = id;
    }
    return segs;
  }

  /** Join pieces end-to-end (only when the result still never touches itself) until `target` remain. */
  function mergeDown(rng, segs, w, h, target) {
    const owner = new Int32Array(w * h);
    const relabel = () => segs.forEach((sg, k) => { for (const c of sg) owner[c] = k; });
    relabel();
    while (segs.length > target) {
      const cands = [];
      for (let i = 0; i < segs.length; i++) {
        for (const endI of [0, 1]) {
          const a = endI ? segs[i][segs[i].length - 1] : segs[i][0];
          for (const nb of PL.neighbors4(a, w, h)) {
            const j = owner[nb], sj = segs[j];
            if (j <= i) continue;
            const endJ = nb === sj[0] ? 0 : nb === sj[sj.length - 1] ? 1 : -1;
            if (endJ < 0) continue;
            cands.push({ i, endI, j, endJ, score: (segs[i].length + sj.length) * (0.4 + rng.next()) });
          }
        }
      }
      cands.sort((x, y) => x.score - y.score);
      let merged = false;
      for (const { i, endI, j, endJ } of cands) {
        const A = endI ? segs[i] : segs[i].slice().reverse(); // A ends at the junction
        const B = endJ ? segs[j].slice().reverse() : segs[j]; // B starts at it
        const aEnd = A[A.length - 1], bStart = B[0];
        let ok = true;
        for (const b of B) {
          for (const nb of PL.neighbors4(b, w, h)) {
            if (owner[nb] === i && !(b === bStart && nb === aEnd)) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        segs[i] = A.concat(B);
        segs.splice(j, 1);
        relabel();
        merged = true;
        break;
      }
      if (!merged) return;
    }
  }

  function generate(rng, size) {
    const w = size.n, h = size.n;
    const [lo, hi] = size.flows;
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const segs = cutPath(rng, hamiltonianPath(rng, w, h), w, h);
      if (!segs) continue;
      mergeDown(rng, segs, w, h, rng.range(lo, hi));
      if (segs.length >= lo && segs.length <= hi) return build(rng, w, h, segs);
      if (segs.length <= PALETTE.length && (!best || segs.length < best.length)) best = segs;
    }
    return build(rng, w, h, best);
  }

  function build(rng, w, h, segs) {
    rng.shuffle(segs);
    return {
      w, h,
      solution: segs,
      ends: segs.map((s) => [s[0], s[s.length - 1]]),
    };
  }

  function endpointMap(puzzle) {
    const m = new Int8Array(puzzle.w * puzzle.h).fill(-1);
    puzzle.ends.forEach(([a, b], k) => { m[a] = k; m[b] = k; });
    return m;
  }

  function isComplete(puzzle, path, k) {
    if (path.length < 2) return false;
    const [a, b] = puzzle.ends[k], s = path[0], e = path[path.length - 1];
    return (s === a && e === b) || (s === b && e === a);
  }

  /** Rule check: every pair joined by an orthogonal path and every cell used exactly once. */
  function isSolved(puzzle, paths) {
    const { w, h } = puzzle, used = new Uint8Array(w * h);
    for (let k = 0; k < puzzle.ends.length; k++) {
      const p = paths[k];
      if (!p || !isComplete(puzzle, p, k)) return false;
      for (let i = 0; i < p.length; i++) {
        if (used[p[i]]) return false;
        used[p[i]] = 1;
        if (i && !PL.neighbors4(p[i], w, h).includes(p[i - 1])) return false;
      }
    }
    return used.every((v) => v);
  }

  // ---------------------------------------------------------------- view

  class FlowView extends PL.BoardView {
    constructor(host, puzzle, opts) {
      super(host, puzzle, opts);
      this.canvas.classList.add('rounded');
      this.ep = endpointMap(puzzle);
      this.paths = puzzle.ends.map(() => []);
      this.drag = null;
      if (opts && opts.saved) this.deserialize(opts.saved);
    }

    serialize() { return this.paths.map((p) => p.slice()); }
    deserialize(s) {
      if (!Array.isArray(s) || s.length !== this.paths.length) return;
      this.paths = s.map((p) => (Array.isArray(p) ? p.filter((v) => Number.isInteger(v)) : []));
    }
    reset() { this.paths = this.puzzle.ends.map(() => []); }
    isSolved() { return isSolved(this.puzzle, this.paths); }

    status() {
      const { ends, w, h } = this.puzzle;
      const filled = new Set(ends.flat());
      let done = 0;
      this.paths.forEach((p, k) => {
        if (isComplete(this.puzzle, p, k)) done++;
        for (const c of p) filled.add(c);
      });
      return `Flows ${done}/${ends.length} · Filled ${Math.round((100 * filled.size) / (w * h))}%`;
    }

    layout(W, H) {
      const { w, h } = this.puzzle;
      const cs = Math.max(18, Math.floor(Math.min(W / w, H / h, 72)));
      this.cs = cs;
      return { width: cs * w, height: cs * h };
    }

    cellAt(p) {
      const { w, h } = this.puzzle;
      const c = Math.floor(p.x / this.cs), r = Math.floor(p.y / this.cs);
      if (r < 0 || c < 0 || r >= h || c >= w) return -1;
      return r * w + c;
    }

    ownerOf(cell) {
      for (let k = 0; k < this.paths.length; k++) if (this.paths[k].includes(cell)) return k;
      return -1;
    }

    onDown(p) {
      const cell = this.cellAt(p);
      if (cell < 0) return;
      let k = this.ep[cell], path;
      if (k >= 0) path = [cell];
      else {
        k = this.ownerOf(cell);
        if (k < 0) return;
        path = this.paths[k].slice(0, this.paths[k].indexOf(cell) + 1);
      }
      this.pushHistory();
      this.drag = { k, path, base: this.serialize(), last: cell, pt: p };
      this.apply();
    }

    onDrag(p) {
      const d = this.drag;
      if (!d) return;
      d.pt = p;
      const target = this.cellAt(p);
      if (target >= 0) {
        const { w } = this.puzzle;
        let guard = 64;
        while (d.last !== target && guard--) {
          const r = (d.last / w) | 0, c = d.last % w, tr = (target / w) | 0, tc = target % w;
          const next = Math.abs(tr - r) > Math.abs(tc - c) ? d.last + Math.sign(tr - r) * w : d.last + Math.sign(tc - c);
          if (!this.extend(next)) break;
        }
      }
      this.apply();
    }

    extend(next) {
      const d = this.drag, path = d.path;
      const at = path.indexOf(next);
      if (at >= 0) { path.length = at + 1; d.last = next; return true; }
      if (isComplete(this.puzzle, path, d.k)) return false;
      const e = this.ep[next];
      if (e >= 0 && e !== d.k) return false;
      path.push(next);
      d.last = next;
      return true;
    }

    /** Current drag path wins; other pipes are cut where it crosses them (restored if it backs off). */
    apply() {
      const d = this.drag, taken = new Set(d.path);
      this.paths = d.base.map((p, j) => {
        if (j === d.k) return d.path.slice();
        const cut = p.findIndex((c) => taken.has(c));
        return cut < 0 ? p.slice() : p.slice(0, cut);
      });
      this.requestDraw();
    }

    onUp() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.paths = this.paths.map((p) => (p.length > 1 ? p : []));
      const changed = JSON.stringify(this.paths) !== JSON.stringify(d.base.map((p) => (p.length > 1 ? p : [])));
      if (changed) this.commit(); else { this.dropHistory(); this.requestDraw(); }
    }

    hint() {
      if (this.won) return false;
      const sol = this.puzzle.solution;
      const same = (a, b) => a.length === b.length && (a.every((v, i) => v === b[i]) || a.every((v, i) => v === b[b.length - 1 - i]));
      let k = this.paths.findIndex((p, j) => !isComplete(this.puzzle, p, j));
      if (k < 0) k = this.paths.findIndex((p, j) => !same(p, sol[j]));
      if (k < 0) return false;
      this.pushHistory();
      const path = sol[k].slice(), taken = new Set(path);
      this.paths = this.paths.map((p, j) => {
        if (j === k) return path;
        const cut = p.findIndex((c) => taken.has(c));
        return cut < 0 ? p : cut > 1 ? p.slice(0, cut) : [];
      });
      this.flash(k);
      this.commit();
      return true;
    }

    render(ctx, now) {
      const { w, h, ends } = this.puzzle;
      const C = this.colors, cs = this.cs;
      const center = (i) => [(i % w) * cs + cs / 2, Math.floor(i / w) * cs + cs / 2];

      ctx.fillStyle = C.flowBoard;
      ctx.fillRect(0, 0, w * cs, h * cs);

      // tinted cells under pipes
      this.paths.forEach((p, k) => {
        if (p.length < 2) return;
        ctx.fillStyle = PALETTE[k];
        ctx.globalAlpha = isComplete(this.puzzle, p, k) ? 0.22 : 0.12;
        for (const i of p) ctx.fillRect((i % w) * cs, Math.floor(i / w) * cs, cs, cs);
      });
      ctx.globalAlpha = 1;

      // grid
      ctx.strokeStyle = C.flowGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= w; c++) { const x = Math.min(c * cs + 0.5, w * cs - 0.5); ctx.moveTo(x, 0); ctx.lineTo(x, h * cs); }
      for (let r = 0; r <= h; r++) { const y = Math.min(r * cs + 0.5, h * cs - 0.5); ctx.moveTo(0, y); ctx.lineTo(w * cs, y); }
      ctx.stroke();

      // hint flash
      for (const f of this.flashes) {
        ctx.globalAlpha = 0.45 * this.flashAlpha(f, now);
        ctx.fillStyle = '#ffffff';
        for (const i of this.paths[f.data] || []) ctx.fillRect((i % w) * cs, Math.floor(i / w) * cs, cs, cs);
        ctx.globalAlpha = 1;
      }

      // pipes
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = cs * 0.34;
      this.paths.forEach((p, k) => {
        if (p.length < 2) return;
        ctx.strokeStyle = PALETTE[k];
        ctx.beginPath();
        p.forEach((i, j) => { const [x, y] = center(i); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      });

      // dots
      ends.forEach(([a, b], k) => {
        const done = isComplete(this.puzzle, this.paths[k], k);
        for (const i of [a, b]) {
          const [x, y] = center(i);
          ctx.fillStyle = PALETTE[k];
          ctx.beginPath();
          ctx.arc(x, y, cs * (done ? 0.36 : 0.33), 0, Math.PI * 2);
          ctx.fill();
          if (done) {
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = Math.max(1.5, cs * 0.05);
            ctx.stroke();
          }
        }
      });

      // finger halo while dragging
      const d = this.drag;
      if (d && d.pt) {
        ctx.fillStyle = PALETTE[d.k];
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.arc(d.pt.x, d.pt.y, cs * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  PL.register({
    id: 'flow',
    name: 'Flow',
    blurb: 'Connect each pair of matching dots. Pipes may not cross and must fill every cell.',
    sizes: [
      { id: '5', label: '5×5', tag: 'Easy', n: 5, flows: [4, 6] },
      { id: '7', label: '7×7', tag: 'Medium', n: 7, flows: [6, 8] },
      { id: '9', label: '9×9', tag: 'Hard', n: 9, flows: [8, 11] },
      { id: '11', label: '11×11', tag: 'Expert', n: 11, flows: [11, 14] },
    ],
    defaultSize: '7',
    rules: `
      <p>Drag from a dot to draw a pipe to the other dot of the same colour.</p>
      <p>Pipes can't cross or branch, and the puzzle is solved when every pair is connected <b>and every cell is filled</b>.</p>
      <p>Drawing through another pipe cuts it. Drag back along a pipe to shorten it, or grab any point of a pipe to redraw from there.</p>`,
    generate,
    View: FlowView,
    logic: { isSolved, hamiltonianPath, PALETTE },
  });
})(globalThis.PL = globalThis.PL || {});
