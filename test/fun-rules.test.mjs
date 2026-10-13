import { test } from "node:test";
import assert from "node:assert/strict";
import { xpToReach, levelFromXp, titleFor } from "../src/vendor/fun-kit/index.js";
import { CURVE, TITLES, XP, BADGES, GRADES, SPEED_TIERS, WARM_GATE_MS, HAPTIC_QUIET_MS, JUDGMENTS } from "../src/fun/config.js";
import {
  speedGateOpen, speedTier, roundGrade, roundXp, strongFinish, hapticAllowed, bumpDayCount, roundsOnDay, balanceScore, rhythmShare, fadePct, paceShare, gradeFor, labelReviewXp,
} from "../src/fun/rules.js";
import { punch } from "./fun-helpers.mjs";

// ---- levels and the first minute (through xpToReach, never a literal)

test("the level curve: the first warm-up lands on level 2 at both ends of what it can pay, never on level 3", () => {
  const badgeXp = (id) => BADGES.find((b) => b.id === id).xp;
  const badges = badgeXp("first_punch") + badgeXp("first_combo") + badgeXp("warmup_done");
  // least: five punches, one combo (so the combo badge and one free combo), the round bonus, the Welcome Bonus; most: five free combos
  const least = XP.freeCombo + XP.warmup + badges + XP.welcome;
  const most = XP.freeCombo * XP.freeComboMax + XP.warmup + badges + XP.welcome;
  assert.ok(least >= xpToReach(2, CURVE), `${least} XP at the least reaches level 2 (${xpToReach(2, CURVE)})`);
  assert.ok(most < xpToReach(3, CURVE), `${most} XP at the most stays under level 3 (${xpToReach(3, CURVE)}): the README and the design promise Level 2`);
  assert.ok(xpToReach(2, CURVE) < xpToReach(3, CURVE) && xpToReach(3, CURVE) < xpToReach(4, CURVE));
});

test("pacing: the first coached sitting lands on level 4 or just past it, badges and Perfect weight included; the whole call ladder takes weeks, not three sittings", () => {
  const badgeXp = (ids) => ids.reduce((a, id) => a + BADGES.find((b) => b.id === id).xp, 0);
  const oneTime = badgeXp(["first_round", "session_done", "called_it", "perfect_timing", "flow_3", "book_5"]);
  // the most a first sitting can pay: the warm-up at its most, then three rounds of twelve Perfect calls, free combos, round, Strong Finish, the session bonus and every one-time badge
  const warm = XP.freeCombo * XP.freeComboMax + XP.warmup + badgeXp(["first_punch", "first_combo", "warmup_done"]) + XP.welcome;
  const round = 12 * XP.called.perfect + XP.freeCombo * XP.freeComboMax + XP.round + XP.strongFinish;
  const raw = warm + 3 * round + XP.session + oneTime;
  const capped = Math.min(raw, XP.dayCap) + Math.max(0, raw - XP.dayCap) / 4;     // the day cap quarters what is past 200
  const level = levelFromXp(Math.round(capped), CURVE).level;
  assert.ok(level >= 4 && level <= 5, `level ${level} after ${Math.round(capped)} XP (${raw} before the day cap)`);
  // the Ring General calls (Level 8) at three sittings a week: more than a week of play, not three sittings of one day each
  const perDay = Math.round(capped);
  const sittingsTo8 = Math.ceil(xpToReach(8, CURVE) / perDay);
  assert.ok(sittingsTo8 >= 5, `${sittingsTo8} full-cap sittings to Level 8`);
});

test("twelve titles, one per level, and the title for a level comes from the table", () => {
  assert.equal(TITLES.length, 12);
  assert.equal(titleFor(1, TITLES), "Walk-In");
  assert.equal(titleFor(2, TITLES), "Wrap Hands");
  assert.equal(titleFor(12, TITLES), "Bell Ringer");
  assert.equal(levelFromXp(xpToReach(7, CURVE), CURVE).level, 7);
});

