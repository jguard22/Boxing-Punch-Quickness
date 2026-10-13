// The game controller end to end, on a fake page: real kit, real judge, real rules, the page's own detector output shape.
// Time is a variable the test moves; the screens are a recorder.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage, xpToReach, dayKey } from "../src/vendor/fun-kit/index.js";
import { CURVE, XP } from "../src/fun/config.js";
import { makeKit } from "../src/fun/kit.js";
import { createSession } from "../src/fun/session.js";
import * as cel from "../src/fun/celebrate.js";
import { C, punch, answer } from "./fun-helpers.mjs";

const EPOCH = 1_760_000_000_000;
const envs = [];
afterEach(() => { while (envs.length) envs.pop().session.dispose(); });

function makeEnv({ sim = false, wrists = { L: true, R: false }, rounds = 3 } = {}) {
  const env = { t: 1000, phase: "idle", n: 0, cmds: [], views: [], sim };
  const S = { punches: [], rounds: [], sim, wrists, unit: "ms", settings: { roundMin: 3, restMin: 1, rounds }, preset: null, clock: null };
  S.clock = { get running() { return env.phase === "round" || env.phase === "rest"; }, cfg: { rounds, roundMs: env.roundMs ?? 180000 }, phaseAt: () => ({ phase: env.phase, n: env.n, remainingMs: 5000, elapsedMs: 0, phaseMs: 0 }) };
  env.S = S;
  env.win = {
    __bwBoxing: { S, core: C, hooks: {}, detector: { hands: { L: { active: false }, R: { active: false } } } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent(e) { env.cmds.push(e.detail); return true; },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { dataset: { mode: "fight" } }, getElementById: () => null },
  };
  env.view = new Proxy({}, { get: (_, name) => (...args) => { env.views.push([name, ...args]); } });
  env.kit = makeKit({ storage: createMemoryStorage() });
  env.downloads = [];
  env.session = createSession({ view: env.view, win: env.win, now: () => env.t, wall: () => EPOCH + env.t, kit: env.kit, download: (ics, name) => env.downloads.push({ ics, name }) });
  env.session.start();
  envs.push(env);
  env.emit = (type, d = {}) => env.session.onEvent({ type, sim: S.sim, ...d });
  env.seen = (name) => env.views.filter((v) => v[0] === name);
  env.startRound = ({ n = 1, total = 1, roundMs = 180000, preset = null } = {}) => {
    env.phase = "round"; env.n = n; S.clock.cfg.rounds = total; S.clock.cfg.roundMs = roundMs; S.preset = preset ? { kind: preset } : null;
    S.rounds.push({ n, startT: env.t, endT: null });
    env.roundStart = env.t;
    env.emit("round.started", { n, total, t: env.t, roundMs, preset });
  };
  env.throw = (o = {}) => {
    const p = punch({ n: S.punches.length + 1, round: env.n, ...o });
    S.punches.push(p);
    env.emit("punch", { p });
    return p;
  };
  env.endRound = ({ stopped = false, last = true, total = 1, preset = null, roundMs = 180000 } = {}) => {
    env.t = env.roundStart + roundMs;
    env.phase = last ? "done" : "rest";
    S.rounds.at(-1).endT = env.t;
    env.emit("round.ended", { n: env.n, t: env.t, stopped, summary: null, roundMs, total, preset });
    if (last) env.emit("session.done", { total, preset });
  };
  return env;
}

/** A warm-up like the simulator's: a long chain of alternating hands. */
function warmup(env, { n = 14 } = {}) {
  env.startRound({ preset: "warmup", roundMs: 30000, total: 1 });
  let t = env.t + 700;
  for (let i = 0; i < n; i++) { env.t = t; env.throw({ startT: t, hand: i % 2 ? "R" : "L", type: i % 2 ? "cross" : "jab", peakV: 6 + (i % 3) * 0.5 }); t += 170 + 300; }
  env.endRound({ preset: "warmup", roundMs: 30000 });
}

