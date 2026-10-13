import { test } from "node:test";
import assert from "node:assert/strict";
import core from "../core.js";

const C = core;
const KIND_OF = { jab: "straight", cross: "straight", hook: "hook", uppercut: "uppercut" };

// Drive synthesized punches through the real detector at virtual times.
function throwPunch(det, hand, kind, t0, rng, o = {}) {
  const s = C.synthPunch(kind, rng, o);
  let out = null;
  for (const smp of s.samples) {
    det.quat(hand, smp.q);
    const p = det.acc(hand, smp.a, t0 + smp.ms);
    if (p) out = p;
  }
  return { punch: out, durMs: s.durMs };
}
function mkPunch(over = {}) {
  return { hand: "L", lead: "L", type: "jab", trueType: null, startT: 0, t: 150, durMs: 150, peakV: 7, peakG: 6, up: 0, vertFrac: 0.1, curve: 1, rotDeg: 3, round: 0, ...over };
}

test("clean synthesized punches classify to their intended type", () => {
  const rng = C.mulberry32(42);
  const det = C.createDetector({ getLead: () => "L" });
  let t = 1000, ok = 0, n = 0;
  for (let i = 0; i < 120; i++) {
    const kind = ["straight", "hook", "uppercut"][i % 3];
    const hand = i % 2 ? "R" : "L";
    const { punch } = throwPunch(det, hand, kind, t, rng);
    t += 1500;
    assert.ok(punch, `punch ${i} (${kind}) detected`);
    n++;
    const want = kind === "straight" ? (hand === "L" ? "jab" : "cross") : kind;
    if (punch.type === want) ok++;
    assert.ok(punch.peakV > 3 && punch.peakV < 14, `speed ${punch.peakV} in a plausible range`);
  }
  assert.ok(ok / n >= 0.97, `accuracy ${ok}/${n}`);
});

test("ambiguous (sloppy) variants are usually mislabeled by the v1 heuristic", () => {
  const rng = C.mulberry32(7);
  const det = C.createDetector({ getLead: () => "L" });
  let t = 1000, wrong = 0, n = 0;
  for (let i = 0; i < 90; i++) {
    const kind = ["straight", "hook", "uppercut"][i % 3];
    const { punch } = throwPunch(det, "L", kind, t, rng, { ambiguous: true });
    t += 1500;
    const want = kind === "straight" ? "jab" : kind;
    n++; if (punch.type !== want) wrong++;
  }
  assert.ok(wrong / n > 0.6, `mislabeled ${wrong}/${n}`);
});

test("refractory: an onset inside 250 ms of the last window end is ignored", () => {
  const rng = C.mulberry32(3);
  const det = C.createDetector({});
  const a = throwPunch(det, "L", "straight", 1000, rng);
  const endT = 1000 + a.durMs + 40;
  const second = throwPunch(det, "L", "straight", endT - 20, rng); // overlaps the refractory window
  assert.ok(a.punch);
  assert.equal(second.punch, null, "second onset suppressed");
  const third = throwPunch(det, "L", "straight", endT + 600, rng);
  assert.ok(third.punch, "later punch detected");
});

test("stance flips jab/cross for the same hand", () => {
  const rng = C.mulberry32(5);
  let lead = "L";
  const det = C.createDetector({ getLead: () => lead });
  const a = throwPunch(det, "L", "straight", 1000, rng).punch;
  lead = "R";
  const b = throwPunch(det, "L", "straight", 3000, rng).punch;
  assert.equal(a.type, "jab");
  assert.equal(b.type, "cross");
  assert.equal(a.lead, "L"); assert.equal(b.lead, "R");
});

