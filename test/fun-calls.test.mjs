import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL, CALL_STAGES, FEATURES, FLOW } from "../src/fun/config.js";
import {
  parseCall, callPool, nextUnlock, callSchedule, callRng, windowState, judge, flowStart, flowStep, handFor, readNum, windowSpanMs, bestJudgment,
} from "../src/fun/calls.js";
import { simResponse, SIM_MIX } from "../src/fun/sim-driver.js";
import { buildRecapCards, bestMoment } from "../src/fun/recap.js";
import { C, punch, answer, throwCombo } from "./fun-helpers.mjs";

const mkCall = (str, at = 0) => ({ at, nums: parseCall(str), str });
const judgeAnswer = (str, ps, at = 0) => { const c = mkCall(str, at); return judge(c, windowState(c, ps, Infinity).chain); };

// ---- the ladder

test("calls by level: stage 1 at level 1, stage 2 at level 2, hooks at 3, four-punch at 6, stage 5 at 8", () => {
  assert.deepEqual(callPool(1), ["1", "1-2"]);
  assert.deepEqual(callPool(2), ["1", "1-2", "1-1", "1-2-1", "1-1-2"]);
  assert.ok(callPool(3).includes("1-2-3") && callPool(3).includes("3") && !callPool(2).includes("3"));
  assert.ok(callPool(6).includes("1-2-3-2") && !callPool(5).includes("1-2-3-2"));
  assert.ok(callPool(8).includes("1-2-5-2") && !callPool(7).includes("1-2-5-2"));
  assert.equal(nextUnlock(1).level, 2);
  assert.equal(nextUnlock(2).label, "Hook calls");
  assert.equal(nextUnlock(99), null);
});

test("every call stage past the first has a feature at the same level, so the level-up modal lists what it opened", () => {
  for (const s of CALL_STAGES.filter((x) => x.level > 1)) assert.equal(FEATURES[s.feature]?.level, s.level, s.id);
  for (const s of CALL_STAGES) for (const c of s.calls) assert.ok(parseCall(c).length === c.split("-").length, `${c} is only boxing numbers 1 to 6`);
});

test("the schedule: the same day, round and level give the same calls; none inside the last seconds; spaced out", () => {
  const o = { roundMs: 180000, level: 2, dayKey: "2026-10-13", roundNumber: 1 };
  const a = callSchedule(o), b = callSchedule(o);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, callSchedule({ ...o, roundNumber: 2 }));
  assert.ok(a.length >= 8 && a.length <= 16, `${a.length} calls in a 3-minute round`);
  assert.equal(a[0].atMs, CALL.firstCallMs);
  const pool = callPool(2);
  for (const [i, x] of a.entries()) {
    assert.ok(pool.includes(x.call));
    if (i) { assert.ok(x.atMs - a[i - 1].atMs >= CALL.gapMinMs, "free work between calls"); assert.notEqual(x.call, a[i - 1].call, "never the same call twice in a row"); }
  }
  assert.ok(a.at(-1).atMs + windowSpanMs(3) <= o.roundMs - CALL.endGuardMs, "the last window closes before the final seconds");
});

test("short rounds scale the schedule down; a 9-second round still fits a call or none, never a window past the bell", () => {
  const s = callSchedule({ roundMs: 30000, level: 1, dayKey: "2026-10-13", roundNumber: 1 });
  assert.ok(s.length >= 2);
  assert.ok(s.at(-1).atMs + windowSpanMs(3) <= 30000);
  for (const x of callSchedule({ roundMs: 9000, level: 1, dayKey: "d", roundNumber: 1 })) assert.ok(x.atMs < 9000);
});

test("callRng is deterministic per day and round", () => {
  assert.equal(callRng("d", 1)(), callRng("d", 1)());
  assert.notEqual(callRng("d", 1)(), callRng("d", 2)());
});

// ---- reading punches

test("hands and numbers: 1, 3, 5 are the lead hand, 2, 4, 6 the rear hand, in either stance", () => {
  assert.equal(handFor(1, "L"), "L"); assert.equal(handFor(2, "L"), "R"); assert.equal(handFor(3, "R"), "R"); assert.equal(handFor(4, "R"), "L");
  assert.equal(readNum(punch({ hand: "R", lead: "R", type: "jab" })), 1);
  assert.equal(readNum(punch({ hand: "L", lead: "R", type: "cross" })), 2);
  assert.equal(readNum(punch({ hand: "L", lead: "L", type: "hook" })), 3);
  assert.equal(readNum(punch({ hand: "R", lead: "L", type: "uppercut" })), 6);
  assert.equal(readNum(punch({ type: "jab", trueType: "hook" })), 1, "a relabelled punch is judged as the detector read it");
});