test("the warm-up round is the first win: inside 60 seconds, Level 2, the three first badges, a Welcome Bonus, no weekly ring tick", () => {
  const env = makeEnv();
  warmup(env);
  const fw = env.session.firstWin.state();
  assert.equal(fw.done, true);
  assert.equal(fw.timeToWinMs, 30000);
  assert.equal(fw.withinTarget, true);
  const info = env.kit.xp.info();
  assert.ok(env.kit.xp.total >= xpToReach(2, CURVE), `${env.kit.xp.total} XP`);
  assert.equal(info.level >= 2, true);
  const have = env.kit.summary().badges.items.filter((b) => b.unlocked).map((b) => b.id);
  for (const id of ["first_punch", "first_combo", "warmup_done"]) assert.ok(have.includes(id), id);
  assert.ok(env.kit.xp.ledger(30).some((r) => r.source === "welcome" && r.amount === XP.welcome), "the Welcome Bonus is on the real profile");
  assert.equal(env.kit.summary().streak.thisWeek.count, 0, "a warm-up is not a weekly session");
  const grade = env.seen("gradeCard")[0][1];
  assert.equal(grade.grade, "warmup");
  assert.equal(grade.warmup, true);
  assert.equal(env.session._state.set.rounds[0].finished, true);
  const snap = env.session.stats.snapshot();
  assert.equal(snap.counts["warmup.done"], 1);
  assert.equal(snap.counts["first.win"], 1);
  assert.equal(snap.firstWinMs, 30000);
});

test("Simulate: the demo profile earns the full warm-up, nothing but the Welcome Bonus reaches the real profile", () => {
  const env = makeEnv({ sim: true });
  warmup(env);
  const set = env.session._state.set;
  assert.equal(set.demo, true);
  assert.equal(set.kit.store.durable, false);
  assert.equal(set.kit.store.kind, "memory");
  assert.ok(set.kit.xp.total >= xpToReach(2, CURVE), "the demo shows the level-up");
  assert.equal(env.kit.xp.total, XP.welcome, "the real profile has only the Welcome Bonus");
  assert.equal(env.kit.summary().badges.items.filter((b) => b.unlocked).length, 0, "no demo badge is saved");
  assert.equal(env.session.firstWin.isDone(), true);
  assert.equal(env.session.stats.snapshot().counts["first.win"], 1);
});

test("a second warm-up pays no second Welcome Bonus", () => {
  const env = makeEnv();
  warmup(env);
  const total = env.kit.xp.total;
  env.emit("session.reset"); env.S.punches.length = 0; env.S.rounds.length = 0;
  env.t += 60000; warmup(env);
  assert.ok(env.kit.xp.ledger(50).filter((r) => r.source === "welcome").length === 1);
  assert.ok(env.kit.xp.total >= total);
});

test("celebrations are held while a round runs and open when it ends", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000 });
  assert.equal(cel.gate.quiet, true, "a round is running: the gate is closed");
  env.throw({ startT: env.t + 500 });
  env.endRound({ last: false, total: 3 });
  assert.equal(cel.gate.quiet, false, "the round ended (rest): the gate is open");
});

test("a coach call: opened on schedule, answered, judged Perfect, Flow moves, XP paid by judgment", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000 });
  const first = env.session._state.round.schedule[0];
  assert.equal(first.atMs, 6000);
  env.t = env.roundStart + first.atMs;
  env.session._tick();
  const c = env.session._state.round.call;
  assert.ok(c, "the call opened");
  assert.equal(env.seen("showCall").length, 1);
  const nums = c.nums;
  const ps = answer(nums, { t0: env.t + 600, gapMs: 250 }).map((p) => ({ ...p, round: 1 }));
  for (const p of ps) { env.t = p.startT; env.throw(p); }
  env.t = ps.at(-1).t + 700;
  env.session._tick();
  const r = env.session._state.round;
  assert.equal(r.call, null, "closed early once the chain went quiet");
  assert.equal(r.calls[0].judgment, "perfect");
  assert.deepEqual(env.seen("stamp").at(-1).slice(1, 2), ["perfect"]);
  assert.equal(env.session.stats.snapshot().counts["call.perfect"], 1);
  env.endRound({ roundMs: 180000 });
  const bundle = env.session._state.set.rounds[0];
  assert.ok(bundle.xp >= XP.called.perfect + XP.round, `${bundle.xp} XP`);
  assert.equal(bundle.calls[0].judgment, "perfect");
});