// ---- speed tiers and the warm-up gate

test("speed tiers by share of your own best, with shape and a percent", () => {
  assert.equal(speedTier(9.5, 10).id, "snap");
  assert.equal(speedTier(9.49, 10).id, "sharp");
  assert.equal(speedTier(8.5, 10).id, "sharp");
  assert.equal(speedTier(8.49, 10).id, "steady");
  assert.equal(speedTier(7, 10).id, "steady");
  assert.equal(speedTier(6.99, 10).id, "easy");
  assert.equal(speedTier(12, 10).pct, 120);
  assert.equal(speedTier(8, null), null, "no best, no tier");
  assert.equal(speedTier(8, 0), null);
  assert.deepEqual(SPEED_TIERS.map((t) => t.shape), ["diamond", "circle", "triangle", "dash"]);
});

test("the warm-up gate: nothing in the warm-up round, nothing in the first minute", () => {
  assert.equal(speedGateOpen({ t: 5e6, setStartT: 0, warmup: true }), false, "the whole warm-up round is gated");
  assert.equal(speedGateOpen({ t: WARM_GATE_MS - 1, setStartT: 0 }), false);
  assert.equal(speedGateOpen({ t: WARM_GATE_MS, setStartT: 0 }), true);
  assert.equal(speedGateOpen({ t: 1e5, setStartT: 4e4 }), true);
  assert.equal(speedGateOpen({ t: 1e5, setStartT: null }), false);
  assert.equal(speedGateOpen({ t: NaN, setStartT: 0 }), false);
});

// ---- XP and its caps

const call = (judgment, counted = false) => ({ judgment, counted });

test("round XP: free combos cap at five, a called combo pays by judgment, Count it pays a flat 3", () => {
  const base = { completedFrac: 1, punches: 40 };
  assert.equal(roundXp({ ...base, freeCombos: 9 }).parts.free, XP.freeCombo * XP.freeComboMax);
  const r = roundXp({ ...base, freeCombos: 0, calls: [call("perfect"), call("great"), call("good"), call("missed"), call("count", true), call("count", false)] });
  assert.equal(r.parts.called, XP.called.perfect + XP.called.great + XP.called.good + XP.called.count);
  assert.equal(XP.called.count, XP.called.good, "counting a combo pays the same flat amount as a Good");
});

test("round XP: at most 15 called combos and 5 counted ones a round", () => {
  const many = Array.from({ length: 40 }, () => call("perfect"));
  assert.equal(roundXp({ completedFrac: 1, punches: 99, freeCombos: 0, calls: many }).parts.called, XP.calledMax * XP.called.perfect);
  const counted = Array.from({ length: 12 }, () => call("count", true));
  const r = roundXp({ completedFrac: 1, punches: 99, freeCombos: 0, calls: counted });
  assert.equal(r.countedPaid, XP.countItMax);
  assert.equal(r.parts.called, XP.countItMax * XP.called.count);
});

test("round XP: the round, Strong Finish and the full session; the warm-up pays 10 and never a Strong Finish or a session bonus", () => {
  const o = { completedFrac: 1, punches: 30, freeCombos: 0, strongFinish: true, fullSession: true };
  const full = roundXp(o);
  assert.deepEqual([full.parts.round, full.parts.strong, full.parts.session], [XP.round, XP.strongFinish, XP.session]);
  const warm = roundXp({ ...o, warmup: true });
  assert.deepEqual([warm.parts.round, warm.parts.strong, warm.parts.session], [XP.warmup, 0, 0]);
  assert.equal(roundXp({ ...o, completedFrac: 0.89 }).parts.round, 0, "under 90 percent of the clock pays no round bonus");
  assert.equal(roundXp({ ...o, completedFrac: 0.9 }).parts.round, XP.round);
  assert.equal(roundXp({ ...o, punches: XP.minPunches - 1 }).total, 0, "standing still for a round earns nothing");
});

