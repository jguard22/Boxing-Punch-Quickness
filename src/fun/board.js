// The bests board and the hit meter as plain data: no DOM, no kit. ui.js draws them; a test walks every rule here.
// The board is read from a few metres away, so a speed best is a big number with a small unit, grouped by punch type and always
// in the same order, whatever order the kit stored them in.

/** The four speed bests, in the order a combo is thrown (1 jab, 2 cross, 3 hook, 5 uppercut). */
export const SPEED_ORDER = Object.freeze([
  Object.freeze({ id: "speed_jab", type: "jab" }),
  Object.freeze({ id: "speed_cross", type: "cross" }),
  Object.freeze({ id: "speed_hook", type: "hook" }),
  Object.freeze({ id: "speed_uppercut", type: "uppercut" }),
]);
/** The other marks, after the speeds. */
export const MARK_ORDER = Object.freeze(["roundGrade", "flow", "longestChain"]);

/** "8.1 m/s" gives { value: "8.1", unit: "m/s" }; "4 punches" and "79" work too. Anything else is all value. */
export function splitBest(text) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(.*?)\s*$/.exec(String(text ?? ""));
  return m ? { value: m[1], unit: m[2] } : { value: String(text ?? ""), unit: "" };
}

/**
 * Sort the kit's bests into the board's two groups. Items: { id, label, text } with the text already formatted for the m/s or mph choice.
 * Unknown ids are kept after the known marks, so a new metric still shows up.
 * @returns {{speeds: Array<{id:string,type:string,label:string,value:string,unit:string}>, marks: Array<{id:string,label:string,value:string,unit:string}>}}
 */
export function boardGroups(items = []) {
  const byId = new Map(items.filter((x) => x && x.id != null && x.text).map((x) => [x.id, x]));
  const speeds = SPEED_ORDER.filter((s) => byId.has(s.id)).map((s) => {
    const it = byId.get(s.id);
    return { id: s.id, type: s.type, label: s.type, ...splitBest(it.text) };
  });
  const known = new Set([...SPEED_ORDER.map((s) => s.id), ...MARK_ORDER]);
  const ids = [...MARK_ORDER.filter((id) => byId.has(id)), ...[...byId.keys()].filter((id) => !known.has(id))];
  const marks = ids.map((id) => ({ id, label: byId.get(id).label ?? id, ...splitBest(byId.get(id).text) }));
  return { speeds, marks };
}

/** How many of the meter's four segments a speed tier lights: Easy 1, Steady 2, Sharp 3, Snap 4. No tier, none. */
export const TIER_LIT = Object.freeze({ easy: 1, steady: 2, sharp: 3, snap: 4 });
export const tierLit = (id) => TIER_LIT[id] ?? 0;