test("Count it: counts the combo for a flat +3, and corrects the labels only outside Simulate", () => {
  for (const sim of [false, true]) {
    const env = makeEnv({ sim });
    env.startRound({ roundMs: 180000 });
    env.session._state.round.schedule = [{ atMs: 0, call: "1" }];
    env.session._tick();
    assert.equal(env.session._state.round.call.str, "1");
    const p = env.throw({ startT: env.t + 600, hand: "L", type: "hook", trueType: sim ? "jab" : null });
    env.t = p.t + 700;
    env.session._tick();
    const entry = env.session._state.round.calls[0];
    assert.equal(entry.judgment, "count");
    assert.equal(entry.read, "3");
    assert.equal(env.seen("countIt").at(-1)[1], true, "the Count it panel is on screen");
    env.session.countIt();
    assert.equal(entry.counted, true);
    assert.equal(p.trueType, sim ? "jab" : "jab", sim ? "the simulator's own truth is never overwritten" : "the corrected label is what was called");
    assert.equal(env.cmds.some((c) => c.cmd === "refresh"), !sim, "the page redraws its tables only when labels changed");
    assert.equal(env.session.stats.snapshot().counts["countit.tap"], 1);
    env.endRound({ roundMs: 180000 });
    const b = env.session._state.set.rounds[0];
    assert.ok(b.xp >= XP.called.count);
  }
});

test("Count it never overwrites a label somebody already chose", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000 });
  env.session._state.round.schedule = [{ atMs: 0, call: "1" }];
  env.session._tick();
  const p = env.throw({ startT: env.t + 600, hand: "L", type: "hook", trueType: "hook" });
  env.t = p.t + 700; env.session._tick();
  env.session.countIt();
  assert.equal(p.trueType, "hook");
});

test("Label Lab: a reviewed punch pays a flat 1 XP, the same whether the label changed or was confirmed; once per punch, 20 a session; Mark all and Simulate pay nothing", () => {
  const env = makeEnv();
  warmup(env, { n: 30 });
  const ps = env.S.punches;
  const base = env.kit.xp.total;
  env.emit("label.reviewed", { p: ps[0], from: null, to: "hook" });                 // changes the auto label (a jab)
  assert.equal(env.kit.xp.total, base + XP.label);
  env.emit("label.reviewed", { p: ps[1], from: null, to: ps[1].type });             // confirms the auto label
  assert.equal(env.kit.xp.total, base + 2 * XP.label, "confirming pays exactly what changing pays");
  env.emit("label.reviewed", { p: ps[0], from: "hook", to: "jab" });                // the same punch again
  assert.equal(env.kit.xp.total, base + 2 * XP.label, "one punch pays once, whatever it is changed to");
  env.emit("label.bulk", { n: 12 });
  assert.equal(env.kit.xp.total, base + 2 * XP.label, "Mark all unreviewed correct earns 0");
  env.emit("label.reviewed", { p: { ...ps[2], sim: true }, from: null, to: "jab" });
  assert.equal(env.kit.xp.total, base + 2 * XP.label, "a simulated punch never counts");
  for (let i = 2; i < ps.length; i++) env.emit("label.reviewed", { p: ps[i], from: null, to: "jab" });
  assert.equal(env.kit.xp.total - base, XP.labelMax * XP.label, "20 a session at most, and the cap is reached");
  const more = env.throw({ startT: env.t, n: 99 });
  const before = env.kit.xp.total;
  env.emit("label.reviewed", { p: more, from: null, to: "jab" });
  assert.equal(env.kit.xp.total, before, "past 20 it pays nothing");
});

