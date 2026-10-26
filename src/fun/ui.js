// The Fight view's screens, drawn into the elements index.html already holds: status, hero, coach banner, stamps, round grade,
// recap sheet, settings. No game rules live here (session.js decides what happens); this file only turns decisions into
// pixels and turns taps into calls on the `actions` it is given. Every cue has its words and shape here; sounds are
// celebrate.js's job, and none of them is the only signal.
import { renderXpBar, renderRecapCarousel, countUp } from "../vendor/fun-kit/index.js";
import { COPY } from "./copy.js";
import { GRADES, JUDGMENTS, SPEED_TIERS } from "./config.js";
import { boardGroups, tierLit } from "./board.js";

const $ = (id) => document.getElementById(id);
const GLYPH = { diamond: "◆", circle: "●", triangle: "▲", square: "■", dash: "−" };
const glyph = (shape) => GLYPH[shape] ?? GLYPH.dash;
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
// toggleAttribute, not .hidden: an SVG element (the call ring) has no .hidden property, so setting it never showed the ring
const show = (el, on) => { if (el) el.toggleAttribute("hidden", !on); };
const pressed = (group, value) => group?.querySelectorAll("button").forEach((b) => { const on = b.dataset.v === value; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
const restartAnim = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
/** Scroll an element into place at once (never an animation: a call cannot wait for one). */
const jump = (el, block) => { try { el.scrollIntoView({ block, behavior: "instant" }); } catch { try { el.scrollIntoView({ block }); } catch { /* no scrolling here */ } } };

export function createView() {
  let actions = {};
  let live = { last: 0, timer: null, pending: null };
  let recapBase = "", warnText = "";

  // ---- screen reader announcements: at most one every three seconds, the latest wins
  function announce(text) {
    const el = $("fun-live");
    if (!el || !text) return;
    const nowT = Date.now(), wait = 3000 - (nowT - live.last);
    const put = (t) => { el.textContent = ""; el.textContent = t; live.last = Date.now(); live.pending = null; };
    if (wait <= 0) { clearTimeout(live.timer); put(text); return; }
    live.pending = text;
    clearTimeout(live.timer);
    live.timer = setTimeout(() => { if (live.pending) put(live.pending); }, wait);
  }

  // ---- status: level bar, week, the Simulate note
  function renderStatus({ info, week, demo, unsaved }) {
    const root = $("fun-status");
    if (!root) return;
    const chips = document.createElement("div");
    chips.className = "chips";
    const chip = (text, cls = "") => { const c = document.createElement("span"); c.className = `chip ${cls}`.trim(); c.textContent = text; chips.append(c); };
    chip(COPY.status.xp(info.total ?? 0));
    if (week) chip(week.reached ? COPY.status.weekDone : COPY.status.week(week.count, week.target), week.reached ? "on" : "");
    if (demo) chip(COPY.chip.simNote, "warn");
    if (unsaved) chip(COPY.chip.unsaved, "warn");
    root.replaceChildren(renderXpBar(info, { label: COPY.status.level }), chips);
  }

  // ---- hero
  function setHero({ first, coachText, detailText, sim, ready }) {
    setText($("hero-title"), first ? COPY.hero.title : COPY.hero.backTitle);
    setText($("hero-sub"), first ? COPY.hero.sub : COPY.hero.backSub);
    const w = $("hero-warmup"), s = $("hero-sim");
    if (w) { setText(w, first ? COPY.hero.warmup : coachText); w.dataset.kind = first ? "warmup" : "coach"; w.classList.toggle("primary", !!ready); }
    // the one-line detail under the buttons: what "Start a round" will run (only once the first win is done)
    const detail = $("hero-detail");
    if (detail) { setText(detail, first ? "" : detailText || ""); show(detail, !first && !!detailText); }
    // the teal button is the one that works right now: with no sensor and no Simulate that is Simulate, never a button that only shows a hint
    if (s) { setText(s, sim ? COPY.hero.simOn : first ? COPY.hero.sim : COPY.hero.simRound); s.setAttribute("aria-pressed", String(!!sim)); s.classList.toggle("primary", !ready); }
    const again = $("hero-warm");
    if (again) { setText(again, COPY.hero.again); show(again, !first); }
  }
  function hint(text) {
    const el = $("hero-hint");
    if (!el) return;
    el.textContent = text || "";
    show(el, !!text);
  }
  function layout({ hero, stage, grade, actions: act, recap: hasRecap = true, punches = 0 }) {
    const had = document.activeElement;
    document.documentElement.dataset.hero = hero ? "1" : "0";            // the timer settings card shows with the hero only: a set that is running or graded has locked them
    document.documentElement.dataset.punches = punches > 0 ? "1" : "0";    // the empty live cards (last punch, count, combos) stay away until there is a punch to show
    show($("fun-hero"), !!hero); show($("fun-stage"), !!stage); show($("fun-grade"), !!grade); show($("grade-actions"), !!act);
    show($("grade-recap"), hasRecap);                                         // a round with nothing read has nothing to recap
    document.documentElement.dataset.playing = stage ? "1" : "0";            // a phone screen is for the round while it runs (fun.css drops the status and header extras)
    // the control that had keyboard focus may just have been hidden: land on whatever replaced it, not on the top of the page
    if (had && had !== document.body && !had.getClientRects().length) focusPlay();
  }
  /** Keyboard focus to the part of the Play area that is showing (programmatic only: the cards are not tab stops). */
  function focusPlay() {
    const target = [$("fun-stage"), $("fun-grade"), $("fun-hero")].find((el) => el && !el.hidden);
    try { target?.focus({ preventScroll: true }); } catch { /* none */ }
  }
  /** The stage goes to the top of the screen when a round starts, so the call and the Count it button are where the eyes are. */
  function showStage() { const el = $("fun-stage"); if (el && !el.hidden) jump(el, "start"); }
  function showHero() { const el = $("fun-hero"); if (el && !el.hidden) jump(el, "nearest"); }
  /** Bring one element of the stage fully on screen if it is not (a call opening while the page is scrolled elsewhere). */
  function reveal(id) {
    const el = $(id);
    if (!el || el.hidden) return;
    const nav = document.querySelector("nav.sections"), top = nav ? nav.getBoundingClientRect().bottom : 0, vh = window.innerHeight;
    const fits = () => { const r = el.getBoundingClientRect(); return r.top >= top && r.bottom <= vh; };
    if (fits()) return;
    const stage = $("fun-stage");
    if (stage && !stage.hidden) jump(stage, "start");
    if (!fits()) jump(el, "nearest");
  }
  /** The two-tap warning before starting over would clear reviewed labels: text near whatever is on screen, and the buttons say "Tap again". */
  function clearWarn(text, againText) {
    const on = !!text;
    const gw = $("grade-warn"); if (gw) { gw.textContent = text || ""; show(gw, on); }
    const hh = $("hero-hint");
    if (on) { const hero = $("fun-hero"); if (hero && !hero.hidden) hint(text); warnText = text; }
    else { if (hh && warnText && hh.textContent === warnText) hint(null); warnText = ""; }
    const rn = $("recap-note"); if (rn && $("fun-recap")?.open) setText(rn, on ? text : recapBase);
    for (const id of ["grade-again", "recap-cta"]) {
      const b = $(id);
      if (!b) continue;
      if (on) { b.dataset.base ??= b.textContent; setText(b, againText); b.classList.add("confirm"); }
      else if (b.dataset.base != null) { setText(b, b.dataset.base); delete b.dataset.base; b.classList.remove("confirm"); }
    }
  }
  /** What the Play again button on the grade card says (Warm-up again until the first win has landed). */
  function againLabel(text) { const b = $("grade-again"); if (!b) return; if (b.dataset.base != null) b.dataset.base = text; else setText(b, text); }

  // ---- stage
  function setStage({ phase, callsOn, voiceOn, running }) {
    setText($("stage-phase"), phase);
    const v = $("stage-voice");
    if (v) { setText(v, voiceOn ? COPY.call.voiceOn : COPY.call.voiceOff); v.setAttribute("aria-pressed", String(!!voiceOn)); show(v, !!callsOn); }
    show($("stage-flow"), !!callsOn);
    const stop = $("stage-stop");
    if (stop) show(stop, !!running);
  }
  /** The round time on the stage; in the clock's last ten seconds it turns red and underlined (the page's own clock card decides when). */
  function stageTime(text) {
    const el = $("stage-time");
    if (!el) return;
    setText(el, text);
    el.dataset.warn = $("clock")?.classList.contains("warn") ? "1" : "0";
  }
  const stageTally = (n) => setText($("stage-tally"), COPY.stage.tally(n));
  /** How far through the round the clock is, as a bar (quiet: no sound, no celebration). */
  function stageProgress(frac) { const b = $("stage-bar"); if (b) b.style.width = `${Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)}%`; }
  /** The three first-win steps in the warm-up, ticking off as they land. Null hides them. */
  function beats(state) {
    const box = $("stage-beats");
    if (!box) return false;
    show(box, !!state);
    if (!state) return false;
    box.querySelectorAll(".beat").forEach((el) => {
      const done = !!state[el.dataset.b], label = COPY.stage.beats[el.dataset.b];
      el.dataset.done = done ? "1" : "0"; el.dataset.glyph = done ? "✓" : "○";
      setText(el, label);
      el.setAttribute("aria-label", `${label}, ${done ? COPY.stage.beatDone : COPY.stage.beatTodo}`);
    });
    return true;
  }
  /** A round whose speed fell by more than a quarter offers to stop: the Stop button says so (the round is never stopped for you). */
  function easeOffer(on) {
    const b = $("stage-stop");
    if (!b) return;
    b.classList.toggle("suggest", !!on);
    setText(b, on ? COPY.call.easeStop : COPY.call.stop);
  }
  /** The stage keeps its own copy of the last punch, so the answer to a punch is where the eyes already are. */
  function mirrorLast() {
    const t = $("last-type"), st = $("stage-last");
    if (st && t) { st.className = t.className.replace("pop", "").trim(); setText(st, t.textContent); }
    const hb = $("stage-hand"), lh = $("last-hand");
    if (hb && lh) { hb.className = lh.className; setText(hb, lh.textContent); hb.hidden = lh.hidden; }
    setText($("stage-speed"), $("last-speed")?.textContent ?? "—");
    setText($("stage-combo"), $("last-combo")?.textContent ?? "—");
  }
  /** A new round starts with a clean board: no leftover punch colour, ring or meter from the last one. */
  function resetHit() {
    const stage = $("fun-stage");
    if (stage) { delete stage.dataset.hit; stage.classList.remove("hit"); }
    $("hit-ring")?.classList.remove("go"); $("stage-speed")?.classList.remove("slam");
    const m = $("stage-meter"); if (m) { m.dataset.lit = "0"; show(m, false); }
  }
  const coach = (text) => setText($("coach-line"), text || "");
  function flow(mult, dim = false) {
    const el = $("stage-flow");
    if (!el) return;
    setText(el, COPY.flow.chip(mult));
    el.dataset.dim = dim ? "1" : "0";
    el.setAttribute("aria-label", COPY.flow.aria(mult));
  }

  function showCall({ nums, names }) {
    const d = $("call-digits");
    if (!d) return;
    d.replaceChildren(...nums.flatMap((n, i) => {
      const span = document.createElement("span");
      span.className = "n"; span.dataset.s = "idle"; span.textContent = String(n);
      if (!i) return [span];
      const sep = document.createElement("span");
      sep.className = "sep"; sep.textContent = "–";
      return [sep, span];
    }));
    setText($("call-names"), names);
    show($("call-banner"), true);
    $("call-banner")?.classList.remove("idle");
    show($("call-ring"), true);
    ring(1);
  }
  function digit(i, state) {
    const ns = $("call-digits")?.querySelectorAll(".n");
    if (ns?.[i]) ns[i].dataset.s = state;
  }
  function ring(frac) {
    const bar = $("ring-bar");
    if (bar) bar.style.setProperty("--off", String(Math.round((1 - Math.max(0, Math.min(1, frac))) * 100)));
  }
  function endCall() { show($("call-ring"), false); $("call-banner")?.classList.add("idle"); }
  function clearCall() {
    endCall();
    $("call-digits")?.replaceChildren();
    setText($("call-names"), "");
    show($("call-banner"), false);
    stamp(null); countIt(false);
  }

  function stamp(j, why = "") {
    const el = $("call-stamp");
    if (!el) return;
    if (!j) { show(el, false); el.replaceChildren(); return; }
    const meta = JUDGMENTS[j];
    el.dataset.j = j; el.dataset.glyph = glyph(meta.shape);
    const word = document.createElement("span"); word.textContent = COPY.judgments[j].name;
    el.replaceChildren(word);
    if (why) { const w = document.createElement("span"); w.className = "why"; w.textContent = why; el.append(w); }
    show(el, true);
    restartAnim(el, "stamp");
  }
  function countIt(on, { text = "", enabled = true, counted = false } = {}) {
    const el = $("countit");
    if (!el) return;
    show(el, !!on);
    setText($("countit-text"), text);
    const b = $("btn-countit");
    if (b) { b.disabled = !enabled; setText(b, counted ? COPY.call.counted : COPY.call.countIt); b.title = COPY.call.countItHelp; }
  }

  // ---- the last punch card
  let speedCount = null, lastWash = -Infinity;
  const WASH_GAP_MS = 340;           // the ring and the edge wash fire at most three times a second, however fast the punches come
  /**
   * The punch lands. The type chip and the combo pop, and on the stage the speed slams in with a ring that opens from behind it and a
   * quick wash along the card's edge, all in the colour of the punch type (that colour stays as a static cue after the motion, and
   * under reduced motion the motion goes and the colour, the words and the number stay). Transform and opacity only, once per punch.
   */
  function punchPop(type) {
    const stage = $("fun-stage");
    document.documentElement.dataset.punches = "1";
    restartAnim($("last-type"), "pop");
    restartAnim($("combo-cur"), "pop");
    mirrorLast();
    if (stage && type) stage.dataset.hit = type;
    restartAnim($("stage-last"), "pop");
    restartAnim($("stage-speed"), "slam");
    const t = Date.now();
    if (t - lastWash >= WASH_GAP_MS) { lastWash = t; restartAnim($("hit-ring"), "go"); restartAnim(stage, "hit"); }
    if (type) restartAnim(document.querySelector(`#type-bars .tb.pt-${type} .fill`), "flash");       // the bar of that punch type flashes once
    // the speed counts up to its value for a moment while it slams (the kit jumps straight to it under reduced motion)
    const el = $("stage-speed"), to = parseFloat($("last-speed")?.textContent ?? "");
    speedCount?.cancel();
    speedCount = el && Number.isFinite(to) ? countUp(el, to, { from: 0, duration: 180, format: (v) => v.toFixed(1) }) : null;
  }
  function tier(t, type) {
    for (const id of ["last-tier", "stage-tier"]) {
      const el = $(id);
      if (!el) continue;
      if (!t) { show(el, false); continue; }
      const meta = COPY.tiers[t.id];
      el.dataset.t = t.id; el.dataset.glyph = `${glyph(t.shape)} `;
      el.textContent = meta.name;
      el.title = meta.line(type, t.pct);
      show(el, true);
    }
    // the four-step meter beside the stage's tier chip: Easy lights one step, Snap all four (the word and the shape stay the signal)
    const m = $("stage-meter");
    if (m) { m.dataset.lit = String(tierLit(t?.id)); m.dataset.t = t?.id ?? ""; show(m, !!t); }
  }
  function lastNote(text) {
    const el = $("last-note");
    if (!el) return;
    el.textContent = text || "";
    show(el, !!text);
  }

  // ---- the Combo Book
  const BEST_SHAPE = { free: "dash", count: "square", good: "triangle", great: "circle", perfect: "diamond" };
  function book({ pages, counts, own, fresh, show: on }) {
    const card = $("card-book");
    if (!card) return;
    show(card, !!on);
    if (!on) return;
    const list = $("book-list");
    list?.replaceChildren(...pages.map((p) => {
      const li = document.createElement("li"); li.className = "book-page";
      li.dataset.locked = p.entry ? "0" : "1"; li.dataset.new = fresh?.has(p.str) ? "1" : "0";
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = p.name;
      const str = document.createElement("span"); str.className = "str"; str.textContent = p.str;
      const best = document.createElement("span"); best.className = "best";
      if (p.entry) { best.dataset.glyph = glyph(BEST_SHAPE[p.entry.best]); best.textContent = `${COPY.book.times(p.entry.count)} · ${COPY.book.best[p.entry.best]}`; }
      else { best.dataset.glyph = glyph("dash"); best.textContent = COPY.book.locked; }
      li.setAttribute("aria-label", COPY.book.aria(p.name, p.str, p.entry ? best.textContent : COPY.book.locked));
      li.append(nm, str, best);
      return li;
    }));
    setText($("book-tag"), COPY.book.tag(counts.named, counts.total - 1 + (pages.some((p) => p.hidden) ? 1 : 0)));
    setText($("book-note"), own > 0 ? COPY.book.own(own) : COPY.book.note);
  }

  // ---- your bests: the board (the speed values arrive already formatted for the m/s or mph choice)
  function pbShelf({ items, show: on }) {
    const card = $("card-pb");
    if (!card) return;
    show(card, !!on);
    if (!on) return;
    const { speeds, marks } = boardGroups(items);
    const span = (cls, text) => { const e = document.createElement("span"); e.className = cls; e.textContent = text; return e; };
    const cell = (kind, o) => {
      const li = document.createElement("li");
      li.className = `pb-cell ${kind}${o.type ? ` pt-${o.type}` : ""}`; li.dataset.kind = kind;
      li.append(span("nm", o.label), span("val", o.value), ...(o.unit ? [span("unit", o.unit)] : []));
      return li;
    };
    $("pb-list")?.replaceChildren(...speeds.map((o) => cell("speed", o)), ...marks.map((o) => cell("mark", o)));
  }

  // ---- round grade
  function gradeCard(g) {
    const stampEl = $("grade-stamp");
    if (stampEl) {
      stampEl.dataset.g = g.grade; stampEl.dataset.glyph = glyph(GRADES.find((x) => x.id === g.grade)?.shape);
      stampEl.textContent = COPY.grade.names[g.grade];
      restartAnim(stampEl, "grade-stamp");
    }
    setText($("grade-tag"), g.warmup ? COPY.grade.warmupRound : g.empty ? "" : `${g.score} / 100`);
    const xpEl = $("grade-xp");
    if (xpEl) countUp(xpEl, g.xp, { format: (v) => COPY.grade.xp(Math.round(v)), duration: 700 });
    setText($("grade-line"), g.line ?? (g.empty ? COPY.grade.empty : COPY.grade.lines[g.grade]));
    const rb = $("grade-ribbon");
    if (rb) { rb.textContent = g.ribbon ?? COPY.grade.strong; rb.title = g.ribbon ? "" : COPY.grade.strongLine; show(rb, !!(g.ribbon || g.strong)); }
    const parts = $("grade-parts");
    if (parts) {
      parts.replaceChildren(...Object.entries(g.parts ?? {}).filter(([, v]) => v != null).map(([k, v]) => {
        const d = document.createElement("div"); d.className = "gp";
        const b = document.createElement("b"); b.textContent = String(Math.round(v));
        d.append(b, document.createTextNode(COPY.grade.parts[k] ?? k));
        return d;
      }));
    }
    setText($("grade-note"), g.note || "");
    announce(COPY.grade.aria(COPY.grade.names[g.grade], g.score, g.xp));
  }

  // ---- recap sheet
  function recap({ cards, cta, ask, note, onCta, onLater, onExport, onClose, onFeedback, xpInfo }) {
    const dlg = $("fun-recap");
    if (!dlg) return Promise.resolve();
    let finish = () => {}, closed = false;
    const done = new Promise((resolve) => { finish = resolve; });
    const close = () => {
      if (closed) return;
      closed = true;
      try { if (dlg.open) dlg.close(); } catch { dlg.removeAttribute("open"); }
      finish(); onClose?.();
    };
    const carousel = renderRecapCarousel(cards, { labels: { slide: "{n} of {total}", recapRegion: COPY.recap.aria } });
    const first = carousel.querySelector(".fk-recap-card");
    const roundsCard = cards[0];
    if (first && roundsCard?.rounds?.length > 1) {
      const maxRate = Math.max(1, ...roundsCard.rounds.map((r) => r.perMin ?? 0));
      const bars = document.createElement("div"); bars.className = "rounds-bars";
      for (const r of roundsCard.rounds) {
        const rb = document.createElement("div"); rb.className = "rb";
        const bar = document.createElement("div"); bar.className = "bar"; bar.style.setProperty("--h", String(Math.max(0.12, (r.perMin ?? 0) / maxRate)));
        const g = document.createElement("div"); g.className = "g"; g.dataset.glyph = glyph(r.glyph); g.textContent = COPY.grade.names[r.grade];
        const lab = document.createElement("div"); lab.textContent = `R${r.n}`;
        rb.append(bar, g, lab); bars.append(rb);
      }
      first.append(bars);
    }
    if (first && roundsCard?.rounds?.length) {
      if (xpInfo) { const x = document.createElement("div"); x.className = "recap-xp"; x.append(renderXpBar(xpInfo, { label: COPY.status.level })); first.append(x); }
    }
    $("recap-body")?.replaceChildren(carousel);
    setText($("recap-title"), COPY.recap.title);
    // the CTA may be waiting for a second tap (starting over would clear reviewed labels): then the sheet stays open
    const cb = $("recap-cta"); if (cb) { delete cb.dataset.base; cb.classList.remove("confirm"); setText(cb, cta.label); cb.onclick = () => { const go = onCta?.(); if (go === false) return; close(); focusPlay(); }; }
    const lb = $("recap-later"); if (lb) { setText(lb, COPY.recap.cta.later); lb.onclick = () => { close(); onLater?.(); }; }
    const eb = $("recap-export"); if (eb) { setText(eb, COPY.recap.export); eb.onclick = () => onExport?.(); }
    const xb = $("recap-close"); if (xb) xb.onclick = () => close();
    recapBase = note || "";
    setText($("recap-note"), recapBase);
    const fb = $("recap-feedback");
    show(fb, !!ask);
    if (fb && ask) {
      setText($("fb-ask"), COPY.feedback.ask);
      pressed($("seg-recap-fb"), null);
      $("seg-recap-fb")?.querySelectorAll("button").forEach((b) => { b.onclick = () => { pressed($("seg-recap-fb"), b.dataset.v); onFeedback?.(b.dataset.v); setText($("recap-note"), COPY.feedback.thanks); }; });
    }
    dlg.onclose = () => close();                       // Esc closes the dialog natively; the promise settles either way
    try { if (!dlg.open) dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
    announce(COPY.recap.aria);
    return done;
  }
  const recapNote = (text) => setText($("recap-note"), text || "");
  const closeRecap = () => { const d = $("fun-recap"); try { if (d?.open) d.close(); } catch { d?.removeAttribute("open"); } };

  // ---- calendar reminder (an .ics the person downloads: the calendar app does the reminding)
  function reminder({ days, day, onAdd }) {
    const sel = $("ics-day");
    if (sel) {
      sel.replaceChildren(...days.map((name, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = name; return o; }));
      sel.value = String(day);
    }
    const b = $("ics-add");
    if (b) b.onclick = () => onAdd?.({ day: Number($("ics-day")?.value), time: $("ics-time")?.value });
    setText($("ics-summary"), COPY.reminder.summary);
  }

  // ---- settings
  function settings({ prefs, stats, firstWinMs, feedback, goal, goalNote }) {
    pressed($("seg-motion"), prefs.motion); pressed($("seg-sound"), prefs.sound); pressed($("seg-voice"), prefs.voice);
    pressed($("seg-calls"), prefs.calls); pressed($("seg-theme"), prefs.theme);
    if (goal) pressed($("seg-goal"), String(goal.target));
    setText($("goal-note"), goalNote || COPY.goal.help);
    pressed($("seg-feedback"), feedback ?? null);
    setText($("fb-note"), feedback ? `${COPY.feedback.settingsHelp} ${COPY.feedback.last(COPY.feedback[feedback] ?? feedback)}` : COPY.feedback.settingsHelp);
    const c = stats?.counts ?? {};
    const fw = firstWinMs != null ? COPY.settings.firstWin(Math.round(firstWinMs / 100) / 10) : COPY.settings.firstWinNone;
    setText($("stats-line"), `${fw} · ${c["warmup.done"] ?? 0} warm-ups · ${c["round.done"] ?? 0} rounds`);
  }
  function mode(m) {
    const root = document.documentElement;
    root.dataset.mode = m;
    pressed($("mode-seg"), null);
    document.querySelectorAll("#mode-seg button").forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  function lab(open) {
    document.documentElement.dataset.lab = open ? "open" : "closed";
    const b = $("btn-lab");
    if (b) { b.setAttribute("aria-expanded", String(!!open)); b.textContent = open ? COPY.lab.toggleClose : COPY.lab.toggleOpen; }
  }
  function setup(open) {
    document.documentElement.dataset.setup = open ? "open" : "closed";
    const b = $("btn-setup");
    if (b) { b.setAttribute("aria-expanded", String(!!open)); b.textContent = open ? COPY.setup.close : COPY.setup.open; }
  }

  // ---- wiring
  function bind(a) {
    actions = a;
    const on = (id, fn) => $(id)?.addEventListener("click", fn);
    on("hero-warmup", () => actions.hero?.());
    on("hero-sim", () => actions.sim?.());
    on("hero-warm", () => actions.warm?.());
    on("stage-voice", () => actions.voice?.());
    on("stage-stop", () => actions.stop?.());
    on("btn-countit", () => actions.countIt?.());
    $("btn-rounds")?.addEventListener("click", (e) => actions.rounds?.(e), true);          // capture: the Fight view may answer before the page's own handler starts a silent round
    on("grade-recap", () => actions.recap?.());
    on("grade-again", () => actions.again?.());
    on("btn-lab", () => actions.lab?.());
    on("btn-setup", () => actions.setup?.());
    on("btn-forget", () => actions.forget?.());
    on("btn-stats", () => actions.statsCsv?.());
    document.querySelectorAll("#mode-seg button").forEach((b) => b.addEventListener("click", () => actions.mode?.(b.dataset.mode)));
    for (const [id, key] of [["seg-motion", "motion"], ["seg-sound", "sound"], ["seg-voice", "voice"], ["seg-calls", "calls"], ["seg-theme", "theme"]]) {
      $(id)?.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => actions.setting?.(key, b.dataset.v)));
    }
    $("seg-feedback")?.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => actions.feedback?.(b.dataset.v)));
    $("seg-goal")?.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => actions.goal?.(Number(b.dataset.v))));
  }
  function forgetLabel(armed, done) {
    const b = $("btn-forget");
    if (b) { b.classList.toggle("confirm", !!armed); setText(b, armed ? COPY.settings.forgetConfirm : COPY.settings.forget); }
    setText($("forget-note"), done ? COPY.settings.forgot : "");
  }

  return {
    bind, announce, renderStatus, setHero, hint, layout, focusPlay, showStage, showHero, reveal, clearWarn, againLabel, setStage, coach, flow, showCall, digit, ring, endCall, clearCall, stamp, countIt,
    stageTally, stageProgress, beats, easeOffer,
    punchPop, mirrorLast, resetHit, stageTime, tier, lastNote, book, pbShelf, gradeCard, reminder, recap, recapNote, closeRecap, settings, mode, lab, setup, forgetLabel,
    tierNames: SPEED_TIERS.map((t) => t.id),
  };
}