// ---- the window

test("the call window: 2.5 s after the last spoken count, longer while punches keep coming, shorter once the chain is done", () => {
  const c = mkCall("1-2-3", 1000);
  const none = windowState(c, [], 1000);
  assert.equal(none.closeAt, 1000 + 2 * CALL.countGapMs + CALL.afterLastCountMs);
  assert.equal(windowState(c, [], none.closeAt - 1).closed, false);
  assert.equal(windowState(c, [], none.closeAt).closed, true);
  const late = answer([1, 2], { t0: 1000 + none.closeAt - 1000 - 400 });
  const ws = windowState(c, late, 1000);
  assert.ok(ws.closeAt > none.closeAt, "a punch near the end keeps the window open for 600 ms after it");
  const full = answer([1, 2, 3], { t0: 1500 });
  const done = windowState(c, full, full.at(-1).t + CALL.afterPunchMs);
  assert.equal(done.early, true);
  assert.equal(done.closed, true, "a full chain that has gone quiet closes early");
  assert.equal(windowState(c, full, full.at(-1).t + CALL.afterPunchMs - 1).closed, false);
});

test("punches before the call, or a gap over 600 ms, are not part of the answer", () => {
  const c = mkCall("1-2", 5000);
  const before = punch({ n: 1, startT: 4000, hand: "L", type: "jab" });
  const resp = answer([1, 2], { t0: 5500 });
  assert.equal(windowState(c, [before, ...resp], Infinity).chain.length, 2);
  const split = [punch({ n: 1, startT: 5400, hand: "L", type: "jab" }), punch({ n: 2, startT: 5400 + 170 + 700, hand: "R", type: "cross" })];
  assert.equal(windowState(c, split, Infinity).chain.length, 1, "a 700 ms gap breaks the chain");
});

// ---- the judge

test("Perfect: right hands, every type, gaps 450 ms or less, first punch within 1.2 s", () => {
  const j = judgeAnswer("1-2-3", answer([1, 2, 3], { t0: 600, gapMs: 300 }));
  assert.equal(j.judgment, "perfect");
  assert.equal(j.read, "1-2-3");
  assert.deepEqual(j.consumed, [1, 2, 3]);
});

test("Great: right hands and types but a slower chain or a late start", () => {
  assert.equal(judgeAnswer("1-2", answer([1, 2], { t0: 600, gapMs: 500 })).judgment, "great", "a 500 ms gap");
  assert.equal(judgeAnswer("1-2", answer([1, 2], { t0: CALL.perfectFirstMs + 300, gapMs: 200 })).judgment, "great", "first punch after 1.2 s");
  assert.equal(judgeAnswer("1-2", answer([1, 2], { t0: 600, gapMs: CALL.perfectGapMs })).judgment, "perfect", "a 450 ms gap is still Perfect");
});

test("Good: right hands and one type different, for calls of three or more", () => {
  const ps = answer([1, 2, 3]);
  ps[1] = { ...ps[1], type: "hook" };                        // the cross read as a hook
  const j = judgeAnswer("1-2-3", ps);
  assert.equal(j.judgment, "good");
  assert.equal(j.mismatches, 1);
  assert.equal(j.read, "1-4-3");
});

test("Count it?: right hands, the sensor read other types (two or more different, or any in a short call)", () => {
  const ps = answer([1, 2, 3]);
  ps[0] = { ...ps[0], type: "uppercut" }; ps[1] = { ...ps[1], type: "hook" };
  const j = judgeAnswer("1-2-3", ps);
  assert.equal(j.judgment, "count");
  assert.equal(j.reason, "types");
  assert.equal(j.read, "5-4-3");
  const short = answer([1, 2]);
  short[1] = { ...short[1], type: "hook" };
  assert.equal(judgeAnswer("1-2", short).judgment, "count", "a 1-2 whose cross read as a hook is Count it?, not a failure");
  const one = answer([1]);
  one[0] = { ...one[0], type: "hook" };
  assert.equal(judgeAnswer("1", one).judgment, "count");
});

test("Missed: wrong hand order, too few punches, or nothing", () => {
  const wrong = answer([2, 1]);
  assert.equal(judgeAnswer("1-2", wrong).judgment, "missed");
  assert.equal(judgeAnswer("1-2", wrong).reason, "hands");
  const few = judgeAnswer("1-2-3", answer([1, 2]));
  assert.equal(few.judgment, "missed"); assert.equal(few.reason, "too-few");
  const none = judgeAnswer("1-2", []);
  assert.equal(none.judgment, "missed"); assert.equal(none.reason, "none");
});