test("Label Lab pays nothing on the Simulate profile, and a reviewed label never changes a call judgment or the grade", () => {
  const env = makeEnv({ sim: true });
  warmup(env);
  const total = env.kit.xp.total;
  env.emit("label.reviewed", { p: env.S.punches[0], from: null, to: "hook" });
  assert.equal(env.kit.xp.total, total);
  assert.equal(env.session._state.set.reviewed?.size ?? 0, 0);
});

test("the recap shows the Label Lab card only once something was reviewed, and never mentions agreeing", () => {
  const env = makeEnv();
  warmup(env);
  env.session.openRecap();
  const first = env.seen("recap").at(-1)[1].cards;
  assert.deepEqual(first.map((c) => c.id), ["rounds", "combo", "next"]);
  env.emit("label.reviewed", { p: env.S.punches[0], from: null, to: "hook" });
  env.emit("label.reviewed", { p: env.S.punches[1], from: null, to: "hook" });
  env.session.openRecap();
  const cards = env.seen("recap").at(-1)[1].cards;
  assert.deepEqual(cards.map((c) => c.id), ["rounds", "combo", "label", "next"]);
  assert.match(cards[2].title, /You coached the coach: 2 punches reviewed\./);
  assert.ok(!/agree|match|accuracy/i.test(JSON.stringify(cards[2])));
});

test("twelve rounds a day, then a round pays 1 XP", () => {
  const env = makeEnv();
  env.kit.store.set("log.rounds", { day: dayKey(EPOCH + env.t, { rolloverHour: 4 }), n: XP.roundsPerDay });
  env.startRound({ roundMs: 180000 });
  let t = env.t + 600;
  for (let i = 0; i < 40; i++) { env.t = t; env.throw({ startT: t, hand: i % 2 ? "R" : "L", type: i % 2 ? "cross" : "jab" }); t += 400; }
  env.endRound({ roundMs: 180000 });
  const outcome = env.session._state.set.rounds[0].outcome;
  const session = outcome.xp.applied.find((a) => a.source === "session");
  assert.equal(session.amount, XP.afterRounds);
  assert.ok(env.seen("gradeCard").at(-1)[1].note.startsWith("That's a full day on the bag. Cool down."));
});

test("a round with no punches earns no round bonus and says so", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000 });
  env.endRound({ roundMs: 180000 });
  const g = env.seen("gradeCard").at(-1)[1];
  assert.equal(g.empty, true);
  assert.equal(g.xp, 0);
  assert.equal(env.kit.xp.total, 0);
});

test("stopping a round early still grades what was thrown, with no round bonus and no recap crash", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000, total: 3 });
  let t = env.t + 600;
  for (let i = 0; i < 10; i++) { env.t = t; env.throw({ startT: t, hand: i % 2 ? "R" : "L", type: i % 2 ? "cross" : "jab" }); t += 400; }
  env.t = env.roundStart + 20000;
  env.phase = "stopped"; env.S.rounds.at(-1).endT = env.t;
  env.emit("round.ended", { n: 1, t: env.t, stopped: true, summary: null, roundMs: 180000, total: 3, preset: null });
  env.emit("session.stopped", { preset: null });
  const b = env.session._state.set.rounds[0];
  assert.equal(b.finished, false);
  const parts = b.outcome.xp.applied.filter((a) => a.source === "session");
  assert.ok(parts.every((a) => a.amount < XP.round + XP.freeCombo * XP.freeComboMax + 1));
});

test("no speed tier or personal best in the warm-up round or the first minute", () => {
  const env = makeEnv();
  env.kit.pb.submit("speed_jab", 7);
  env.startRound({ preset: "warmup", roundMs: 30000, total: 1 });
  env.throw({ startT: env.t + 500, peakV: 9 });
  assert.ok(env.seen("tier").every((v) => v[1] == null), "no tier inside the warm-up round");
  const env2 = makeEnv();
  env2.kit.pb.submit("speed_jab", 7);
  env2.startRound({ roundMs: 180000 });
  env2.throw({ startT: env2.t + 30000, peakV: 9 });
  assert.ok(env2.seen("tier").every((v) => v[1] == null), "no tier in the first minute of a session");
  env2.throw({ startT: env2.t + 61000, peakV: 9 });
  assert.equal(env2.seen("tier").at(-1)[1].id, "snap", "after the minute, against your own best");
});