test("boxing numbers: 1 jab, 2 cross, 3/4 hooks, 5/6 uppercuts, corrections win", () => {
  assert.equal(C.punchNumber(mkPunch({ type: "jab" })), 1);
  assert.equal(C.punchNumber(mkPunch({ type: "cross", hand: "R" })), 2);
  assert.equal(C.punchNumber(mkPunch({ type: "hook", hand: "L" })), 3);
  assert.equal(C.punchNumber(mkPunch({ type: "hook", hand: "R" })), 4);
  assert.equal(C.punchNumber(mkPunch({ type: "uppercut", hand: "L" })), 5);
  assert.equal(C.punchNumber(mkPunch({ type: "uppercut", hand: "R" })), 6);
  assert.equal(C.punchNumber(mkPunch({ type: "jab", trueType: "hook" })), 3);
  // southpaw: right hand leads
  assert.equal(C.punchNumber(mkPunch({ type: "hook", hand: "R", lead: "R" })), 3);
});

test("combo grouping: 600 ms rule, round split, string and stats", () => {
  const P = [
    mkPunch({ n: 1, type: "jab", startT: 0, t: 150 }),
    mkPunch({ n: 2, type: "cross", hand: "R", startT: 400, t: 560 }),       // 250 ms rest -> same combo
    mkPunch({ n: 3, type: "hook", hand: "L", startT: 900, t: 1050 }),       // 340 ms -> same combo
    mkPunch({ n: 4, type: "jab", startT: 1800, t: 1950 }),                  // 750 ms -> new combo
    mkPunch({ n: 5, type: "cross", hand: "R", startT: 2300, t: 2450 }),     // 350 ms -> same
    mkPunch({ n: 6, type: "jab", startT: 2900, t: 3050, round: 1 }),        // within gap but round changes
  ];
  const combos = C.annotateCombos(P);
  assert.deepEqual(combos.map((c) => c.str), ["1-2-3", "1-2", "1"]);
  assert.deepEqual(P.map((p) => p.combo), [1, 1, 1, 2, 2, 3]);
  assert.deepEqual(P.map((p) => p.comboPos), [1, 2, 3, 1, 2, 1]);
  assert.equal(combos[0].durMs, 1050);
  assert.deepEqual(C.comboTally(combos), [{ str: "1-2-3", count: 1 }, { str: "1-2", count: 1 }].sort((a, b) => b.count - a.count || b.str.length - a.str.length));
  assert.equal(C.describeCombo("1-2-3"), "jab · cross · lead hook");
  // correcting punch 3 from hook to uppercut renumbers the combo
  P[2].trueType = "uppercut";
  assert.equal(C.annotateCombos(P)[0].str, "1-2-5");
});

test("round clock: events in order, phases, warn, stop", () => {
  const clk = C.createRoundClock({ roundMs: 30000, restMs: 10000, rounds: 2, warnMs: 10000 });
  assert.equal(clk.phaseAt(0).phase, "idle");
  const ev0 = clk.start(1000);
  assert.deepEqual(ev0.map((e) => e.type), ["roundStart"]);
  assert.equal(clk.phaseAt(1000 + 5000).phase, "round");
  assert.equal(clk.phaseAt(1000 + 5000).n, 1);
  assert.equal(clk.phaseAt(1000 + 5000).remainingMs, 25000);
  const evs = clk.tick(1000 + 45000);
  assert.deepEqual(evs.map((e) => e.type + e.n), ["warn1", "roundEnd1", "restStart1", "roundStart2"]);
  assert.equal(evs[1].t, 1000 + 30000);
  assert.equal(clk.phaseAt(1000 + 35000).phase, "rest");
  const rest = clk.tick(1000 + 90000).map((e) => e.type + e.n);
  assert.deepEqual(rest, ["warn2", "roundEnd2", "done2"]);
  assert.equal(clk.finished, true);
  assert.equal(clk.phaseAt(1000 + 95000).phase, "done");
  assert.equal(clk.running, false);

  // short rounds skip the warning; stop mid-round
  const c2 = C.createRoundClock({ roundMs: 12000, restMs: 3000, rounds: 3, warnMs: 10000 });
  c2.start(0);
  assert.deepEqual(c2.tick(12000).map((e) => e.type), ["roundEnd", "restStart"]);
  const st = c2.stop(13500);
  assert.equal(st[0].phase, "rest");
  assert.equal(c2.running, false);
  assert.equal(c2.phaseAt(14000).phase, "stopped");
  assert.deepEqual(c2.tick(60000), []);
  assert.equal(C.fmtClock(180000), "3:00");
  assert.equal(C.fmtClock(59001), "1:00");
  assert.equal(C.fmtClock(-5), "0:00");
});