test("round XP: no XP per punch (volume is never the way to more)", () => {
  const a = roundXp({ completedFrac: 1, punches: 10, freeCombos: 2 }), b = roundXp({ completedFrac: 1, punches: 900, freeCombos: 2 });
  assert.equal(a.total, b.total);
});

test("round XP: no reward depends on a label (the function has no label input, and Count it pays the same either way)", () => {
  assert.equal(roundXp({ completedFrac: 1, punches: 20, freeCombos: 0, calls: [call("count", true)], reviewed: 50, relabelled: 50, agreement: 1 }).total,
    roundXp({ completedFrac: 1, punches: 20, freeCombos: 0, calls: [call("count", true)] }).total);
});

test("twelve rounds a day, then each round earns 1 XP", () => {
  const o = { completedFrac: 1, punches: 40, freeCombos: 5, calls: [call("perfect")], strongFinish: true, fullSession: true };
  assert.ok(roundXp({ ...o, roundsToday: XP.roundsPerDay - 1 }).total > XP.afterRounds);
  const capped = roundXp({ ...o, roundsToday: XP.roundsPerDay });
  assert.equal(capped.total, XP.afterRounds);
  assert.equal(capped.fullDay, true);
  let s = null;
  for (let i = 0; i < 5; i++) s = bumpDayCount(s, "2026-10-13");
  assert.equal(roundsOnDay(s, "2026-10-13"), 5);
  assert.equal(roundsOnDay(s, "2026-10-14"), 0, "a new day starts over");
});

// ---- Round Grade

const stream = (n, { speed = 7, gap = 200, hands = ["L", "R"], t0 = 0, durMs = 170 } = {}) => {
  let t = t0;
  return Array.from({ length: n }, (_, i) => { const p = punch({ n: i + 1, hand: hands[i % hands.length], startT: t, durMs, peakV: typeof speed === "function" ? speed(i) : speed }); t += durMs + gap; return p; });
};

test("Round Grade: a tight round of perfect calls is Fire, a round of misses is not, the warm-up is always Warm-up", () => {
  const ps = stream(30);
  const endT = ps.at(-1).t;
  const calls = Array.from({ length: 8 }, () => ({ judgment: "perfect" }));
  const fire = roundGrade({ punches: ps, calls, startT: 0, endT, roundMs: endT, flowPeak: 3 });
  assert.equal(fire.grade, "fire");
  assert.ok(fire.score >= 85 && fire.score <= 100);
  const missed = roundGrade({ punches: ps, calls: calls.map(() => ({ judgment: "missed" })), startT: 0, endT, roundMs: endT });
  assert.ok(missed.score < fire.score);
  const warm = roundGrade({ punches: ps, calls, startT: 0, endT, roundMs: endT, warmup: true });
  assert.equal(warm.grade, "warmup");
  assert.equal(warm.score, fire.score, "the score is still computed; only the name is fixed");
  assert.equal(gradeFor(99, true).id, "warmup");
});

test("Round Grade bands and an empty round", () => {
  assert.deepEqual(GRADES.map((g) => [g.id, g.min]), [["fire", 85], ["sharp", 70], ["solid", 50], ["warmup", 0]]);
  assert.equal(gradeFor(85).id, "fire"); assert.equal(gradeFor(84).id, "sharp"); assert.equal(gradeFor(70).id, "sharp");
  assert.equal(gradeFor(69).id, "solid"); assert.equal(gradeFor(50).id, "solid"); assert.equal(gradeFor(49).id, "warmup");
  const none = roundGrade({ punches: [], startT: 0, endT: 1000, roundMs: 1000 });
  assert.equal(none.score, 0);
  assert.equal(none.grade, "warmup");
});