test("Lab view: events are ignored, no screens are driven", () => {
  const env = makeEnv();
  env.session.setMode("lab");
  env.views.length = 0;
  env.startRound({ roundMs: 180000 });
  env.throw({ startT: env.t + 500 });
  assert.equal(env.seen("punchPop").length, 0);
  assert.equal(env.session._state.round, null);
  assert.equal(env.kit.xp.total, 0);
});

test("the one-tap feedback and its first-win time stay local; Forget my data clears them with the rest", () => {
  const env = makeEnv();
  warmup(env);
  assert.equal(env.session.feedback("loved"), true);
  assert.equal(env.session.feedback("meh"), false);
  const list = env.kit.store.get("log.feedback", []);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ["at", "choice", "winMs"]);
  assert.equal(list[0].winMs, 30000);
  assert.equal(env.session.stats.snapshot().counts["feedback.loved"], 1);
  env.session.forget();                                  // first click arms
  assert.ok(env.kit.xp.total > 0);
  env.session.forget();                                  // second click forgets
  assert.equal(env.kit.xp.total, 0);
  assert.equal(env.session.firstWin.isDone(), false);
  assert.deepEqual(env.kit.store.get("log.feedback", []), []);
  assert.equal(env.session.stats.snapshot().counts["first.win"] ?? 0, 0);
});

test("the simulator waits while a call is open, and answers a call on request", () => {
  const env = makeEnv({ sim: true });
  env.startRound({ roundMs: 180000 });
  assert.equal(env.win.__bwBoxing.hooks.simBusy(), false);
  env.t = env.roundStart + 6000;
  env.session._tick();
  assert.equal(env.win.__bwBoxing.hooks.simBusy(), true);
  assert.ok(env.cmds.some((c) => c.cmd === "simAnswer" && Array.isArray(c.nums)), "the simulated boxer is asked to throw its answer");
});

test("after a Simulate set finished (the page stopped Simulate itself), Round 1: Coach Calls carries on in Simulate", () => {
  const env = makeEnv({ sim: true, wrists: { L: false, R: false } });
  warmup(env);
  env.S.sim = false;                                    // the page stops Simulate when the rounds end
  env.cmds.length = 0;
  env.session.startCoached();
  assert.deepEqual(env.cmds.map((c) => c.cmd), ["reset", "sim", "rounds"]);
  assert.equal(env.cmds[1].on, true);
});

test("with no sensor and no Simulate, starting says what to do and sends no command", () => {
  const env = makeEnv({ wrists: { L: false, R: false } });
  env.cmds.length = 0;
  env.session.startWarmup();
  assert.deepEqual(env.cmds, []);
  assert.match(env.seen("hint").at(-1)[1], /No wrist sensor/);
  env.S.wrists.L = true;
  env.session.startWarmup();
  assert.equal(env.cmds.at(-1).cmd, "warmup");
  assert.equal(env.cmds.at(-1).roundMs, 30000);
});

test("Combo Book: a called combo and a free chain each get a page; the book is on the profile that played, and the badge opens at five", () => {
  const env = makeEnv();
  env.startRound({ roundMs: 180000 });
  env.session._state.round.schedule = [{ atMs: 0, call: "1-2" }];
  env.session._tick();
  const ps = answer([1, 2], { t0: env.t + 600, gapMs: 250 }).map((p) => ({ ...p, round: 1 }));
  for (const p of ps) { env.t = p.startT; env.throw(p); }
  env.t = ps.at(-1).t + 700; env.session._tick();
  // a free chain after the call: 1-2-3
  let t = env.t + 5000;
  for (const [i, [hand, type]] of [["L", "jab"], ["R", "cross"], ["L", "hook"]].entries()) { env.t = t; env.throw({ startT: t, hand, type }); t += 170 + 250; }
  env.endRound({ roundMs: 180000 });
  const book = env.kit.store.get("book", {});
  assert.deepEqual(book["1-2"], { count: 1, best: "perfect" });
  assert.deepEqual(book["1-2-3"], { count: 1, best: "free" });
  assert.deepEqual(env.session._state.set.rounds[0].added.map((a) => a.name), ["One-Two", "Classic"]);
  assert.match(env.seen("gradeCard").at(-1)[1].note, /New in your Combo Book: One-Two, Classic\./);
  const shown = env.seen("book").at(-1)[1];
  assert.equal(shown.show, true);
  assert.equal(shown.counts.named, 2);
});