test("per-round stats: counts, rate, by-type speed, L/R balance, combos", () => {
  const P = [];
  let n = 0;
  const add = (o) => P.push(mkPunch({ n: ++n, ...o }));
  add({ type: "jab", hand: "L", peakV: 8, startT: 0, t: 150, round: 1 });
  add({ type: "cross", hand: "R", peakV: 6, startT: 400, t: 550, round: 1 });
  add({ type: "jab", hand: "L", peakV: 7, startT: 3000, t: 3150, round: 1 });
  add({ type: "hook", hand: "L", peakV: 5, startT: 70000, t: 70150, round: 2 });
  const sess = C.buildSession(P, [{ n: 1, startT: 0, endT: 60000 }, { n: 2, startT: 60000, endT: null }], 120000);
  const r1 = sess.rounds[0], r2 = sess.rounds[1];
  assert.equal(r1.count, 3);
  assert.equal(r1.perMin, 3);
  assert.equal(r1.meanV, 7);
  assert.equal(r1.peakV, 8);
  assert.equal(r1.byType.jab.n, 2);
  assert.equal(r1.byType.jab.mean, 7.5);
  assert.equal(r1.byType.cross.peak, 6);
  assert.equal(r1.byType.hook.n, 0);
  assert.equal(r1.byType.hook.mean, null);
  assert.equal(r1.nL, 2); assert.equal(r1.nR, 1);
  assert.ok(Math.abs(r1.pctL - 66.6667) < 0.01);
  assert.equal(r1.combos, 1); assert.equal(r1.singles, 1); assert.equal(r1.longest, 2);
  assert.equal(r2.open, true);
  assert.equal(r2.durMs, 60000);
  assert.equal(sess.total.count, 4);
  assert.equal(sess.total.durMs, 120000);
  assert.equal(sess.inRounds, 4);
  // output rate counts only punches thrown while the clock was live
  P.push(mkPunch({ n: 5, startT: 62000, t: 62150, round: 0, peakV: 4 }));
  const s2 = C.buildSession(P, [{ n: 1, startT: 0, endT: 60000 }, { n: 2, startT: 60000, endT: null }], 120000);
  assert.equal(s2.total.count, 5);
  assert.equal(s2.inRounds, 4);
  assert.equal(s2.total.perMin, 4 / 2);
});

test("detector ignores out-of-order samples", () => {
  const det = C.createDetector({});
  det.acc("L", { x: 0, y: 0, z: 0 }, 100);
  det.acc("L", { x: 0, y: 0, z: 0 }, 105);
  assert.equal(det.acc("L", { x: 50, y: 0, z: 0 }, 103), null);
  assert.equal(det.hands.L.active, false);
});

test("free work (no rounds): rate withheld until 20 s of work", () => {
  const P = [mkPunch({ n: 1, startT: 0, t: 150 }), mkPunch({ n: 2, startT: 5000, t: 5150 })];
  assert.equal(C.buildSession(P, [], 6000).total.perMin, null);
  const Q = [mkPunch({ n: 1, startT: 0, t: 150 }), mkPunch({ n: 2, startT: 30000, t: 30150 })];
  assert.equal(C.buildSession(Q, [], 31000).total.perMin, 2 / (30150 / 60000));
});

