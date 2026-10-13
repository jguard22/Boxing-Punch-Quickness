// Shared by the fun-layer tests: synthetic punches through the page's real detector, and hand-built punches for the edges.
import core from "../core.js";

export const C = core;

/** A hand-built punch record: times in ms, `lead` is the lead hand at the time. */
export function punch(o = {}) {
  const startT = o.startT ?? 0, durMs = o.durMs ?? 170;
  return { n: o.n ?? 1, hand: "L", lead: "L", type: "jab", trueType: null, startT, t: startT + durMs, durMs, peakV: 7, peakG: 6, round: 1, ...o };
}

/** Boxing numbers to the hand and type a perfect read would give (orthodox: left lead). */
const READ = { 1: ["L", "jab"], 2: ["R", "cross"], 3: ["L", "hook"], 4: ["R", "hook"], 5: ["L", "uppercut"], 6: ["R", "uppercut"] };
/** A clean answer to a call: the right hand and type for every count, `gapMs` between one punch's end and the next onset. */
export function answer(nums, { t0 = 500, gapMs = 200, durMs = 170, lead = "L" } = {}) {
  let t = t0;
  return nums.map((n, i) => {
    const [h, type] = READ[n];
    const hand = lead === "L" ? h : h === "L" ? "R" : "L";
    const p = punch({ n: i + 1, hand, lead, type, startT: t, durMs });
    t += durMs + gapMs;
    return p;
  });
}

/** Throw a combo through the real detector like the simulator does (paced by hand, ambiguous throws mixed in). Returns the detected punches. */
export function throwCombo(nums, rng, { t0 = 1000, ambiguous = 0.12, scale = 1, lead = "L" } = {}) {
  const det = C.createDetector({ getLead: () => lead });
  const out = [];
  let off = 0, prevHand = null;
  for (const [hand, kind] of C.comboToThrows(nums, lead)) {
    const s = C.synthPunch(kind, rng, { scale, ambiguous: rng() < ambiguous });
    for (const smp of s.samples) {
      det.quat(hand, smp.q);
      const p = det.acc(hand, smp.a, t0 + off + smp.ms);
      if (p) out.push({ ...p, n: out.length + 1, round: 1 });
    }
    off += prevHand === hand ? 520 + rng() * 60 : 330 + rng() * 110;
    prevHand = hand;
  }
  return out;
}
