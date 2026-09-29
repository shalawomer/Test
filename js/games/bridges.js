/* Bridges (Hashiwokakero) — link islands with 1 or 2 straight bridges.
 * Generator grows a connected network outward from one island, adds a few loops, then asks the
 * solver whether the puzzle has exactly one solution; if not it tries another layout. */
(function (PL) {
  'use strict';

  const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  // ---------------------------------------------------------------- structure

  /** Candidate bridges: each island to its nearest island right and below, plus crossings. */
  function buildEdges(n, islands) {
    const at = new Int16Array(n * n).fill(-1);
    islands.forEach((isl, k) => { at[isl.r * n + isl.c] = k; });
    const edges = [], through = Array.from({ length: n * n }, () => []);
    islands.forEach((isl, a) => {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const cells = [];
        let r = isl.r + dr, c = isl.c + dc;
        while (r < n && c < n && at[r * n + c] < 0) { cells.push(r * n + c); r += dr; c += dc; }
        if (r >= n || c >= n) continue;
        const e = edges.length;
        edges.push({ a, b: at[r * n + c], horiz: dr === 0, cells, cross: [] });
        for (const cell of cells) through[cell].push(e);
      }
    });
    for (const list of through) {
      for (const e of list) for (const f of list) if (edges[e].horiz !== edges[f].horiz && e !== f) edges[e].cross.push(f);
    }
    const incident = islands.map(() => []);
    edges.forEach((e, k) => { incident[e.a].push(k); incident[e.b].push(k); });
    return { edges, incident, at };
  }

  function connected(islandCount, edges, vals) {
    const parent = Array.from({ length: islandCount }, (_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    let groups = islandCount;
    edges.forEach((e, k) => {
      if (vals[k] > 0) {
        const ra = find(e.a), rb = find(e.b);
        if (ra !== rb) { parent[ra] = rb; groups--; }
      }
    });
    return groups <= 1;
  }

  // ---------------------------------------------------------------- solver

  /** Count solutions (stopping at `limit`). Constraint propagation + backtracking. */
  function countSolutions(puzzle, limit = 2) {
    const { islands, edges, incident } = puzzle;
    const E = edges.length;
    const lo0 = new Int8Array(E), hi0 = new Int8Array(E);
    edges.forEach((e, k) => { hi0[k] = Math.min(2, islands[e.a].num, islands[e.b].num); });
    let found = 0, budget = 200000;

    function propagate(lo, hi) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < islands.length; i++) {
          const need = islands[i].num, inc = incident[i];
          let sLo = 0, sHi = 0;
          for (const e of inc) { sLo += lo[e]; sHi += hi[e]; }
          if (sLo > need || sHi < need) return false;
          for (const e of inc) {
            const nlo = Math.max(lo[e], need - (sHi - hi[e]));
            const nhi = Math.min(hi[e], need - (sLo - lo[e]));
            if (nlo > nhi) return false;
            if (nlo !== lo[e] || nhi !== hi[e]) {
              sLo += nlo - lo[e]; sHi += nhi - hi[e];
              lo[e] = nlo; hi[e] = nhi; changed = true;
            }
          }
        }
        for (let e = 0; e < E; e++) {
          if (!lo[e]) continue;
          for (const f of edges[e].cross) {
            if (lo[f]) return false;
            if (hi[f]) { hi[f] = 0; changed = true; }
          }
        }
      }
      return true;
    }

    function search(lo, hi) {
      if (found >= limit || --budget < 0) return;
      if (!propagate(lo, hi)) return;
      if (!connected(islands.length, edges, hi)) return;
      // branch on the undecided edge whose islands have the fewest options
      let best = -1, bestScore = 1e9;
      for (let e = 0; e < E; e++) {
        if (lo[e] === hi[e]) continue;
        const score = incident[edges[e].a].length + incident[edges[e].b].length;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (best < 0) {
        if (connected(islands.length, edges, lo)) found++;
        return;
      }
      for (let v = hi[best]; v >= lo[best]; v--) {
        const l = lo.slice(), h = hi.slice();
        l[best] = h[best] = v;
        search(l, h);
        if (found >= limit) return;
      }
    }

    search(lo0, hi0);
    return budget < 0 ? Math.max(found, limit) : found; // out of budget => treat as ambiguous
  }

  // ---------------------------------------------------------------- generator

  function layout(rng, n, target) {
    const island = new Int16Array(n * n).fill(-1);
    const occ = new Uint8Array(n * n);
    const pts = [];
    const bridges = new Map(); // "a-b" -> count
    const free = (r, c) => r >= 0 && c >= 0 && r < n && c < n && island[r * n + c] < 0 && !occ[r * n + c];
    const lonely = (r, c) => DIRS.every(([dr, dc]) => {
      const rr = r + dr, cc = c + dc;
      return rr < 0 || cc < 0 || rr >= n || cc >= n || island[rr * n + cc] < 0;
    });
    const add = (r, c) => { island[r * n + c] = pts.length; pts.push({ r, c }); return pts.length - 1; };
    const link = (a, b, cells) => {
      bridges.set(a < b ? `${a}-${b}` : `${b}-${a}`, rng.chance(0.42) ? 2 : 1);
      for (const x of cells) occ[x] = 1;
    };

    const mid = () => Math.floor(n / 3) + rng.int(Math.ceil(n / 3));
    add(mid(), mid());
    for (let tries = 0; pts.length < target && tries < target * 60; tries++) {
      const a = rng.int(pts.length), [dr, dc] = rng.pick(DIRS);
      const dist = rng.range(2, Math.max(2, Math.min(n - 1, rng.chance(0.7) ? 3 : n - 1)));
      const r = pts[a].r + dr * dist, c = pts[a].c + dc * dist;
      if (!free(r, c) || !lonely(r, c)) continue;
      const cells = [];
      let ok = true;
      for (let s = 1; s < dist; s++) {
        const rr = pts[a].r + dr * s, cc = pts[a].c + dc * s;
        if (!free(rr, cc)) { ok = false; break; }
        cells.push(rr * n + cc);
      }
      if (!ok) continue;
      link(a, add(r, c), cells);
    }

    // a few extra links make loops (more interesting deductions)
    const { edges } = buildEdges(n, pts);
    for (const e of rng.shuffle(edges.slice())) {
      const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
      if (bridges.has(key) || !rng.chance(0.35)) continue;
      if (e.cells.some((x) => occ[x])) continue;
      link(e.a, e.b, e.cells);
    }
    return { pts, bridges };
  }

  function generate(rng, size) {
    const n = size.n;
    let fallback = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const target = rng.range(size.islands[0], size.islands[1]);
      const { pts, bridges } = layout(rng, n, target);
      if (pts.length < size.islands[0]) continue;
      const { edges, incident } = buildEdges(n, pts);
      const solution = edges.map((e) => bridges.get(`${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`) || 0);
      const islands = pts.map((p) => ({ r: p.r, c: p.c, num: 0 }));
      edges.forEach((e, k) => { islands[e.a].num += solution[k]; islands[e.b].num += solution[k]; });
      const puzzle = { n, islands, edges, incident, solution };
      if (countSolutions(puzzle, 2) === 1) return puzzle;
      if (!fallback) fallback = puzzle;
    }
    return fallback;
  }

  function isSolved(puzzle, vals) {
    const { islands, edges, incident } = puzzle;
    for (let i = 0; i < islands.length; i++) {
      let s = 0;
      for (const e of incident[i]) s += vals[e];
      if (s !== islands[i].num) return false;
    }
    for (let e = 0; e < edges.length; e++) {
      if (vals[e] && edges[e].cross.some((f) => vals[f])) return false;
    }
    return connected(islands.length, edges, vals);
  }

  // ---------------------------------------------------------------- view

  class BridgesView extends PL.BoardView {
    constructor(host, puzzle, opts) {
      super(host, puzzle, opts);
      this.canvas.classList.add('rounded');
      this.vals = new Int8Array(puzzle.edges.length);
      this.sel = -1;
      this.drag = null;
      if (opts && opts.saved) this.deserialize(opts.saved);
    }

    serialize() { return Array.from(this.vals).join(''); }
    deserialize(s) {
      if (typeof s !== 'string' || s.length !== this.vals.length) return;
      for (let i = 0; i < s.length; i++) this.vals[i] = Math.min(2, +s[i] || 0);
    }
    reset() { this.vals.fill(0); this.sel = -1; }
    isSolved() { return isSolved(this.puzzle, this.vals); }

    sum(i) { return this.puzzle.incident[i].reduce((s, e) => s + this.vals[e], 0); }

    status() {
      const n = this.puzzle.islands.length;
      let done = 0;
      for (let i = 0; i < n; i++) if (this.sum(i) === this.puzzle.islands[i].num) done++;
      return `Islands ${done}/${n}`;
    }

    layout(W, H) {
      const n = this.puzzle.n;
      const cs = Math.max(20, Math.floor(Math.min(W / n, H / n, 64)));
      this.cs = cs;
      return { width: cs * n, height: cs * n };
    }

    xy(i) { const isl = this.puzzle.islands[i]; return [(isl.c + 0.5) * this.cs, (isl.r + 0.5) * this.cs]; }

    islandAt(p) {
      const { islands } = this.puzzle;
      for (let i = 0; i < islands.length; i++) {
        const [x, y] = this.xy(i);
        if (Math.hypot(p.x - x, p.y - y) <= this.cs * 0.48) return i;
      }
      return -1;
    }

    edgeFrom(i, dr, dc) {
      const { edges, incident, islands } = this.puzzle;
      for (const e of incident[i]) {
        const o = edges[e].a === i ? edges[e].b : edges[e].a;
        const r = Math.sign(islands[o].r - islands[i].r), c = Math.sign(islands[o].c - islands[i].c);
        if (r === dr && c === dc) return e;
      }
      return -1;
    }

    edgeBetween(a, b) {
      return this.puzzle.incident[a].find((e) => {
        const E = this.puzzle.edges[e];
        return (E.a === a && E.b === b) || (E.a === b && E.b === a);
      });
    }

    edgeAt(p) {
      const { edges } = this.puzzle;
      let best = -1, bestD = this.cs * 0.34;
      edges.forEach((e, k) => {
        const [ax, ay] = this.xy(e.a), [bx, by] = this.xy(e.b);
        let d;
        if (e.horiz) d = p.x > Math.min(ax, bx) && p.x < Math.max(ax, bx) ? Math.abs(p.y - ay) : 1e9;
        else d = p.y > Math.min(ay, by) && p.y < Math.max(ay, by) ? Math.abs(p.x - ax) : 1e9;
        if (d < bestD) { bestD = d; best = k; }
      });
      return best;
    }

    onDown(p) {
      this.drag = { from: this.islandAt(p), start: p, edge: -1 };
    }

    onDrag(p) {
      const d = this.drag;
      if (!d || d.from < 0) return;
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      let edge = -1;
      if (Math.hypot(dx, dy) > this.cs * 0.4) {
        edge = Math.abs(dx) > Math.abs(dy) ? this.edgeFrom(d.from, 0, Math.sign(dx)) : this.edgeFrom(d.from, Math.sign(dy), 0);
      }
      if (edge !== d.edge) { d.edge = edge; this.requestDraw(); }
    }

    onUp(p) {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.from >= 0) {
        if (d.edge >= 0) { this.sel = -1; this.cycle(d.edge); return; }
        if (this.islandAt(p) !== d.from) { this.requestDraw(); return; }
        // tap on an island: select it, or link it to the selected one
        if (this.sel >= 0 && this.sel !== d.from) {
          const e = this.edgeBetween(this.sel, d.from);
          if (e !== undefined) { this.sel = -1; this.cycle(e); return; }
        }
        this.sel = this.sel === d.from ? -1 : d.from;
        this.requestDraw();
        return;
      }
      this.sel = -1;
      const e = this.edgeAt(p);
      if (e >= 0) this.cycle(e); else this.requestDraw();
    }

    cycle(e) {
      const next = (this.vals[e] + 1) % 3;
      if (this.vals[e] === 0) {
        const blocker = this.puzzle.edges[e].cross.find((f) => this.vals[f] > 0);
        if (blocker !== undefined) { this.flash({ edge: blocker }, 700); return; }
      }
      this.pushHistory();
      this.vals[e] = next;
      this.commit();
    }

    hint() {
      if (this.won) return false;
      const sol = this.puzzle.solution;
      let e = this.vals.findIndex((v, k) => v > sol[k]);
      if (e < 0) e = this.vals.findIndex((v, k) => v < sol[k]);
      if (e < 0) return false;
      this.pushHistory();
      this.vals[e] = sol[e];
      for (const f of this.puzzle.edges[e].cross) if (sol[e] && this.vals[f]) this.vals[f] = 0;
      this.flash({ edge: e });
      this.commit();
      return true;
    }

    render(ctx, now) {
      const { n, islands, edges } = this.puzzle;
      const C = this.colors, cs = this.cs;

      ctx.fillStyle = C.board;
      ctx.fillRect(0, 0, n * cs, n * cs);

      // faint grid points
      ctx.fillStyle = C.grid;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          ctx.beginPath();
          ctx.arc((c + 0.5) * cs, (r + 0.5) * cs, Math.max(1, cs * 0.035), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const line = (e, off, color, width) => {
        const E = edges[e];
        let [ax, ay] = this.xy(E.a), [bx, by] = this.xy(E.b);
        if (E.horiz) { ay += off; by += off; } else { ax += off; bx += off; }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      };

      // flashes (hints / blocked crossings)
      for (const f of this.flashes) {
        ctx.globalAlpha = this.flashAlpha(f, now);
        line(f.data.edge, 0, f.dur < 1000 ? C.danger : C.accent, cs * 0.38);
        ctx.globalAlpha = 1;
      }

      // drag preview
      if (this.drag && this.drag.edge >= 0) {
        ctx.globalAlpha = 0.35;
        line(this.drag.edge, 0, C.accent, cs * 0.24);
        ctx.globalAlpha = 1;
      }

      // bridges
      ctx.lineCap = 'round';
      const bw = Math.max(2, cs * 0.075);
      this.vals.forEach((v, e) => {
        if (v === 1) line(e, 0, C.bridge, bw);
        else if (v === 2) { line(e, -cs * 0.11, C.bridge, bw); line(e, cs * 0.11, C.bridge, bw); }
      });

      // islands
      const R = cs * 0.38;
      islands.forEach((isl, i) => {
        const [x, y] = this.xy(i), s = this.sum(i);
        const state = s === isl.num ? 'done' : s > isl.num ? 'over' : 'open';
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = state === 'done' ? C.islandDone : C.island;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, cs * 0.05);
        ctx.strokeStyle = state === 'over' ? C.danger : i === this.sel ? C.accent : C.bridge;
        ctx.stroke();
        if (i === this.sel) {
          ctx.beginPath();
          ctx.arc(x, y, R + cs * 0.08, 0, Math.PI * 2);
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = Math.max(2, cs * 0.06);
          ctx.stroke();
        }
        ctx.fillStyle = state === 'over' ? C.danger : state === 'done' ? C.muted : C.ink;
        ctx.font = this.font(cs * 0.44, 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(isl.num), x, y + 1);
      });
    }
  }

  PL.register({
    id: 'bridges',
    name: 'Bridges',
    blurb: 'Link every island into one network. Each number says how many bridges touch it.',
    sizes: [
      { id: '7', label: '7×7', tag: 'Easy', n: 7, islands: [8, 11] },
      { id: '9', label: '9×9', tag: 'Medium', n: 9, islands: [13, 17] },
      { id: '11', label: '11×11', tag: 'Hard', n: 11, islands: [19, 25] },
      { id: '13', label: '13×13', tag: 'Expert', n: 13, islands: [26, 34] },
    ],
    defaultSize: '9',
    rules: `
      <p>Connect the islands with straight horizontal or vertical bridges.</p>
      <ul>
        <li>The number on each island is how many bridges touch it.</li>
        <li>Two islands can share at most <b>2</b> bridges.</li>
        <li>Bridges can't cross each other or pass over islands.</li>
        <li>In the end every island must be connected into a single group.</li>
      </ul>
      <p>Drag from an island toward a neighbour — or tap the gap between them — to cycle 0 → 1 → 2 bridges. You can also tap one island, then another.</p>
      <p>Every puzzle has exactly one solution.</p>`,
    generate,
    View: BridgesView,
    logic: { buildEdges, countSolutions, isSolved },
  });
})(globalThis.PL = globalThis.PL || {});
