// The game, between the page and the screens. It listens to the page's `bwfun` events (punches, rounds, labels, Simulate), keeps one
// set of rounds and one round in view, runs the coach's calls, turns a finished round into one kit session (XP, badges, bests) and
// hands the screens what to draw. The detector, the classifier and the round clock never import this: the page only dispatches
// events and takes a few commands back, and a fault in here is caught, logged and never stops a round.
import { createFirstWin, dayKey, buildReminderIcs, downloadIcs } from "../vendor/fun-kit/index.js";
import * as K from "./kit.js";
import * as cel from "./celebrate.js";
import * as prefsStore from "./prefs.js";
import { createStats } from "./stats.js";
import { COPY } from "./copy.js";
import { buildRecapCards, bestMoment } from "./recap.js";
import { simResponse } from "./sim-driver.js";
import { bookAdd, bookCounts, bookPages } from "./book.js";
import {
  XP, WARMUP, FIRST_WIN, SPEED_PB_IDS, CALL, FLOW, JUDGMENTS, FADE_STOP_PCT,
} from "./config.js";
import {
  speedGateOpen, speedTier, roundGrade, roundXp, bumpDayCount, roundsOnDay, mean, labelReviewXp, fadePct,
} from "./rules.js";
import {
  parseCall, callSchedule, windowState, judge, flowStart, flowStep, handFor, nextUnlock,
} from "./calls.js";

const DAY_OPTS = { rolloverHour: 4 };
const ROUNDS_KEY = "log.rounds";
const FEEDBACK_KEY = "log.feedback";
const BOOK_KEY = "book";