test("Combo Book: Simulate fills the demo profile's book, never the real one", () => {
  const env = makeEnv({ sim: true });
  warmup(env);
  assert.deepEqual(env.kit.store.get("book", {}), {});
  assert.ok(Object.keys(env.session._state.set.kit.store.get("book", {})).length >= 1);
});

test("Combo Book stays hidden until the first combo (progressive reveal)", () => {
  const env = makeEnv();
  assert.equal(env.seen("book").at(-1)[1].show, false);
});

test("Add my next session: a weekly .ics at the day and time the person picks, downloaded, nothing sent", () => {
  const env = makeEnv();
  warmup(env);
  const ics = env.session.addReminder({ day: 4, time: "18:30" });
  assert.equal(env.downloads.length, 1);
  assert.equal(env.downloads[0].name, "bag-work-session.ics");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=TH/);
  assert.match(ics, /DTSTART:\d{8}T183000/);
  assert.match(ics, /SUMMARY:Bag work session/);
  assert.match(env.seen("recapNote").at(-1)[1], /Thursdays at 18:30/);
  assert.equal(env.session.addReminder({ day: 9, time: "x" }), null, "a bad time or day downloads nothing");
  assert.equal(env.downloads.length, 1);
});

test("Personal bests: top speed per punch type after the gate, stored in m/s and shown in the chosen unit; none from the warm-up", () => {
  globalThis.BPCore = C;
  const env = makeEnv();
  warmup(env);
  assert.equal(env.kit.pb.best("speed_jab"), null, "no speed best from the warm-up round");
  assert.equal(env.seen("pbShelf").at(-1)[1].show, false);
  env.t += 10000;
  env.startRound({ roundMs: 180000 });
  const base = env.t;
  for (const [i, v] of [6.2, 7.5, 6.9].entries()) { env.t = base + 61000 + i * 600; env.throw({ startT: env.t, hand: "L", type: "jab", peakV: v }); }
  env.throw({ startT: base + 10000, hand: "L", type: "jab", peakV: 11 });                    // inside the first minute: never a best
  env.endRound({ roundMs: 180000 });
  assert.equal(env.kit.pb.best("speed_jab"), 7.5, "the best after the gate, in m/s");
  const shelf = env.seen("pbShelf").at(-1)[1];
  assert.equal(shelf.show, true);
  assert.ok(shelf.items.some((x) => x.label === "Jab speed" && x.text === "7.5 m/s"));
  env.win.__bwBoxing.S.unit = "mph";
  assert.ok(env.kit.pb.all().find((x) => x.id === "speed_jab").bestText.endsWith("mph"), "the same stored value reads in mph");
  delete globalThis.BPCore;
});

test("a session left on the page by the Lab view is not wiped silently: the hero says so first", () => {
  const env = makeEnv();
  env.S.rounds.push({ n: 1, startT: 0, endT: 1000 });          // a lab session is on the page, the game has no set for it
  env.session.onEvent({ type: "device", on: true });
  env.views.length = 0;
  env.emit("session.reset");                                    // any refresh
  env.S.rounds.push({ n: 1, startT: 0, endT: 1000 });
  env.session.setMode("lab"); env.session.setMode("fight");
  assert.equal(env.seen("layout").at(-1)[1].hero, true);
  assert.match(env.seen("hint").at(-1)[1], /export the CSV first/);
  assert.deepEqual(env.cmds.filter((c) => c.cmd === "reset"), [], "nothing was reset");
});