test("fatigue curve: % of first usable round, needs 2+ rounds", () => {
  const stat = (n, count, meanV, perMin) => ({ n, count, meanV, perMin });
  assert.equal(C.fatigueCurve([stat(1, 40, 7, 40)]), null);
  assert.equal(C.fatigueCurve([stat(1, 2, 7, 40), stat(2, 40, 7, 40)]), null, "rounds with <3 punches are not usable");
  const f = C.fatigueCurve([stat(1, 40, 8, 50), stat(2, 38, 7.6, 46), stat(3, 30, 6.4, 40)]);
  assert.equal(f.points.length, 3);
  assert.equal(f.points[0].speedPct, 100);
  assert.ok(Math.abs(f.speedFadePct - -20) < 1e-9);
  assert.ok(Math.abs(f.rateFadePct - -20) < 1e-9);
  assert.equal(f.lastRound, 3);
});

test("confusion matrix: reviewed punches only, accuracy / precision / recall", () => {
  const P = [
    mkPunch({ type: "jab", trueType: "jab" }),
    mkPunch({ type: "jab", trueType: "jab" }),
    mkPunch({ type: "jab", trueType: "cross" }),
    mkPunch({ type: "hook", trueType: "hook" }),
    mkPunch({ type: "cross", trueType: null }),
    mkPunch({ type: "cross", trueType: "uppercut" }),
  ];
  const c = C.confusion(P);
  assert.equal(c.n, 5);
  assert.equal(c.ok, 3);
  assert.equal(c.accuracy, 0.6);
  assert.equal(c.m.cross.jab, 1);
  assert.equal(c.m.uppercut.cross, 1);
  assert.equal(c.recall.jab, 2 / 2);
  assert.equal(c.recall.cross, 0);
  assert.equal(c.precision.jab, 2 / 3);
  assert.equal(c.precision.uppercut, null);
  assert.equal(C.confusion([]).accuracy, null);
});

test("insole weight transfer: front-foot shift and absent-insole case", () => {
  const rng = C.mulberry32(11);
  const sim = C.createInsoleSim(rng);
  const buf = [];
  const t0 = 2000, dur = 170;
  sim.punch(t0, dur, 14);
  for (let t = 1500; t <= 3000; t += 10) { const s = sim.sample(t); buf.push([t, s.lead, s.rear]); } // lead = left foot
  const w = C.weightShift(buf, t0, t0 + dur, "left");
  assert.ok(w.shiftPp > 9 && w.shiftPp < 17, `shift ${w.shiftPp}`);
  assert.ok(w.frontPct > 55);
  const wr = C.weightShift(buf, t0, t0 + dur, "right");
  assert.ok(wr.shiftPp < -9, "same samples read from the other foot flip sign");
  assert.equal(C.weightShift([], t0, t0 + dur, "left"), null);
  assert.equal(C.weightShift([[t0 + 5000, 0.5, 0.5]], t0, t0 + dur, "left"), null);
});

test("units: stored m/s, displayed m/s or mph, round trip", () => {
  assert.equal(C.fmtSpeed(7, "ms"), "7.0");
  assert.equal(C.fmtSpeed(7, "mph"), "15.7");
  assert.equal(C.fmtSpeed(null, "mph"), "—");
  assert.ok(Math.abs(C.fromMph(C.toMph(6.25)) - 6.25) < 1e-12);
  assert.equal(C.speedLabel("mph"), "mph");
  assert.equal(C.speedLabel("ms"), "m/s");
});

test("end to end: simulated combos through the detector give the thrown combos", () => {
  const rng = C.mulberry32(99);
  const lead = "L";
  const got = [];
  const det2 = C.createDetector({ getLead: () => lead, onPunch: (p) => got.push(p) });
  let t = 1000;
  const thrown = [];
  for (let i = 0; i < 25; i++) {
    const nums = C.pickCombo(rng);
    thrown.push(nums.join("-"));
    let prevHand = null;
    for (const [hand, kind] of C.comboToThrows(nums, lead)) {
      const s = C.synthPunch(kind, rng);
      for (const smp of s.samples) { det2.quat(hand, smp.q); det2.acc(hand, smp.a, t + smp.ms); }
      t += prevHand === hand ? 560 : 400; // same-hand repeats need > refractory
      prevHand = hand;
    }
    t += 1200;
  }
  got.forEach((p, i) => { p.n = i + 1; });
  const combos = C.annotateCombos(got);
  assert.equal(got.length, thrown.join("-").split("-").length, "every thrown punch detected once");
  assert.deepEqual(combos.map((c) => c.str), thrown, "combo strings match what was thrown");
});

