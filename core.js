/* Brilliant Wear — Boxing Punch Quickness: core logic (pure, no DOM).
   Loaded as window.BPCore in the page and via require()/import in node tests.

   Everything numeric is metric (m/s, m, ms). Unit conversion happens only in
   fmtSpeed()/the UI. Punch detection and classification are the same code the
   Simulate mode and the hardware path both run through. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BPCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = 9.80665;
  const MS_TO_MPH = 2.2369362920544;
  const TYPES = ["jab", "cross", "hook", "uppercut"];
  const TYPE_NAMES = { 1: "jab", 2: "cross", 3: "lead hook", 4: "rear hook", 5: "lead uppercut", 6: "rear uppercut" };

  const DEFAULTS = {
    rateMs: 5,                 // 200 Hz — punches are ~120-250 ms events
    startG: 2.0,               // |linAcc| onset threshold (g)
    endG: 0.8,                 // below this = punch over
    maxPunchMs: 450,
    maxGapMs: 50,              // a bigger hole in the sample stream (BLE dropout, sim restart) aborts the open window
    refractoryMs: 250,
    minPeakV: 1.2,             // m/s — below this it is arm wiggle
    minPathM: 0.15,            // m
    vertFrac: 0.5,             // upward displacement share => uppercut
    hookYawDeg: 40,            // |yaw change| => hook
    hookCurve: 1.6,            // path length / net displacement => hook
    comboGapMs: 600,           // punches closer than this (end -> next onset) chain into a combo
    roundMs: 180000,           // 3 min round
    restMs: 60000,             // 1 min rest
    rounds: 3,
    warnMs: 10000,             // 10 s clapper warning
    wtPreMs: 120,              // weight share window before onset
    wtPostMs: 60,              // ...and in the last ms of the punch window
  };

  // ---------- units ----------
  const toMph = (ms) => ms * MS_TO_MPH;
  const fromMph = (mph) => mph / MS_TO_MPH;
  function fmtSpeed(ms, unit, digits = 1) {
    if (ms == null || Number.isNaN(ms)) return "—";
    return (unit === "mph" ? toMph(ms) : ms).toFixed(digits);
  }
  const speedLabel = (unit) => (unit === "mph" ? "mph" : "m/s");

  // ---------- math ----------
  function quatRotate(q, v) {
    const { x, y, z, w } = q;
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  }
  function yawOf(q) { return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)); }
  function yawDeg(q0, q1) {
    if (!q0 || !q1) return 0;
    let d = (yawOf(q1) - yawOf(q0)) * 180 / Math.PI;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const effType = (p) => p.trueType || p.type;

  // ---------- punch detection + classification ----------
  function classify(hand, feat, lead, cfg = DEFAULTS) {
    // TODO[SDK]: verify world-frame up axis on hardware (assumed z-up here)
    if (feat.vertFrac > cfg.vertFrac && feat.up > 0) return "uppercut";
    if (Math.abs(feat.rotDeg) > cfg.hookYawDeg || feat.curve > cfg.hookCurve) return "hook";
    return hand === lead ? "jab" : "cross";
  }

  function mkHand() {
    return { q: null, q0: null, lastT: null, active: false, start: 0, v: [0, 0, 0], d: [0, 0, 0],
             path: 0, peakV: 0, peakA: 0, lastEnd: -Infinity, aborted: 0 };
  }

  // One detector for both wrists. getLead() -> "L" | "R" (stance); onPunch(p) is optional,
  // acc() also returns the finished punch so tests can drive it synchronously.
  function createDetector({ cfg: over = {}, getLead = () => "L", onPunch = null } = {}) {
    const cfg = { ...DEFAULTS, ...over };
    const hands = { L: mkHand(), R: mkHand() };

    function quat(hand, q) { hands[hand].q = q; }

    function acc(hand, a, t) {
      const h = hands[hand];
      if (h.lastT != null && t <= h.lastT) return null; // out-of-order / duplicate sample
      // A hole in the stream while a window is open means the integrated velocity is stale:
      // drop the window (no punch, no refractory) and let this sample start fresh below.
      if (h.active && h.lastT != null && t - h.lastT > cfg.maxGapMs) { h.active = false; h.aborted++; }
      const dt = h.lastT == null ? 0 : Math.min(0.03, (t - h.lastT) / 1000);
      h.lastT = t;
      if (!dt) return null;
      const world = h.q ? quatRotate(h.q, [a.x, a.y, a.z]) : [a.x, a.y, a.z];
      const mag = Math.hypot(world[0], world[1], world[2]);

      if (!h.active) {
        if (mag > cfg.startG * G && t - h.lastEnd > cfg.refractoryMs) {
          h.active = true; h.start = t; h.q0 = h.q ? { ...h.q } : null;
          h.v = [0, 0, 0]; h.d = [0, 0, 0]; h.path = 0; h.peakV = 0; h.peakA = 0;
        }
        return null;
      }
      // inside a punch window: integrate from assumed rest at onset
      for (let i = 0; i < 3; i++) { h.v[i] += world[i] * dt; h.d[i] += h.v[i] * dt; }
      const speed = Math.hypot(h.v[0], h.v[1], h.v[2]);
      h.path += speed * dt;
      if (speed > h.peakV) h.peakV = speed;
      if (mag > h.peakA) h.peakA = mag;

      if (mag < cfg.endG * G || t - h.start > cfg.maxPunchMs) {
        h.active = false; h.lastEnd = t;
        return finish(hand, h, t);
      }
      return null;
    }

    function finish(hand, h, t) {
      if (h.peakV < cfg.minPeakV || h.path < cfg.minPathM) return null; // arm wiggle, not a punch
      const net = Math.hypot(h.d[0], h.d[1], h.d[2]);
      const feat = {
        durMs: Math.round(t - h.start),
        peakV: h.peakV, peakG: h.peakA / G,
        up: h.d[2], vertFrac: net > 0 ? Math.abs(h.d[2]) / net : 0,
        curve: net > 0.02 ? h.path / net : 1,
        rotDeg: yawDeg(h.q0, h.q),
      };
      const lead = getLead();
      const p = { hand, lead, startT: h.start, t, ...feat, type: classify(hand, feat, lead, cfg) };
      if (onPunch) onPunch(p);
      return p;
    }

    function reset() { hands.L = mkHand(); hands.R = mkHand(); }
    return { cfg, hands, quat, acc, reset };
  }

  // ---------- combos (boxing numbering: 1 jab, 2 cross, 3/4 lead/rear hook, 5/6 lead/rear uppercut) ----------
  function punchNumber(p) {
    const type = effType(p);
    if (type === "jab") return 1;
    if (type === "cross") return 2;
    const isLead = p.hand === p.lead;
    if (type === "hook") return isLead ? 3 : 4;
    return isLead ? 5 : 6;
  }

  // Group chronological punches into combos. A new combo starts when the rest between
  // one punch's end and the next onset exceeds gapMs, or the round changes.
  function groupCombos(punches, gapMs = DEFAULTS.comboGapMs) {
    const combos = [];
    let cur = null, prev = null;
    for (const p of punches) {
      const gap = prev ? p.startT - prev.t : Infinity;
      if (!cur || gap > gapMs || (prev && (prev.round || 0) !== (p.round || 0))) {
        cur = { punches: [] };
        combos.push(cur);
      }
      cur.punches.push(p);
      prev = p;
    }
    for (const c of combos) {
      const nums = c.punches.map(punchNumber);
      c.nums = nums;
      c.str = nums.join("-");
      c.len = nums.length;
      c.startT = c.punches[0].startT;
      c.endT = c.punches[c.len - 1].t;
      c.durMs = c.endT - c.startT;
      c.round = c.punches[0].round || 0;
      c.peakV = Math.max(...c.punches.map((p) => p.peakV));
      c.meanV = mean(c.punches.map((p) => p.peakV));
    }
    return combos;
  }
  // Stamps combo / comboPos / comboLen / num onto each punch (recomputed after label corrections).
  function annotateCombos(punches, gapMs = DEFAULTS.comboGapMs) {
    const combos = groupCombos(punches, gapMs);
    combos.forEach((c, ci) => c.punches.forEach((p, i) => {
      p.combo = ci + 1; p.comboPos = i + 1; p.comboLen = c.len; p.num = c.nums[i];
    }));
    return combos;
  }
  function comboTally(combos, minLen = 2) {
    const tally = new Map();
    for (const c of combos) if (c.len >= minLen) tally.set(c.str, (tally.get(c.str) || 0) + 1);
    return [...tally.entries()].map(([str, count]) => ({ str, count })).sort((a, b) => b.count - a.count || b.str.length - a.str.length);
  }
  function describeCombo(str) {
    return str.split("-").map((n) => TYPE_NAMES[n] || n).join(" · ");
  }

  // ---------- round clock ----------
  // Pure state machine over caller-supplied timestamps. tick(t) returns the events
  // crossed since the last tick: roundStart / warn / roundEnd / restStart / done.
  function createRoundClock(opts = {}) {
    const cfg = { roundMs: DEFAULTS.roundMs, restMs: DEFAULTS.restMs, rounds: DEFAULTS.rounds, warnMs: DEFAULTS.warnMs, ...opts };
    let startedAt = null, stoppedAt = null, finished = false, idx = 0;
    let timeline = [];

    function build() {
      const tl = [];
      let off = 0;
      for (let n = 1; n <= cfg.rounds; n++) {
        tl.push({ off, type: "roundStart", n });
        if (cfg.roundMs > cfg.warnMs * 2) tl.push({ off: off + cfg.roundMs - cfg.warnMs, type: "warn", n });
        off += cfg.roundMs;
        tl.push({ off, type: "roundEnd", n });
        if (n < cfg.rounds) { tl.push({ off, type: "restStart", n }); off += cfg.restMs; }
        else tl.push({ off, type: "done", n });
      }
      return { tl, total: off };
    }
    let totalMs = 0;

    function emit(t) {
      const out = [];
      while (idx < timeline.length && startedAt + timeline[idx].off <= t) {
        const ev = timeline[idx++];
        out.push({ ...ev, t: startedAt + ev.off });
        if (ev.type === "done") finished = true;
      }
      return out;
    }
    function start(t) {
      const b = build();
      timeline = b.tl; totalMs = b.total;
      startedAt = t; stoppedAt = null; finished = false; idx = 0;
      return emit(t);
    }
    function tick(t) { return startedAt == null || stoppedAt != null ? [] : emit(t); }
    function stop(t) {
      if (startedAt == null || stoppedAt != null || finished) return [];
      // Events already due (a roundEnd the 100 ms tick has not delivered yet) come first, so
      // a Stop pressed right after a round ended still closes that round at its scheduled end.
      const due = emit(t);
      if (finished) return due;                     // the session ended on its own before the click
      const ph = phaseAt(t);
      stoppedAt = t;
      return [...due, { type: "stopped", t, n: ph.n, phase: ph.phase }];
    }
    // Scheduled phase at time t (independent of tick lag).
    function phaseAt(t) {
      if (startedAt == null) return { phase: "idle", n: 0, elapsedMs: 0, remainingMs: cfg.roundMs, phaseMs: cfg.roundMs };
      if (stoppedAt != null && t >= stoppedAt) return { phase: "stopped", n: 0, elapsedMs: 0, remainingMs: 0, phaseMs: 0 };
      const e = t - startedAt;
      if (e >= totalMs) return { phase: "done", n: cfg.rounds, elapsedMs: cfg.roundMs, remainingMs: 0, phaseMs: cfg.roundMs };
      let off = 0;
      for (let n = 1; n <= cfg.rounds; n++) {
        if (e < off + cfg.roundMs) return { phase: "round", n, elapsedMs: e - off, remainingMs: off + cfg.roundMs - e, phaseMs: cfg.roundMs };
        off += cfg.roundMs;
        if (n < cfg.rounds) {
          if (e < off + cfg.restMs) return { phase: "rest", n, elapsedMs: e - off, remainingMs: off + cfg.restMs - e, phaseMs: cfg.restMs };
          off += cfg.restMs;
        }
      }
      return { phase: "done", n: cfg.rounds, elapsedMs: cfg.roundMs, remainingMs: 0, phaseMs: cfg.roundMs };
    }
    return {
      cfg, start, tick, stop, phaseAt,
      get running() { return startedAt != null && stoppedAt == null && !finished; },
      get finished() { return finished; },
      get startedAt() { return startedAt; },
      get stoppedAt() { return stoppedAt; },
      get totalMs() { return totalMs; },
    };
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------- insole weight transfer ----------
  // buf rows: [t, leftLoad, rightLoad]. leadSide: "left" | "right" (the front foot).
  function leadShareOver(buf, from, to, leadSide) {
    let sum = 0, n = 0;
    for (const [t, l, r] of buf) {
      if (t < from || t > to) continue;
      const tot = l + r;
      if (tot < 0.02) continue;
      sum += (leadSide === "left" ? l : r) / tot; n++;
    }
    return n ? sum / n : null;
  }
  // Shift of load share onto the lead (front) foot between pre-onset and punch end, in
  // percentage points of total load. + = weight moved to the front foot, - = to the back foot.
  function weightShift(buf, startT, endT, leadSide, cfg = DEFAULTS) {
    const pre = leadShareOver(buf, startT - cfg.wtPreMs, startT, leadSide);
    const post = leadShareOver(buf, endT - cfg.wtPostMs, endT, leadSide);
    if (pre == null || post == null) return null;
    return { shiftPp: (post - pre) * 100, frontPct: post * 100 };
  }

  // ---------- stats ----------
  function summarize(punches, durMs) {
    const count = punches.length;
    const speeds = punches.map((p) => p.peakV);
    const peakPunch = count ? punches.reduce((a, b) => (b.peakV > a.peakV ? b : a)) : null;
    const byType = {};
    for (const t of TYPES) {
      const xs = punches.filter((p) => effType(p) === t).map((p) => p.peakV);
      byType[t] = { n: xs.length, mean: mean(xs), peak: xs.length ? Math.max(...xs) : null };
    }
    const L = punches.filter((p) => p.hand === "L"), R = punches.filter((p) => p.hand === "R");
    const combos = groupCombos(punches);
    const shifts = punches.filter((p) => p.shiftPp != null);
    const straight = shifts.filter((p) => ["jab", "cross"].includes(effType(p)));
    return {
      count, durMs,
      perMin: durMs > 0 ? count / (durMs / 60000) : null,
      meanV: mean(speeds), peakV: count ? Math.max(...speeds) : null,
      peakType: peakPunch ? effType(peakPunch) : null,
      byType,
      nL: L.length, nR: R.length, pctL: count ? (L.length / count) * 100 : null,
      meanL: mean(L.map((p) => p.peakV)), meanR: mean(R.map((p) => p.peakV)),
      combos: combos.filter((c) => c.len >= 2).length,
      singles: combos.filter((c) => c.len === 1).length,
      longest: combos.length ? Math.max(...combos.map((c) => c.len)) : 0,
      longestStr: combos.length ? combos.reduce((a, b) => (b.len > a.len ? b : a)).str : null,
      topCombos: comboTally(combos).slice(0, 3),
      shift: {
        n: shifts.length, mean: mean(shifts.map((p) => p.shiftPp)),
        straightMean: mean(straight.map((p) => p.shiftPp)),
      },
    };
  }

  // rounds: [{n, startT, endT|null}]. nowT closes open rounds. opts.roundMs = configured round
  // length (lets the fatigue curve tell a stopped-early stub from a full round).
  function buildSession(punches, rounds, nowT, opts = {}) {
    const perRound = rounds.map((r) => {
      const pts = punches.filter((p) => p.round === r.n);
      const durMs = Math.max(0, (r.endT ?? nowT) - r.startT);
      return { n: r.n, open: r.endT == null, ...summarize(pts, durMs) };
    });
    let activeMs;
    if (rounds.length) activeMs = perRound.reduce((a, r) => a + r.durMs, 0);
    else if (punches.length >= 2) activeMs = Math.max(0, punches[punches.length - 1].t - punches[0].startT);
    else activeMs = 0;
    const total = summarize(punches, activeMs);
    const inRounds = punches.filter((p) => p.round > 0).length;
    if (rounds.length) total.perMin = activeMs > 0 ? inRounds / (activeMs / 60000) : null; // output while the clock was live
    else if (activeMs < 20000) total.perMin = null; // free work too short to be a meaningful rate
    const fatigue = fatigueCurve(perRound, opts);
    const openRound = perRound.find((r) => r.open);
    const fatigueNote = fatigue ? (openRound ? `R${openRound.n} in progress, not counted` : fatigue.skipped.length ? `R${fatigue.skipped.map((r) => r.n).join(", R")} too short, not counted` : null)
      : openRound ? "round in progress" : "needs 2+ full rounds";
    return { rounds: perRound, total, fatigue, fatigueNote, openRound: openRound ? openRound.n : null, inRounds };
  }

  // Output and hand speed per round, as % of the first round with enough data. Only complete
  // rounds count: an open round, or one cut short below minRoundFrac of the full round length,
  // has a few seconds of punches behind its rate and speed - noise, not fatigue.
  function fatigueCurve(roundStats, { roundMs = null, minRoundFrac = 0.5 } = {}) {
    const closed = roundStats.filter((r) => r.open !== true);
    const full = roundMs ?? Math.max(0, ...closed.map((r) => r.durMs ?? 0));
    const skipped = [];
    const usable = roundStats.filter((r) => {
      if (r.open === true) return false;
      if (r.durMs != null && full > 0 && r.durMs < full * minRoundFrac) { skipped.push({ n: r.n, reason: "short" }); return false; }
      return r.count >= 3 && r.meanV != null && r.perMin != null;
    });
    if (usable.length < 2) return null;
    const base = usable[0];
    const points = usable.map((r) => ({
      n: r.n, speedPct: (r.meanV / base.meanV) * 100, ratePct: (r.perMin / base.perMin) * 100,
      meanV: r.meanV, perMin: r.perMin,
    }));
    const last = points[points.length - 1];
    return { points, baseRound: base.n, lastRound: last.n, speedFadePct: last.speedPct - 100, rateFadePct: last.ratePct - 100, skipped };
  }

  // Confusion matrix over reviewed punches: rows = true label, columns = auto label.
  function confusion(punches) {
    const m = {};
    for (const a of TYPES) { m[a] = {}; for (const b of TYPES) m[a][b] = 0; }
    let n = 0, ok = 0;
    for (const p of punches) {
      if (!p.trueType) continue;
      m[p.trueType][p.type]++; n++;
      if (p.trueType === p.type) ok++;
    }
    const rowSum = {}, colSum = {}, recall = {}, precision = {};
    for (const t of TYPES) {
      rowSum[t] = TYPES.reduce((a, b) => a + m[t][b], 0);
      colSum[t] = TYPES.reduce((a, b) => a + m[b][t], 0);
    }
    for (const t of TYPES) {
      recall[t] = rowSum[t] ? m[t][t] / rowSum[t] : null;
      precision[t] = colSum[t] ? m[t][t] / colSum[t] : null;
    }
    return { m, n, ok, accuracy: n ? ok / n : null, rowSum, colSum, recall, precision };
  }

  // ---------- coaching read-out (sport wording, not medical) ----------
  function coachNotes(session, conf, unit = "ms") {
    const notes = [];
    const f = session.fatigue, t = session.total;
    const sp = (v) => `${fmtSpeed(v, unit)} ${speedLabel(unit)}`;
    if (f) {
      const s = f.speedFadePct, r = f.rateFadePct;
      if (s >= 3) notes.push({ tone: "good", text: `Hand speed rose ${s.toFixed(0)}% from round ${f.baseRound} to round ${f.lastRound} — you finished faster than you started.` });
      else if (s >= -3) notes.push({ tone: "good", text: `Hand speed held within 3% of round ${f.baseRound} through round ${f.lastRound} — conditioning is holding up.` });
      else if (s >= -8) notes.push({ tone: "info", text: `Hand speed eased ${Math.abs(s).toFixed(0)}% by round ${f.lastRound} — normal late-round fade; keep the snap on the last combo.` });
      else notes.push({ tone: "warn", text: `Hand speed faded ${Math.abs(s).toFixed(0)}% by round ${f.lastRound} — add late-round speed work (short, sharp rounds).` });
      if (r <= -15) notes.push({ tone: "warn", text: `Punch output dropped ${Math.abs(r).toFixed(0)}% from round ${f.baseRound} to ${f.lastRound} — pace the early rounds or build work capacity.` });
    }
    if (t.count >= 10 && t.pctL != null && (t.pctL > 62 || t.pctL < 38)) {
      const heavy = t.pctL > 50 ? "Left" : "Right", light = t.pctL > 50 ? "right" : "left";
      notes.push({ tone: "info", text: `${heavy} hand threw ${Math.max(t.pctL, 100 - t.pctL).toFixed(0)}% of punches — give the ${light} hand more work.` });
    }
    const typed = TYPES.filter((k) => t.byType[k].n >= 3);
    if (typed.length >= 2) {
      const fast = typed.reduce((a, b) => (t.byType[b].mean > t.byType[a].mean ? b : a));
      const slow = typed.reduce((a, b) => (t.byType[b].mean < t.byType[a].mean ? b : a));
      notes.push({ tone: "info", text: `Quickest punch: ${fast} (${sp(t.byType[fast].mean)} avg). Slowest: ${slow} (${sp(t.byType[slow].mean)}).` });
    }
    if (t.longest >= 3) notes.push({ tone: "info", text: `Longest combination: ${t.longestStr} (${t.longest} punches).` });
    if (t.shift.straightMean != null && t.shift.n >= 5) {
      const w = t.shift.straightMean;
      if (w >= 8) notes.push({ tone: "good", text: `Weight moves ${w.toFixed(0)} pp onto the front foot on straight punches — good drive through the floor.` });
      else notes.push({ tone: "info", text: `Only ${w.toFixed(0)} pp of forward weight transfer on straight punches — push off the back foot for more reach and snap.` });
    }
    if (conf && conf.n >= 8) notes.push({ tone: conf.accuracy >= 0.85 ? "good" : "info", text: `Auto punch-type labels matched your corrections ${(conf.accuracy * 100).toFixed(0)}% of the time (${conf.n} reviewed).` });
    return notes.slice(0, 8);                  // 7 can fire today; the cap only guards future additions
  }

  function summaryText(session, conf, unit = "ms") {
    const t = session.total, u = speedLabel(unit);
    const L = [];
    L.push("Brilliant Wear — Boxing Punch Quickness session");
    L.push(`Punches ${t.count} · rounds ${session.rounds.length} · mean ${fmtSpeed(t.meanV, unit)} ${u} · peak ${fmtSpeed(t.peakV, unit)} ${u}${t.peakType ? ` (${t.peakType})` : ""}`);
    if (t.perMin != null) L.push(`Output ${t.perMin.toFixed(0)} punches/min · combos ${t.combos} · longest ${t.longestStr || "—"}`);
    for (const r of session.rounds) {
      L.push(`R${r.n}: ${r.count} punches, ${r.perMin != null ? r.perMin.toFixed(0) : "—"}/min, mean ${fmtSpeed(r.meanV, unit)} ${u}, peak ${fmtSpeed(r.peakV, unit)} ${u}, L/R ${r.pctL != null ? r.pctL.toFixed(0) : "—"}/${r.pctL != null ? (100 - r.pctL).toFixed(0) : "—"}`);
    }
    for (const n of coachNotes(session, conf, unit)) L.push(`- ${n.text}`);
    return L.join("\n");
  }

  // ---------- CSV ----------
  const PUNCH_CSV_HEADER = "punch,hand,auto_type,true_type,peak_speed_ms,peak_accel_g,dur_ms,rot_deg,vert_frac,curve,gap_ms,reviewed,round,lead_hand,combo,combo_pos,combo_str,wt_shift_pp,front_foot_pct";
  function punchCsvRow(p, comboStr = "") {
    return [
      p.n, p.hand, p.type, p.trueType ?? p.type, p.peakV.toFixed(2), p.peakG.toFixed(2), p.durMs,
      p.rotDeg.toFixed(1), p.vertFrac.toFixed(3), p.curve.toFixed(2), p.gapMs ?? "",
      p.trueType ? 1 : 0, p.round || 0, p.lead, p.combo ?? "", p.comboPos ?? "", comboStr,
      p.shiftPp != null ? p.shiftPp.toFixed(1) : "", p.frontPct != null ? p.frontPct.toFixed(1) : "",
    ].join(",");
  }
  const ROUND_CSV_HEADER = ["round", "duration_s", "punches", "punches_per_min", "combos", "longest_combo", "mean_speed_ms", "peak_speed_ms", "pct_left",
    ...TYPES.flatMap((t) => [`${t}_n`, `${t}_mean_ms`, `${t}_peak_ms`]), "wt_shift_mean_pp", "wt_shift_n"].join(",");
  function roundCsvRow(r) {
    const f = (v, d = 2) => (v == null ? "" : v.toFixed(d));
    return [
      r.n, (r.durMs / 1000).toFixed(1), r.count, f(r.perMin, 1), r.combos, r.longest, f(r.meanV), f(r.peakV), f(r.pctL, 1),
      ...TYPES.flatMap((t) => [r.byType[t].n, f(r.byType[t].mean), f(r.byType[t].peak)]),
      f(r.shift.mean, 1), r.shift.n,
    ].join(",");
  }

  // ---------- simulation (shared by the Simulate button and the tests) ----------
  // Boxing numbers -> [which hand, wave kind]. lead = "L" | "R".
  function comboToThrows(nums, lead) {
    const rear = lead === "L" ? "R" : "L";
    const map = { 1: [lead, "straight"], 2: [rear, "straight"], 3: [lead, "hook"], 4: [rear, "hook"], 5: [lead, "uppercut"], 6: [rear, "uppercut"] };
    return nums.map((n) => map[n]);
  }
  const SIM_COMBOS = [
    [[1], 4], [[2], 2], [[1, 2], 8], [[1, 1, 2], 5], [[1, 2, 3], 6], [[1, 2, 3, 2], 5], [[1, 2, 5, 2], 5],
    [[2, 3, 2], 3], [[1, 6, 3, 2], 4], [[3, 4], 2], [[1, 2, 1, 2], 3], [[5, 2], 3], [[2, 6, 3], 2],
  ];
  function pickCombo(rng) {
    const total = SIM_COMBOS.reduce((a, c) => a + c[1], 0);
    let x = rng() * total;
    for (const [nums, w] of SIM_COMBOS) { x -= w; if (x <= 0) return nums; }
    return SIM_COMBOS[0][0];
  }

  // 200 Hz world-frame accel + yaw-only quaternion for one punch. `ambiguous` makes a
  // sloppy variant that the v1 heuristic will usually mislabel (feeds the confusion matrix).
  function synthPunch(kind, rng, o = {}) {
    const step = o.stepMs ?? DEFAULTS.rateMs;
    const dur = 140 + rng() * 60;
    const base = kind === "hook" ? 55 : kind === "uppercut" ? 48 : 65;
    const peak = base * (0.85 + rng() * 0.3) * (o.scale ?? 1);
    const yaw0 = rng() * Math.PI;
    const amb = !!o.ambiguous;
    const wob = 0.04 + rng() * 0.08;
    let sweep = 0, yawSwing = 0.1, up = 0, side = 0;
    if (kind === "straight") { sweep = amb ? 1.3 : 0; yawSwing = amb ? 0.8 : 0.1; }
    else if (kind === "hook") { sweep = amb ? 0.45 : 1.8; yawSwing = amb ? 0.5 : 1.2; }
    else { up = amb ? 0.45 : 0.9; side = amb ? 0.8 : 0.35; yawSwing = 0.1; }
    const samples = [];
    for (let ms = 0; ms <= dur + 40; ms += step) {
      const ph = Math.min(1, ms / dur);
      const env = Math.sin(ph * Math.PI) * peak;
      let ax, ay, az = 0;
      if (kind === "uppercut") { az = env * up; ax = env * side; ay = 0; }
      else if (sweep > 0) { ax = env * Math.cos(ph * sweep); ay = env * Math.sin(ph * sweep); }
      else { ax = env; ay = env * wob * Math.sin(ph * 7); }
      const yaw = yaw0 + ph * yawSwing;
      samples.push({ ms, a: { x: ax, y: ay, z: az }, q: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } });
    }
    return { kind, durMs: dur, samples };
  }

  // Synthetic lead-foot load share around punches (insole channel for Simulate).
  function shiftAmpPp(kind, isLead, rng, scale = 1) {
    let a;
    if (kind === "straight") a = isLead ? 4 + rng() * 4 : 11 + rng() * 7;
    else if (kind === "hook") a = isLead ? 6 + rng() * 4 : 3 + rng() * 5;
    else a = -2 + rng() * 5;
    return a * scale;
  }
  function createInsoleSim(rng) {
    const events = [];
    const smooth = (x) => x * x * (3 - 2 * x);
    function leadShare(t) {
      let s = 0.5;
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i], tau = t - e.t0;
        if (tau > e.durMs + 2500) { events.splice(i, 1); continue; }
        if (tau < 0) continue;
        const shape = tau <= e.durMs ? smooth(tau / e.durMs) : Math.exp(-(tau - e.durMs) / 250);
        s += (e.ampPp / 100) * shape;
      }
      return Math.min(0.98, Math.max(0.02, s + (rng() - 0.5) * 0.008));
    }
    return {
      punch(t0, durMs, ampPp) { events.push({ t0, durMs, ampPp }); },
      sample(t) { const s = leadShare(t), tot = 0.9 + (rng() - 0.5) * 0.02; return { lead: s * tot, rear: (1 - s) * tot }; },
    };
  }

  return {
    G, MS_TO_MPH, TYPES, TYPE_NAMES, DEFAULTS,
    toMph, fromMph, fmtSpeed, speedLabel,
    quatRotate, yawDeg, mulberry32, mean, effType,
    classify, createDetector,
    punchNumber, groupCombos, annotateCombos, comboTally, describeCombo,
    createRoundClock, fmtClock,
    leadShareOver, weightShift,
    summarize, buildSession, fatigueCurve, confusion, coachNotes, summaryText,
    PUNCH_CSV_HEADER, punchCsvRow, ROUND_CSV_HEADER, roundCsvRow,
    comboToThrows, pickCombo, synthPunch, shiftAmpPp, createInsoleSim,
  };
});
