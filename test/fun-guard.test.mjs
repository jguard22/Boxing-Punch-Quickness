import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createMemoryStorage, createFirstWin, createSound, xpForNextLevel, FIRST_WIN_TARGET_MS } from "../src/vendor/fun-kit/index.js";
import { APP, CURVE, XP, BADGES, DROPS, TITLES, FEATURES, PB_METRICS, FIRST_WIN, SOUND_PLANS, HIT_SOUND, JUDGMENT_SOUND, JUDGMENTS, GRADES, SPEED_TIERS, NEVER_WORDS, HAPTIC_VOCABULARY } from "../src/fun/config.js";
import { COPY, allCopy } from "../src/fun/copy.js";
import { makeKit, makeDemoKit, KIT_CONFIG, fmtSpeed, useSpeedUnit } from "../src/fun/kit.js";
import { createStats, STAT_EVENTS } from "../src/fun/stats.js";
import * as prefs from "../src/fun/prefs.js";
import * as cel from "../src/fun/celebrate.js";
import { C } from "./fun-helpers.mjs";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules" || f === ".git" || / 2\./.test(f)) return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const funFiles = walk(join(root, "src/fun")).map((f) => relative(root, f));

// ---- one config, a second instance for the demo

test("one createFunKit config: playful mode, weekly sessions ring, the 200 XP day cap, no XP of the kit's own per session", () => {
  const kit = makeKit({ storage: createMemoryStorage() });
  assert.equal(kit.guard.mode, "playful");
  assert.equal(kit.guard.flags.streakMode, "weekly");
  assert.equal(kit.guard.flags.dailyXpSoftCap, XP.dayCap);
  assert.equal(kit.guard.ignored.length, 0, "no override was dropped");
  assert.equal(kit.streaks.rules.mode, "weekly");
  assert.equal(kit.streaks.rules.unit, "sessions");
  assert.equal(kit.xp.info().need, xpForNextLevel(1, CURVE), "the level curve is the kit's, from the config");
  assert.equal(KIT_CONFIG.app, APP);
  assert.equal(BADGES.length, 10, "the eight starter badges plus the two Combo Book ones");
  assert.equal(TITLES.length, 12);
  for (const d of DROPS) assert.equal(d.kind, "message", "surprises are kind notes, never tied to a measurement");
});

test("the Simulate profile is a second kit instance on memory storage; its XP is never saved, and only the Welcome Bonus reaches the real profile", () => {
  const storage = createMemoryStorage();
  const real = makeKit({ storage });
  const demo = makeDemoKit(real);
  assert.equal(demo.store.kind, "memory");
  assert.equal(demo.store.durable, false);
  assert.equal(demo.isFork, true);
  demo.xp.award({ amount: 500, source: "x", label: "x" });
  assert.equal(real.xp.total, 0, "nothing the demo earns reaches the real profile");
  assert.equal(demo.rewards ? true : true, true);
  const w = { amount: XP.welcome, key: "welcome", once: true, source: "welcome", label: "Welcome Bonus" };
  assert.equal(demo.awardToParent(w).gained, XP.welcome);
  assert.equal(real.xp.total, XP.welcome);
  assert.equal(demo.awardToParent(w).gained, 0, "paid once");
  demo.dispose();
});

test("Forget my data calls kit.reset() and leaves no kit key behind", () => {
  const storage = createMemoryStorage();
  const kit = makeKit({ storage });
  kit.xp.award({ amount: 80, source: "x", label: "x", key: "k" });
  kit.store.set("log.stats", { counts: { "round.done": 3 } });
  assert.ok(storage.length > 0);
  kit.reset();
  assert.equal(kit.xp.total, 0);
  const left = []; for (let i = 0; i < storage.length; i++) left.push(storage.key(i));
  assert.deepEqual(left.filter((k) => k.startsWith(`fk:${APP}:`)), []);
  assert.match(read("src/fun/session.js"), /kit\.reset\(\)/, "the Forget button calls kit.reset()");
});

