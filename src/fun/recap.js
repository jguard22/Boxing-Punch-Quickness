// The recap as plain card data (three cards: Rounds, Combo highlight, Up next). Pure: the numbers come in, the words come from
// copy.js, and ui.js draws them with the kit's carousel. A speed never appears here; the cards carry grades, counts and names.
import { COPY } from "./copy.js";
import { GRADES, JUDGMENTS } from "./config.js";

const gradeName = (id) => COPY.grade.names[id] ?? id;

/**
 * The best moment of a session (peak-end: card two is always one). The best called combo (Perfect before Great before Good, then
 * the longer one); if no call landed, or every round graded Warm-up, the longest chain instead.
 * @param {{calls:Array<{call:string, judgment:string}>, chains:Array<{str:string, len:number}>, allWarmup?:boolean}} o
 * @returns {{kind:"called"|"chain"|null, str:string, judgment?:string}}
 */
export function bestMoment({ calls = [], chains = [], allWarmup = false }) {
  const landed = calls.filter((c) => c.judgment && JUDGMENTS[c.judgment] && ["perfect", "great", "good"].includes(c.judgment));
  if (landed.length && !allWarmup) {
    const best = landed.reduce((a, c) => {
      const wa = JUDGMENTS[a.judgment].weight, wc = JUDGMENTS[c.judgment].weight;
      return wc > wa || (wc === wa && c.call.length > a.call.length) ? c : a;
    });
    return { kind: "called", str: best.call, judgment: best.judgment };
  }
  const longest = chains.reduce((a, c) => (a == null || c.len > a.len ? c : a), null);
  return longest ? { kind: "chain", str: longest.str, len: longest.len } : { kind: null, str: "" };
}

/**
 * @param {{rounds:Array<{n:number, grade:string, score:number, punches:number, perMin:number|null, xp:number}>,
 *   best:{kind:string|null, str:string, judgment?:string}, comboCount:number, level:number, title:string,
 *   nextUnlock:{level:number, label:string}|null, week:{count:number, target:number, reached:boolean}|null,
 *   heldPct:number|null, eased:boolean, demo:boolean, welcome:number, resetsOnNew:boolean}} o
 */
export function buildRecapCards(o) {
  const R = COPY.recap;
  const rounds = o.rounds ?? [];
  const roundLines = rounds.map((r) => R.roundLine(r.n, gradeName(r.grade), r.score, r.punches, r.xp));
  const cards = [{
    id: "rounds", kind: "rounds", tone: "accent", eyebrow: R.rounds, big: R.roundsBig(rounds.length),
    title: rounds.map((r) => gradeName(r.grade)).join(", ") || COPY.grade.empty, list: roundLines,
    rounds: rounds.map((r) => ({ n: r.n, grade: r.grade, glyph: GRADES.find((g) => g.id === r.grade)?.shape ?? "dash", perMin: r.perMin, score: r.score })),
  }];

  const b = o.best ?? { kind: null, str: "" };
  cards.push({
    id: "combo", kind: "combo", tone: b.kind === "called" ? "gold" : "accent", eyebrow: R.combo, big: b.str || "–",
    title: b.kind === "called" ? R.comboCalled(COPY.judgments[b.judgment]?.name ?? b.judgment) : b.kind === "chain" ? R.comboLongest : R.comboNone,
    list: o.comboCount > 0 ? [R.comboBook(o.comboCount)] : [],
  });

  const next = [];
  if (o.week) next.push(o.week.reached ? R.nextWeekDone : R.nextWeek(o.week.count, o.week.target));
  if (o.eased) next.push(R.eased); else if (o.heldPct != null && rounds.length > 1) next.push(R.held(o.heldPct));
  if (o.demo) next.push(o.welcome ? R.demoKept(o.welcome) : R.demoNone);
  if (o.resetsOnNew) next.push(R.cleared);
  cards.push({
    id: "next", kind: "next", tone: "calm", eyebrow: R.next, big: `Lv ${o.level}`, unit: o.title,
    title: o.nextUnlock ? R.nextUnlock(o.nextUnlock.level, o.nextUnlock.label) : R.nextTop, list: next,
  });
  // The kit's carousel prints a list only when it has two lines or more; a single line is folded into the card's sentence instead.
  return cards.map((c) => (c.list?.length === 1 ? { ...c, title: `${c.title} ${c.list[0]}`, list: [] } : c));
}
