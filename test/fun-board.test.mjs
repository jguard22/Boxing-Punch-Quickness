// The bests board and the hit meter as data (src/fun/board.js), and the first-screen layout the session hands the screens.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../src/vendor/fun-kit/index.js";
import { makeKit } from "../src/fun/kit.js";
import { createSession } from "../src/fun/session.js";
import { SPEED_ORDER, MARK_ORDER, splitBest, boardGroups, tierLit, TIER_LIT } from "../src/fun/board.js";
import { SPEED_TIERS, SOUND_PLANS } from "../src/fun/config.js";
import { COPY, allCopy } from "../src/fun/copy.js";

test("splitBest: a big number and a small unit, in m/s or mph, punches or nothing", () => {
  assert.deepEqual(splitBest("8.1 m/s"), { value: "8.1", unit: "m/s" });
  assert.deepEqual(splitBest("18.1 mph"), { value: "18.1", unit: "mph" });
  assert.deepEqual(splitBest("4 punches"), { value: "4", unit: "punches" });
  assert.deepEqual(splitBest("79"), { value: "79", unit: "" });
  assert.deepEqual(splitBest("  7,5  m/s "), { value: "7,5", unit: "m/s" }, "a comma decimal still splits");
  assert.deepEqual(splitBest("n/a"), { value: "n/a", unit: "" }, "anything else is all value");
  assert.deepEqual(splitBest(null), { value: "", unit: "" });
});

test("boardGroups: speeds by punch type in throwing order, then the marks, whatever order the kit stored them in", () => {
  const items = [
    { id: "longestChain", label: "Longest chain", text: "4 punches" }, { id: "speed_hook", label: "Hook speed", text: "8.7 m/s" },
    { id: "roundGrade", label: "Round Grade", text: "79" }, { id: "speed_jab", label: "Jab speed", text: "8.1 m/s" },
    { id: "flow", label: "Flow", text: "3" }, { id: "speed_uppercut", label: "Uppercut speed", text: "7.6 m/s" }, { id: "speed_cross", label: "Cross speed", text: "9.4 m/s" },
  ];
  const g = boardGroups(items);
  assert.deepEqual(g.speeds.map((s) => s.type), ["jab", "cross", "hook", "uppercut"]);
  assert.deepEqual(g.speeds.map((s) => `${s.value} ${s.unit}`), ["8.1 m/s", "9.4 m/s", "8.7 m/s", "7.6 m/s"]);
  assert.deepEqual(g.marks.map((m) => m.id), MARK_ORDER);
  assert.deepEqual(g.marks.map((m) => m.value), ["79", "3", "4"]);
  assert.equal(g.marks[2].unit, "punches");
});

test("boardGroups: only what exists shows; an unknown metric is kept after the known marks; empty text is dropped", () => {
  const g = boardGroups([{ id: "speed_cross", label: "Cross speed", text: "9.4 m/s" }, { id: "balance", label: "Balance", text: "55 %" }, { id: "flow", label: "Flow", text: "2" }, { id: "speed_jab", label: "Jab speed", text: "" }]);
  assert.deepEqual(g.speeds.map((s) => s.type), ["cross"]);
  assert.deepEqual(g.marks.map((m) => m.id), ["flow", "balance"]);
  assert.deepEqual(boardGroups([]), { speeds: [], marks: [] });
  assert.deepEqual(boardGroups(undefined), { speeds: [], marks: [] });
  assert.equal(SPEED_ORDER.length, 4);
});

test("tierLit: Easy lights one step and Snap all four; the meter has a step for every speed tier and nothing for no tier", () => {
  assert.deepEqual(SPEED_TIERS.map((t) => tierLit(t.id)).sort(), [1, 2, 3, 4], "every tier in config has its own number of lit steps");
  assert.equal(tierLit("easy"), 1); assert.equal(tierLit("snap"), 4);
  assert.equal(tierLit(undefined), 0); assert.equal(tierLit("nope"), 0);
  assert.equal(Object.keys(TIER_LIT).length, SPEED_TIERS.length);
});

test("the Snap tick is a valid kit sound, short and quiet", () => {
  const plan = SOUND_PLANS.snapTick;
  assert.ok(plan, "snapTick is in the plans");
  assert.ok(Math.max(...plan.map((v) => (v.at ?? 0) + v.dur)) <= 0.2, "under a fifth of a second");
  assert.ok(Math.max(...plan.map((v) => v.gain)) <= 0.2, "quiet");
});

