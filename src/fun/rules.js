// The rules of Bag Work as pure functions: speed tiers and the warm-up gate, Round Grade, Strong Finish, round XP with its caps,
// the haptic budget. No DOM, no kit, no storage, no clock of its own: everything is passed in, so each rule is tested on
// the page's synthetic punches. A punch is the page's record: { hand, lead, type, startT, t, peakV, round, ... } with times in ms.

import {
  SPEED_TIERS, GRADES, GRADE_POINTS, RHYTHM_GAP_MS, FINISH_MIN_PUNCHES, STRONG_FINISH_RATIO, FADE_STOP_PCT, BALANCE_BAND, XP,
  JUDGMENTS, WARM_GATE_MS, HAPTIC_QUIET_MS, CALL, FLOW,
} from "./config.js";

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ---------------------------------------------------------------------------------------------------- speed tiers + the gate

/**
 * The warm-up gate. No speed best and no Snap tier in the first minute of a session, and none anywhere in the warm-up round.
 * @param {{t:number, setStartT:number|null, warmup?:boolean}} o `t` the punch time, `setStartT` when the session began (clock start or first punch)
 */
export function speedGateOpen({ t, setStartT, warmup = false }) {
  if (warmup) return false;
  if (!Number.isFinite(t) || !Number.isFinite(setStartT)) return false;
  return t - setStartT >= WARM_GATE_MS;
}

/**
 * A punch's speed against your own best for that punch type. Null without a best (there is nothing to be relative to).
 * @returns {{id:string, shape:string, pct:number}|null}
 */
export function speedTier(speed, best) {
  if (!(Number.isFinite(speed) && Number.isFinite(best) && best > 0)) return null;
  const ratio = speed / best;
  const tier = SPEED_TIERS.find((t) => ratio >= t.min) ?? SPEED_TIERS.at(-1);
  return { id: tier.id, shape: tier.shape, pct: Math.round(ratio * 100) };
}

// ---------------------------------------------------------------------------------------------------- Round Grade parts

const byStart = (punches) => [...punches].sort((a, b) => a.startT - b.startT);

/** Rest gaps (previous end to next onset) that chain punches into a combo, in ms. */
export function chainGaps(punches, chainMs = CALL.chainGapMs) {
  const ps = byStart(punches), gaps = [];
  for (let i = 1; i < ps.length; i++) {
    const g = ps[i].startT - ps[i - 1].t;
    if (g <= chainMs) gaps.push(Math.max(0, g));
  }
  return gaps;
}

/** Share of chain gaps at or under the rhythm gap; null when the round had no chains. */
export function rhythmShare(punches) {
  const gaps = chainGaps(punches);
  return gaps.length ? gaps.filter((g) => g <= RHYTHM_GAP_MS).length / gaps.length : null;
}

/** Left share of the round's punches in percent; null without punches. */
export function leftShare(punches) {
  return punches.length ? (punches.filter((p) => p.hand === "L").length / punches.length) * 100 : null;
}

/** Hand balance in 0..1: full inside 40 to 60 percent, none beyond 20 / 80, linear between. */
export function balanceScore(punches) {
  const l = leftShare(punches);
  if (l == null) return 0;
  const off = Math.abs(l - 50);
  return clamp(1 - (off - BALANCE_BAND.full) / (BALANCE_BAND.none - BALANCE_BAND.full), 0, 1);
}

/** Mean speed of the last `windowMs` of the round over the round mean. Null without enough punches. */
export function finishRatio(punches, endT, windowMs) {
  if (punches.length < FINISH_MIN_PUNCHES) return null;
  const all = mean(punches.map((p) => p.peakV));
  const tail = punches.filter((p) => p.startT >= endT - windowMs);
  if (!tail.length || !(all > 0)) return null;
  return mean(tail.map((p) => p.peakV)) / all;
}

