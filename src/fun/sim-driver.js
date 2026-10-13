// What the simulated boxer does when the coach calls a combo. Pure, with the rng passed in, so a test can check the mix.
// Most of the time it throws the call, sometimes late, sometimes in the wrong hand order, sometimes too few punches: so a
// demo shows Perfect, Great, Good, Count it and Missed instead of a wall of Perfects. The page's own simulator still adds
// its 12 percent of sloppy throws that the classifier reads wrongly.

import { parseCall } from "./calls.js";

export const SIM_MIX = Object.freeze({ exact: 0.78, late: 0.1, wrongOrder: 0.07, tooFew: 0.05 });

/**
 * @param {string} call e.g. "1-2-3"
 * @param {() => number} rng 0..1
 * @returns {{nums:number[], delayMs:number, kind:"exact"|"late"|"wrongOrder"|"tooFew"}}
 */
export function simResponse(call, rng) {
  const nums = parseCall(call);
  const roll = rng();
  const quick = () => 500 + Math.round(rng() * 400);
  if (roll < SIM_MIX.exact) return { nums, delayMs: quick(), kind: "exact" };
  if (roll < SIM_MIX.exact + SIM_MIX.late) return { nums, delayMs: 1300 + Math.round(rng() * 600), kind: "late" };
  if (roll < SIM_MIX.exact + SIM_MIX.late + SIM_MIX.wrongOrder) {
    const flipped = nums.slice();
    flipped[0] = flipped[0] % 2 === 1 ? flipped[0] + 1 : flipped[0] - 1;      // the other hand throws first
    return { nums: flipped, delayMs: quick(), kind: "wrongOrder" };
  }
  return { nums: nums.length >= 2 ? nums.slice(0, 1) : [], delayMs: quick(), kind: "tooFew" };
}