test("extra punches after the call are ignored: the first answer-length punches are judged", () => {
  const j = judgeAnswer("1-2", answer([1, 2, 1, 2]));
  assert.equal(j.judgment, "perfect");
  assert.equal(j.consumed.length, 2);
});

test("southpaw: the same call is thrown from the other hand and judged the same", () => {
  const j = judgeAnswer("1-2-3", answer([1, 2, 3], { lead: "R" }));
  assert.equal(j.judgment, "perfect");
  const wrongStance = answer([1, 2, 3], { lead: "R" }).map((p) => ({ ...p, lead: "L" }));
  assert.notEqual(judgeAnswer("1-2-3", wrongStance).judgment, "perfect");
});

// ---- measured on the real detector

function trials(str, n, seed) {
  const rng = C.mulberry32(seed), nums = parseCall(str), counts = { perfect: 0, great: 0, good: 0, count: 0, missed: 0 };
  for (let i = 0; i < n; i++) {
    const ps = throwCombo(nums, rng, { t0: 800 });
    const c = mkCall(str, 300);
    counts[judge(c, windowState(c, ps, Infinity).chain).judgment]++;
  }
  return counts;
}

test("on the real detector with 12 percent sloppy throws: a correct combo is Missed never, and at least Good for about 92 percent of 1-2 and 98 percent of 1-2-3", () => {
  // measured over 1000 throws each (seeded): 1-2 -> 922 Perfect + 78 Count it?, 1-2-3 -> 810 Perfect + 176 Good + 14 Count it?
  const a = trials("1-2", 400, 11), b = trials("1-2-3", 400, 12);
  const atLeastGood = (t, n) => (t.perfect + t.great + t.good) / n;
  assert.ok(atLeastGood(a, 400) >= 0.88, `1-2 ${JSON.stringify(a)}`);
  assert.ok(atLeastGood(b, 400) >= 0.96, `1-2-3 ${JSON.stringify(b)}`);
  assert.ok(b.perfect / 400 >= 0.75, `1-2-3 Perfect-eligible ${JSON.stringify(b)}`);
  assert.equal(a.missed + b.missed, 0, "a correct combo is never Missed because of the classifier");
});

test("the classifier's mistakes land on Count it?, which is neutral (Flow unchanged)", () => {
  let s = flowStart();
  s = flowStep(s, "perfect"); s = flowStep(s, "perfect");
  const before = s;
  assert.deepEqual(flowStep(s, "count"), before);
});

// ---- Flow

test("Flow: x1 at the start, +1 for every two Perfect or Great in a row, capped at x5, down by one on a Good or a Missed", () => {
  let s = flowStart();
  assert.equal(s.mult, 1);
  s = flowStep(s, "perfect"); assert.equal(s.mult, 1);
  s = flowStep(s, "great"); assert.equal(s.mult, 2);
  s = flowStep(s, "perfect"); s = flowStep(s, "perfect"); assert.equal(s.mult, 3);
  for (let i = 0; i < 20; i++) s = flowStep(s, "perfect");
  assert.equal(s.mult, FLOW.max);
  assert.equal(s.peak, FLOW.max);
  s = flowStep(s, "good"); assert.equal(s.mult, FLOW.max - 1); assert.equal(s.run, 0);
  s = flowStep(s, "missed"); assert.equal(s.mult, FLOW.max - 2);
  assert.equal(s.peak, FLOW.max, "the peak stays");
  let low = flowStart(); low = flowStep(low, "missed"); assert.equal(low.mult, 1, "never below x1");
});

// ---- the simulated boxer

test("the simulated boxer answers a call: mostly exactly, sometimes late, in the wrong order or short, so a demo shows every judgment", () => {
  const rng = C.mulberry32(5), seen = { exact: 0, late: 0, wrongOrder: 0, tooFew: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) seen[simResponse("1-2-3", rng).kind]++;
  assert.ok(Math.abs(seen.exact / N - SIM_MIX.exact) < 0.03, JSON.stringify(seen));
  assert.ok(Math.abs(seen.late / N - SIM_MIX.late) < 0.03);
  assert.ok(Math.abs(seen.wrongOrder / N - SIM_MIX.wrongOrder) < 0.03);
  assert.ok(Math.abs(seen.tooFew / N - SIM_MIX.tooFew) < 0.03);
});