test("CSV row and header have matching column counts", () => {
  const p = mkPunch({ n: 1, combo: 1, comboPos: 1, shiftPp: 8.123, frontPct: 61.2 });
  assert.equal(C.punchCsvRow(p, "1-2").split(",").length, C.PUNCH_CSV_HEADER.split(",").length);
  const sess = C.buildSession([p], [{ n: 1, startT: 0, endT: 60000 }], 60000);
  assert.equal(C.roundCsvRow(sess.rounds[0]).split(",").length, C.ROUND_CSV_HEADER.split(",").length);
  assert.ok(C.PUNCH_CSV_HEADER.startsWith("punch,hand,auto_type,true_type,peak_speed_ms,peak_accel_g,dur_ms,rot_deg,vert_frac,curve,gap_ms"), "original columns keep their order");
});

test("coach notes: sport wording, fade and drive callouts", () => {
  const P = [];
  let n = 0;
  const mk = (round, startT, v, hand, type, shiftPp) => P.push(mkPunch({ n: ++n, round, startT, t: startT + 150, peakV: v, hand, type, shiftPp }));
  for (let i = 0; i < 6; i++) mk(1, i * 5000, 8, i % 2 ? "R" : "L", i % 2 ? "cross" : "jab", 12);
  for (let i = 0; i < 6; i++) mk(2, 60000 + i * 5000, 6, i % 2 ? "R" : "L", i % 2 ? "cross" : "jab", 12);
  const sess = C.buildSession(P, [{ n: 1, startT: 0, endT: 60000 }, { n: 2, startT: 60000, endT: 120000 }], 120000);
  const notes = C.coachNotes(sess, C.confusion(P), "mph");
  const text = notes.map((x) => x.text).join(" | ");
  assert.ok(/faded 25%/.test(text), text);
  assert.ok(/front foot/.test(text), text);
  assert.ok(/mph/.test(text));
  assert.ok(!/(diagnos|treat|injur|medical)/i.test(text));
  assert.ok(C.summaryText(sess, C.confusion(P), "ms").includes("R2:"));
});

// ---------- review fixes ----------
test("detector: a gap in the stream aborts the open window instead of emitting a ghost punch", () => {
  const rng = C.mulberry32(11);
  const det = C.createDetector({});
  // 90 ms of a straight punch, then the stream dies (BLE dropout / Stop Simulate)
  const s = C.synthPunch("straight", rng);
  let first = null;
  for (const smp of s.samples) {
    if (smp.ms > 90) break;
    det.quat("L", smp.q);
    first = det.acc("L", smp.a, 1000 + smp.ms) || first;
  }
  assert.equal(first, null);
  assert.equal(det.hands.L.active, true, "window open when the stream stops");
  // 8 s later a clean punch arrives: it must be detected on its own, not swallowed
  const real = throwPunch(det, "L", "straight", 9000, rng);
  assert.ok(real.punch, "post-gap punch detected");
  assert.ok(real.punch.durMs <= 450, `duration ${real.punch.durMs} within the cap`);
  assert.ok(real.punch.startT >= 9000, `punch starts after the gap (${real.punch.startT})`);
  assert.ok(real.punch.peakV < 14, `no stale velocity carried over (${real.punch.peakV})`);
  assert.equal(det.hands.L.aborted, 1);
});

test("detector: the first sample after a gap can itself start a new window", () => {
  const det = C.createDetector({});
  det.acc("L", { x: 0, y: 0, z: 0 }, 100);
  det.acc("L", { x: 40, y: 0, z: 0 }, 105);              // onset
  assert.equal(det.hands.L.active, true);
  det.acc("L", { x: 40, y: 0, z: 0 }, 2000);             // 1.9 s hole, still hard acceleration
  assert.equal(det.hands.L.active, true);
  assert.equal(det.hands.L.start, 2000, "fresh window opened at the post-gap sample");
  assert.equal(det.hands.L.aborted, 1);
});

