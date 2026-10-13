# Boxing Punch Quickness Demo — Brilliant Wear

Two wrist-worn Sense units (plus optional insoles) → punch detection, peak hand
speed, **automatic punch type**, **combo detection**, a **3 min / 1 min round
timer with bell**, per-round output, weight transfer per punch, a fatigue curve,
a confusion matrix from the labels you correct, and a session summary. Same
single-page family and navy / teal look as the Athletic Explosiveness demo.

**Run it:** serve over HTTPS or localhost (Web Bluetooth needs a secure
context) — `npm run serve` (tiny static server on <http://127.0.0.1:5362/>), or
`npx serve .` — or open `index.html` and hit **Simulate** (no hardware).

**Test it:** `npm test` (node, no dependencies — the logic in `core.js`) and
`npm run smoke` (headless Chrome through playwright-core: drives a 3-round
Simulate session, checks the UI, the unit switch, CSV export, mobile layout and
zero console errors).

## Files
| File | What |
|---|---|
| `index.html` | page markup |
| `styles.css` | all styling; every color / space / size / radius is a `:root` token |
| `core.js` | pure logic (`window.BPCore` / `require`): detector, classifier, combos, round clock, stats, confusion, weight shift, CSV rows, sim generators |
| `app.js` | UI, round clock wiring, audio, SDK adapter, Simulate engine |
| `test/core.test.mjs` | unit tests for `core.js` (`node --test`) |
| `scripts/serve.mjs`, `scripts/smoke.mjs` | static server (:5362) and headless smoke test |

## Punch detection & speed
Wrist linear acceleration at 200 Hz (5 ms). Onset = |accel| > 2 g after a
250 ms refractory; the window ends when it falls under 0.8 g or at 450 ms.
Inside the window the world-frame acceleration (rotated by the game-rotation
quaternion) is integrated from assumed rest → peak hand speed. Windows with
peak < 1.2 m/s or path < 15 cm are discarded as arm wiggle. Hand speed is
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
in minutes). **Start Rounds** runs the clock: bell on round start (one ring),
10-second clapper warning, two rings at round end (three after the last round),
a progress bar and a red pulse in the last 10 s. Punches are assigned to the
round they started in; punches during rest count in the totals but not in any
round. Stopping early closes the open round with its real duration. A finished
or stopped session locks the timer until **Reset session** (two-click confirm,
so you can't lose labels by accident — export first).

**Per-round output:** punches, punches/min, combos and longest, mean / peak
speed overall and per type (jab, cross, hook, uppercut), L/R balance (% of
punches), and mean weight shift.

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
speed and output change in the summary.

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
match — plus plain-language coaching notes (training wording, not medical) and a
**Copy summary** button.

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
