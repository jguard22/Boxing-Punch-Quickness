// The Fight view's screens, drawn into the elements index.html already holds: status, hero, coach banner, stamps, round grade,
// recap sheet, settings. No game rules live here (session.js decides what happens); this file only turns decisions into
// pixels and turns taps into calls on the `actions` it is given. Every cue has its words and shape here; sounds are
// celebrate.js's job, and none of them is the only signal.
import { renderXpBar, renderRecapCarousel, countUp } from "../vendor/fun-kit/index.js";
import { COPY } from "./copy.js";
import { GRADES, JUDGMENTS, SPEED_TIERS } from "./config.js";

const $ = (id) => document.getElementById(id);
const GLYPH = { diamond: "◆", circle: "●", triangle: "▲", square: "■", dash: "−" };
const glyph = (shape) => GLYPH[shape] ?? GLYPH.dash;
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const show = (el, on) => { if (el) el.hidden = !on; };
const pressed = (group, value) => group?.querySelectorAll("button").forEach((b) => { const on = b.dataset.v === value; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
const restartAnim = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

export function createView() {
  let actions = {};
  let live = { last: 0, timer: null, pending: null };

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
  function renderStatus({ info, week, demo }) {
    const root = $("fun-status");
    if (!root) return;
    const chips = document.createElement("div");
    chips.className = "chips";
    const chip = (text, cls = "") => { const c = document.createElement("span"); c.className = `chip ${cls}`.trim(); c.textContent = text; chips.append(c); };
    chip(COPY.status.xp(info.total ?? 0));
    if (week) chip(week.reached ? COPY.status.weekDone : COPY.status.week(week.count, week.target), week.reached ? "on" : "");
    if (demo) chip(COPY.chip.simNote, "warn");
    root.replaceChildren(renderXpBar(info, { label: COPY.status.level }), chips);
  }

  // ---- hero
  function setHero({ first, coachText, sim }) {
    setText($("hero-title"), first ? COPY.hero.title : COPY.hero.backTitle);
    setText($("hero-sub"), first ? COPY.hero.sub : COPY.hero.backSub);
    const w = $("hero-warmup"), s = $("hero-sim");
    if (w) { setText(w, first ? COPY.hero.warmup : coachText); w.dataset.kind = first ? "warmup" : "coach"; }
    if (s) { setText(s, sim ? COPY.hero.simOn : COPY.hero.sim); s.setAttribute("aria-pressed", String(!!sim)); }
    const again = $("hero-warm");
    if (again) { setText(again, COPY.hero.again); show(again, !first); }
  }
  function hint(text) {
    const el = $("hero-hint");
    if (!el) return;
    el.textContent = text || "";
    show(el, !!text);
  }
  function layout({ hero, stage, grade, actions: act }) {
    show($("fun-hero"), !!hero); show($("fun-stage"), !!stage); show($("fun-grade"), !!grade); show($("grade-actions"), !!act);
  }

  // ---- stage
  function setStage({ phase, callsOn, voiceOn, running }) {
    setText($("stage-phase"), phase);
    const v = $("stage-voice");
    if (v) { setText(v, voiceOn ? COPY.call.voiceOn : COPY.call.voiceOff); v.setAttribute("aria-pressed", String(!!voiceOn)); show(v, !!callsOn); }
    show($("stage-flow"), !!callsOn);
    const stop = $("stage-stop");
    if (stop) show(stop, !!running);
  }
  const stageTime = (text) => setText($("stage-time"), text);
  /** The stage keeps its own copy of the last punch, so the answer to a punch is where the eyes already are. */
  function mirrorLast() {
    const t = $("last-type"), st = $("stage-last");
    if (st && t) { st.className = t.className.replace("pop", "").trim(); setText(st, t.textContent); }
    setText($("stage-speed"), $("last-speed")?.textContent ?? "—");
    setText($("stage-combo"), $("last-combo")?.textContent ?? "—");
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
  function punchPop() {
    restartAnim($("last-type"), "pop");
    restartAnim($("combo-cur"), "pop");
    mirrorLast();
    restartAnim($("stage-last"), "pop");
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
  }
  function lastNote(text) {
    const el = $("last-note");
    if (!el) return;
    el.textContent = text || "";
    show(el, !!text);
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
    setText($("grade-line"), g.empty ? COPY.grade.empty : COPY.grade.lines[g.grade]);
    const rb = $("grade-ribbon");
    if (rb) { rb.textContent = COPY.grade.strong; rb.title = COPY.grade.strongLine; show(rb, !!g.strong); }
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
    const carousel = renderRecapCarousel(cards, { labels: { slide: "{n} of {total}", recapRegion: COPY.recap.aria } });
    const first = carousel.querySelector(".fk-recap-card");
    const roundsCard = cards[0];
    if (first && roundsCard?.rounds?.length) {
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
      if (xpInfo) { const x = document.createElement("div"); x.className = "recap-xp"; x.append(renderXpBar(xpInfo, { label: COPY.status.level })); first.append(x); }
    }
    $("recap-body")?.replaceChildren(carousel);
    setText($("recap-title"), COPY.recap.title);
    const cb = $("recap-cta"); if (cb) { setText(cb, cta.label); cb.onclick = () => { close(); onCta?.(); }; }
    const lb = $("recap-later"); if (lb) { setText(lb, COPY.recap.cta.later); lb.onclick = () => { close(); onLater?.(); }; }
    const eb = $("recap-export"); if (eb) { setText(eb, COPY.recap.export); eb.onclick = () => onExport?.(); }
    const xb = $("recap-close"); if (xb) xb.onclick = () => close();
    setText($("recap-note"), note || "");
    const fb = $("recap-feedback");
    show(fb, !!ask);
    if (fb && ask) {
      setText($("fb-ask"), COPY.feedback.ask);
      pressed($("seg-recap-fb"), null);
      $("seg-recap-fb")?.querySelectorAll("button").forEach((b) => { b.onclick = () => { pressed($("seg-recap-fb"), b.dataset.v); onFeedback?.(b.dataset.v); setText($("recap-note"), COPY.feedback.thanks); }; });
    }
    return new Promise((resolve) => {
      let closed = false;
      function close() { if (closed) return; closed = true; try { dlg.close(); } catch { dlg.removeAttribute("open"); } resolve(); onClose?.(); }
      dlg.onclose = () => { if (!closed) { closed = true; resolve(); onClose?.(); } };
      dlg.oncancel = () => { /* Esc closes through onclose */ };
      try { if (!dlg.open) dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
      announce(COPY.recap.aria);
    });
  }
  const closeRecap = () => { const d = $("fun-recap"); try { if (d?.open) d.close(); } catch { d?.removeAttribute("open"); } };

  // ---- settings
  function settings({ prefs, stats, firstWinMs, feedback }) {
    pressed($("seg-motion"), prefs.motion); pressed($("seg-sound"), prefs.sound); pressed($("seg-voice"), prefs.voice);
    pressed($("seg-calls"), prefs.calls); pressed($("seg-theme"), prefs.theme);
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
  }
  function forgetLabel(armed, done) {
    const b = $("btn-forget");
    if (b) { b.classList.toggle("confirm", !!armed); setText(b, armed ? COPY.settings.forgetConfirm : COPY.settings.forget); }
    setText($("forget-note"), done ? COPY.settings.forgot : "");
  }

  return {
    bind, announce, renderStatus, setHero, hint, layout, setStage, coach, flow, showCall, digit, ring, endCall, clearCall, stamp, countIt,
    punchPop, mirrorLast, stageTime, tier, lastNote, gradeCard, recap, closeRecap, settings, mode, lab, setup, forgetLabel,
    tierNames: SPEED_TIERS.map((t) => t.id),
  };
}
