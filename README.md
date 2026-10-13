# Boxing Punch Quickness Demo — Brilliant Wear

Two wrist-worn Sense units (plus optional insoles) → punch detection, peak hand
speed, **automatic punch type**, **combo detection**, a **3 min / 1 min round
timer with bell**, per-round output, weight transfer per punch, a fatigue curve,
a confusion matrix from the labels you correct, and a session summary. Same
single-page family and navy / teal look as the Athletic Explosiveness demo.

**Run it:** serve over HTTPS or localhost (Web Bluetooth needs a secure
context) — `npm run serve` (tiny static server on <http://127.0.0.1:5362/>), or
`npx serve .` — or open `index.html` and hit **Simulate** (no hardware).

**Test it:** `npm test` (node, no dependencies — the logic in `core.js` and the fun layer),
`npm run smoke` (headless Chrome through playwright-core on the lab view: drives a 3-round
Simulate session, checks the UI, the unit switch, CSV export, mobile layout and
zero console errors) and `npm run smoke:fun` (the Fight view: first win, coached set, views, reduced motion, forget).
`npm run shoot:fun` writes the 390 px light, dark and reduced-motion screenshots to `docs/screenshots/fun/`.

## Files
| File | What |
|---|---|
| `index.html` | page markup |
| `styles.css` | all styling; every color / space / size / radius is a `:root` token |
| `core.js` | pure logic (`window.BPCore` / `require`): detector, classifier, combos, round clock, stats, confusion, weight shift, CSV rows, sim generators |
| `app.js` | UI, round clock wiring, audio, SDK adapter, Simulate engine; a small event bridge out (`bwfun`) and command bridge in (`bwcmd`) to the fun layer |
| `fun.css` | the fun layer's styles: the kit's `--fk-*` tokens mapped to this page's tokens, plus the Fight view |
| `src/fun/` | the fun layer (see "Bag Work" below); `src/vendor/fun-kit/` is the vendored shared kit, never edited here |
| `test/core.test.mjs` | unit tests for `core.js` (`node --test`) |
| `test/fun-*.test.mjs`, `test/hygiene.test.mjs` | the fun layer: rules, calls, guardrails, the session controller on a fake page, repo hygiene |
| `scripts/serve.mjs`, `scripts/smoke.mjs`, `scripts/smoke-fun.mjs`, `scripts/shoot-fun.mjs` | static server (:5362), the lab smoke, the Fight view smoke, the screenshots |

## Punch detection & speed
Wrist linear acceleration at 200 Hz (5 ms). Onset = |accel| > 2 g after a
250 ms refractory; the window ends when it falls under 0.8 g or at 450 ms.
Inside the window the world-frame acceleration (rotated by the game-rotation
quaternion) is integrated from assumed rest → peak hand speed. Windows with
peak < 1.2 m/s or path < 15 cm are discarded as arm wiggle. A hole of more than
50 ms in the sample stream (BLE dropout, Stop → Simulate) aborts the open window
without emitting a punch — integrated velocity is stale after a gap — and the
next sample can start a fresh one; Stop Simulate also resets the detector. Hand speed is
stored and exported in m/s; the **m/s ↔ mph** switch in the header only changes
the display (remembered per browser).

## Automatic punch type (v1 heuristic)
Per-punch features: net displacement, path length, curvature (path / net), yaw
rotation (start → end), vertical fraction.

| Rule | Type |
|---|---|
| vertical share of displacement > 0.5, upward | **uppercut** |
| \|yaw\| > 40° or curvature > 1.6 | **hook** |
| otherwise straight → lead hand / rear hand (stance toggle) | **jab** / **cross** |

The **true type** dropdown in the punch log corrects mislabels (or confirms
them with "✓ correct"). Every punch logs its feature vector to the table and
CSV, so a bag session becomes a labeled training set for `bwml`.

## Combos
Punches whose rest gap (previous punch end → next onset) is under **600 ms**
chain into one combination (a round change always splits). Combos use standard
boxing numbers: **1** jab · **2** cross · **3 / 4** lead / rear hook · **5 / 6**
lead / rear uppercut — so a jab, cross, lead hook reads `1-2-3`. Lead and rear
come from the stance toggle at the time of the punch; corrections renumber
immediately. The Combos card shows the latest combination, longest, singles and
the top three; each log row shows its combo and position.

## Rounds
Default 3 min round, 1 min rest, 3 rounds (all editable; also `?round=3&rest=1&rounds=6`
in minutes — URL values apply to that page load only and are never saved as your
defaults; a value you type into the field on the page is saved). **Start Rounds** runs the clock: bell on round start (one ring),
10-second clapper warning, two rings at round end (three after the last round),
a progress bar and a red pulse in the last 10 s. Punches are assigned to the
round they started in; punches during rest count in the totals but not in any
round. Stopping early closes the open round with its real duration (a Stop pressed just
after a round ended still closes that round at its scheduled end). A finished
or stopped session locks the timer until **Reset session** (two-click confirm,
so you can't lose labels by accident — export first).

**Per-round output:** punches, punches/min, combos and longest, mean / peak
speed overall and per type (jab, cross, hook, uppercut), L/R balance (% of
punches), and mean weight shift.

## Bag Work (the Fight view)
The page opens in **Fight view**: a rhythm game for your heavy bag. The coach calls a combo ("1-2-3"), you throw it, the bell keeps score.
Everything the page did before is still there: **Lab** in the header switches to the original page (every card, table and export),
**Setup** holds the sensor, Simulate, export and reset controls, and **Show lab details** opens the tables under the live cards.
`?mode=lab` shows the lab view for one visit, `?fun=0` turns the fun layer off entirely (nothing of it is even fetched and no storage is touched).

- **First win in 30 seconds, no setup.** *Start 30-second warm-up* (or *Simulate (no sensors)*, which starts Simulate and the warm-up in one tap) runs a
  30 s round: the first punch pops with its type and speed, a chain forms a combo string, and at the bell the Round Grade stamp lands, XP counts up and
  Level 2 opens. The time is measured with `createFirstWin().state().timeToWinMs`. Nothing asks for a name, an account or a permission.
- **Coach Calls.** After the warm-up, rounds call combos in boxing numbers (stage 1: `1`, `1-2`; stage 2 at Level 2; hooks at 3; uppercuts at 5; four punches
  at 6; stage 5 at 8). A call opens a window (2.5 s after the last spoken count, or 600 ms after your last punch). Judgments, always shape plus word:
  **Perfect** (right hands, every type, gaps 450 ms or less, first punch within 1.2 s), **Great**, **Good** (one type different), **Count it?**
  (right hands, the sensor read other types: one tap counts it for a flat +3 XP and, outside Simulate, saves what you called as the corrected labels)
  and **Missed**. The judge never fails a combo for the classifier's mistake. **Flow** x1 to x5 rises on Perfect or Great in a row and drops silently.
- **Round Grade** (Warm-up, Solid, Sharp, Fire; the warm-up round is always Warm-up): calls 40 (pace control 40 in free work), rhythm 35,
  finish 10, both hands 15. **Strong Finish** compares the last 30 s with the round's own mean speed, never in the warm-up, never after a fade over 25 percent.
- **XP** comes from rounds, calls and free combos only: free combo +2 (5 a round), called combo +3 / +5 / +8, round +15 (warm-up +10), Strong Finish +10,
  full session +25. No XP per punch, no XP for relabelling or confirming a label, 12 rounds a day (then 1 XP a round), a 200 XP soft cap a day.
- **Speed tiers** (Snap, Sharp, Steady, Easy) and speed bests exist only after the first minute of a session and never in the warm-up round.
  Speeds are stored in m/s and shown as m/s or mph (the header switch) everywhere.
- **Recap** (three cards: Rounds, Combo highlight, Up next) after every set, with a one-tap *Loved it / Fine / Not for me* that stays on this device with the first-win time.
- **Simulate is a demo.** It runs on a second kit instance on memory storage: nothing it earns is saved except the one-time Welcome Bonus (+40 XP).
  The simulated boxer answers calls with a mix of exact, late, wrong-order and short throws so every judgment shows up.
- **Settings** (all local): motion (follow the device, reduced, full), sounds, coach voice (off by default), coach calls, light / dark, the feedback tap,
  fun stats (counts only, CSV) and **Forget my data** (`kit.reset()`).
- **Guardrails.** Bag and pad work only: copy never says damage, knockout, power or force. No haptics are sent in this build (TODO[SDK]); the rule is tested:
  never inside a punch window or within 350 ms of an onset. Celebrations (confetti, toasts, level-up) wait behind one quiet gate while a round runs.
  Sounds and speech are optional and every cue has words and a shape on screen. Nothing loops or flashes; reduced motion removes all movement.

### How it is wired
`app.js` stays a plain script. It dispatches `bwfun` events (`punch`, `round.started`, `round.ended`, `session.done`, `session.reset`, `label.reviewed`, `sim`, ...)
and listens for `bwcmd` commands (`warmup`, `rounds`, `stop`, `reset`, `sim`, `simAnswer`). `src/fun/boot.js` loads the layer with a dynamic import.

| File | What |
|---|---|
| `config.js`, `copy.js` | every number, content table and word; no DOM, no kit import |
| `rules.js`, `calls.js`, `sim-driver.js`, `recap.js` | pure rules (tiers, gate, Round Grade, XP and caps, the haptic budget, the call ladder and judge, Flow, recap cards); no kit import |
| `kit.js` | the one `createFunKit` config and the memory-storage Simulate twin |
| `celebrate.js` | the only file that plays sound, speech or celebrations, behind the quiet gate |
| `session.js`, `ui.js`, `stats.js`, `prefs.js`, `start.js`, `boot.js` | the controller, the screens, local counts, display preferences, entry |

Measurement and safety code (`core.js`, `app.js`, the rules and the judge) never import the kit; a test greps for it. To update the kit:
`bash ~/Documents/GitHub/bw-fun-kit/scripts/vendor.sh .` from this repo, then `npm test`.

## Weight transfer (optional insoles)
With insoles connected (or **sim insoles** in Simulate) each punch gets a
front / back foot load shift: the lead-foot share of total insole load in the
last 60 ms of the punch minus its share in the 120 ms before onset, in
**percentage points** (`pp`). Positive = weight moved onto the front foot (the
usual drive on a jab / cross), negative = onto the back foot. The lead foot is
the one on the lead-hand side of the stance toggle. A ratio of the two feet's
own load means no standing calibration is needed and per-foot bias cancels.
Without insoles every weight field shows "—" and the CSV columns stay empty —
the rest of the demo is unaffected.

## Fatigue curve
Mean hand speed and punches/min per round, each indexed to the first round with
3+ punches (= 100 %). Shown from the second usable round on, with the late-round
speed and output change in the summary. Only **completed** rounds count: a round
still running, or one stopped before half its configured length, is left out
(a few seconds of punches would read as a fake fade), and the panel says "round
in progress" until two full rounds are in.

## Confusion matrix
Rows = your (corrected) label, columns = the heuristic's label, only for punches
you reviewed (unreviewed ≠ correct; **Mark all unreviewed correct** bulk-confirms
a clean session). Shows accuracy, per-type recall and precision. In Simulate,
**sim labels truth** tags each punch with what the generator threw — about 12 %
of the synthetic punches are deliberately sloppy (flat uppercuts, short hooks,
hooky straights), so the matrix shows realistic v1 confusions instead of a
perfect diagonal.

## Session summary
Always-on panel: punches, punches/min, mean / peak speed (and the punch type of
the peak), combinations and longest, L/R balance with per-hand speed, late-round
speed and output change, weight to the front foot on straights, auto-label
match — plus plain-language coaching notes (training wording, not medical; up to
seven can show) and a **Copy summary** button.

## CSV
- **Export Punches CSV** — the original columns first
  (`punch,hand,auto_type,true_type,peak_speed_ms,peak_accel_g,dur_ms,rot_deg,vert_frac,curve,gap_ms`),
  then `reviewed,round,lead_hand,combo,combo_pos,combo_str,wt_shift_pp,front_foot_pct`.
  `gap_ms` is now the rest between the previous punch's end and this onset (it
  used to be end-to-end).
- **Export Rounds CSV** — one row per round with the per-round output above
  (speeds in m/s).

## Simulate
Plays synthesized 200 Hz accel / quaternion through the real detector in wall
clock time: boxing combinations (`1-2`, `1-2-3`, `1-2-5-2`, `1-6-3-2` …) from
both hands with mixed types, a 100 Hz insole load stream with type-dependent
weight shift, and fatigue across rounds (speed and pace both fall a few percent
per round). Simulate stops itself when the rounds finish. The reaction drill
(beep → next impact) is unchanged.

## SDK notes
All hardware touchpoints live in `SDKAdapter` (`app.js`): a `BS.Device` per wrist
(`linearAcceleration` + `gameRotation`) and `BS.DevicePair.insoles` for the
`devicePressure` stream. `TODO[SDK]`: verify the insole event payload, the
world-frame up axis (z-up assumed), and the 250 ms refractory against real fast
double jabs (same-hand punches closer than ~420 ms onset-to-onset merge today —
tune on hardware data).

## Ground truth for speed
240 fps slow-mo (iPhone) with a marker on the glove and a known-length reference
in frame gives per-punch peak speed; regress it against the IMU estimate. No
radar needed.

*Estimates are training and performance summaries — not medical measurements.*