/** How far speed fell over the round, in percent (first third of the punches against the last third). Null without enough punches. */
export function fadePct(punches) {
  const ps = byStart(punches);
  if (ps.length < 6) return null;
  const k = Math.floor(ps.length / 3);
  const first = mean(ps.slice(0, k).map((p) => p.peakV)), last = mean(ps.slice(-k).map((p) => p.peakV));
  return first > 0 ? ((first - last) / first) * 100 : null;
}

/** Pace control for free work: the share of six equal slices of the round whose punch count sits within 10 percent (or one punch) of the round's median slice. */
export function paceShare(punches, startT, endT) {
  const span = endT - startT;
  if (!(span > 0) || punches.length < 3) return null;
  const bins = Array.from({ length: 6 }, () => 0);
  for (const p of punches) bins[clamp(Math.floor(((p.startT - startT) / span) * 6), 0, 5)]++;
  const med = median(bins), tol = Math.max(med * 0.1, 1);
  return bins.filter((c) => Math.abs(c - med) <= tol).length / bins.length;
}

/** The grade band for a score. The warm-up round is always the Warm-up band. */
export function gradeFor(score, warmup = false) {
  if (warmup) return GRADES.at(-1);
  return GRADES.find((g) => score >= g.min) ?? GRADES.at(-1);
}

/**
 * Strong Finish: the last 30 seconds (a third of a short round) at 95 percent or more of the round's own mean speed, with at
 * least eight punches, never in the warm-up round and never when speed fell by more than 25 percent over the round.
 * It compares with the round's own mean, so a round that faded is not asked to push.
 */
export function strongFinish(punches, { endT, roundMs, warmup = false }) {
  if (warmup) return false;
  const fade = fadePct(punches);
  if (fade != null && fade > FADE_STOP_PCT) return false;
  const ratio = finishRatio(punches, endT, Math.min(30000, roundMs / 3));
  return ratio != null && ratio >= STRONG_FINISH_RATIO;
}

/**
 * Round Grade, 0 to 100. Called mode: calls 40, rhythm 35, finish 10, hands 15. Free mode swaps the calls for pace control.
 * Flow lifts the calls part (5 percent per Flow step above x1, capped at the 40 points). The finish part is only 10 points and a
 * round without enough punches gets the middle of it, so a fading round is not punished for not pushing.
 * @param {{punches:object[], calls?:Array<{judgment:string}>, startT:number, endT:number, roundMs:number, warmup?:boolean, flowPeak?:number}} o
 */
export function roundGrade({ punches, calls = [], startT, endT, roundMs, warmup = false, flowPeak = 1 }) {
  const mode = calls.length ? "called" : "free";
  const ps = punches.filter(Boolean);
  const weight = calls.length ? mean(calls.map((c) => JUDGMENTS[c.judgment]?.weight ?? 0)) : 0;
  const lift = 1 + 0.05 * (clamp(flowPeak, FLOW.min, FLOW.max) - 1);
  const callsPts = mode === "called" ? GRADE_POINTS.called * clamp(weight * lift, 0, 1) : 0;
  const pace = mode === "free" ? paceShare(ps, startT, endT) : null;
  const pacePts = mode === "free" ? GRADE_POINTS.pace * (pace ?? 0) : 0;
  const rs = rhythmShare(ps);
  const rhythmPts = GRADE_POINTS.rhythm * (rs ?? 0);
  const ratio = finishRatio(ps, endT, Math.min(30000, roundMs / 3));
  const finishPts = GRADE_POINTS.finish * (ratio == null ? 0.5 : clamp(ratio / STRONG_FINISH_RATIO, 0, 1));
  const handsPts = GRADE_POINTS.balance * balanceScore(ps);
  const parts = { calls: callsPts, pace: pacePts, rhythm: rhythmPts, finish: finishPts, hands: handsPts };
  const score = ps.length ? Math.round(clamp(callsPts + pacePts + rhythmPts + finishPts + handsPts, 0, 100)) : 0;
  const band = gradeFor(score, warmup);
  const fade = fadePct(ps);
  return {
    score, grade: band.id, shape: band.shape, mode, warmup, parts, fade,
    fadeBig: fade != null && fade > FADE_STOP_PCT,
    strong: strongFinish(ps, { endT, roundMs, warmup }),
    balancePct: leftShare(ps),
  };
}

