# Pocket Logic

Endless, procedurally generated logic puzzles. Every level is built by code on the device from a seed, so there are unlimited puzzles, nothing to download, and the app works offline. The whole thing is about 125 KB of HTML, CSS and JavaScript, with no dependencies and no build step.

| Game | Rules | How the generator works |
|---|---|---|
| **Flow** | Connect each pair of matching dots. Pipes can't cross, and every cell must be filled. | Makes a random Hamiltonian path over the grid (using "backbite" moves), cuts it into short pieces, then joins neighbouring pieces until the target number of pipes is reached. A pipe is never allowed to run alongside itself. A constraint solver then confirms that no other solution of that kind exists; the game still accepts any valid solution the player finds. |
| **Nonogram** | Fill cells so each row and column matches its run-length clues. | Draws a random picture (noise, blobs or a mirrored image) and runs a line solver on it. If the solver gets stuck, one undecided cell is flipped and the solver runs again. Every puzzle can therefore be solved one line at a time, with a unique answer and no guessing. |
| **Bridges** (Hashiwokakero) | Link the islands with 1 or 2 straight bridges so that each island has as many bridges as its number and everything forms one connected group. | Grows a network of islands outward from a starting island and adds a few loops. A constraint-propagation solver with backtracking then checks that there is exactly one solution. |
| **Beacons** *(original)* | Place one beacon in every row and every column. Beacons never touch, not even diagonally. Each number is the walking distance (up/down/left/right steps) to the nearest beacon. | Lists every legal beacon layout for the board size, picks one, adds distance clues until only that layout fits, then removes any clue that isn't needed. |

Each game comes in 4 sizes, from Easy to Expert. The game, size and level number together form the seed, so *Flow 7×7 · Level 42* is the same puzzle on every device.

### Features

- **Daily puzzles:** one puzzle per game each day, seeded from the date, so everyone gets the same set. Solving at least one daily a day builds a streak, and **Share** copies a spoiler-free summary of your results.
- **Stats:** levels solved and best times for every game and difficulty, plus your daily totals and your current and record streaks.
- **Game feel:** short synthesised sounds (Web Audio, so no audio files) and vibration on supported phones when you complete a pipe, line or island, plus confetti when you solve a puzzle. The speaker button mutes all of it.
- **Helpers:**
  - undo, restart and hints (Nonogram hints only reveal cells you can deduce from the current board),
  - a Nonogram counter that shows your stroke length while you drag,
  - Beacons dots marking tiles your beacons already rule out,
  - a Bridges preview of the next bridge when you hover or select an island.
- **Everything else:** the rules open automatically the first time you play a game. There's a timer with best times, automatic saving of your progress (saves are tied to a fingerprint of the puzzle, so they never load onto a different board), and light and dark themes.

## Run it

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8080   # or: npm start
# then open http://localhost:8080
```

The offline service worker only runs when the app is served over http(s). Opening it from `file://` still works, but without offline caching.

### Publish with GitHub Pages

Go to **Settings → Pages → Build and deployment**, choose *Deploy from a branch*, select the branch and `/ (root)`. The app uses only relative paths, so it works under `https://<user>.github.io/<repo>/`. After it loads once, it can be installed as an app and played offline.

## Tests

```sh
npm test   # node --test, no dependencies
```

The tests generate 25 levels of every size of every game and check that:

- each puzzle is valid,
- the same seed always gives the same puzzle,
- Nonograms can be solved by line logic alone,
- Bridges, Beacons and Flow puzzles have exactly one solution (for Flow: one in which no pipe doubles back alongside itself),
- Flow pipes never touch themselves,
- the Flow solver finds both solutions of a known ambiguous board,
- daily seeds differ by day and by game,
- the rule checkers reject broken boards.

## Project layout

```
index.html              app shell
css/style.css           styles and theme tokens (the canvas boards read these too)
js/core.js              seeded RNG, game registry, BoardView base class (canvas, input, undo, progress events)
js/fx.js                sounds, haptics and confetti
js/games/flow.js        each game file = generator + solver/checker + board view
js/games/nonogram.js
js/games/bridges.js
js/games/beacons.js
js/app.js               home screen, daily puzzles, routing, levels, timer, saving, stats, win screen
sw.js                   offline cache (bump VERSION when you change files)
manifest.webmanifest    install metadata
tests/                  generator tests
```

To add a game, create a file in `js/games/` that calls `PL.register({ id, name, blurb, sizes, rules, generate(rng, size), View })`, where `View` extends `PL.BoardView`. Then add a `<script>` tag for it, include it in `ORDER` and `ICONS` in `app.js`, and add it to the service worker's asset list.