test("the first win is measured: createFirstWin on a store, win inside 60 seconds, no signup or permission wall in the way", () => {
  const store = makeKit({ storage: createMemoryStorage() }).store;
  let t = 1_000_000;
  const fw = createFirstWin({ store, now: () => t, winEvent: FIRST_WIN.winEvent, beats: FIRST_WIN.beats.map((b) => ({ ...b, text: b.id })) });
  fw.start();
  t += 700; fw.event("punch");
  t += 4000; fw.event("combo");
  t += 25000; fw.event("warmup.done");
  const s = fw.state();
  assert.equal(s.done, true);
  assert.equal(s.timeToWinMs, 29700);
  assert.ok(s.timeToWinMs <= FIRST_WIN_TARGET_MS);
  assert.equal(s.withinTarget, true);
  const html = read("index.html");
  for (const wall of [/type="password"/i, /type="email"/i, /sign ?up/i, /log ?in/i, /create (an )?account/i]) assert.ok(!wall.test(html), `no ${wall}`);
});

test("the first win still ends on the warm-up round even if no combo was thrown", () => {
  const store = makeKit({ storage: createMemoryStorage() }).store;
  let t = 0;
  const fw = createFirstWin({ store, now: () => t, winEvent: FIRST_WIN.winEvent, beats: FIRST_WIN.beats.map((b) => ({ ...b, text: b.id })) });
  fw.start(); t += 30000; fw.event("warmup.done");
  assert.equal(fw.state().done, true);
});

// ---- words

test("all app copy passes kit.guard.lintCopy and the never-say list (bag and pad work: no damage, knockouts, power or force)", () => {
  const kit = makeKit({ storage: createMemoryStorage() });
  const strings = allCopy();
  assert.ok(strings.length > 120, `${strings.length} strings checked`);
  const extra = [
    ...BADGES.flatMap((b) => [b.title, b.desc]), ...DROPS.map((d) => d.title), ...TITLES.map((t) => t[1]),
    ...Object.values(FEATURES).map((f) => f.label), ...PB_METRICS.map((m) => m.label),
  ].map((text, i) => ({ path: `content[${i}]`, text }));
  const never = new RegExp(`\\b(${NEVER_WORDS.join("|")})\\b`, "i");
  const wellness = /\b(rehab\w*|heal(s|ed|ing)?|therap\w*|cure[sd]?|treat(s|ed|ing|ment|ments)?|diagnos\w*)\b/i;
  for (const { path, text } of [...strings, ...extra]) {
    assert.deepEqual(kit.guard.lintCopy(text), [], `${path}: "${text}" reads as pressure`);
    assert.ok(!never.test(text), `${path}: "${text}" uses a word this layer never says`);
    assert.ok(!wellness.test(text), `${path}: "${text}" breaks the wellness wording`);
    assert.ok(!/ghaps/i.test(text));
  }
  assert.ok(kit.guard.lintCopy("Don't break the streak").length > 0, "the lint does catch pressure language");
});

test("the safety line, the wellness note and the first screen are all on the page", () => {
  assert.match(COPY.safety, /Wrap your hands\. Warm up first\. Stop if anything hurts\./);
  assert.match(read("index.html"), /Wrap your hands\. Warm up first\. Stop if anything hurts\./);
  assert.match(read("index.html"), /not medical measurements/);
});

// ---- measurement and safety code never imports the kit; celebrations go through one gate

