// Fun stats, local only: a count per allowlisted event name, and the first-win time. Nothing else can be recorded here: there
// is no field for a sensor value, a punch, a name or an id, and nothing leaves the device. It lives in the kit's store, so
// "Forget my data" clears it with the rest.

export const STAT_EVENTS = Object.freeze([
  "warmup.started", "warmup.done", "round.done", "sim.used",
  "call.perfect", "call.great", "call.good", "call.count", "call.missed", "countit.tap",
  "recap.opened", "feedback.loved", "feedback.fine", "feedback.notForMe", "first.win",
]);
const ALLOWED = new Set(STAT_EVENTS);
const KEY = "log.stats";
const blank = () => ({ counts: {}, firstWinMs: null });

export function createStats(store) {
  const load = () => ({ ...blank(), ...(store.get(KEY, blank()) ?? {}) });
  return {
    /** Count one event. Unknown names are refused (returns false). */
    count(name, by = 1) {
      if (!ALLOWED.has(name) || !Number.isFinite(by)) return false;
      const s = load();
      s.counts = { ...(s.counts ?? {}), [name]: (s.counts?.[name] ?? 0) + Math.max(0, Math.round(by)) };
      store.set(KEY, s);
      return true;
    },
    /** The first-win time in whole milliseconds (kept once). */
    firstWin(ms) {
      const s = load();
      if (s.firstWinMs == null && Number.isFinite(ms)) { s.firstWinMs = Math.round(ms); store.set(KEY, s); }
      return s.firstWinMs;
    },
    snapshot: () => { const s = load(); return { counts: { ...(s.counts ?? {}) }, firstWinMs: s.firstWinMs ?? null }; },
    csv() {
      const s = load();
      return ["event,count", ...STAT_EVENTS.map((e) => `${e},${s.counts?.[e] ?? 0}`), `first_win_ms,${s.firstWinMs ?? ""}`].join("\n");
    },
  };
}