export function createSession({ view, win = globalThis.window, now = () => performance.now(), wall = () => Date.now(), kit = K.getKit(), download = downloadIcs } = {}) {
  const app = () => win.__bwBoxing;
  const S = () => app().S;
  const core = () => app().core;
  let demo = null;                                   // the Simulate profile: a second kit instance on memory storage, made on first use
  const demoKit = () => (demo ??= K.makeDemoKit(kit));
  const dropDemo = () => { try { demo?.dispose(); } catch { /* nothing to stop */ } demo = null; };
  const stats = createStats(kit.store);
  const firstWin = createFirstWin({
    store: kit.store, now: wall, winEvent: FIRST_WIN.winEvent, nudgeAfterMs: FIRST_WIN.nudgeAfterMs, assistAfterMs: FIRST_WIN.assistAfterMs,
    beats: FIRST_WIN.beats.map((b) => ({ id: b.id, on: b.on, text: COPY.coachMarks[b.text], hint: COPY.coachMarks[b.hint] })),
  });

  let prefs = prefsStore.load();
  let mode = win.document?.documentElement.dataset.mode === "lab" ? "lab" : "fight";
  const simRng = (() => { let a = (wall() ^ 0x9e3779b9) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const st = { set: null, round: null, ticker: null, fwTick: 0, forgetArmed: null, clearArmed: null, exportedSig: null };

  const cmd = (name, extra = {}) => win.dispatchEvent(new win.CustomEvent("bwcmd", { detail: { cmd: name, ...extra } }));
  /** This week's ring from the streak's read-only state (kit.summary() also pins today's challenges, which would write after Forget my data). */
  const weekState = () => { try { return kit.streaks.state(wall()).thisWeek ?? null; } catch { return null; } };
  const hasWrist = () => { const w = S().wrists; return !!(w.L || w.R); };
  const sensorsLive = () => { const s = S(); return !!(s.sim || s.wrists.L || s.wrists.R); };
  const viewDemo = () => !!(S().sim || st.set?.demo);
  const viewKit = () => (viewDemo() ? demoKit() : kit);
  const day = () => dayKey(wall(), DAY_OPTS);
  const fmtDur = (ms) => (ms >= 60000 ? `${+(ms / 60000).toFixed(2)} min` : `${Math.round(ms / 1000)} s`);
  const roundText = () => fmtDur(S().settings.roundMin * 60000);
  const callsOn = () => prefs.calls === "on";
  /** The real profile cannot be written to disk (storage blocked or full): XP lives in memory until the page closes, and the status says so. */
  const unsaved = () => kit.store.durable === false && kit.store.kind !== "memory";

  // ---------------------------------------------------------------------------------------------- screens
  function layout() {
    const s = S(), running = !!s.clock?.running, hasRounds = s.rounds.length > 0;
    const graded = !!st.set?.rounds.length;
    // a session on the page that the game is not showing (left by the Lab view, by Forget my data, or by anything unexpected) is not ours to wipe
    // silently, and the Play area must never be blank: the hero says so before it starts a new one
    const orphan = hasRounds && !running && !graded;
    view.layout({ hero: (!hasRounds && !running) || orphan, stage: running, grade: graded && hasRounds, actions: !running && !!st.set?.done, recap: !!st.set?.rounds.some((r) => r.punches > 0) });
    if (orphan) view.hint(COPY.hero.sessionOnPage);
    view.againLabel(againIsCoached() ? COPY.recap.cta.again : COPY.recap.cta.warm);
  }
  function refreshStatus() {
    try {
      const vk = viewKit(), week = weekState();
      view.renderStatus({ info: vk.xp.info(), week, demo: viewDemo(), unsaved: !viewDemo() && unsaved() });
    } catch (e) { warn("status", e); }
  }
  function refreshHero() {
    const first = !firstWin.isDone();
    view.setHero({ first, coachText: COPY.hero.coach(S().settings.rounds, roundText()), sim: S().sim, ready: sensorsLive() });
  }
  let goalNote = "";
  function refreshSettings() {
    let goal = null;
    try { goal = kit.streaks.goal(wall()); } catch { /* weekly mode only */ }
    view.settings({ prefs, stats: stats.snapshot(), firstWinMs: firstWin.state().timeToWinMs ?? stats.snapshot().firstWinMs, feedback: lastFeedback(), goal, goalNote });
  }
  /** The weekly ring's goal, 1 to 5 sessions. The kit keeps every past week under the goal it was played under, so changing it never re-scores history. */
  function setGoal(n) {
    if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, reason: "range" };       // 1 to 5 a week here (the kit would allow more)
    const r = kit.streaks.setGoal(n, { at: wall() });
    if (!r.ok) return r;
    goalNote = !r.changed ? COPY.goal.same(n) : r.applies === "now" ? COPY.goal.now(n) : COPY.goal.next(n);
    refreshSettings(); refreshStatus();
    return r;
  }
  /** The Combo Book of the profile in view: it appears after the first combo (progressive reveal), never before. */
  function refreshBook(fresh = new Set()) {
    try {
      const book = viewKit().store.get(BOOK_KEY, {}), counts = bookCounts(book);
      view.book({ pages: bookPages(book), counts, own: counts.distinct - counts.named, fresh, show: counts.distinct > 0 });
    } catch (e) { warn("book", e); }
  }
  /** Personal bests of the profile in view. Speeds are stored in m/s; the text is made by the kit's format, which reads the m/s or mph choice. */
  function refreshPb() {
    try {
      const items = viewKit().pb.all().filter((x) => x.best != null).map((x) => ({ label: x.label, text: x.bestText }));
      view.pbShelf({ items, show: items.length > 0 });
    } catch (e) { warn("bests", e); }
  }
  const refreshAll = () => { refreshStatus(); refreshHero(); refreshSettings(); refreshBook(); refreshPb(); layout(); };
  const warn = (what, e) => { try { console.warn(`[bag work] ${what}`, e); } catch { /* none */ } };

  // ---------------------------------------------------------------------------------------------- starting
  function hint(text) { view.hint(text); }
  function ensureSensors() {
    if (sensorsLive() || (st.set?.demo && !hasWrist())) { hint(null); return true; }   // a finished Simulate set carries on in Simulate
    hint(COPY.hero.noSensor);
    view.showHero();
    return false;
  }

  // Starting over clears the punches on the page, and with them every label somebody reviewed. The page's own Reset needs two taps for that
  // reason; so does every control here that would do the same, unless the CSV was exported since the last change.
  const labelSig = () => { const ps = S().punches; let n = 0; for (const p of ps) if (p.trueType != null && !p.sim) n++; return { punches: ps.length, labelled: n, sig: `${ps.length}:${n}` }; };
  function disarmClear() { clearTimeout(st.clearArmed); st.clearArmed = null; view.clearWarn(null); }
  /** True when starting over may go ahead; false (and a warning on screen) when it needs the second tap. */
  function guardClear() {
    const s = S();
    if (!s.rounds.length && !s.clock) return true;                    // nothing on the page to lose
    const risk = labelSig();
    if (!risk.labelled || st.exportedSig === risk.sig) { disarmClear(); return true; }
    if (st.clearArmed) { disarmClear(); return true; }
    st.clearArmed = setTimeout(disarmClear, 6000);
    view.clearWarn(COPY.clear.warn(risk.punches, risk.labelled), COPY.clear.again);
    return false;
  }
  /** Start over when a finished or stopped set is still on the page; keeps Simulate on when that is what the person was using. */
  function freshStart() {
    const s = S();
    const wantSim = s.sim || (!!st.set?.demo && !hasWrist());
    if (s.rounds.length || s.clock) cmd("reset");
    if (wantSim && !S().sim) cmd("sim", { on: true });
  }
  const againIsCoached = () => firstWin.isDone() || (!!st.set && st.set.kind !== "warmup");
  /** Every way to begin: needs sensors (or Simulate), then the second tap if labels are at stake. Returns false only when it is waiting for that tap. */
  function begin(run, { sim = false } = {}) {
    if (S().clock?.running) return true;
    if (!sim && !ensureSensors()) return true;
    if (!guardClear()) return false;
    run();
    return true;
  }
  const runWarmup = () => { freshStart(); cmd("warmup", { roundMs: WARMUP.roundMs, restMs: WARMUP.restMs, rounds: WARMUP.rounds, warnMs: WARMUP.warnMs }); };
  const runCoached = () => { freshStart(); cmd("rounds"); };
  const startWarmup = () => begin(runWarmup);
  const startCoached = () => begin(runCoached);
  const heroAction = () => (firstWin.isDone() ? startCoached() : startWarmup());
  const againAction = () => (againIsCoached() ? startCoached() : startWarmup());
  function heroSim() {
    if (S().sim) { cmd("sim", { on: false }); return; }
    begin(() => { cmd("sim", { on: true }); (firstWin.isDone() ? runCoached : runWarmup)(); }, { sim: true });
  }
  /** The timer card's own Start Rounds, in the Fight view: with no sensor it says what to do instead of running a silent round. */
  function railStart(e) {
    if (mode !== "fight" || S().clock?.running || S().rounds.length || sensorsLive()) return;
    e?.stopImmediatePropagation?.();
    ensureSensors();
  }

  // ---------------------------------------------------------------------------------------------- the bridge
  function onEvent(d) {
    if (mode !== "fight" && d.type !== "session.reset") return;     // the Lab view is the page as it was: the game is switched off
    switch (d.type) {
      case "punch": return mode === "fight" ? onPunch(d.p) : undefined;
      case "round.started": return mode === "fight" ? onRoundStarted(d) : undefined;
      case "round.warn": return mode === "fight" && st.round ? view.announce("10 seconds.") : undefined;
      case "round.ended": return mode === "fight" ? onRoundEnded(d) : undefined;
      case "session.done": return mode === "fight" ? finishSet("done") : undefined;
      case "session.stopped": return mode === "fight" ? finishSet("stopped") : undefined;
      case "session.reset": return onReset();
      case "sim": return onSim(d.on);
      case "device": hint(null); return refreshHero();
      case "units": view.mirrorLast(); refreshPb(); return refreshHero();
      case "stance.changed": return undefined;
      case "label.reviewed": return onLabelReviewed(d);
      case "label.bulk": return undefined;                          // "Mark all unreviewed correct" earns 0
      default: return undefined;
    }
  }

  /**
   * Label Lab: a punch you reviewed pays a flat 1 XP (20 a session, once per punch, nothing for Simulate or Mark all). It pays the
   * same whether the choice changed the auto label or confirmed it: no reward depends on agreeing or disagreeing.
   */
  function onLabelReviewed(d) {
    const p = d.p, set = st.set;
    if (!p || !set || set.demo) return;
    set.reviewed ??= new Set();
    const amount = labelReviewXp({ paid: set.reviewed.size, alreadyPaid: set.reviewed.has(p.n), sim: !!p.sim });
    if (!amount) return;
    set.reviewed.add(p.n);
    try {
      const res = kit.xp.award({ amount, source: "label", label: COPY.labelLab.xp, key: `label:${set.id}:${p.n}` }, { at: wall() });
      if (res.levelUp) cel.celebrateOutcome({ outcome: { xp: res, celebrations: [{ type: "levelup", level: res.toLevel, title: res.title }] } });
    } catch (e) { warn("label", e); }
    refreshStatus();
  }
  const plural = (t) => (t === "cross" ? "crosses" : `${t}s`);
  /** The most common mix-up among the punches you reviewed ("hooks read as jabs"), from the page's confusion counts. */
  function topMixup() {
    try {
      const cf = core().confusion(S().punches);
      let best = null;
      for (const a of core().TYPES) for (const b of core().TYPES) if (a !== b && cf.m[a][b] > 0 && (!best || cf.m[a][b] > best.n)) best = { a, b, n: cf.m[a][b] };
      return best ? `${plural(best.a)} read as ${plural(best.b)}` : null;
    } catch { return null; }
  }

  function onSim(on) {
    if (on && mode === "fight") { demoKit(); stats.count("sim.used"); }
    refreshHero(); refreshStatus(); refreshSettings(); refreshBook(); refreshPb();
  }
  function onReset() {
    stopTicker(); st.round = null; st.set = null;
    cel.dismissAll(); cel.hush(); view.closeRecap(); view.clearCall(); view.coach("");
    refreshAll();
  }

  // ---------------------------------------------------------------------------------------------- a round starts
  function onRoundStarted(d) {
    cel.dismissAll(); view.closeRecap();
    const s = S();
    if (!st.set || st.set.done) {
      const warm = d.preset === "warmup", demo = !!s.sim;
      st.set = {
        id: wall().toString(36), kind: warm ? "warmup" : callsOn() ? "coached" : "free", demo, kit: demo ? demoKit() : kit,
        startedAt: d.t, total: d.total, roundMs: d.roundMs, rounds: [], finished: 0, ringCounted: false, done: false, celebration: Promise.resolve(), won: false,
      };
      if (warm) {
        if (!firstWin.isDone()) { if (firstWin.state().active) firstWin.reset(); firstWin.start(); }
        stats.count("warmup.started");
      }
    }
    const set = st.set;
    const level = set.kit.xp.level;
    st.round = {
      n: d.n, startT: d.t, roundMs: d.roundMs, calls: [], call: null, flow: flowStart(), consumed: new Set(), livePb: new Set(), pendingCount: null,
      schedule: set.kind === "warmup" || !callsOn() ? [] : callSchedule({ roundMs: d.roundMs, level, dayKey: day(), roundNumber: d.n }),
      sawPunch: false, sawCombo: false, comboAnnounced: false, count: 0, easeOffered: false,
    };
    app().hooks.simBusy = callBusy;
    view.clearCall();
    lastPhaseKey = "";
    view.setStage(stageState(true));
    view.flow(FLOW.min, false);
    view.coach(set.kind === "warmup" ? COPY.coachMarks.start : !callsOn() ? COPY.call.off : COPY.call.ready);
    view.lastNote(null); view.tier(null);
    view.stageTally(0); view.stageProgress(0); view.easeOffer(false);
    view.beats(set.kind === "warmup" && firstWin.state().active ? { punch: false, combo: false, bell: false } : null);
    layout();
    view.showStage();                                  // the stage is where the eyes need to be: bring it to the top of the screen
    if (!st.ticker) startTicker();
    refreshStatus();
    view.announce(set.kind === "warmup" ? COPY.coachMarks.start : `Round ${d.n} of ${d.total}.`);
  }

  const stageState = (running) => ({ phase: phaseText(), callsOn: !st.set ? callsOn() : st.set.kind !== "warmup" && callsOn(), voiceOn: prefs.voice === "on", running });

  function phaseText() {
    const s = S(), set = st.set;
    if (!s.clock) return "";
    const ph = s.clock.phaseAt(now());
    if (set?.kind === "warmup") return COPY.grade.warmupRound;
    if (ph.phase === "rest") return `Rest · next round ${ph.n + 1}`;
    return `Round ${Math.max(1, ph.n)} of ${s.clock.cfg.rounds}`;
  }

  // ---------------------------------------------------------------------------------------------- the ticker
  function startTicker() { stopTicker(); st.ticker = setInterval(() => { try { tick(); } catch (e) { warn("tick", e); } }, 100); }
  function stopTicker() { if (st.ticker) clearInterval(st.ticker); st.ticker = null; }

  const lastPunches = () => S().punches.slice(-16);
  function callBusy() {
    const r = st.round;
    if (!r) return false;
    if (r.call) return true;
    const next = r.schedule[0];
    return !!next && now() - r.startT >= next.atMs - 2500;
  }

  function tick() {
    const r = st.round, set = st.set, s = S();
    if (!set || mode !== "fight") return;
    const t = now();
    const ph = s.clock ? s.clock.phaseAt(t) : null;
    if (ph) { setStagePhase(ph); view.stageTime(core().fmtClock(ph.remainingMs)); if (r && ph.phase === "round" && ph.phaseMs) view.stageProgress(ph.elapsedMs / ph.phaseMs); }
    if (!r) return;
    const elapsed = t - r.startT;
    // a round whose speed has fallen by more than a quarter offers to stop, once, in the coach line and on the Stop button (never a rule: the round carries on)
    if (!r.easeOffered && ph?.phase === "round" && elapsed > r.roundMs * 0.4 && r.count >= 12) {
      const fade = fadePct(S().punches.filter((p) => p.round === r.n));
      if (fade != null && fade > FADE_STOP_PCT) { r.easeOffered = true; view.easeOffer(true); view.coach(COPY.call.easeOffer); view.announce(COPY.call.easeOffer); }
    }
    if (r.call) {
      const c = r.call, ws = windowState(c, lastPunches(), t);
      const spoken = Math.min(c.nums.length, Math.floor((t - c.at) / CALL.countGapMs) + 1);
      let hits = 0;
      for (let i = 0; i < Math.min(ws.chain.length, c.nums.length); i++) { if (ws.chain[i].hand === handFor(c.nums[i], ws.chain[i].lead)) hits++; else break; }
      for (let i = 0; i < c.nums.length; i++) view.digit(i, i < hits ? "hit" : i < spoken ? "spoken" : "idle");
      const total = Math.max(1, ws.closeAt - c.at);
      view.ring((ws.closeAt - t) / total);
      if (ws.closed) closeCall(false);
    } else if (r.schedule.length && elapsed >= r.schedule[0].atMs && ph?.phase === "round") {
      openCall(r.schedule.shift());
    }
    // first win: nudge, then assist (the kit's two signals)
    if (firstWin.state().active && t - st.fwTick >= 1000) {
      st.fwTick = t;
      const f = firstWin.tick();
      if (f?.type === "nudge") view.coach(f.text);
      else if (f?.type === "assist" && !r.sawPunch) view.coach(COPY.coachMarks.assist);
    }
  }
  let lastPhaseKey = "";
  function setStagePhase(ph) {
    const key = `${ph.phase}:${ph.n}`;
    if (key === lastPhaseKey) return;
    lastPhaseKey = key;
    view.setStage(stageState(ph.phase === "round" || ph.phase === "rest"));
    if (ph.phase === "rest") view.coach(COPY.call.rest);
  }

  // ---------------------------------------------------------------------------------------------- coach calls
  function openCall(item) {
    const r = st.round;
    if (r.call) closeCall(true);
    const t = now(), nums = parseCall(item.call);
    r.call = { id: r.calls.length + 1, str: item.call, nums, at: t };
    const names = nums.map((n) => core().TYPE_NAMES[n]).join(" · ");
    view.showCall({ nums, names });
    view.reveal("call-banner");                        // a call is the one moment that cannot wait for a scroll
    view.stamp(null); view.countIt(false); r.pendingCount = null;
    view.coach(COPY.call.throw(names));
    cel.readout("callBlip");
    const words = nums.map((n) => COPY.digits[n]).join(", ");
    if (prefs.voice === "on") cel.say(`${words}!`);
    view.announce(COPY.call.announce(words));
    if (S().sim) { const resp = simResponse(item.call, simRng); cmd("simAnswer", { nums: resp.nums, delayMs: resp.delayMs }); }
  }

  function closeCall(force) {
    const r = st.round;
    if (!r?.call) return;
    const c = r.call, t = now();
    const ws = windowState(c, lastPunches(), force ? Infinity : t);
    const j = judge(c, ws.chain);
    r.call = null;
    const entry = { call: c.str, nums: c.nums, judgment: j.judgment, read: j.read, reason: j.reason, counted: false, chain: ws.chain.slice(0, c.nums.length) };
    r.calls.push(entry);
    for (const n of j.consumed) r.consumed.add(n);
    r.flow = flowStep(r.flow, j.judgment);
    view.flow(r.flow.mult, j.judgment === "good" || j.judgment === "missed");
    view.endCall();
    view.stamp(j.judgment, COPY.judgments[j.judgment].line);
    cel.judgmentSound(j.judgment);
    if (j.judgment === "perfect") cel.buzz("perfect");
    view.announce(COPY.a11y.stamp(COPY.judgments[j.judgment].name, COPY.judgments[j.judgment].line));
    stats.count(`call.${j.judgment}`);
    if (j.judgment === "count") {
      const used = r.calls.filter((x) => x.counted).length;
      r.pendingCount = entry;
      view.countIt(true, { text: COPY.call.read(j.read || "nothing", c.str), enabled: used < XP.countItMax });
      view.reveal("btn-countit");
    }
    view.coach(COPY.call.next);
  }

  /**
   * "Count it": the hands were right and the sensor read other types. It counts the combo for a flat +3, the same as a Good, and nothing else:
   * it never touches a punch's label. Labels are changed only by somebody reviewing them in the Punch Log (a flat 1 XP whether the choice
   * agrees or not), so no tap here pays more for saying the sensor was wrong.
   */
  function countIt() {
    const r = st.round ?? null;
    const entry = r?.pendingCount;
    if (!entry || entry.counted) return;
    if (r.calls.filter((x) => x.counted).length >= XP.countItMax) { view.countIt(true, { text: COPY.call.countItLimit, enabled: false }); return; }
    entry.counted = true;
    stats.count("countit.tap");
    view.countIt(true, { text: COPY.call.counted, enabled: false, counted: true });
    view.announce(`${COPY.call.counted}.`);
  }

  // ---------------------------------------------------------------------------------------------- a punch lands
  function onPunch(p) {
    const s = S(), set = st.set, r = st.round;
    cel.noteOnset(p.startT);
    view.punchPop(p.type);
    cel.punchSound(p.type);
    if (!r || !set) return;
    r.count++;
    view.stageTally(r.count);
    // coach marks and the first-win beats
    const warm = set.kind === "warmup";
    const steps = () => warm && firstWin.state().active && view.beats({ punch: r.sawPunch, combo: r.sawCombo, bell: false });
    if (!r.sawPunch) { r.sawPunch = true; if (firstWin.state().active) firstWin.event("punch"); if (warm) view.coach(COPY.coachMarks.punch); steps(); }
    const prev = s.punches[s.punches.length - 2];
    if (prev && prev.round === p.round && p.startT - prev.t <= CALL.chainGapMs && !r.sawCombo) {
      r.sawCombo = true;
      if (firstWin.state().active) firstWin.event("combo");
      if (warm) view.coach(COPY.coachMarks.combo);
      steps();
    }
    // speed tier and bests: only after the warm-up gate, and only against a best you already have
    const open = speedGateOpen({ t: p.startT, setStartT: set.startedAt, warmup: warm });
    const id = SPEED_PB_IDS[p.type], best = id ? set.kit.pb.best(id) : null;
    if (!open) { view.tier(null); view.lastNote(warm ? COPY.pb.gate : COPY.tiers.gated); }
    else {
      const tier = speedTier(p.peakV, best);
      view.tier(tier, p.type);
      if (!tier) view.lastNote(COPY.tiers.none);
      else if (tier.id === "easy") view.lastNote(COPY.tiers.easy.line());
      else view.lastNote(null);
      if (best != null && p.peakV > best && !r.livePb.has(p.type)) {
        r.livePb.add(p.type);
        view.lastNote(COPY.pb.live(p.type));
        view.announce(COPY.pb.live(p.type));
      }
    }
    // a call window may have just been answered in full
    if (r.call) {
      const ws = windowState(r.call, lastPunches(), now());
      if (ws.closed) closeCall(false);
    }
  }

  // ---------------------------------------------------------------------------------------------- a round ends
  function onRoundEnded(d) {
    const r = st.round, set = st.set;
    if (!r || !set || r.n !== d.n) return;
    if (r.call) closeCall(true);
    view.endCall();
    const s = S(), c = core();
    const punches = s.punches.filter((p) => p.round === r.n);
    const warm = set.kind === "warmup", roundMs = d.roundMs;
    const startT = r.startT, endT = Math.max(d.t, startT + 1);
    const completedFrac = Math.min(1, (endT - startT) / roundMs);
    const finished = !d.stopped && completedFrac >= XP.completeFrac;
    const longRound = warm || roundMs >= XP.minRoundMs;              // a round under a minute is a drill: no round, Strong Finish or session bonus, no weekly ring
    const combos = c.groupCombos(punches, c.DEFAULTS.comboGapMs);
    const freeList = combos.filter((x) => x.len >= 2 && x.punches.every((p) => !r.consumed.has(p.n)));
    const free = freeList.length;
    const grade = roundGrade({ punches, calls: r.calls, startT, endT, roundMs, warmup: warm, flowPeak: r.flow.peak });
    const roundsToday = roundsOnDay(set.kit.store.get(ROUNDS_KEY, null), day());
    const fullSession = finished && !warm && longRound && set.finished + 1 === set.total && d.n === set.total;
    const xp = roundXp({ warmup: warm, completedFrac, punches: punches.length, freeCombos: free, calls: r.calls, strongFinish: grade.strong, fullSession, roundsToday, roundMs });

    // the first win is the warm-up played: the clock ran out AND the sensor read enough punches for it to be a round (a bell with nothing thrown is not a win)
    const warmWon = warm && finished && punches.length >= XP.minPunches;
    let justWon = false;
    if (warmWon) { const was = firstWin.isDone(); firstWin.event("warmup.done"); justWon = !was && firstWin.isDone(); }
    if (justWon) { set.won = true; stats.count("first.win"); stats.firstWin(firstWin.state().timeToWinMs); }

    const bundle = {
      n: r.n, grade: grade.grade, score: grade.score, warmup: warm, punches: punches.length, strong: grade.strong, fadeBig: grade.fadeBig, free,
      perMin: d.summary?.perMin ?? (punches.length ? punches.length / ((endT - startT) / 60000) : null), meanV: d.summary?.meanV ?? mean(punches.map((p) => p.peakV)),
      xp: 0, chains: combos.filter((x) => x.len >= 2).map((x) => ({ str: x.str, len: x.len })), calls: r.calls.map((x) => ({ call: x.call, judgment: x.judgment })),
      comboStrings: new Set(combos.filter((x) => x.len >= 2).map((x) => x.str)), outcome: null, finished,
    };

    if (punches.length > 0) {
      try {
        const first = ["punch"];
        if (combos.some((x) => x.len >= 2)) first.push("combo");
        if (warmWon) first.push("warmup");
        if (!warm && finished && longRound) first.push("round");
        if (fullSession) first.push("session");
        if (r.calls.some((x) => ["good", "great", "perfect"].includes(x.judgment) || (x.judgment === "count" && x.counted))) first.push("called");
        if (r.calls.some((x) => x.judgment === "perfect")) first.push("perfect");
        const metrics = {};
        // the Combo Book: every combo landed (called as Good or better or counted, or thrown free) gets its page, any judgment
        const landed = [
          ...r.calls.filter((x) => ["perfect", "great", "good"].includes(x.judgment) || (x.judgment === "count" && x.counted)).map((x) => ({ str: x.call, judgment: x.judgment })),
          ...freeList.map((x) => ({ str: x.str, judgment: "free" })),
        ];
        const booked = bookAdd(set.kit.store.get(BOOK_KEY, {}), landed);
        set.kit.store.set(BOOK_KEY, booked.book);
        bundle.added = booked.added;
        const counts = bookCounts(booked.book);
        metrics.bookDistinct = counts.distinct; metrics.bookNamed = counts.named;
        if (!warm) {
          const gated = punches.filter((p) => speedGateOpen({ t: p.startT, setStartT: set.startedAt, warmup: false }));
          for (const [type, id] of Object.entries(SPEED_PB_IDS)) {
            const xs = gated.filter((p) => p.type === type).map((p) => p.peakV);
            if (xs.length) metrics[id] = Math.max(...xs);
          }
          if (finished) metrics.roundGrade = grade.score;
          if (r.calls.length) metrics.flow = r.flow.peak;
          const longest = Math.max(0, ...combos.map((x) => x.len));
          if (longest >= 2) metrics.longestChain = longest;
        }
        const ring = !warm && finished && longRound && !set.ringCounted;
        const extraXp = justWon && !set.demo ? [{ amount: XP.welcome, key: "welcome", once: true, source: "welcome", label: "Welcome Bonus" }] : [];
        const outcome = set.kit.completeSession({
          id: `${set.id}:r${r.n}`, at: wall(), durationMs: Math.round(endT - startT), baseXp: xp.total, metrics,
          counters: { rounds: finished ? 1 : 0, calledLanded: r.calls.filter((x) => ["good", "great", "perfect"].includes(x.judgment)).length, countedCombos: r.calls.filter((x) => x.counted).length },
          tags: warm ? ["warmup"] : [], first, countsTowardStreak: ring, extraXp,
        });
        if (ring) set.ringCounted = true;
        if (justWon && set.demo) set.kit.awardToParent({ amount: XP.welcome, key: "welcome", once: true, source: "welcome", label: "Welcome Bonus" });
        set.kit.store.set(ROUNDS_KEY, bumpDayCount(set.kit.store.get(ROUNDS_KEY, null), day()));
        bundle.outcome = outcome;
        bundle.xp = outcome.xp?.gained ?? xp.total;
        bundle.levelUp = !!outcome.xp?.levelUp;
        bundle.softened = !!outcome.xp?.applied?.some((a) => a.softened);
        set.celebration = cel.celebrateOutcome({ outcome, demo: set.demo });
      } catch (e) { warn("round", e); bundle.xp = xp.total; }
    }
    if (finished) set.finished++;
    stats.count("round.done");
    if (warmWon) stats.count("warmup.done");
    set.rounds.push(bundle);

    const fresh = bundle.added ?? [];
    const note = [
      xp.fullDay ? COPY.grade.day : grade.fadeBig ? COPY.grade.fade : punches.length && warm && finished && !warmWon ? COPY.grade.few : "",         // an empty round says so once, in the grade line
      bundle.softened && !xp.fullDay ? COPY.grade.softCap(XP.dayCap) : "",                // the soft cap shrinks a reward silently otherwise
      xp.short ? COPY.grade.short : "",
      fresh.length ? COPY.book.fresh(fresh.map((a) => a.name ?? a.str).join(", ")) : "",
      set.demo ? COPY.grade.demo : "",                                                   // the demo profile's XP and level are not the saved ones
    ].filter(Boolean).join(" ");
    if (fresh.some((a) => a.hidden)) cel.readout("alphabet");
    refreshBook(new Set(fresh.map((a) => a.str)));
    refreshPb();
    const { calls: callsPts, pace: pacePts, ...rest } = grade.parts;          // calls count in a called round, pace in free work: show the one that applies
    const winSecs = justWon ? Math.round((firstWin.state().timeToWinMs ?? 0) / 100) / 10 : null;
    view.gradeCard({
      grade: grade.grade, score: grade.score, xp: bundle.xp, strong: grade.strong, warmup: warm, empty: !punches.length, parts: grade.mode === "called" ? { calls: callsPts, ...rest } : { pace: pacePts, ...rest }, note,
      ...(justWon ? { ribbon: COPY.grade.firstWin(winSecs), line: COPY.grade.firstWinLine } : {}),
    });
    cel.readout("gradeSlam");
    if (grade.strong) cel.buzz("perfect");
    // the coach line never carries a stale cue past the bell
    view.coach(justWon ? COPY.coachMarks.won : warm && finished && !warmWon ? (punches.length ? COPY.coachMarks.few(punches.length) : COPY.coachMarks.empty) : "");
    view.easeOffer(false); view.beats(null);
    st.round = null;
    app().hooks.simBusy = null;
    refreshStatus(); refreshSettings(); layout();
  }

  // ---------------------------------------------------------------------------------------------- the set ends: recap
  async function finishSet(reason) {
    const set = st.set;
    if (!set || set.done) return;
    set.done = true;
    stopTicker();
    layout();
    view.setStage({ phase: reason === "done" ? "Done" : "Stopped", callsOn: false, running: false });
    if (reason === "stopped") view.coach(COPY.call.stopped);
    if (!set.rounds.length || set.rounds.every((r) => !r.punches)) return;     // nothing was read, so there is nothing to recap
    try { await set.celebration; } catch { /* the recap still opens */ }
    if (st.set !== set) return;                      // reset while the celebration played
    openRecap(set);
  }

  function setBundle(set) {
    const vk = set.kit, info = vk.xp.info();
    const all = set.rounds;
    const callsAll = all.flatMap((r) => r.calls), chainsAll = all.flatMap((r) => r.chains);
    const strings = new Set(all.flatMap((r) => [...r.comboStrings]));
    const speeds = all.filter((r) => r.meanV).map((r) => r.meanV);
    const heldPct = speeds.length > 1 ? Math.round((speeds.at(-1) / speeds[0]) * 100) : null;
    const week = weekState();
    const unlock = nextUnlock(info.level);
    return {
      cards: buildRecapCards({
        rounds: all.map((r) => ({ n: r.n, grade: r.grade, score: r.score, punches: r.punches, perMin: r.perMin, xp: r.xp, warmup: r.warmup })),
        best: bestMoment({ calls: callsAll, chains: chainsAll, allWarmup: all.every((r) => r.grade === "warmup") }),
        comboCount: strings.size, level: info.level, title: info.title, nextUnlock: unlock ? { level: unlock.level, label: unlock.label } : null,
        week: week ? { count: week.count, target: week.target, reached: week.reached } : null,
        heldPct, eased: all.some((r) => r.fadeBig), demo: set.demo, welcome: set.won ? XP.welcome : 0, resetsOnNew: false,
        label: { reviewed: set.reviewed?.size ?? 0, top: topMixup() },
      }),
      info,
    };
  }

  /**
   * The first date a weekly event on `day` (0 = Sunday) at `time` can start: today only if that is the day and the time has not passed. The kit
   * writes DTSTART from startDate and repeats on the chosen weekday, so a start date of "today" would add a stray one-off event today.
   */
  function nextWeekday(day, time) {
    const d = new Date(wall()), [hh, mm] = time.split(":").map(Number);
    const ahead = (day - d.getDay() + 7) % 7;
    const laterToday = ahead === 0 && (hh > d.getHours() || (hh === d.getHours() && mm > d.getMinutes()));
    d.setDate(d.getDate() + (ahead === 0 && !laterToday ? 7 : ahead));
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** A weekly calendar event the person downloads, at a day and time they pick. The calendar app does the reminding; nothing is sent. */
  function addReminder({ day, time } = {}) {
    if (!/^\d{1,2}:\d{2}$/.test(time ?? "") || !(day >= 0 && day <= 6)) { view.recapNote(COPY.reminder.bad); return null; }
    try {
      const ics = buildReminderIcs({ title: COPY.reminder.title, description: COPY.reminder.description, time, days: [day], startDate: nextWeekday(day, time), appName: "bag-work" });
      download(ics, "bag-work-session.ics", { doc: win.document, urlApi: win.URL });
      view.recapNote(COPY.reminder.done(COPY.reminder.days[day], time));
      return ics;
    } catch (e) { warn("reminder", e); view.recapNote(COPY.reminder.bad); return null; }
  }

  function openRecap(set = st.set) {
    if (!set?.rounds.length || mode !== "fight") return Promise.resolve();
    const { cards, info } = setBundle(set);
    stats.count("recap.opened");
    const warmOnly = set.kind === "warmup";
    const next = againIsCoached();
    view.reminder({ days: COPY.reminder.days, day: (new Date(wall()).getDay() + 2) % 7, onAdd: addReminder });
    return view.recap({
      cards, xpInfo: info,
      cta: { label: warmOnly ? (next ? COPY.recap.ctaCoach(S().settings.rounds, roundText()) : COPY.recap.cta.warm) : COPY.recap.cta.again },
      ask: shouldAsk(), note: COPY.recap.cleared,
      onCta: () => againAction(),
      onExport: () => win.document.getElementById("btn-export")?.click(),
      onFeedback: (c) => feedback(c),
    });
  }

  // ---------------------------------------------------------------------------------------------- feedback, stats, forget
  const lastFeedback = () => kit.store.get(FEEDBACK_KEY, []).at(-1)?.choice ?? null;
  function shouldAsk() {
    const answers = kit.store.get(FEEDBACK_KEY, []).length, sets = stats.snapshot().counts["recap.opened"] ?? 0;
    return answers === 0 || (sets > 0 && sets % 5 === 0 && answers < sets / 5);
  }
  function feedback(choice) {
    if (!["loved", "fine", "notForMe"].includes(choice)) return false;
    kit.store.update(FEEDBACK_KEY, (list) => [...list.slice(-49), { at: wall(), choice, winMs: firstWin.state().timeToWinMs ?? stats.snapshot().firstWinMs ?? null }], []);
    stats.count(`feedback.${choice}`);
    refreshSettings();
    return true;
  }
  function statsCsv() {
    const blob = new win.Blob([stats.csv()], { type: "text/csv" });
    const a = win.document.createElement("a");
    a.href = win.URL.createObjectURL(blob); a.download = "bag-work-fun-stats.csv"; a.click();
    setTimeout(() => win.URL.revokeObjectURL(a.href), 1000);
  }
  function forget() {
    if (!st.forgetArmed) {
      view.forgetLabel(true, false);
      st.forgetArmed = setTimeout(() => { st.forgetArmed = null; view.forgetLabel(false, false); }, 3000);
      return;
    }
    clearTimeout(st.forgetArmed); st.forgetArmed = null;
    if (S().clock?.running) cmd("stop");               // a round in progress ends through the normal events first: it must not be left running with no game behind it
    disarmClear();
    kit.reset(); dropDemo(); prefsStore.forget();
    prefs = prefsStore.load();
    applyPrefs();
    stopTicker(); st.set = null; st.round = null;
    cel.dismissAll(); view.closeRecap(); view.clearCall();
    refreshAll();
    view.forgetLabel(false, true);
  }

  // ---------------------------------------------------------------------------------------------- settings
  let themeMq = null;
  function resolveTheme() {
    const root = win.document.documentElement;
    if (root.dataset.fun === "off") return;
    root.dataset.theme = prefs.theme === "auto" ? (win.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : prefs.theme;
  }
  function applyPrefs() {
    cel.setMotion(prefs.motion === "auto" ? null : prefs.motion);
    cel.setSoundOn(prefs.sound === "on");
    resolveTheme();
    if (!prefs.voice || prefs.voice === "off") cel.hush();
  }
  function setting(key, value) {
    prefs = prefsStore.clean({ ...prefs, [key]: value });
    prefsStore.save(prefs);
    applyPrefs();
    if (key === "voice") view.setStage(stageState(!!S().clock?.running));
    if (key === "calls") refreshHero();
    if (key === "sound" && prefs.sound === "on") cel.unlockSound();
    refreshSettings();
  }
  function setMode(m) {
    const next = m === "lab" ? "lab" : "fight";
    if (next === mode) return;
    if (S().clock?.running) {                           // the game and the page's clock must stay in step: no view switch while a set runs, and the screen says why
      const text = COPY.mode.busy(next);
      if (mode === "fight") view.coach(text); else cmd("log", { text, cls: "warn" });
      view.announce(text);
      return;
    }
    mode = next;
    prefsStore.saveMode(next);
    view.mode(next);
    if (next === "lab") { stopTicker(); st.round = null; app().hooks.simBusy = null; cel.dismissAll(); cel.hush(); view.closeRecap(); }
    else refreshAll();
  }

  // ---------------------------------------------------------------------------------------------- start
  function start() {
    K.useSpeedUnit(() => S().unit);
    cel.bind({
      quiet: () => !!(S().clock?.running && S().clock.phaseAt(now()).phase === "round"),
      windowOpen: () => { const h = app().detector?.hands; return !!(h && (h.L.active || h.R.active)); },
      now,
    });
    cel.armSound();
    view.bind({
      hero: heroAction, sim: heroSim, warm: () => startWarmup(), stop: () => cmd("stop"), voice: () => setting("voice", prefs.voice === "on" ? "off" : "on"),
      countIt, recap: () => openRecap(), again: againAction, rounds: railStart,
      lab: () => view.lab(win.document.documentElement.dataset.lab !== "open"),
      setup: () => view.setup(win.document.documentElement.dataset.setup !== "open"),
      forget, statsCsv, mode: setMode, setting, feedback, goal: setGoal,
    });
    view.mode(mode); view.lab(false); view.setup(false);
    applyPrefs();
    // a CSV the person just exported is a copy of what a fresh start would clear
    try { win.document?.getElementById?.("btn-export")?.addEventListener?.("click", () => { st.exportedSig = labelSig().sig; disarmClear(); }); } catch { /* no page */ }
    if (unsaved()) view.announce(COPY.chip.unsaved);
    try { win.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (prefs.theme === "auto") resolveTheme(); }); } catch { /* an old browser */ }
    win.addEventListener("bwfun", (e) => { try { onEvent(e.detail || {}); } catch (err) { warn(e.detail?.type ?? "event", err); } });
    refreshAll();
    // read-only handle for the headless checks
    win.__bwFun = { firstWin, kit, stats, get set() { return st.set; }, get round() { return st.round; }, get prefs() { return prefs; }, get mode() { return mode; }, getDemoKit: demoKit };
    return api;
  }

  const api = { start, startWarmup, startCoached, again: againAction, railStart, openRecap, setting, setMode, feedback, forget, stats, firstWin, countIt, onEvent, addReminder, setGoal, dispose() { stopTicker(); clearTimeout(st.forgetArmed); st.forgetArmed = null; clearTimeout(st.clearArmed); st.clearArmed = null; cel.hush(); }, _tick: tick, _state: st };
  return api;
}