test("Round Grade parts: calls 40, rhythm 35, finish 10, hands 15; free mode swaps the calls for pace; Flow lifts but never past 40", () => {
  const ps = stream(40), endT = ps.at(-1).t;
  const perfect = Array.from({ length: 6 }, () => ({ judgment: "perfect" }));
  const x1 = roundGrade({ punches: ps, calls: perfect, startT: 0, endT, roundMs: endT, flowPeak: 1 });
  const x5 = roundGrade({ punches: ps, calls: perfect, startT: 0, endT, roundMs: endT, flowPeak: 5 });
  assert.ok(x5.parts.calls >= x1.parts.calls && x5.parts.calls <= 40);
  assert.equal(x1.parts.calls, 40, "perfect calls are the whole 40 points");
  assert.ok(x1.parts.rhythm <= 35 && x1.parts.finish <= 10 && x1.parts.hands <= 15);
  const free = roundGrade({ punches: ps, calls: [], startT: 0, endT, roundMs: endT });
  assert.equal(free.mode, "free");
  assert.equal(free.parts.calls, 0);
  assert.ok(free.parts.pace > 0 && free.parts.pace <= 40);
  assert.ok(Object.values(x5.parts).reduce((a, b) => a + b, 0) <= 100.0001);
});

test("hand balance: full points between 40 and 60 percent, none past 20 / 80", () => {
  const mk = (l, r) => [...Array.from({ length: l }, () => punch({ hand: "L" })), ...Array.from({ length: r }, () => punch({ hand: "R" }))];
  assert.equal(balanceScore(mk(10, 10)), 1);
  assert.equal(balanceScore(mk(6, 4)), 1);
  assert.equal(balanceScore(mk(7, 3)), 0.5, "70 percent is half way");
  assert.equal(balanceScore(mk(8, 2)), 0);
  assert.equal(balanceScore(mk(9, 1)), 0);
  assert.equal(balanceScore([]), 0);
});

test("rhythm counts chain gaps under 450 ms; a round with no chains has no rhythm share", () => {
  assert.equal(rhythmShare(stream(10, { gap: 200 })), 1);
  assert.equal(rhythmShare(stream(10, { gap: 500 })), 0);
  assert.equal(rhythmShare(stream(10, { gap: 2000 })), null);
});

test("Strong Finish: the round's own mean, 8+ punches, never in the warm-up, never after a fade over 25 percent", () => {
  const even = stream(24, { speed: 7 }), end = even.at(-1).t, roundMs = 90000;
  assert.equal(strongFinish(even, { endT: end, roundMs }), true);
  assert.equal(strongFinish(even, { endT: end, roundMs, warmup: true }), false);
  assert.equal(strongFinish(stream(6, { speed: 7 }), { endT: 3000, roundMs }), false, "needs 8 punches");
  const fading = stream(24, { speed: (i) => 9 - i * 0.18 }), fend = fading.at(-1).t;
  assert.ok(fadePct(fading) > 25, `fade ${fadePct(fading)}`);
  assert.equal(strongFinish(fading, { endT: fend, roundMs }), false);
  const g = roundGrade({ punches: fading, calls: [], startT: 0, endT: fend, roundMs });
  assert.equal(g.fadeBig, true);
  assert.equal(g.strong, false);
});

test("pace control is the share of the round's slices near its own median", () => {
  const steady = stream(36, { gap: 300 }), s = paceShare(steady, 0, steady.at(-1).t + 1);
  assert.ok(s >= 0.66, `steady pace ${s}`);
  assert.equal(paceShare(stream(2), 0, 1000), null);
});

// ---- the haptic budget

test("no buzz inside a punch window or within 350 ms of an onset", () => {
  assert.equal(hapticAllowed({ now: 1000, lastOnsetT: null, windowOpen: false }), true);
  assert.equal(hapticAllowed({ now: 1000, lastOnsetT: 900, windowOpen: false }), false);
  assert.equal(hapticAllowed({ now: 1000, lastOnsetT: 1000 - HAPTIC_QUIET_MS + 1, windowOpen: false }), false);
  assert.equal(hapticAllowed({ now: 1000, lastOnsetT: 1000 - HAPTIC_QUIET_MS, windowOpen: false }), true);
  assert.equal(hapticAllowed({ now: 5000, lastOnsetT: null, windowOpen: true }), false);
  assert.equal(HAPTIC_QUIET_MS, 350);
});