test("the hero's primary words: Start a round once the first win is done, and a one-line detail of what it runs", () => {
  assert.equal(COPY.hero.round, "Start a round");
  assert.equal(COPY.hero.roundDetail(3, "3 min"), "Coach Calls: 3 rounds of 3 min. Change that under Rounds, below.");
  assert.match(COPY.hero.roundDetail(1, "30 s"), /1 round of 30 s/);
  assert.ok(allCopy().some((c) => c.path === "COPY.hero.roundDetail"), "the copy lint walks the new line too");
});

// ---- the layout the session hands the screens

const EPOCH = 1_760_000_000_000;
const sessions = [];
afterEach(() => { while (sessions.length) sessions.pop().dispose(); });
function fakeEnv({ punches = [], rounds = [], wrists = { L: true, R: false } } = {}) {
  const views = [];
  const S = { punches, rounds, sim: false, wrists, unit: "ms", settings: { roundMin: 3, restMin: 1, rounds: 3 }, preset: null, clock: null };
  const win = {
    __bwBoxing: { S, core: {}, hooks: {}, detector: { hands: { L: { active: false }, R: { active: false } } } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent() { return true; }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { dataset: { mode: "fight" } }, getElementById: () => null },
  };
  const view = new Proxy({}, { get: (_, name) => (...args) => { views.push([name, ...args]); } });
  const session = createSession({ view, win, now: () => 1000, wall: () => EPOCH, kit: makeKit({ storage: createMemoryStorage() }) });
  session.start();
  sessions.push(session);
  return { views, S, session, seen: (n) => views.filter((v) => v[0] === n) };
}

test("the layout carries the punch count, so the empty live cards stay away from a first screen and come back with the first punch", () => {
  const env = fakeEnv();
  assert.equal(env.seen("layout").at(-1)[1].punches, 0, "a fresh page has no punches");
  assert.equal(env.seen("layout").at(-1)[1].hero, true);
  const env2 = fakeEnv({ punches: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  assert.equal(env2.seen("layout").at(-1)[1].punches, 3);
});

test("the hero gets the round label and the detail line for what Start a round runs", () => {
  const env = fakeEnv();
  const hero = env.seen("setHero").at(-1)[1];
  assert.equal(hero.first, true, "before the first win the view keeps the warm-up label and hides the detail");
  assert.equal(hero.coachText, "Start a round");
  assert.match(hero.detailText, /^Coach Calls: 3 rounds of 3 min\./);
});

test("the personal bests reach the board with their ids and text, so it can group the speeds by punch type", () => {
  const kit = makeKit({ storage: createMemoryStorage() });
  kit.pb.submit("speed_cross", 9.4, { at: EPOCH }); kit.pb.submit("speed_jab", 8.1, { at: EPOCH }); kit.pb.submit("longestChain", 4, { at: EPOCH });
  const views = [];
  const S = { punches: [], rounds: [], sim: false, wrists: { L: true, R: false }, unit: "ms", settings: { roundMin: 3, restMin: 1, rounds: 3 }, preset: null, clock: null };
  const win = {
    __bwBoxing: { S, core: {}, hooks: {}, detector: { hands: { L: { active: false }, R: { active: false } } } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    dispatchEvent() { return true; }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { dataset: { mode: "fight" } }, getElementById: () => null },
  };
  const view = new Proxy({}, { get: (_, name) => (...args) => { views.push([name, ...args]); } });
  const session = createSession({ view, win, now: () => 1000, wall: () => EPOCH, kit });
  session.start();
  sessions.push(session);
  const shelf = views.filter((v) => v[0] === "pbShelf").at(-1)[1];
  assert.equal(shelf.show, true);
  assert.deepEqual(shelf.items.map((x) => x.id).sort(), ["longestChain", "speed_cross", "speed_jab"]);
  const g = boardGroups(shelf.items);
  assert.deepEqual(g.speeds.map((x) => `${x.type} ${x.value}`), ["jab 8.1", "cross 9.4"], "jab before cross, whatever order they were stored in");
  assert.equal(g.marks[0].id, "longestChain");
});
