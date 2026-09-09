/* Brilliant Wear — Boxing Punch Quickness Demo (first draft)
   Two wrist-worn Sense units. Detects punches from wrist linear acceleration,
   integrates a short window for peak hand speed, and AUTO-CLASSIFIES the
   punch type (jab / cross / hook / uppercut) with a labeled v1 heuristic:

     · net displacement mostly upward            → uppercut
     · large yaw rotation or curved path         → hook
     · otherwise straight                        → jab (lead hand) / cross (rear)

   Lead vs rear comes from the stance toggle (Orthodox = left lead). Every
   punch logs its feature vector (speed, accel, rotation, vertical fraction,
   curvature) + a correctable "true type" → CSV, so the heuristic's labels
   become the ML classifier's training set. SDK touchpoints in SDKAdapter. */

(() => {
  "use strict";

  const CFG = {
    rateMs: 5,                 // 200 Hz — punches are ~120-250 ms events
    startG: 2.0,               // |linAcc| onset threshold (g)
    endG: 0.8,                 // below this = punch over
    maxPunchMs: 450,
    refractoryMs: 250,
    vertFrac: 0.5,             // upward displacement share ⇒ uppercut
    hookYawDeg: 40,            // |yaw change| ⇒ hook
    hookCurve: 1.6,            // path length / net displacement ⇒ hook
    goDelayMinMs: 1200, goDelayMaxMs: 3200,
  };
  const G = 9.80665;

  const S = {
    stance: "orthodox",        // orthodox: L lead · southpaw: R lead
    hands: { L: mkHand(), R: mkHand() },
    punches: [], counts: { L: 0, R: 0 },
    typeCounts: { jab: 0, cross: 0, hook: 0, uppercut: 0 },
    go: { armed: false, at: null, timer: null, best: null },
    sim: false, simTimer: null,
    audio: null,
  };
  function mkHand() {
    return { connected: false, q: null, q0: null, lastT: 0, active: false,
             start: 0, v: [0, 0, 0], d: [0, 0, 0], path: 0, peakV: 0, peakA: 0, lastEnd: 0 };
  }
  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const TYPE_COLORS = { jab: "var(--teal)", cross: "var(--blue)", hook: "var(--amber)", uppercut: "var(--violet)" };
  function log(msg, cls = "") {
    $("log").insertAdjacentHTML("afterbegin", `<div class="${cls}">${new Date().toLocaleTimeString()} — ${msg}</div>`);
  }

  // ---------- math ----------
  function quatRotate(q, v) {
    const { x, y, z, w } = q;
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  }
  function yawDeg(q0, q1) {
    if (!q0 || !q1) return 0;
    const yaw = (q) => Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    let d = (yaw(q1) - yaw(q0)) * 180 / Math.PI;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    return d;
  }

  // ---------- punch detection + classification ----------
  function onQuat(hand, q) { S.hands[hand].q = q; }
  function onAcc(hand, a, t) {
    const h = S.hands[hand];
    const dt = h.lastT ? Math.min(0.03, (t - h.lastT) / 1000) : 0;
    h.lastT = t;
    if (!dt) return;
    const world = h.q ? quatRotate(h.q, [a.x, a.y, a.z]) : [a.x, a.y, a.z];
    const mag = Math.hypot(...world);

    if (!h.active) {
      if (mag > CFG.startG * G && t - h.lastEnd > CFG.refractoryMs) {
        h.active = true; h.start = t; h.q0 = h.q ? { ...h.q } : null;
        h.v = [0, 0, 0]; h.d = [0, 0, 0]; h.path = 0; h.peakV = 0; h.peakA = 0;
      }
      return;
    }
    // inside a punch window: integrate from assumed rest at onset
    for (let i = 0; i < 3; i++) { h.v[i] += world[i] * dt; h.d[i] += h.v[i] * dt; }
    const speed = Math.hypot(...h.v);
    h.path += speed * dt;
    if (speed > h.peakV) h.peakV = speed;
    if (mag > h.peakA) h.peakA = mag;

    const done = mag < CFG.endG * G || t - h.start > CFG.maxPunchMs;
    if (done) {
      h.active = false; h.lastEnd = t;
      finishPunch(hand, h, t);
    }
  }

  function classify(hand, feat) {
    // TODO[SDK]: verify world-frame up axis on hardware (assumed z-up here)
    if (feat.vertFrac > CFG.vertFrac && feat.up > 0) return "uppercut";
    if (Math.abs(feat.rotDeg) > CFG.hookYawDeg || feat.curve > CFG.hookCurve) return "hook";
    const lead = S.stance === "orthodox" ? "L" : "R";
    return hand === lead ? "jab" : "cross";
  }

  function finishPunch(hand, h, t) {
    if (h.peakV < 1.2 || h.path < 0.15) return; // arm wiggle, not a punch
    const net = Math.hypot(...h.d);
    const feat = {
      durMs: Math.round(t - h.start),
      peakV: h.peakV, peakG: h.peakA / G,
      up: h.d[2], vertFrac: net > 0 ? Math.abs(h.d[2]) / net : 0,
      curve: net > 0.02 ? h.path / net : 1,
      rotDeg: yawDeg(h.q0, h.q),
    };
    const type = classify(hand, feat);
    const prev = S.punches[S.punches.length - 1];
    const p = {
      n: S.punches.length + 1, hand, type, trueType: null, t,
      gapMs: prev ? Math.round(t - prev.t) : null, ...feat,
    };
    S.punches.push(p);
    S.counts[hand]++;
    S.typeCounts[type]++;
    if (S.go.at != null) {
      const r = Math.round(t - S.go.at);
      S.go.at = null;
      S.go.best = S.go.best == null ? r : Math.min(S.go.best, r);
      $("react-ms").textContent = r;
      $("react-best").textContent = S.go.best;
      $("go-light").className = "go-light";
      $("btn-go").classList.remove("armed");
    }
    render(p);
  }

  function render(p) {
    $("last-type").textContent = p.type.toUpperCase();
    $("last-type").className = `punch-badge pt-${p.type}`;
    const hb = $("last-hand");
    hb.style.display = "inline-block";
    hb.textContent = p.hand;
    hb.className = `hand-badge hand-${p.hand}`;
    $("last-speed").textContent = p.peakV.toFixed(1);
    $("last-mph").textContent = (p.peakV * 2.23694).toFixed(0);
    $("last-g").textContent = p.peakG.toFixed(1);
    $("count-total").textContent = S.punches.length;
    $("count-L").textContent = S.counts.L;
    $("count-R").textContent = S.counts.R;
    $("best-speed").textContent = Math.max(...S.punches.map((x) => x.peakV)).toFixed(1);
    const winStart = p.t - 60000;
    const inWin = S.punches.filter((x) => x.t >= winStart).length;
    $("rate").textContent = `${inWin} /min`;
    $("type-bars").innerHTML = Object.entries(S.typeCounts).map(([k, v]) => {
      const max = Math.max(...Object.values(S.typeCounts), 1);
      return `<div class="tb"><span>${k}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%;background:${TYPE_COLORS[k]}"></div></div><b>${v}</b></div>`;
    }).join("");
    $("punch-table").querySelector("tbody").insertAdjacentHTML("afterbegin",
      `<tr><td>${p.n}</td><td>${p.hand}</td><td>${p.type}</td><td>${p.peakV.toFixed(1)}</td><td>${p.peakG.toFixed(1)}</td>
       <td>${Math.round(p.rotDeg)}</td><td>${Math.round(p.vertFrac * 100)}</td><td>${p.gapMs ?? "—"}</td>
       <td><select data-punch="${p.n}"><option value="">✓ auto</option><option>jab</option><option>cross</option><option>hook</option><option>uppercut</option></select></td></tr>`);
    $("punch-table").querySelector("select").addEventListener("change", (e) => {
      const punch = S.punches.find((x) => x.n === Number(e.target.dataset.punch));
      if (punch) { punch.trueType = e.target.value || null; if (punch.trueType) log(`Punch ${punch.n}: corrected ${punch.type} → ${punch.trueType}.`); }
    });
  }

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
      if (S.sim) setTimeout(() => simPunch(Math.random() > 0.5 ? "L" : "R", "straight"), 200 + Math.random() * 120);
    }, CFG.goDelayMinMs + Math.random() * (CFG.goDelayMaxMs - CFG.goDelayMinMs));
    log("GO armed — punch on the beep.");
  }
  function beep(freq, ms) {
    try {
      S.audio ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = S.audio.createOscillator(), g = S.audio.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(S.audio.destination);
      g.gain.value = 0.25; o.start(); o.stop(S.audio.currentTime + ms / 1000);
    } catch { /* no audio */ }
  }

  // ---------- CSV ----------
  function exportCsv() {
    const lines = ["punch,hand,auto_type,true_type,peak_speed_ms,peak_accel_g,dur_ms,rot_deg,vert_frac,curve,gap_ms"];
    for (const p of S.punches) lines.push(
      `${p.n},${p.hand},${p.type},${p.trueType ?? p.type},${p.peakV.toFixed(2)},${p.peakG.toFixed(2)},${p.durMs},${p.rotDeg.toFixed(1)},${p.vertFrac.toFixed(3)},${p.curve.toFixed(2)},${p.gapMs ?? ""}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `punches-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    log(`Exported ${S.punches.length} punches (auto + corrected labels).`);
  }

  // ---------- SDK adapter ----------
  const SDKAdapter = {
    devices: { L: null, R: null },
    hasSDK() { return typeof window.BS !== "undefined"; },
    async connect(hand) {
      if (!this.hasSDK()) { log("SDK not loaded — check network / unpkg.", "bad"); return; }
      try {
        const device = new BS.Device();
        this.devices[hand] = device;
        device.addEventListener("isConnected", () => {
          S.hands[hand].connected = device.isConnected;
          $(hand === "L" ? "btn-left" : "btn-right").classList.toggle("connected", device.isConnected);
          if (device.isConnected) {
            device.setSensorConfiguration({ linearAcceleration: CFG.rateMs, gameRotation: CFG.rateMs * 2 });
            log(`${hand} wrist connected @ ${CFG.rateMs}ms.`);
          }
        });
        device.addEventListener("linearAcceleration", (e) => {
          const a = e.message.linearAcceleration;
          if (a) onAcc(hand, a, now());
        });
        device.addEventListener("gameRotation", (e) => {
          const q = e.message.gameRotation ?? e.message.quaternion;
          if (q) onQuat(hand, q);
        });
        device.connect();
        log(`${hand} wrist: Bluetooth chooser opened.`);
      } catch (err) { log(`${hand} wrist connect failed: ${err.message}`, "bad"); }
    },
  };

  // ---------- simulate ----------
  // Synthesizes 200 Hz accel/quat windows per punch type so detection,
  // integration, and classification all run the real code path.
  function simPunch(hand, kind) {
    const h = S.hands[hand];
    const t0 = now();
    const dur = 140 + Math.random() * 60;
    const peak = (kind === "hook" ? 55 : kind === "uppercut" ? 48 : 65) * (0.85 + Math.random() * 0.3);
    let yaw0 = Math.random() * Math.PI;
    for (let ms = 0; ms <= dur + 40; ms += CFG.rateMs) {
      setTimeout(() => {
        const ph = Math.min(1, ms / dur);
        const env = Math.sin(ph * Math.PI) * peak;
        let ax = 0, ay = 0, az = 0;
        if (kind === "straight") { ax = env; ay = env * 0.08 * Math.sin(ph * 7); }
        else if (kind === "hook") { ax = env * Math.cos(ph * 1.8); ay = env * Math.sin(ph * 1.8); }
        else { az = env * 0.9; ax = env * 0.35; }
        const yaw = kind === "hook" ? yaw0 + ph * 1.2 : yaw0 + ph * 0.1;
        onQuat(hand, { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
        onAcc(hand, { x: ax, y: ay, z: az }, now());
      }, ms);
    }
  }
  function simStart() {
    if (S.sim) { S.sim = false; clearInterval(S.simTimer); $("btn-sim").classList.remove("connected"); log("Simulate stopped."); return; }
    S.sim = true;
    $("btn-sim").classList.add("connected");
    log("Simulate: combos every ~1 s — straights, hooks, uppercuts, both hands.", "ok");
    const kinds = ["straight", "straight", "straight", "hook", "hook", "uppercut"];
    S.simTimer = setInterval(() => {
      if (Math.random() < 0.25) return; // breathing room
      const lead = S.stance === "orthodox" ? "L" : "R";
      const hand = Math.random() < 0.55 ? lead : (lead === "L" ? "R" : "L");
      simPunch(hand, kinds[Math.floor(Math.random() * kinds.length)]);
    }, 1000);
  }

  // ---------- wire up ----------
  $("btn-left").addEventListener("click", () => SDKAdapter.connect("L"));
  $("btn-right").addEventListener("click", () => SDKAdapter.connect("R"));
  $("btn-stance").addEventListener("click", (e) => {
    S.stance = S.stance === "orthodox" ? "southpaw" : "orthodox";
    e.target.textContent = `Stance: ${S.stance[0].toUpperCase()}${S.stance.slice(1)}`;
    log(`Stance → ${S.stance} (${S.stance === "orthodox" ? "left" : "right"} lead).`);
  });
  $("btn-go").addEventListener("click", armGo);
  $("btn-sim").addEventListener("click", simStart);
  $("btn-export").addEventListener("click", exportCsv);
  document.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); armGo(); } });
  log("Ready. Connect both wrist Sense units, or hit Simulate.");
})();