test("judgment weights run from Perfect down to Missed", () => {
  const w = ["perfect", "great", "good", "count", "missed"].map((j) => JUDGMENTS[j].weight);
  assert.deepEqual(w, [...w].sort((a, b) => b - a));
  assert.equal(JUDGMENTS.missed.weight, 0);
});

test("Label Lab XP: flat, once per punch, 20 a session, nothing for Mark all or Simulate", () => {
  assert.equal(labelReviewXp({ paid: 0 }), XP.label);
  assert.equal(labelReviewXp({ paid: XP.labelMax - 1 }), XP.label);
  assert.equal(labelReviewXp({ paid: XP.labelMax }), 0);
  assert.equal(labelReviewXp({ paid: 0, alreadyPaid: true }), 0);
  assert.equal(labelReviewXp({ paid: 0, bulk: true }), 0);
  assert.equal(labelReviewXp({ paid: 0, sim: true }), 0);
  assert.equal(labelReviewXp.length, 1, "one options object: there is no input for whether the label changed or matched");
  assert.ok(!/changed|agree|match|correct/i.test(labelReviewXp.toString().split("{")[0] + labelReviewXp.toString().split("\n")[0]));
});

// ---- the review fixes in the rules

test("a called round that ignores the coach cannot grade Solid: the other parts only count in proportion to how the calls went", () => {
  const ps = stream(40, { gap: 200 }), endT = ps.at(-1).t;
  const run = (judgment) => roundGrade({ punches: ps, calls: Array.from({ length: 8 }, () => ({ judgment })), startT: 0, endT, roundMs: endT, flowPeak: 1 });
  const ignored = run("missed"), good = run("good"), perfect = run("perfect");
  assert.ok(ignored.score < 50, `ignoring every call scores ${ignored.score}`);
  assert.equal(ignored.grade, "warmup");
  assert.ok(ignored.score < good.score && good.score < perfect.score, `${ignored.score} < ${good.score} < ${perfect.score}`);
  assert.equal(perfect.grade, "fire");
  const sum = (g) => Object.values(g.parts).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(ignored) - ignored.score) <= 0.5 + 1e-9, "the parts on the grade card add up to the score");
  // free work is unchanged: no calls, no scaling
  const free = roundGrade({ punches: ps, calls: [], startT: 0, endT, roundMs: endT });
  assert.equal(free.mode, "free");
});

test("a round under a minute pays no round, Strong Finish or session bonus and a smaller free-combo cap; the warm-up is exempt", () => {
  const o = { completedFrac: 1, punches: 30, freeCombos: 9, strongFinish: true, fullSession: true };
  const full = roundXp({ ...o, roundMs: XP.minRoundMs });
  assert.equal(full.parts.round, XP.round);
  assert.equal(full.parts.strong, XP.strongFinish);
  assert.equal(full.parts.session, XP.session);
  assert.equal(full.parts.free, XP.freeCombo * XP.freeComboMax);
  const tiny = roundXp({ ...o, roundMs: 6000 });
  assert.deepEqual([tiny.parts.round, tiny.parts.strong, tiny.parts.session, tiny.parts.free, tiny.total], [0, 0, 0, 0, 0]);
  assert.equal(tiny.short, true);
  const half = roundXp({ ...o, roundMs: XP.minRoundMs / 2 });
  assert.equal(half.parts.free, XP.freeCombo * Math.floor(XP.freeComboMax / 2), "the free-combo cap shrinks in proportion");
  assert.equal(half.parts.round, 0);
  const warm = roundXp({ ...o, warmup: true, roundMs: 30000 });
  assert.equal(warm.parts.round, XP.warmup);
  assert.equal(warm.parts.free, XP.freeCombo * XP.freeComboMax, "the 30-second warm-up keeps its full table");
  assert.equal(roundXp({ ...o }).parts.round, XP.round, "no roundMs given: a full round");
});