test("detector: reset() drops an open window", () => {
  const det = C.createDetector({});
  det.acc("L", { x: 0, y: 0, z: 0 }, 100);
  det.acc("L", { x: 40, y: 0, z: 0 }, 105);
  det.reset();
  assert.equal(det.hands.L.active, false);
  assert.equal(det.hands.L.lastT, null);
});

test("fatigue curve: open and stopped-early rounds are left out", () => {
  const mkR = (n, count, meanV, perMin, durMs, open = false) => ({ n, count, meanV, perMin, durMs, open });
  // R3 still running, 5 punches in a few seconds: would read +260% output / big speed swing
  const f = C.fatigueCurve([mkR(1, 40, 8, 50, 180000), mkR(2, 38, 7.6, 46, 180000), mkR(3, 5, 4, 180, 4000, true)]);
  assert.equal(f.lastRound, 2);
  assert.equal(f.points.length, 2);
  // stopped at 5 s of a 180 s round: too short even though it is closed
  const g = C.fatigueCurve([mkR(1, 40, 8, 50, 180000), mkR(2, 38, 7.6, 46, 180000), mkR(3, 4, 9, 180, 5000)], { roundMs: 180000 });
  assert.equal(g.lastRound, 2);
  assert.deepEqual(g.skipped.map((r) => r.n), [3]);
  // a round stopped at 60% of its length still counts
  const h = C.fatigueCurve([mkR(1, 40, 8, 50, 180000), mkR(2, 25, 7.6, 46, 108000)], { roundMs: 180000 });
  assert.equal(h.lastRound, 2);
  // only one complete round -> no curve at all
  assert.equal(C.fatigueCurve([mkR(1, 40, 8, 50, 180000), mkR(2, 5, 4, 180, 4000, true)]), null);
  // without a configured length the longest closed round is the yardstick
  assert.equal(C.fatigueCurve([mkR(1, 40, 8, 50, 180000), mkR(2, 4, 9, 180, 5000)]), null);
});

test("buildSession: an in-progress round never feeds the fatigue read-out or the notes", () => {
  const P = [];
  let n = 0;
  const mk = (round, startT, v, hand) => P.push(mkPunch({ n: ++n, round, startT, t: startT + 150, peakV: v, hand, type: hand === "L" ? "jab" : "cross" }));
  for (let i = 0; i < 20; i++) mk(1, i * 3000, 8, i % 2 ? "R" : "L");
  for (let i = 0; i < 5; i++) mk(2, 60000 + i * 700, 12, i % 2 ? "R" : "L");   // 5 fast punches, 3.5 s into round 2
  const rounds = [{ n: 1, startT: 0, endT: 60000 }, { n: 2, startT: 60000, endT: null }];
  const sess = C.buildSession(P, rounds, 63500, { roundMs: 60000 });
  assert.equal(sess.fatigue, null);
  assert.equal(sess.fatigueNote, "round in progress");
  assert.equal(sess.openRound, 2);
  const text = C.coachNotes(sess, C.confusion(P), "ms").map((x) => x.text).join(" | ");
  assert.ok(!/Hand speed (faded|eased|rose|held)/.test(text), text);
  // the same round stopped 3.5 s in is a stub, still excluded
  const stopped = C.buildSession(P, [rounds[0], { n: 2, startT: 60000, endT: 63500 }], 70000, { roundMs: 60000 });
  assert.equal(stopped.fatigue, null);
  assert.equal(stopped.fatigueNote, "needs 2+ full rounds");
});