// ---------------------------------------------------------------------------------------------------- XP

/**
 * XP for one round. Calls, free combos, finishing the clock and a Strong Finish earn it; punches do not, so volume is never
 * the way to more. Caps: five free combos and fifteen called combos a round, five counted combos a round (a counted combo pays
 * the same flat 3 as a Good, whatever the label did), and twelve rounds a day, after which a round pays 1 XP.
 * @param {{warmup?:boolean, completedFrac:number, punches:number, freeCombos:number, calls?:Array<{judgment:string, counted?:boolean}>,
 *   strongFinish?:boolean, fullSession?:boolean, roundsToday?:number}} o roundsToday: rounds already paid today
 */
export function roundXp({ warmup = false, completedFrac, punches, freeCombos, calls = [], strongFinish: strong = false, fullSession = false, roundsToday = 0 }) {
  const parts = { free: 0, called: 0, round: 0, strong: 0, session: 0 };
  if (roundsToday >= XP.roundsPerDay) return { total: XP.afterRounds, parts, fullDay: true, countedPaid: 0, calledPaid: 0 };
  parts.free = XP.freeCombo * clamp(Math.floor(freeCombos || 0), 0, XP.freeComboMax);
  let calledPaid = 0, countedPaid = 0;
  for (const c of calls) {
    if (calledPaid >= XP.calledMax) break;
    if (c.judgment === "count") {
      if (!c.counted || countedPaid >= XP.countItMax) continue;
      countedPaid++; calledPaid++; parts.called += XP.called.count;
    } else if (XP.called[c.judgment]) { calledPaid++; parts.called += XP.called[c.judgment]; }
  }
  const finished = completedFrac >= XP.completeFrac && punches >= XP.minPunches;
  if (finished) parts.round = warmup ? XP.warmup : XP.round;
  if (finished && strong && !warmup) parts.strong = XP.strongFinish;
  if (finished && fullSession && !warmup) parts.session = XP.session;
  const total = parts.free + parts.called + parts.round + parts.strong + parts.session;
  return { total, parts, fullDay: false, countedPaid, calledPaid };
}

// ---------------------------------------------------------------------------------------------------- Label Lab

/**
 * XP for reviewing a punch's label. Flat: it pays the same whether the choice changed the auto label or confirmed it, so nothing
 * here rewards disagreeing or agreeing (either would bias the training data this page collects). One punch pays once, twenty a
 * session at most, "Mark all unreviewed correct" pays nothing, and simulated punches pay nothing.
 * @param {{paid:number, alreadyPaid?:boolean, sim?:boolean, bulk?:boolean}} o paid: reviews already paid this session
 */
export function labelReviewXp({ paid, alreadyPaid = false, sim = false, bulk = false }) {
  if (sim || bulk || alreadyPaid || paid >= XP.labelMax) return 0;
  return XP.label;
}

// ---------------------------------------------------------------------------------------------------- haptic budget

/**
 * May a buzz be sent right now? Never while a punch window is open on either hand and never within 350 ms of an onset: the
 * wrist Senses are the measuring instruments and vibration adds acceleration noise.
 */
export function hapticAllowed({ now, lastOnsetT = null, windowOpen = false }) {
  if (windowOpen) return false;
  if (lastOnsetT != null && now - lastOnsetT < HAPTIC_QUIET_MS) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------- day counters

/** The next value of a "rounds today" counter: it starts over on a new day key. */
export function bumpDayCount(state, day, by = 1) {
  const cur = state && state.day === day ? state.n : 0;
  return { day, n: cur + by };
}
export const roundsOnDay = (state, day) => (state && state.day === day ? state.n : 0);
