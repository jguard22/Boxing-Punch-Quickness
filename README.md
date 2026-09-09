# Boxing Punch Quickness Demo — Brilliant Wear (first draft)

Two wrist-worn Sense units → punch detection, peak hand speed, **automatic
punch-type classification**, punch rate, and a beep-reaction drill. Same
single-page family as the Warehouse Ergonomics demo.

**Run it:** serve over HTTPS or localhost (Web Bluetooth needs a secure
context) — `npx serve .` — or open `index.html` and hit **Simulate**.

## Punch detection & speed
Wrist linear acceleration at 200 Hz (5 ms). Onset = |accel| > 2 g after a
250 ms refractory; window ends when it falls under 0.8 g or at 450 ms. Within
the window, world-frame acceleration (rotated by the game-rotation
quaternion) is integrated from assumed rest → peak hand speed (m/s + mph).
Windows with peak < 1.2 m/s or path < 15 cm are discarded as arm wiggle.

## Automatic punch-type classification (v1 heuristic)
Per-punch features: net displacement vector, path length, curvature
(path / net), yaw rotation (start→end quaternion), vertical fraction.

| Rule | Type |
|---|---|
| vertical share of displacement > 0.5, upward | **uppercut** |
| \|yaw\| > 40° or curvature > 1.6 | **hook** |
| otherwise straight → lead hand / rear hand (stance toggle) | **jab** / **cross** |

Every punch logs its full feature vector to the table + CSV, and the
**true type** dropdown corrects mislabels — so a session of bag work comes
out as a labeled training set. The heuristic is v1 scaffolding; the CSV is
the point: `bwml` trains the real classifier (logistic → int8 CNN for
on-device) from `{peak_speed, peak_accel, dur, rot_deg, vert_frac, curve}`
against the corrected labels.

Known v1 limits (marked TODO[SDK]): world-frame up axis assumed z-up —
verify on hardware; overhand and body-shot variants not yet split; the
"assumed rest at onset" integration undercounts speed when punches chain
fast (feature, not bug, for gap_ms < refractory — tune on real data).

## Ground truth for speed
240 fps slow-mo (iPhone) with a marker on the glove + a known-length
reference in frame → per-punch peak speed; regress against the IMU estimate.
No radar needed.

## Reaction drill
Arm GO (space) → random-delay beep → next detected impact stops the clock.
Beep→impact ms per attempt, session best kept.