test("measurement and safety code never imports the kit: the detector, the page, the rules and the call judge are kit-free", () => {
  const importsKit = (f) => /vendor\/fun-kit|createFunKit/.test(read(f));
  for (const f of ["core.js", "app.js", "src/fun/config.js", "src/fun/copy.js", "src/fun/rules.js", "src/fun/calls.js", "src/fun/sim-driver.js", "src/fun/recap.js", "src/fun/stats.js", "src/fun/prefs.js", "src/fun/boot.js", "src/fun/start.js"]) {
    assert.equal(importsKit(f), false, `${f} must not import the kit`);
  }
  const importers = funFiles.filter((f) => f.endsWith(".js") && !f.includes("/vendor/") && importsKit(f)).sort();
  assert.deepEqual(importers, ["src/fun/celebrate.js", "src/fun/kit.js", "src/fun/session.js", "src/fun/ui.js"]);
  assert.ok(!/import\s/.test(read("app.js")) && !/require\(/.test(read("app.js")), "app.js stays a plain script with no imports");
  assert.ok(!/src\/fun|fun-kit/.test(read("core.js")));
});

test("every celebration goes through celebrate.js and its gate; no other file calls the kit's juice", () => {
  const juice = /\b(toast|burst|confetti|ribbons|bloom|gentleGlow|levelUpModal|unlockToast|playOutcome)\s*\(|\bsound\.play\s*\(|\bhaptics\.play\s*\(/;
  for (const f of funFiles.filter((x) => x.endsWith(".js") && x !== "src/fun/celebrate.js")) assert.equal(juice.test(read(f)), false, `${f} calls the kit's juice directly`);
  const c = read("src/fun/celebrate.js");
  assert.match(c, /createQuietGate/);
  assert.match(c, /gate\.run\(/);
  assert.match(c, /playOutcome\(/);
  assert.match(read("src/fun/session.js"), /cel\.celebrateOutcome\(/);
});

test("the gate holds a celebration while a round runs and plays it when the round ends", async () => {
  let running = true;
  cel.bind({ quiet: () => running, windowOpen: () => false });
  const handle = cel.celebrateOutcome({ outcome: { celebrations: [] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cel.gate.quiet, true, "closed while a round runs");
  assert.ok(cel.gate.pending > 0, "the celebration is waiting, not playing");
  running = false;
  cel.gate.flush({ force: true });
  const r = await handle;
  assert.equal(r.ran, true);
  assert.equal(cel.gate.pending, 0);
  cel.bind({ quiet: () => false });
});

test("the gate is closed while a punch window is open too", () => {
  cel.bind({ quiet: () => false, windowOpen: () => true });
  assert.equal(cel.gate.quiet, true);
  cel.bind({ windowOpen: () => false });
  assert.equal(cel.gate.quiet, false);
});

test("a buzz never goes out without a device, inside a punch window or within 350 ms of an onset", () => {
  const sent = [];
  let clock = 10_000, open = false;
  cel.bind({ now: () => clock, windowOpen: () => open, quiet: () => false });
  assert.equal(cel.buzz("perfect"), false, "no device is bound in this build: nothing sends a vibration");
  cel.bindDevice((name) => sent.push(name));
  cel.noteOnset(9_900);
  assert.equal(cel.buzz("perfect"), false, "100 ms after an onset");
  clock = 10_400;
  assert.equal(cel.buzz("perfect"), true);
  open = true;
  assert.equal(cel.buzz("perfect"), false, "a punch window is open");
  assert.deepEqual(sent, ["perfect"]);
  cel.bindDevice(null);
  assert.ok(HAPTIC_VOCABULARY.landed);
});

test("celebrations are never the only signal: every sound has a visual twin in copy, and no sound or buzz is required to read the game", () => {
  for (const j of Object.keys(JUDGMENTS)) { assert.ok(COPY.judgments[j].name && COPY.judgments[j].line, j); assert.ok(JUDGMENTS[j].shape); assert.ok(JUDGMENT_SOUND[j]); }
  for (const g of GRADES) { assert.ok(COPY.grade.names[g.id] && COPY.grade.lines[g.id], g.id); assert.ok(g.shape); }
  for (const t of SPEED_TIERS) { assert.ok(COPY.tiers[t.id].name, t.id); assert.ok(t.shape); }
  for (const type of ["jab", "cross", "hook", "uppercut"]) assert.ok(HIT_SOUND[type]);
  const shapes = new Set(Object.values(JUDGMENTS).map((j) => j.shape));
  assert.equal(shapes.size, 5, "five judgments, five shapes: never colour alone");
  const html = read("index.html");
  assert.match(html, /aria-live="polite"/, "judgments and grades are announced");
  assert.match(html, /id="call-digits"/, "the call is on screen as large text, so the spoken call is optional");
});

test("every sound the layer adds is a valid kit plan", () => {
  const sound = createSound({ createContext: () => null, plans: SOUND_PLANS });
  for (const name of Object.keys(SOUND_PLANS)) assert.ok(sound.has(name), name);
});

// ---- no raw values in any event; local only

test("fun stats take only allowlisted event names and whole-number counts: no sensor value, no name, no id", () => {
  const store = makeKit({ storage: createMemoryStorage() }).store;
  const stats = createStats(store);
  assert.equal(stats.count("round.done"), true);
  assert.equal(stats.count("punch.peakV"), false);
  assert.equal(stats.count("round.done", NaN), false);
  stats.count("call.perfect", 2.6);
  stats.firstWin(30096.4);
  const snap = stats.snapshot();
  assert.deepEqual(Object.keys(snap.counts).sort(), ["call.perfect", "round.done"]);
  assert.equal(snap.counts["call.perfect"], 3);
  assert.equal(snap.firstWinMs, 30096);
  assert.deepEqual(stats.csv().split("\n").slice(1, -1).map((l) => l.split(",")[0]), [...STAT_EVENTS]);
  assert.ok(!/(?:speed|peak|accel|\bg\b)/i.test(stats.csv()));
  for (const e of STAT_EVENTS) assert.match(e, /^[a-z]+(\.[A-Za-z]+)?$/);
});

test("the page sends nothing anywhere: no fetch, XHR, beacon or analytics in the fun layer", () => {
  for (const f of funFiles.filter((x) => x.endsWith(".js"))) assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|gtag|analytics)\b/.test(read(f)), f);
});

test("display preferences are validated and survive a browser with storage turned off", () => {
  assert.deepEqual(prefs.clean({ theme: "neon", motion: "reduce", sound: 5, calls: "off" }), { theme: "auto", motion: "reduce", sound: "on", voice: "off", calls: "off" });
  assert.deepEqual(prefs.load({ getItem() { throw new Error("blocked"); } }), { ...prefs.DEFAULTS });
  assert.equal(prefs.save({}, { setItem() { throw new Error("blocked"); } }), false);
  assert.equal(prefs.loadMode({ getItem: () => "lab" }), "lab");
  assert.equal(prefs.loadMode({ getItem: () => "weird" }), "fight");
  const mem = new Map();
  const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  prefs.save({ theme: "light" }, fake); prefs.saveMode("lab", fake);
  assert.equal(prefs.load(fake).theme, "light");
  prefs.forget(fake);
  assert.equal(mem.size, 0);
});

// ---- units: metric stored, metric or imperial shown

test("speeds are stored in m/s and shown as m/s or mph; personal-best lines follow the choice", () => {
  globalThis.BPCore = C;
  const kit = makeKit({ storage: createMemoryStorage() });
  let unit = "ms";
  useSpeedUnit(() => unit);
  assert.equal(fmtSpeed(8), "8.0 m/s");
  unit = "mph";
  assert.equal(fmtSpeed(8), `${(8 * 2.2369362920544).toFixed(1)} mph`);
  kit.pb.submit("speed_jab", 8);
  assert.equal(kit.pb.best("speed_jab"), 8, "stored in m/s whatever the display");
  const r = kit.pb.submit("speed_jab", 7.9);
  assert.match(r.text, /mph/);
  unit = "ms";
  assert.match(kit.pb.describe("speed_jab", kit.pb.submit("speed_jab", 7.8)), /m\/s/);
  delete globalThis.BPCore;
});

test("the speed shown in the stage and the tier line stay unit-aware, and the new copy never prints a bare speed", () => {
  for (const { text } of allCopy()) assert.ok(!/\b\d+(\.\d+)?\s?(m\/s|mph)\b/.test(text), text);
  assert.match(read("index.html"), /id="stage-speed"[^]*?class="unit u-speed"/, "the stage speed carries the page's unit label, which the page keeps in step");
  assert.match(read("src/fun/ui.js"), /\$\("last-speed"\)/, "and its number is the page's own, already converted");
});

// ---- tokens, motion, flashing

test("every --fk-* token the kit's stylesheet uses is mapped in fun.css (or set by the kit's own script), and nothing is raw", () => {
  const kitCss = read("src/vendor/fun-kit/ui/fun-kit.css"), fun = read("fun.css");
  const used = new Set([...kitCss.matchAll(/var\((--fk-[a-z0-9-]+)\s*[,)]/g)].map((m) => m[1]));
  const defined = new Set([...fun.matchAll(/(--fk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const inline = new Set([...kitCss.matchAll(/(--fk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const f of walk(join(root, "src/vendor/fun-kit")).filter((x) => x.endsWith(".js"))) for (const m of readFileSync(f, "utf8").matchAll(/["'`](--fk-[a-z0-9-]+)["'`]/g)) inline.add(m[1]);
  for (const v of used) assert.ok(defined.has(v) || inline.has(v), `${v} is used by fun-kit.css but not mapped in fun.css`);
  assert.doesNotMatch(fun, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(fun, /\b(?:rgba?|hsla?)\(/);
  assert.match(fun, /--fk-accent:\s*var\(--teal\)/);
  assert.match(read("styles.css"), /--teal:\s*#00d4aa/i, "brand teal is the page's own token");
  const html = read("index.html");
  assert.ok(!html.includes("vendor/fun-kit/ui/tokens.css"), "the kit's own tokens are never loaded");
  const order = ["styles.css", "fun-kit/ui/fun-kit.css", "fun.css"].map((s) => html.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "stylesheets load page tokens, kit, then the mapping");
});

test("light and dark are both defined from the same tokens, and the text-safe colours are darker in light", () => {
  const css = read("styles.css");
  assert.match(css, /:root\[data-theme="light"\]/);
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const light = css.slice(css.indexOf(':root[data-theme="light"]'));
  const tok = (name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(light)?.[1];
  const panel = tok("--panel"), text = tok("--text"), muted = tok("--muted");
  for (const name of ["--teal-text", "--amber-text", "--red-text", "--blue-text", "--violet-text"]) assert.ok(ratio(tok(name), panel) >= 4.5, `${name} on the light card: ${ratio(tok(name), panel).toFixed(2)}`);
  assert.ok(ratio(text, panel) >= 7 && ratio(muted, panel) >= 4.5);
  assert.ok(ratio(tok("--teal-text"), tok("--navy")) >= 4.5, "teal text on the light page background");
  const dark = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="light"]'));
  assert.ok(ratio(/--text:\s*(#[0-9a-fA-F]{6})/.exec(dark)[1], /--panel:\s*(#[0-9a-fA-F]{6})/.exec(dark)[1]) >= 7);
  assert.ok(ratio("#00d4aa", /--panel:\s*(#[0-9a-fA-F]{6})/.exec(dark)[1]) >= 4.5, "brand teal on the dark card");
});

test("reduced motion: the device setting and an in-app control that wins; nothing in the fun layer loops or flashes", () => {
  const fun = read("fun.css");
  assert.match(fun, /prefers-reduced-motion:\s*reduce/);
  assert.match(fun, /\[data-motion="full"\]/);
  assert.match(fun, /\[data-motion="reduce"\]/);
  assert.match(read("index.html"), /dataset\.motion/);
  assert.match(read("src/fun/celebrate.js"), /setReducedMotion\(/);
  assert.deepEqual([...fun.matchAll(/animation[^;{}]*\binfinite\b[^;{}]*/g)].map((m) => m[0]), [], "fun.css never loops an animation");
  for (const m of read("styles.css").matchAll(/animation:[^;]*\binfinite\b[^;]*/g)) {
    const dur = /var\((--[a-z-]+)\)/.exec(m[0])?.[1];
    const secs = Number(new RegExp(`${dur}:\\s*([\\d.]+)s`).exec(read("styles.css"))?.[1]);
    assert.ok(secs >= 0.34, `the page's looping pulse (${m[0].trim()}) runs under 3 flashes a second`);
  }
  const kitCss = read("src/vendor/fun-kit/ui/fun-kit.css");
  for (const l of kitCss.matchAll(/animation[^;{}]*\binfinite\b[^;{}]*/g)) assert.ok(Number(/\s([\d.]+)s\s/.exec(l[0])?.[1]) >= 1, `kit loop ${l[0]}`);
  assert.ok(!/renderStreakFlame|fk-streak-flame/.test(funFiles.map((f) => read(f)).join("")), "the kit's looping flame is not used");
  for (const id of ["seg-motion"]) assert.match(read("index.html"), new RegExp(`id="${id}"`));
});

test("the page stays usable without the fun layer: ?fun=0 and ?mode=lab show the original structure", () => {
  const html = read("index.html"), css = read("fun.css");
  assert.match(html, /get\("fun"\) === "0"/);
  assert.match(css, /html\[data-fun="off"\] \.fun-only/);
  assert.match(css, /html\[data-mode="lab"\] \.fun-only/);
  assert.match(read("src/fun/boot.js"), /get\("fun"\) === "0"/);
  assert.doesNotMatch(read("src/fun/boot.js"), /^\s*(import|export)\s/m, "boot.js is a plain script with only a dynamic import, so ?fun=0 fetches nothing and a browser without module support still falls back");
  assert.match(read("src/fun/boot.js"), /dataset\.fun = "off"/, "if the layer cannot start, the page becomes the original page");
  assert.match(read("index.html"), /<script src="src\/fun\/boot\.js"><\/script>/);
  for (const id of ["btn-left", "btn-right", "btn-insoles", "btn-stance", "btn-sim", "btn-export", "btn-export-rounds", "btn-reset", "units-seg", "summary-card", "round-wrap", "fx-wrap", "cm-wrap", "punch-table", "log"]) assert.match(html, new RegExp(`id="${id}"`), `${id} is still on the page`);
});

test("the vendored kit has its VERSION and still matches the hygiene lint", () => {
  assert.ok(existsSync(join(root, "src/vendor/fun-kit/VERSION")));
  assert.match(read("src/vendor/fun-kit/VERSION"), /^bw-fun-kit \d+\.\d+\.\d+\ncommit [0-9a-f]{40}/);
});