test("what the simulated boxer throws is judged as it should be", () => {
  const r = (kind) => { const rng = (() => { const vals = { exact: 0.1, late: 0.8, wrongOrder: 0.9, tooFew: 0.99 }; let k = 0; return () => (k++ === 0 ? vals[kind] : 0.5); })(); return simResponse("1-2", rng); };
  assert.equal(judgeAnswer("1-2", answer(r("exact").nums, { t0: r("exact").delayMs })).judgment, "perfect");
  assert.equal(judgeAnswer("1-2", answer(r("late").nums, { t0: r("late").delayMs })).judgment, "great");
  assert.equal(judgeAnswer("1-2", answer(r("wrongOrder").nums, { t0: 600 })).judgment, "missed");
  assert.equal(judgeAnswer("1-2", answer(r("tooFew").nums, { t0: 600 })).judgment, "missed");
  assert.deepEqual(simResponse("1", () => 0.99).nums, [], "a one-punch call that is skipped throws nothing");
});

// ---- the recap

test("the recap has three cards: Rounds, Combo highlight, Up next; the best moment is a called combo unless every round graded Warm-up", () => {
  const calls = [{ call: "1-2", judgment: "good" }, { call: "1-2-3", judgment: "perfect" }, { call: "1", judgment: "perfect" }, { call: "1-2", judgment: "missed" }];
  assert.deepEqual(bestMoment({ calls, chains: [{ str: "1-2-3-2", len: 4 }] }), { kind: "called", str: "1-2-3", judgment: "perfect" });
  assert.deepEqual(bestMoment({ calls, chains: [{ str: "1-2-3-2", len: 4 }], allWarmup: true }), { kind: "chain", str: "1-2-3-2", len: 4 });
  assert.equal(bestMoment({ calls: [], chains: [] }).kind, null);
  assert.equal(bestJudgment(["good", "perfect", "missed"]), "perfect");
  const cards = buildRecapCards({
    rounds: [{ n: 1, grade: "solid", score: 62, punches: 40, perMin: 80, xp: 40 }, { n: 2, grade: "sharp", score: 74, punches: 44, perMin: 88, xp: 55 }],
    best: bestMoment({ calls, chains: [] }), comboCount: 4, level: 3, title: "Bag Rookie", nextUnlock: { level: 5, label: "Uppercut calls" },
    week: { count: 1, target: 3, reached: false }, heldPct: 97, eased: false, demo: false, welcome: 0, resetsOnNew: false,
  });
  assert.deepEqual(cards.map((c) => c.id), ["rounds", "combo", "next"]);
  assert.equal(cards[1].big, "1-2-3");
  assert.match(cards[2].title, /Level 5 opens Uppercut calls/);
  assert.deepEqual(cards[2].list, ["This week: 1 of 3 sessions.", "Speed held at 97% of round one."], "two or more lines stay a list");
  assert.equal(cards[0].rounds.length, 2);
  for (const c of cards) assert.ok(!c.list || c.list.length !== 1, "a one-line list is folded into the sentence (the carousel prints lists of two or more)");
});

test("a warm-up-only recap names the warm-up round, not a grade called Warm-up twice", () => {
  const cards = buildRecapCards({ rounds: [{ n: 1, grade: "warmup", warmup: true, score: 30, punches: 33, perMin: 66, xp: 50 }], best: { kind: "chain", str: "1-2", len: 2 }, comboCount: 1, level: 2, title: "Wrap Hands", nextUnlock: null, week: null, heldPct: null, eased: false, demo: false, welcome: 0 });
  assert.equal(cards[0].title, "Warm-up done. Easy rounds count. Warm-up round: 33 punches · +50 XP");
  assert.equal(cards[1].title.startsWith("Your longest chain"), true);
  assert.equal(cards[1].title, "Your longest chain. 1 different combo this session", "a folded line reads as its own sentence: the title gets its full stop first");
});

test("the demo recap says only the Welcome Bonus is kept", () => {
  const cards = buildRecapCards({ rounds: [{ n: 1, grade: "warmup", score: 30, punches: 20, perMin: 40, xp: 50 }], best: { kind: "chain", str: "1-2" }, comboCount: 1, level: 2, title: "Wrap Hands", nextUnlock: null, week: null, heldPct: null, eased: false, demo: true, welcome: 40 });
  assert.match(cards[2].title, /only your Welcome Bonus/);
  assert.match(cards[2].title, /Every call is open|Level/);
});
