// Generator tests: every puzzle is valid, deterministic, and (where promised) uniquely solvable.
// Run with `npm test` (Node 18+, no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
for (const f of ['js/core.js', 'js/games/flow.js', 'js/games/nonogram.js', 'js/games/bridges.js', 'js/games/beacons.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const { PL } = globalThis;
const LEVELS = 25;

function* puzzles(id) {
  const game = PL.games[id];
  for (const size of game.sizes) {
    for (let level = 1; level <= LEVELS; level++) {
      yield { size, level, puzzle: game.generate(new PL.RNG(PL.seedFor(id, size.id, level)), size) };
    }
  }
}

test('same seed gives the same puzzle', () => {
  for (const id of Object.keys(PL.games)) {
    const game = PL.games[id], size = game.sizes[1];
    const a = game.generate(new PL.RNG(PL.seedFor(id, size.id, 7)), size);
    const b = game.generate(new PL.RNG(PL.seedFor(id, size.id, 7)), size);
    assert.deepEqual(JSON.stringify(a), JSON.stringify(b), id);
  }
});

test('nonogram: clues match the picture and line logic alone solves it', () => {
  const { lineSolve, isSolved } = PL.games.nonogram.logic;
  for (const { puzzle: p, size, level } of puzzles('nonogram')) {
    const res = lineSolve(p.rows, p.cols, p.w, p.h);
    assert.ok(res.solved, `${size.id} L${level} not line-solvable`);
    assert.deepEqual(Array.from(res.grid), Array.from(p.solution));
    assert.ok(isSolved(p, Uint8Array.from(p.solution)));
  }
});

test('flow: solution pipes are valid, fill the board and never touch themselves', () => {
  const { isSolved, PALETTE } = PL.games.flow.logic;
  for (const { puzzle: p, size, level } of puzzles('flow')) {
    const tag = `${size.id} L${level}`;
    assert.ok(isSolved(p, p.solution), tag);
    assert.ok(p.ends.length <= PALETTE.length, tag);
    for (const pipe of p.solution) {
      assert.ok(pipe.length >= 3, `${tag} short pipe`);
      const idx = new Map(pipe.map((c, i) => [c, i]));
      for (let i = 0; i < pipe.length; i++) {
        for (const nb of PL.neighbors4(pipe[i], p.w, p.h)) {
          if (idx.has(nb)) assert.equal(Math.abs(idx.get(nb) - i), 1, `${tag} pipe touches itself`);
        }
      }
    }
  }
});

test('bridges: solution is valid and unique', () => {
  const { isSolved, countSolutions } = PL.games.bridges.logic;
  for (const { puzzle: p, size, level } of puzzles('bridges')) {
    const tag = `${size.id} L${level}`;
    assert.ok(isSolved(p, p.solution), tag);
    assert.equal(countSolutions(p, 2), 1, `${tag} not unique`);
    assert.ok(p.islands.every((i) => i.num >= 1 && i.num <= 8), tag);
  }
});

test('beacons: solution follows the rules and is the only one', () => {
  const { isSolved, countSolutions } = PL.games.beacons.logic;
  for (const { puzzle: p, size, level } of puzzles('beacons')) {
    const tag = `${size.id} L${level}`;
    const cells = new Uint8Array(p.n * p.n);
    p.solution.forEach((c, r) => { cells[r * p.n + c] = 2; });
    assert.ok(isSolved(p, cells), tag);
    assert.equal(countSolutions(p.n, p.clues, 2), 1, `${tag} not unique`);
    assert.ok(p.clues.every((q) => p.solution[q.r] !== q.c), `${tag} clue on a beacon`);
  }
});

test('rule checkers reject broken boards', () => {
  const flow = PL.games.flow, nono = PL.games.nonogram, br = PL.games.bridges, be = PL.games.beacons;
  const f = flow.generate(new PL.RNG(1), flow.sizes[0]);
  assert.ok(!flow.logic.isSolved(f, f.solution.map((p, k) => (k === 0 ? p.slice(0, -1) : p))));

  const n = nono.generate(new PL.RNG(2), nono.sizes[0]);
  const cells = Uint8Array.from(n.solution);
  cells[0] ^= 1;
  assert.ok(!nono.logic.isSolved(n, cells));

  const b = br.generate(new PL.RNG(3), br.sizes[0]);
  const vals = b.solution.slice();
  vals[vals.findIndex((v) => v > 0)] = 0;
  assert.ok(!br.logic.isSolved(b, vals));

  const bc = be.generate(new PL.RNG(4), be.sizes[0]);
  const grid = new Uint8Array(bc.n * bc.n);
  bc.solution.forEach((c, r) => { grid[r * bc.n + c] = 2; });
  grid[bc.solution[0]] = 0;
  assert.ok(!be.logic.isSolved(bc, grid));
});
