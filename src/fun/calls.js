// Coach Calls as pure functions: which calls a level unlocks, a deterministic schedule of calls for a round, the call window,
// the judge, Flow. A call is a combo in boxing numbers (1 jab, 2 cross, 3 / 4 lead / rear hook, 5 / 6 lead / rear uppercut).
// No DOM, no kit, no clock of its own. A punch is the page's record: { n, hand, lead, type, startT, t, ... } with times in ms.
//
// The judge is lenient on purpose. The page's type classifier is right about 98 percent of the time for straights but only about
// 87 percent for hooks and uppercuts, so a strict "types must match" rule would call roughly one correct 1-2-3 in six wrong.
// When the hands are right but the sensor read other types the answer is "Count it?", never a failure.

import { CALL, CALL_STAGES, FLOW, JUDGMENTS } from "./config.js";

export const parseCall = (str) => String(str).split("-").map(Number).filter((n) => n >= 1 && n <= 6);
export const callString = (nums) => nums.join("-");

// ---------------------------------------------------------------------------------------------------- the ladder

/** Every call a level can be given. */
export const callPool = (level) => CALL_STAGES.filter((s) => level >= s.level).flatMap((s) => s.calls);

/** The next stage a level has not reached yet, for "Level 3 opens hook calls". Null when every call is open. */
export function nextUnlock(level) {
  const s = CALL_STAGES.find((x) => x.level > level);
  return s ? { level: s.level, label: s.label ?? "new calls", calls: s.calls, id: s.id } : null;
}

// ---------------------------------------------------------------------------------------------------- seeded picks

const fnv = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The same day and round give the same rng on every device. */
export const callRng = (dayKey, roundNumber) => mulberry32(fnv(`${dayKey}|${roundNumber}|calls`));

/**
 * The calls of one round, as offsets from the round start. The first call comes early, the gap between calls leaves free work
 * (about 11 to 15 seconds in a 3-minute round, scaled down for short rounds) and the last window closes before the final
 * seconds so the bell and the grade are never crowded. The same day, round and level always give the same schedule.
 * @returns {Array<{atMs:number, call:string}>}
 */
