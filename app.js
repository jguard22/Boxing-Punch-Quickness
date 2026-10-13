/* Brilliant Wear — Boxing Punch Quickness Demo
   Two wrist-worn Sense units (+ optional insoles). Wrist linear acceleration →
   punch windows → integrated peak hand speed → auto punch type (jab / cross /
   hook / uppercut) → combos, rounds, weight transfer, fatigue and a confusion
   matrix from the labels you correct.

   Detection / classification / stats live in core.js (BPCore, unit-tested in
   node). This file is the UI, the clock, the audio, CSV, the SDK adapter and
   the Simulate engine. Every hardware touchpoint is in SDKAdapter (TODO[SDK]
   marks event names to verify on real hardware). Speeds are stored and
   exported in m/s; only the display converts to mph. */

(() => {
  "use strict";
  const C = window.BPCore;
  const { TYPES } = C;

  const CFG = { ...C.DEFAULTS, goDelayMinMs: 1200, goDelayMaxMs: 3200, tableRows: 60, simPumpMs: 4, insoleHoldMs: 1500, simAmbiguous: 0.12 };

  const S = {
    stance: "orthodox",          // orthodox: L lead · southpaw: R lead
    unit: "ms",                  // display only: "ms" | "mph"
    punches: [], combos: [],
    rounds: [],                  // [{n, startT, endT|null}]
    clock: null, sessionDone: false,
    settings: { roundMin: 3, restMin: 1, rounds: 3 },
    persisted: { roundMin: 3, restMin: 1, rounds: 3 },   // what localStorage holds (URL overrides never land here)
    urlKeys: new Set(),                                  // settings currently overridden by ?round= / ?rest= / ?rounds=
    bell: true,
    go: { armed: false, at: null, timer: null, best: null },
    insole: { buf: [], load: { left: 0, right: 0 }, last: { left: -Infinity, right: -Infinity } },
    sim: false, simInsoles: true, simTruth: true,
    audio: null, tableDirty: false, resetTimer: null, tick: 0,
  };
  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const lead = () => (S.stance === "orthodox" ? "L" : "R");
  const leadSide = () => (lead() === "L" ? "left" : "right");
  const fs = (v, d = 1) => C.fmtSpeed(v, S.unit, d);
  const sgn = (v, d = 0) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
  const pct = (v, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);

  function log(msg, cls = "") {
    const el = $("log");
    el.insertAdjacentHTML("afterbegin", `<div class="${cls}">${new Date().toLocaleTimeString()} — ${msg}</div>`);
    while (el.childElementCount > 200) el.lastElementChild.remove();
  }

  // ---------- per-browser prefs (units, timer settings) ----------
  const PREF_KEY = "bw-boxing-prefs-v1";
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (p.unit === "ms" || p.unit === "mph") S.unit = p.unit;
      if (p.settings) Object.assign(S.settings, p.settings);
      if (typeof p.bell === "boolean") S.bell = p.bell;
    } catch { /* storage unavailable */ }
    S.persisted = { ...S.settings };
    // ?round=0.15&rest=0.05&rounds=3&unit=mph (handy for demos / tests). Timer overrides apply to
    // this page load only: they are never written to localStorage, so a demo link cannot change
    // the defaults you get next time. Editing the field on the page makes it yours (see below).
    const q = new URLSearchParams(location.search);
    for (const [param, key] of [["round", "roundMin"], ["rest", "restMin"], ["rounds", "rounds"]]) {
      if (q.get(param)) { S.settings[key] = Number(q.get(param)); S.urlKeys.add(key); }
    }
    if (q.get("unit") === "mph" || q.get("unit") === "ms") S.unit = q.get("unit");
  }
  function savePrefs() {
    const settings = { ...S.settings };
    for (const k of S.urlKeys) settings[k] = S.persisted[k];
    S.persisted = settings;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ unit: S.unit, settings, bell: S.bell })); } catch { /* ignore */ }
  }

  // ---------- detection → punch records ----------
  const detector = C.createDetector({ cfg: CFG, getLead: lead, onPunch: handlePunch });

  function insolePresent() {
    const t = now();
    return t - S.insole.last.left < CFG.insoleHoldMs && t - S.insole.last.right < CFG.insoleHoldMs;
  }
  function onLoad(side, v, t) {
    S.insole.load[side] = v;
    S.insole.last[side] = t;
    S.insole.buf.push([t, S.insole.load.left, S.insole.load.right]);
    while (S.insole.buf.length && t - S.insole.buf[0][0] > 3000) S.insole.buf.shift();
  }

  function handlePunch(raw) {
    const prev = S.punches[S.punches.length - 1];
    const ph = S.clock ? S.clock.phaseAt(raw.startT) : null;
    const p = {
      ...raw, n: S.punches.length + 1, trueType: null,
      gapMs: prev ? Math.max(0, Math.round(raw.startT - prev.t)) : null,
      round: ph && ph.phase === "round" ? ph.n : 0,
      shiftPp: null, frontPct: null,
    };
    if (insolePresent()) {
      const w = C.weightShift(S.insole.buf, raw.startT, raw.t, raw.lead === "L" ? "left" : "right", CFG);
      if (w) { p.shiftPp = w.shiftPp; p.frontPct = w.frontPct; }
    }
    if (S.sim && S.simTruth) {                       // generator knows what it threw
      const q = Sim.expect[raw.hand];
      while (q.length && q[0].t < raw.startT - 300) q.shift();
      if (q.length && Math.abs(q[0].t - raw.startT) < 300) p.trueType = q.shift().truth;
    }
    S.punches.push(p);
    if (S.go.at != null) {
      const r = Math.round(raw.t - S.go.at);
      S.go.at = null;
      S.go.best = S.go.best == null ? r : Math.min(S.go.best, r);
      $("react-ms").textContent = r;
      $("react-best").textContent = S.go.best;
      $("go-light").className = "go-light";
      $("btn-go").classList.remove("armed");
    }
    renderAll();
  }

  // ---------- rendering ----------
  let session = null;
  const buildSess = (nowT = now()) => C.buildSession(S.punches, S.rounds, nowT, { roundMs: S.clock?.cfg.roundMs });
  const effType = C.effType;

  function renderUnits() {
    document.querySelectorAll(".u-speed").forEach((e) => { e.textContent = C.speedLabel(S.unit); });
    document.querySelectorAll("#units-seg button").forEach((b) => {
      const on = b.dataset.unit === S.unit;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function renderAll() {
    S.combos = C.annotateCombos(S.punches, CFG.comboGapMs);
    session = buildSess();
    renderLive();
    renderCombos();
    renderWeight();
    renderTable();
    renderStats();
  }
  // the parts that also change with the clock (open round duration)
  function renderStats() {
    if (!session || S.tick % 10 === 0) session = buildSess();
    renderRounds();
    renderFatigue();
    renderConfusion();
    renderSummary();
  }

  function renderLive() {
    const last = S.punches[S.punches.length - 1];
    const t = session.total;
    if (!last) {
      $("last-type").textContent = "—"; $("last-type").className = "badge pt-jab";
      $("last-hand").hidden = true;
      for (const id of ["last-speed", "last-g", "last-combo"]) $(id).textContent = "—";
    } else {
      const type = effType(last);
      $("last-type").textContent = type.toUpperCase();
      $("last-type").className = `badge pt-${type}`;
      const hb = $("last-hand");
      hb.hidden = false; hb.textContent = last.hand; hb.className = `badge sm hand-badge hand-${last.hand}`;
      $("last-speed").textContent = fs(last.peakV);
      $("last-g").textContent = last.peakG.toFixed(1);
      $("last-combo").textContent = S.combos[last.combo - 1]?.str ?? "—";
    }
    $("count-total").textContent = S.punches.length;
    $("count-L").textContent = t.nL;
    $("count-R").textContent = t.nR;
    $("best-speed").textContent = fs(t.peakV);
    renderRate();
    const counts = Object.fromEntries(TYPES.map((k) => [k, t.byType[k].n]));
    const max = Math.max(...Object.values(counts), 1);
    $("type-bars").innerHTML = TYPES.map((k) =>
      `<div class="tb pt-${k}"><span>${k}</span><div class="track"><div class="fill" style="width:${(counts[k] / max) * 100}%"></div></div><b>${counts[k]}</b></div>`).join("");
  }
  function renderRate() {
    const since = now() - 60000;
    $("rate").textContent = `${S.punches.filter((x) => x.t >= since).length} /min`;
  }

  function renderCombos() {
    const cur = S.combos[S.combos.length - 1];
    $("combo-cur").textContent = cur ? cur.str : "—";
    $("combo-names").textContent = cur ? C.describeCombo(cur.str) : "latest combination, boxing numbers";
    const t = session.total;
    $("combo-count").textContent = `${t.combos} combo${t.combos === 1 ? "" : "s"}`;
    $("combo-longest").textContent = t.longest ? `${t.longestStr} (${t.longest})` : "—";
    $("combo-singles").textContent = t.singles;
    $("top-combos").innerHTML = t.topCombos.length
      ? t.topCombos.map((c) => `<div class="tc"><span>${c.str}</span><b>×${c.count}</b></div>`).join("")
      : `<div class="empty">Top combinations appear here.</div>`;
  }

  function renderWeight() {
    const present = insolePresent();
    const chip = $("wt-state");
    chip.textContent = present ? (S.sim && S.simInsoles ? "sim insoles" : "insoles live") : "no insoles";
    chip.classList.toggle("on", present);
    const last = S.punches[S.punches.length - 1];
    const v = last?.shiftPp ?? null;
    $("wt-last").textContent = sgn(v, 1);
    $("wt-straight").textContent = sgn(session.total.shift.straightMean, 1);
    const fill = $("wt-fill"), range = 25;               // gauge full scale ± 25 pp
    const w = v == null ? 0 : Math.min(1, Math.abs(v) / range) * 50;
    fill.className = v != null && v < 0 ? "neg" : "";
    fill.style.width = `${w}%`;
    fill.style.left = v != null && v < 0 ? `${50 - w}%` : "50%";
    const per = TYPES.map((k) => {
      const xs = S.punches.filter((p) => p.shiftPp != null && effType(p) === k).map((p) => p.shiftPp);
      return xs.length ? `${k} ${sgn(C.mean(xs), 0)}` : null;
    }).filter(Boolean);
    $("wt-types").textContent = per.length
      ? `Avg shift by type (pp of load onto the front foot): ${per.join(" · ")}`
      : "Connect insoles (or Simulate with sim insoles) for front/back foot load shift per punch.";
  }

  function renderTable() {
    if (document.activeElement && document.activeElement.closest?.("#punch-table")) { S.tableDirty = true; return; }
    S.tableDirty = false;
    const rows = S.punches.slice(-CFG.tableRows).reverse().map((p) => {
      const cs = S.combos[p.combo - 1];
      const sel = p.trueType == null ? "" : p.trueType === p.type ? "=" : p.trueType;
      const opt = (v, label) => `<option value="${v}"${sel === v ? " selected" : ""}>${label}</option>`;
      return `<tr><td>${p.n}</td><td>${p.round || "—"}</td><td><span class="badge sm hand-${p.hand}">${p.hand}</span></td>
        <td>${cs ? cs.str : "—"} <span class="pair">·${p.comboPos}</span></td>
        <td><span class="badge sm pt-${p.type}">${p.type}</span></td><td>${fs(p.peakV)}</td><td>${p.peakG.toFixed(1)}</td>
        <td>${Math.round(p.rotDeg)}</td><td>${Math.round(p.vertFrac * 100)}</td>
        <td class="${p.shiftPp == null ? "dim" : p.shiftPp < 0 ? "neg" : "pos"}">${sgn(p.shiftPp, 1)}</td><td>${p.gapMs ?? "—"}</td>
        <td><select data-punch="${p.n}">${opt("", "unreviewed")}${opt("=", "✓ correct")}${["jab", "cross", "hook", "uppercut"].map((k) => opt(k, k)).join("")}</select></td></tr>`;
    });
    $("punch-table").tBodies[0].innerHTML = rows.join("");
  }

  function renderRounds() {
    const wrap = $("round-wrap");
    const t = session.total;
    if (!session.rounds.length && !t.count) {
      wrap.innerHTML = `<div class="empty">Start rounds (or just throw some punches) — per-round punch count, rate, speed by type, L/R balance and weight transfer land here.</div>`;
      return;
    }
    const cell = (b) => (b.n ? `${fs(b.mean)} <span class="pair">/ ${fs(b.peak)} · ${b.n}</span>` : `<span class="dim">—</span>`);
    const row = (r, label, cls) => `<tr class="${cls}"><td>${label}${r.open ? " ●" : ""}</td><td>${r.count}</td><td>${r.perMin == null ? "—" : r.perMin.toFixed(0)}</td>
      <td>${r.combos}</td><td>${r.longest || "—"}</td><td>${r.count ? `${fs(r.meanV)} <span class="pair">/ ${fs(r.peakV)}</span>` : "—"}</td>
      <td>${r.count ? `${r.pctL.toFixed(0)} / ${(100 - r.pctL).toFixed(0)}` : "—"}</td>
      ${TYPES.map((k) => `<td>${cell(r.byType[k])}</td>`).join("")}
      <td class="${r.shift.mean == null ? "dim" : r.shift.mean < 0 ? "neg" : "pos"}">${sgn(r.shift.mean, 1)}</td></tr>`;
    wrap.innerHTML = `<table id="round-table"><thead><tr><th>rnd</th><th>punches</th><th>/min</th><th>combos</th><th>longest</th>
      <th>speed <span class="u-speed">${C.speedLabel(S.unit)}</span></th><th>L / R %</th><th>jab</th><th>cross</th><th>hook</th><th>upper</th><th>shift pp</th></tr></thead>
      <tbody>${session.rounds.map((r) => row(r, `R${r.n}`, "round-row")).join("")}${row(t, session.rounds.length ? "All" : "Free", "total-row")}</tbody></table>`;
  }

  function renderFatigue() {
    const f = session.fatigue, wrap = $("fx-wrap");
    if (!f) {
      wrap.innerHTML = `<div class="empty fx-empty">${session.openRound != null
        ? `Round ${session.openRound} is in progress — the curve compares completed rounds, so it appears once two have finished.`
        : "Run two or more full rounds (3+ punches each) to draw the fatigue curve."}</div>`;
      $("fx-tag").textContent = session.openRound != null ? "round in progress" : "% of first round";
      return;
    }
    const W = 560, H = 220, pad = { l: 42, r: 22, t: 22, b: 30 };
    const all = f.points.flatMap((p) => [p.speedPct, p.ratePct]).concat(100);
    let lo = Math.floor((Math.min(...all) - 6) / 10) * 10, hi = Math.ceil((Math.max(...all) + 6) / 10) * 10;
    if (hi - lo < 30) { hi += 10; lo -= 10; }
    const n = f.points.length;
    const x = (i) => pad.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    let grid = "";
    for (let v = lo; v <= hi; v += 10) grid += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="lbl" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
    const line = (key, cls) => `<polyline class="${cls}" points="${f.points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ")}"/>`;
    const dots = (key, dcls, tcls, dy) => f.points.map((p, i) =>
      `<circle class="${dcls}" cx="${x(i)}" cy="${y(p[key])}" r="4"/><text class="val ${tcls}" x="${x(i)}" y="${y(p[key]) + dy}" text-anchor="middle">${p[key].toFixed(0)}</text>`).join("");
    const xl = f.points.map((p, i) => `<text class="lbl" x="${x(i)}" y="${H - 8}" text-anchor="middle">R${p.n}</text>`).join("");
    wrap.innerHTML = `<svg class="fx" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fatigue curve: hand speed and punches per minute by round, percent of first round" preserveAspectRatio="xMidYMid meet">
      ${grid}<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${y(100)}" y2="${y(100)}"/>
      ${line("ratePct", "l-rate")}${line("speedPct", "l-speed")}${dots("ratePct", "d-rate", "t-rate", 16)}${dots("speedPct", "d-speed", "t-speed", -9)}${xl}</svg>`;
    $("fx-tag").textContent = `speed ${sgn(f.speedFadePct)}% · output ${sgn(f.rateFadePct)}%${session.fatigueNote ? ` · ${session.fatigueNote}` : ""}`;
  }

  function renderConfusion() {
    const cf = C.confusion(S.punches);
    $("cm-tag").textContent = cf.n ? `${cf.n} reviewed · ${(cf.accuracy * 100).toFixed(0)}% match` : "0 reviewed";
    const maxCell = Math.max(1, ...TYPES.flatMap((a) => TYPES.map((b) => cf.m[a][b])));
    const head = `<tr><th class="rowh">true ↓ auto →</th>${TYPES.map((k) => `<th>${k}</th>`).join("")}<th>recall</th></tr>`;
    const body = TYPES.map((a) => `<tr><th class="rowh">${a}</th>${TYPES.map((b) => {
      const v = cf.m[a][b];
      return `<td class="cell${a === b ? "" : " off"}" style="--heat:${Math.round((v / maxCell) * 70)}">${v || "·"}</td>`;
    }).join("")}<td class="dim">${cf.recall[a] == null ? "—" : (cf.recall[a] * 100).toFixed(0) + "%"}</td></tr>`).join("");
    const foot = `<tr><th class="rowh">precision</th>${TYPES.map((k) => `<td class="dim">${cf.precision[k] == null ? "—" : (cf.precision[k] * 100).toFixed(0) + "%"}</td>`).join("")}<td></td></tr>`;
    $("cm-wrap").innerHTML = `<div class="scroll"><table class="cm" id="cm-table"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>`;
  }

  function renderSummary() {
    const t = session.total, f = session.fatigue, cf = C.confusion(S.punches);
    const ph = S.clock ? S.clock.phaseAt(now()) : null;
    $("summary-tag").textContent = !t.count ? "waiting for punches"
      : S.sessionDone ? `complete · ${session.rounds.length} round${session.rounds.length === 1 ? "" : "s"}`
      : S.clock?.running ? `in progress · ${ph.phase === "rest" ? "rest" : "round " + ph.n}`
      : session.rounds.length ? "stopped early" : "free work";
    const k = (v, label, sub) => `<div class="kpi"><div class="v">${v}</div><div class="k">${label}</div><div class="s">${sub ?? "&nbsp;"}</div></div>`;
    const u = C.speedLabel(S.unit);
    $("kpis").innerHTML = [
      k(t.count, "punches", session.rounds.length ? `${session.inRounds} in rounds` : "free work"),
      k(t.perMin == null ? "—" : t.perMin.toFixed(0), "punches / min", t.durMs ? `${C.fmtClock(t.durMs)} active` : "needs 20 s of work"),
      k(`${fs(t.meanV)} <span class="unit">${u}</span>`, "mean hand speed", t.peakV ? `peak ${fs(t.peakV)} ${u} · ${t.peakType}` : null),
      k(t.combos, "combinations", t.longest ? `longest ${t.longestStr}` : null),
      k(t.count ? `${t.pctL.toFixed(0)} / ${(100 - t.pctL).toFixed(0)}` : "—", "left / right %", t.meanL != null && t.meanR != null ? `speed L ${fs(t.meanL)} · R ${fs(t.meanR)}` : null),
      k(f ? `${sgn(f.speedFadePct)}%` : "—", "late-round speed", f ? `output ${sgn(f.rateFadePct)}% · R${f.baseRound}→R${f.lastRound}${session.openRound != null ? " · R" + session.openRound + " running" : ""}` : session.fatigueNote),
      k(t.shift.straightMean == null ? "—" : `${sgn(t.shift.straightMean, 1)} <span class="unit">pp</span>`, "weight to front foot", t.shift.n ? `straights · ${t.shift.n} measured` : "no insole data"),
      k(cf.n ? pct(cf.accuracy * 100) : "—", "auto-label match", `${cf.n} reviewed of ${t.count}`),
    ].join("");
    const notes = C.coachNotes(session, cf, S.unit);
    $("notes").innerHTML = notes.length
      ? notes.map((n) => `<div class="n ${n.tone}">${n.text}</div>`).join("")
      : `<div class="empty">Coaching notes appear once there are enough punches and rounds to compare.</div>`;
  }

  // ---------- round clock ----------
  const fmtDur = (ms) => (ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} min` : ms >= 60000 ? `${(ms / 60000).toFixed(2).replace(/\.?0+$/, "")} min` : `${Math.round(ms / 1000)} s`);
  function readSettings() {
    const num = (id, lo, hi, dflt) => { const v = Number($(id).value); return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : dflt; };
    S.settings.roundMin = num("set-round", 0.1, 10, 3);
    S.settings.restMin = num("set-rest", 0.05, 5, 1);
    S.settings.rounds = Math.round(num("set-rounds", 1, 12, 3));
  }
  function applySettingsToInputs() {
    $("set-round").value = S.settings.roundMin; $("set-rest").value = S.settings.restMin; $("set-rounds").value = S.settings.rounds;
    $("set-bell").checked = S.bell;
  }
  function renderClock() {
    const st = S.settings, roundMs = st.roundMin * 60000, restMs = st.restMin * 60000;
    $("clock-sub").textContent = `${fmtDur(roundMs)} round · ${fmtDur(restMs)} rest × ${st.rounds}`;
    const ph = S.clock ? S.clock.phaseAt(now()) : { phase: "idle", n: 0, elapsedMs: 0, remainingMs: roundMs, phaseMs: roundMs };
    const total = S.clock ? S.clock.cfg.rounds : st.rounds;
    const warn = ph.phase === "round" && ph.remainingMs <= CFG.warnMs && roundMs > CFG.warnMs * 2;
    $("clock").className = `clock ${ph.phase}${warn ? " warn" : ""}`;
    $("clock-phase").textContent = { idle: "Ready", round: `Round ${ph.n} of ${total}`, rest: `Rest · next round ${ph.n + 1}`, done: "Session complete", stopped: "Stopped" }[ph.phase];
    $("clock-time").textContent = ph.phase === "done" || ph.phase === "stopped" ? "0:00" : C.fmtClock(ph.remainingMs);
    $("clock-bar").style.width = `${ph.phaseMs ? Math.min(100, (ph.elapsedMs / ph.phaseMs) * 100) : 0}%`;
    const running = !!S.clock?.running, locked = running || S.rounds.length > 0;
    const b = $("btn-rounds");
    b.textContent = running ? "Stop" : S.sessionDone ? "Rounds complete" : S.rounds.length ? "Stopped" : "Start Rounds";
    b.disabled = !running && S.rounds.length > 0;
    b.title = b.disabled ? "Reset the session to run another set of rounds" : "";
    b.classList.toggle("primary", !running);
    for (const id of ["set-round", "set-rest", "set-rounds"]) $(id).disabled = locked;
  }

  function startRounds() {
    if (S.clock?.running) { handleClock(S.clock.stop(now())); return; }
    if (S.rounds.length) { log("Reset the session before starting another set of rounds (export the CSV first to keep this one).", "warn"); return; }
    readSettings(); savePrefs();
    S.clock = C.createRoundClock({ roundMs: S.settings.roundMin * 60000, restMs: S.settings.restMin * 60000, rounds: S.settings.rounds, warnMs: CFG.warnMs });
    S.sessionDone = false;
    ensureAudio();
    handleClock(S.clock.start(now()));
  }
  function handleClock(events) {
    for (const ev of events) {
      const N = S.clock.cfg.rounds;
      if (ev.type === "roundStart") {
        S.rounds.push({ n: ev.n, startT: ev.t, endT: null });
        bell(1);
        log(`Round ${ev.n} of ${N} — go.`, "ok");
      } else if (ev.type === "warn") {
        clap();
        log(`Round ${ev.n}: 10 seconds.`, "warn");
      } else if (ev.type === "roundEnd" || (ev.type === "stopped" && ev.phase === "round")) {
        const r = S.rounds.find((x) => x.n === ev.n);
        if (r && r.endT == null) r.endT = ev.t;
        if (ev.type === "roundEnd") bell(ev.n === N ? 3 : 2);
        S.combos = C.annotateCombos(S.punches, CFG.comboGapMs);
        const rs = buildSess(ev.t).rounds.find((x) => x.n === ev.n);
        if (rs) log(`Round ${ev.n} ${ev.type === "stopped" ? "stopped" : "done"}: ${rs.count} punches, ${rs.perMin == null ? "—" : rs.perMin.toFixed(0)}/min, mean ${fs(rs.meanV)} ${C.speedLabel(S.unit)}, ${rs.combos} combos.`, "ok");
      } else if (ev.type === "restStart") {
        log(`Rest — ${fmtDur(S.settings.restMin * 60000)}.`);
      } else if (ev.type === "done") {
        S.sessionDone = true;
        log(`All ${N} rounds complete — summary below.`, "ok");
        if (S.sim) simStop();
      }
      if (ev.type === "stopped") {
        for (const r of S.rounds) {                          // safety net: no round may stay open after Stop
          if (r.endT == null) r.endT = Math.min(ev.t, r.startT + S.clock.cfg.roundMs);
        }
        log("Rounds stopped.", "warn");
        if (S.sim) simStop();
      }
    }
    renderClock();
    renderAll();
  }
  function clockTick() {
    S.tick++;
    if (S.clock) {
      const evs = S.clock.tick(now());
      if (evs.length) handleClock(evs);
    }
    renderClock();
    renderRate();
    if (S.tick % 10 === 0 && (S.clock?.running || S.punches.length)) { renderStats(); renderWeight(); }
  }

  // ---------- audio ----------
  function ensureAudio() {
    try {
      S.audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (S.audio.state === "suspended") S.audio.resume();
    } catch { /* no audio */ }
    return S.audio;
  }
  function tone(freq, startIn, dur, vol, type = "sine") {
    const a = ensureAudio();
    if (!a) return;
    const t0 = a.currentTime + startIn;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function bell(count) {
    if (!S.bell) return;
    try {
      for (let i = 0; i < count; i++)
        for (const [ratio, gain] of [[1, 1], [2.76, 0.55], [5.4, 0.32], [8.93, 0.18]]) tone(520 * ratio, i * 0.4, 1.5 / Math.sqrt(ratio), 0.22 * gain);
    } catch { /* no audio */ }
  }
  function clap() {
    if (!S.bell) return;
    try { tone(1800, 0, 0.05, 0.2, "square"); tone(1800, 0.12, 0.05, 0.2, "square"); } catch { /* no audio */ }
  }
  function beep(freq, ms) { try { tone(freq, 0, ms / 1000, 0.25); } catch { /* no audio */ } }

  // ---------- reaction drill ----------
  function armGo() {
    if (S.go.armed) return;
    S.go.armed = true; S.go.at = null;
    $("btn-go").classList.add("armed");
    $("go-light").className = "go-light armed";
    S.go.timer = setTimeout(() => {
      S.go.armed = false;
      S.go.at = now();
      $("go-light").className = "go-light go";
      beep(880, 120);
      if (S.sim) setTimeout(() => simThrowFree("straight"), 200 + Math.random() * 120);
    }, CFG.goDelayMinMs + Math.random() * (CFG.goDelayMaxMs - CFG.goDelayMinMs));
    log("GO armed — punch on the beep.");
  }

  // ---------- CSV ----------
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  function exportCsv() {
    if (!S.punches.length) { log("No punches to export yet.", "warn"); return; }
    S.combos = C.annotateCombos(S.punches, CFG.comboGapMs);
    const lines = [C.PUNCH_CSV_HEADER, ...S.punches.map((p) => C.punchCsvRow(p, S.combos[p.combo - 1]?.str ?? ""))];
    download(`punches-${stamp()}.csv`, lines.join("\n"));
    log(`Exported ${S.punches.length} punches (m/s, auto + corrected labels, combos, rounds, weight shift).`);
  }
  function exportRoundsCsv() {
    const sess = buildSess();
    if (!sess.rounds.length) { log("No rounds yet — run the round timer first.", "warn"); return; }
    download(`rounds-${stamp()}.csv`, [C.ROUND_CSV_HEADER, ...sess.rounds.map(C.roundCsvRow)].join("\n"));
    log(`Exported ${sess.rounds.length} rounds (m/s).`);
  }

  // ---------- SDK adapter ----------
  const SDKAdapter = {
    devices: { L: null, R: null }, pair: null,
    hasSDK() { return typeof window.BS !== "undefined"; },
    async connect(hand) {
      if (!this.hasSDK()) { log("SDK not loaded — check network / unpkg.", "bad"); return; }
      try {
        const device = new BS.Device();
        this.devices[hand] = device;
        device.addEventListener("isConnected", () => {
          $(hand === "L" ? "btn-left" : "btn-right").classList.toggle("connected", device.isConnected);
          if (device.isConnected) {
            device.setSensorConfiguration({ linearAcceleration: CFG.rateMs, gameRotation: CFG.rateMs * 2 });
            log(`${hand} wrist connected @ ${CFG.rateMs}ms.`);
          }
        });
        device.addEventListener("linearAcceleration", (e) => {
          const a = e.message.linearAcceleration;
          if (a) detector.acc(hand, a, now());
        });
        device.addEventListener("gameRotation", (e) => {
          const q = e.message.gameRotation ?? e.message.quaternion;
          if (q) detector.quat(hand, q);
        });
        device.connect();
        log(`${hand} wrist: Bluetooth chooser opened.`);
      } catch (err) { log(`${hand} wrist connect failed: ${err.message}`, "bad"); }
    },
    async connectInsoles() {
      if (!this.hasSDK()) { log("SDK not loaded — check network / unpkg.", "bad"); return; }
      try {
        this.pair = BS.DevicePair.insoles;
        this.pair.addEventListener("isConnected", () => $("btn-insoles").classList.toggle("connected", this.pair.isConnected));
        this.pair.addEventListener("deviceIsConnected", (e) => {
          const { device, side, isConnected } = e.message;
          if (!isConnected) return;
          device.setSensorConfiguration({ pressure: 10 });
          log(`${side} insole connected @ 10ms.`);
        });
        // TODO[SDK]: confirm devicePressure carries { pressure: { normalizedSum }, side } on hardware
        this.pair.addEventListener("devicePressure", (e) => {
          const { pressure: p, side } = e.message;
          if (p?.normalizedSum != null) onLoad(side, p.normalizedSum, now());
        });
        const device = new BS.Device();
        device.connect();
        log("Insoles: Bluetooth chooser opened. Pick one, then click again for the other foot. (Optional — adds weight transfer.)");
      } catch (err) { log(`Insole connect failed: ${err.message}`, "bad"); }
    },
  };

  // ---------- simulate ----------
  // Synthesizes 200 Hz accel/quat per punch (BPCore.synthPunch) and plays it
  // through the real detector at wall-clock time — plus, optionally, a 100 Hz
  // insole load channel — so detection, integration, classification, combos,
  // rounds and weight transfer all run the production code path.
  const Sim = {
    rng: C.mulberry32((Date.now() ^ 0x5bd1e995) >>> 0),
    streams: [], expect: { L: [], R: [] }, timers: new Set(), pump: null, insoleTimer: null, insole: null,
  };
  const later = (fn, ms) => {
    const id = setTimeout(() => { Sim.timers.delete(id); fn(); }, ms);
    Sim.timers.add(id);
  };
  function simPump() {
    const t = now();
    for (const st of Sim.streams) {
      while (st.i < st.samples.length && st.t0 + st.samples[st.i].ms <= t) {
        const smp = st.samples[st.i++];
        detector.quat(st.hand, smp.q);
        detector.acc(st.hand, smp.a, st.t0 + smp.ms);
      }
    }
    Sim.streams = Sim.streams.filter((st) => st.i < st.samples.length);
  }
  function simInsoleTick() {
    const t = now(), s = Sim.insole.sample(t);
    const ls = leadSide(), rs = ls === "left" ? "right" : "left";
    onLoad(ls, s.lead, t); onLoad(rs, s.rear, t);
  }
  function simThrow(hand, kind, scale) {
    const s = C.synthPunch(kind, Sim.rng, { scale, ambiguous: Sim.rng() < CFG.simAmbiguous });
    const t0 = now(), isLead = hand === lead();
    Sim.streams.push({ hand, t0, samples: s.samples, i: 0 });
    Sim.expect[hand].push({ t: t0, truth: kind === "straight" ? (isLead ? "jab" : "cross") : kind });
    if (S.simInsoles && Sim.insole) Sim.insole.punch(t0, s.durMs, C.shiftAmpPp(kind, isLead, Sim.rng, scale));
  }
  function simThrowFree(kind) {            // one-off punch (reaction drill) on a hand that is not mid-punch
    const busy = new Set(Sim.streams.map((s) => s.hand));
    const hands = ["L", "R"].filter((h) => !busy.has(h));
    if (!hands.length) { later(() => simThrowFree(kind), 80); return; }
    simThrow(hands[Math.floor(Sim.rng() * hands.length)], kind, 1);
  }
  function simFatigue(ph) {
    if (!ph || ph.phase !== "round") return { scale: 1, slow: 1 };
    const frac = ph.phaseMs ? ph.elapsedMs / ph.phaseMs : 0;
    return { scale: 1 - 0.045 * (ph.n - 1) - 0.03 * frac, slow: 1 + 0.12 * (ph.n - 1) };
  }
  function simNextCombo() {
    if (!S.sim) return;
    const ph = S.clock ? S.clock.phaseAt(now()) : null;
    if (ph && ph.phase !== "round") { later(simNextCombo, 250); return; }       // rest between rounds
    const { scale, slow } = simFatigue(ph);
    let off = 0, prevHand = null;
    for (const [hand, kind] of C.comboToThrows(C.pickCombo(Sim.rng), lead())) {
      later(() => simThrow(hand, kind, scale), off);
      off += (prevHand === hand ? 520 + Sim.rng() * 60 : 330 + Sim.rng() * 110) * slow;
      prevHand = hand;
    }
    later(simNextCombo, off + (900 + Sim.rng() * 1300) * slow);
  }
  function simStart() {
    if (S.sim) return;
    S.sim = true;
    $("btn-sim").classList.add("connected");
    $("btn-sim").textContent = "Stop Simulate";
    Sim.insole = C.createInsoleSim(Sim.rng);
    Sim.pump = setInterval(simPump, CFG.simPumpMs);
    if (S.simInsoles) Sim.insoleTimer = setInterval(simInsoleTick, 10);
    log("Simulate: boxing combinations (1-2, 1-2-3, 1-2-5-2 …) — both hands, mixed types, fading across rounds.", "ok");
    later(simNextCombo, 300);
  }
  function simStop() {
    if (!S.sim) return;
    S.sim = false;
    clearInterval(Sim.pump); clearInterval(Sim.insoleTimer);
    for (const id of Sim.timers) clearTimeout(id);
    Sim.timers.clear(); Sim.streams.length = 0; Sim.expect = { L: [], R: [] };
    detector.reset();                                        // a half-fed punch window must not outlive the stream
    $("btn-sim").classList.remove("connected");
    $("btn-sim").textContent = "Simulate";
    log("Simulate stopped.");
  }

  // ---------- session reset ----------
  function resetSession() {
    if (S.sim) simStop();
    clearTimeout(S.go.timer);
    S.punches = []; S.combos = []; S.rounds = []; S.clock = null; S.sessionDone = false;
    S.go = { armed: false, at: null, timer: null, best: null };
    S.insole.buf = [];
    detector.reset();
    $("react-ms").textContent = "—"; $("react-best").textContent = "—";
    $("go-light").className = "go-light"; $("btn-go").classList.remove("armed");
    renderClock(); renderAll();
    log("Session cleared.", "warn");
  }

  // ---------- summary copy ----------
  async function copySummary() {
    const cf = C.confusion(S.punches);
    const text = C.summaryText(buildSess(), cf, S.unit);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        ok = document.execCommand("copy"); ta.remove();
      } catch { /* blocked */ }
    }
    $("copy-state").textContent = ok ? "Copied." : "Clipboard blocked — summary written to the session log.";
    if (!ok) log(text.replace(/\n/g, "<br>"));
    setTimeout(() => { $("copy-state").textContent = ""; }, 3000);
  }

  // ---------- wire up ----------
  $("btn-left").addEventListener("click", () => SDKAdapter.connect("L"));
  $("btn-right").addEventListener("click", () => SDKAdapter.connect("R"));
  $("btn-insoles").addEventListener("click", () => SDKAdapter.connectInsoles());
  $("btn-stance").addEventListener("click", (e) => {
    S.stance = S.stance === "orthodox" ? "southpaw" : "orthodox";
    e.target.textContent = `Stance: ${S.stance[0].toUpperCase()}${S.stance.slice(1)}`;
    log(`Stance → ${S.stance} (${S.stance === "orthodox" ? "left" : "right"} lead).`);
  });
  $("btn-go").addEventListener("click", armGo);
  $("btn-sim").addEventListener("click", () => (S.sim ? simStop() : simStart()));
  $("sim-insoles").addEventListener("change", (e) => {
    S.simInsoles = e.target.checked;
    if (S.sim) {
      clearInterval(Sim.insoleTimer); Sim.insoleTimer = null;
      if (S.simInsoles) Sim.insoleTimer = setInterval(simInsoleTick, 10);
    }
  });
  $("sim-truth").addEventListener("change", (e) => { S.simTruth = e.target.checked; });
  $("btn-export").addEventListener("click", exportCsv);
  $("btn-export-rounds").addEventListener("click", exportRoundsCsv);
  $("btn-rounds").addEventListener("click", startRounds);
  $("btn-copy").addEventListener("click", copySummary);
  $("btn-reset").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm"); b.textContent = "Click again to clear";
      S.resetTimer = setTimeout(() => { b.classList.remove("confirm"); b.textContent = "Reset session"; }, 3000);
      return;
    }
    clearTimeout(S.resetTimer);
    b.classList.remove("confirm"); b.textContent = "Reset session";
    resetSession();
  });
  document.querySelectorAll("#units-seg button").forEach((b) => b.addEventListener("click", () => {
    S.unit = b.dataset.unit; savePrefs(); renderUnits(); renderAll(); renderClock();
  }));
  const SETTING_KEY = { "set-round": "roundMin", "set-rest": "restMin", "set-rounds": "rounds" };
  for (const id of ["set-round", "set-rest", "set-rounds"]) $(id).addEventListener("change", () => {
    S.urlKeys.delete(SETTING_KEY[id]);                   // a value typed on the page is a real preference
    readSettings(); applySettingsToInputs(); savePrefs(); renderClock();
  });
  $("set-bell").addEventListener("change", (e) => { S.bell = e.target.checked; savePrefs(); });
  $("btn-confirm-all").addEventListener("click", () => {
    let n = 0;
    for (const p of S.punches) if (p.trueType == null) { p.trueType = p.type; n++; }
    log(`Marked ${n} unreviewed punch${n === 1 ? "" : "es"} as correct.`);
    renderAll();
  });
  $("punch-table").tBodies[0].addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel) return;
    const punch = S.punches.find((x) => x.n === Number(sel.dataset.punch));
    if (!punch) return;
    const v = sel.value;
    punch.trueType = v === "" ? null : v === "=" ? punch.type : v;
    if (v === "") log(`Punch ${punch.n}: review cleared.`);
    else if (punch.trueType === punch.type) log(`Punch ${punch.n}: ${punch.type} confirmed.`);
    else log(`Punch ${punch.n}: corrected ${punch.type} → ${punch.trueType}.`);
    sel.blur();
    renderAll();
  });
  $("punch-table").addEventListener("focusout", () => { if (S.tableDirty) setTimeout(renderAll, 0); });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
    e.preventDefault(); armGo();
  });

  loadPrefs();
  applySettingsToInputs();
  readSettings();               // clamp anything odd that came from storage or the URL
  applySettingsToInputs();
  renderUnits();
  renderClock();
  renderAll();
  setInterval(clockTick, 100);
  window.__bwBoxing = { S, core: C };   // debug / test hook (read-only use)
  log("Ready. Connect both wrist Sense units (insoles optional), or hit Simulate.");
})();