test("round clock: Stop before the tick delivered roundEnd still closes the round first", () => {
  const clk = C.createRoundClock({ roundMs: 10000, restMs: 3000, rounds: 2, warnMs: 10000 });
  clk.start(0);
  const evs = clk.stop(10050);                       // no tick between 10000 and the click
  assert.deepEqual(evs.map((e) => e.type), ["roundEnd", "restStart", "stopped"]);
  assert.equal(evs[0].t, 10000, "roundEnd keeps its scheduled time");
  assert.equal(evs[2].phase, "rest");
  assert.deepEqual(clk.tick(60000), []);
  // Stop after the whole session ended but before the final tick: events, no 'stopped'
  const c2 = C.createRoundClock({ roundMs: 1000, restMs: 500, rounds: 1, warnMs: 10000 });
  c2.start(0);
  assert.deepEqual(c2.stop(1200).map((e) => e.type), ["roundEnd", "done"]);
  assert.equal(c2.finished, true);
  // Stop mid-round is unchanged
  const c3 = C.createRoundClock({ roundMs: 10000, restMs: 3000, rounds: 2, warnMs: 10000 });
  c3.start(0);
  const st = c3.stop(4000);
  assert.deepEqual(st.map((e) => e.type), ["stopped"]);
  assert.equal(st[0].phase, "round");
});

function noteFixture(v1, v2, n1, n2) {
  // Left-hand heavy (80%), jabs + hooks, one 3-punch combo, forward weight shift, all reviewed.
  const P = [];
  let n = 0;
  const add = (round, startT, v, i) => {
    const hand = i % 5 === 4 ? "R" : "L";
    const type = hand === "R" ? "cross" : i % 3 === 0 ? "hook" : "jab";
    P.push(mkPunch({ n: ++n, round, startT, t: startT + 150, peakV: v, hand, type, trueType: type, shiftPp: 14 }));
  };
  for (let i = 0; i < n1; i++) add(1, i * (58000 / n1), v1, i);
  for (let i = 0; i < n2; i++) add(2, 60000 + i * (58000 / n2), v2, i);
  P.push(mkPunch({ n: ++n, round: 2, startT: 118300, t: 118450, peakV: v2, hand: "R", type: "cross", trueType: "cross", shiftPp: 14 }));
  P.push(mkPunch({ n: ++n, round: 2, startT: 118700, t: 118850, peakV: v2, hand: "L", type: "jab", trueType: "jab", shiftPp: 14 }));
  P.push(mkPunch({ n: ++n, round: 2, startT: 119100, t: 119250, peakV: v2, hand: "R", type: "cross", trueType: "cross", shiftPp: 14 }));
  const rounds = [{ n: 1, startT: 0, endT: 60000 }, { n: 2, startT: 60000, endT: 120000 }];
  return { P, sess: C.buildSession(P, rounds, 120000, { roundMs: 60000 }) };
}

test("coach notes: a speed gain reads as a gain, not 'held within X%'", () => {
  const { P, sess } = noteFixture(7, 7.6, 30, 30);
  const text = C.coachNotes(sess, C.confusion(P), "ms").map((x) => x.text).join(" | ");
  assert.ok(/Hand speed rose 9% from round 1 to round 2/.test(text), text);
  assert.ok(!/held within/.test(text), text);
  const flat = noteFixture(7, 7.1, 30, 30);
  assert.ok(/held within 3% of round 1 through round 2/.test(C.coachNotes(flat.sess, C.confusion(flat.P), "ms").map((x) => x.text).join(" | ")));
});

test("coach notes: the auto-label accuracy note is not dropped when every other note fires", () => {
  const { P, sess } = noteFixture(7, 7.1, 36, 20);                   // held speed + output down 44%
  const notes = C.coachNotes(sess, C.confusion(P), "ms");
  const text = notes.map((x) => x.text).join(" | ");
  for (const re of [/Hand speed held/, /Punch output dropped/, /Left hand threw/, /Quickest punch/, /Longest combination/, /front foot/, /matched your corrections/]) assert.ok(re.test(text), `${re}: ${text}`);
  assert.equal(notes.length, 7);
});