export function callSchedule({ roundMs, level, dayKey, roundNumber }) {
  const rng = callRng(dayKey, roundNumber);
  const pool = callPool(level);
  const first = Math.min(CALL.firstCallMs, roundMs * 0.2);
  const gap = clamp(roundMs / 6, 4000, CALL.gapMinMs);
  const jitter = Math.min(CALL.gapJitterMs, roundMs / 10);
  const guard = Math.min(CALL.endGuardMs, roundMs * 0.25);
  const out = [];
  let at = first, prev = null;
  while (at + windowSpanMs(3) <= roundMs - guard && out.length < 40) {
    let call = pool[Math.floor(rng() * pool.length)];
    if (pool.length > 1 && call === prev) call = pool[(pool.indexOf(call) + 1) % pool.length];
    out.push({ atMs: Math.round(at), call });
    prev = call;
    at += gap + rng() * jitter;
  }
  return out;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Roughly how long a call of `n` counts stays open when answered at a normal pace. */
export const windowSpanMs = (n) => (n - 1) * CALL.countGapMs + CALL.afterLastCountMs;

// ---------------------------------------------------------------------------------------------------- reading punches

/** The boxing number the detector read for a punch. A relabelled punch is read as the detector read it. */
export function readNum(p) {
  if (p.type === "jab") return 1;
  if (p.type === "cross") return 2;
  const lead = p.hand === p.lead;
  if (p.type === "hook") return lead ? 3 : 4;
  return lead ? 5 : 6;
}
/** Which hand a count belongs to: 1, 3, 5 are the lead hand, 2, 4, 6 the rear hand. */
export const handFor = (n, lead) => (n % 2 === 1 ? lead : lead === "L" ? "R" : "L");
export const kindOfNum = (n) => (n <= 2 ? "straight" : n <= 4 ? "hook" : "uppercut");
export const kindOfType = (type) => (type === "jab" || type === "cross" ? "straight" : type);

// ---------------------------------------------------------------------------------------------------- the window

/**
 * Where a call stands. The window opens when the call is spoken and closes 2.5 seconds after the last spoken count or
 * 600 ms after the last punch of the answer, whichever is later. The answer is the first chain of punches that starts after the
 * call (a gap over 600 ms ends it). It closes early once a full-length chain has been quiet for 600 ms.
 * @param {{at:number, nums:number[]}} call
 * @returns {{chain:object[], closeAt:number, closed:boolean, early:boolean}}
 */
export function windowState(call, punches, now) {
  const n = call.nums.length;
  const lastCountT = call.at + (n - 1) * CALL.countGapMs;
  let close = lastCountT + CALL.afterLastCountMs;
  const chain = [];
  for (const p of [...punches].filter((x) => x.startT >= call.at).sort((a, b) => a.startT - b.startT)) {
    if (p.startT > close) break;
    if (chain.length && p.startT - chain.at(-1).t > CALL.chainGapMs) break;
    chain.push(p);
    close = Math.max(close, p.t + CALL.afterPunchMs);
  }
  const early = chain.length >= n && now >= chain.at(-1).t + CALL.afterPunchMs;
  return { chain, closeAt: close, closed: early || now >= close, early };
}

// ---------------------------------------------------------------------------------------------------- the judge

/**
 * Judge an answer. Perfect: the right hands in the right order, every type as called, every gap 450 ms or less, the first
 * punch within 1.2 seconds of the call. Great: the same without the timing. Good: right hands and at most one type different
 * (calls of three or more). Count it?: right hands but the sensor read other types. Missed: wrong hand order, too few punches
 * or nothing in the window.
 * @param {{at:number, nums:number[]}} call
 * @param {object[]} chain the answer from windowState()
 * @returns {{judgment:string, read:string, reason:string|null, firstMs:number|null, maxGap:number, mismatches:number, consumed:number[]}}
 */
export function judge(call, chain) {
  const n = call.nums.length;
  const base = { read: "", reason: null, firstMs: null, maxGap: 0, mismatches: 0, consumed: [] };
  if (!chain.length) return { ...base, judgment: "missed", reason: "none" };
  const resp = chain.slice(0, n);
  const read = resp.map(readNum);
  const out = { ...base, read: read.join("-"), consumed: resp.map((p) => p.n).filter((x) => x != null), firstMs: Math.round(resp[0].startT - call.at) };
  if (resp.length < n) return { ...out, judgment: "missed", reason: "too-few" };
  for (let i = 0; i < n; i++) if (resp[i].hand !== handFor(call.nums[i], resp[i].lead)) return { ...out, judgment: "missed", reason: "hands" };
  const mismatches = read.filter((r, i) => r !== call.nums[i]).length;
  let maxGap = 0;
  for (let i = 1; i < n; i++) maxGap = Math.max(maxGap, resp[i].startT - resp[i - 1].t);
  const res = { ...out, mismatches, maxGap: Math.round(maxGap) };
  if (mismatches === 0) {
    const tight = maxGap <= CALL.perfectGapMs && res.firstMs <= CALL.perfectFirstMs;
    return { ...res, judgment: tight ? "perfect" : "great" };
  }
  if (n >= 3 && mismatches <= 1) return { ...res, judgment: "good" };
  return { ...res, judgment: "count", reason: "types" };
}

// ---------------------------------------------------------------------------------------------------- Flow

export const flowStart = () => ({ mult: FLOW.min, run: 0, peak: FLOW.min });

/**
 * One call's effect on Flow. Perfect or Great in a row raise it by one for every two; a Good or a Missed lowers it by one,
 * silently (the chip dims, nothing sounds); "Count it?" leaves it alone. Pure: returns the next state.
 */
export function flowStep(state, judgment) {
  if (judgment === "perfect" || judgment === "great") {
    const run = state.run + 1;
    const mult = run % FLOW.perStep === 0 ? Math.min(FLOW.max, state.mult + 1) : state.mult;
    return { mult, run, peak: Math.max(state.peak, mult) };
  }
  if (judgment === "good" || judgment === "missed") return { mult: Math.max(FLOW.min, state.mult - 1), run: 0, peak: state.peak };
  return state;
}

/** The best of a list of judgments (perfect first), for the combo highlight. */
export const bestJudgment = (list) => list.reduce((best, j) => (best == null || (JUDGMENTS[j]?.weight ?? -1) > (JUDGMENTS[best]?.weight ?? -1) ? j : best), null);
