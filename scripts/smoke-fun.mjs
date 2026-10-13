// Headless smoke test of the Fight view (the fun layer) in system Chrome (playwright-core).
//   node scripts/smoke-fun.mjs [outdir]
// Starts the static server on :5362 (PORT to override) and drives, with Simulate and no sensors: the first win (first punch
// inside about a second, a Round Grade stamp at about 31 s, Level 2, the recap, the one-tap feedback), a coached set with calls,
// the m/s to mph switch, Lab and Fight views, ?fun=0 (the original page, no storage touched), reduced motion, Forget my data,
// phone width (no horizontal scroll) and zero console errors. Needs Google Chrome + playwright-core (PW=/path/to/playwright-core).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
function findPw() {
  if (process.env.PW) return process.env.PW;
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) { const p = path.join(npx, d, "node_modules/playwright-core"); if (existsSync(p)) return p; }
  return "playwright-core";
}
const { chromium } = require(findPw());

const PORT = Number(process.env.PORT || 5362);
const PAGE = `http://127.0.0.1:${PORT}/index.html`;
const OUT = process.argv[2] || path.join(os.tmpdir(), "boxing-fun-shots");
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };

const server = await startServer(PORT);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const hard = setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(2); }, 280000);

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "dark", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`console ${m.type()}: ${m.text()}`); });
  await page.route("**/unpkg.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* sdk stub for smoke test */" }));
  return page;
}
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.$eval(sel, (e) => !!(e.offsetParent || e.getClientRects().length)).catch(() => false);
const ready = (page) => page.waitForFunction(() => !!window.__bwFun, null, { timeout: 8000 });
/** Click away a level-up modal if one is open (the player does this with "Keep going"). */
async function dismissModal(page) {
  if (await page.$(".fk-modal .fk-btn")) { await page.click(".fk-modal .fk-btn"); await page.waitForTimeout(350); return true; }
  return false;
}
async function until(page, fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return true;
    await dismissModal(page);
    await page.waitForTimeout(150);
  }
  console.log(`   (timed out waiting for ${label})`);
  return false;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  // ---- A: ?fun=0 is the original page: nothing of the fun layer shows, no storage is touched
  {
    const page = await newPage();
    await page.goto(`${PAGE}?fun=0`);
    await page.waitForTimeout(800);
    check(await page.evaluate(() => document.documentElement.dataset.fun === "off" && document.documentElement.dataset.mode === "lab"), "?fun=0: lab view, fun layer off");
    check(!(await visible(page, "#fun-hero")) && !(await visible(page, "#mode-seg")) && !(await visible(page, "nav.sections")), "?fun=0: no hero, no view switch, no section nav");
    check((await visible(page, "#btn-sim")) && (await visible(page, "#card-clock")) && (await visible(page, "#punch-table")) && (await visible(page, "#btn-export")), "?fun=0: every control and card of the original page is there");
    check(await page.evaluate(() => !window.__bwFun && !Object.keys(localStorage).some((k) => k.startsWith("fk:") || k.startsWith("bw-box-"))), "?fun=0: the fun layer is not loaded and writes no storage");
    check(await page.evaluate(() => document.documentElement.dataset.theme === "dark"), "?fun=0: the original dark look");
    await page.context().close();
  }

  // ---- A2: if the fun layer cannot load (a browser or a file:// page that refuses modules), the page is the original page
  {
    // no error collectors here: the failed fetch and the layer's own warning are what this case is about
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route("**/unpkg.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* stub */" }));
    await page.route("**/src/fun/start.js*", (r) => r.abort());
    await page.goto(PAGE);
    await page.waitForTimeout(1500);
    check(await page.evaluate(() => document.documentElement.dataset.fun === "off" && document.documentElement.dataset.mode === "lab"), "fallback: the layer failed to load, the original page is shown");
    check((await visible(page, "#btn-sim")) && (await visible(page, "#punch-table")) && !(await visible(page, "#fun-hero")), "fallback: every control and card is there, no dead hero");
    await page.click("#btn-sim");
    await page.waitForTimeout(1500);
    check(Number(await txt(page, "#count-total")) > 0, "fallback: Simulate still works");
    await ctx.close();
  }

  // ---- B: Lab and Fight views, and the way between them
  {
    const page = await newPage();
    await page.goto(`${PAGE}?mode=lab`);
    await ready(page);
    check((await visible(page, "#punch-table")) && (await visible(page, "#btn-export-rounds")) && !(await visible(page, "#fun-hero")), "?mode=lab: every lab card and export, no hero");
    check((await visible(page, "#mode-seg")) && !(await visible(page, "#btn-setup")), "?mode=lab: the Fight / Lab switch is there, the Setup button is not needed");
    check(await page.evaluate(() => !localStorage.getItem("bw-box-mode")), "?mode=lab is for this visit only");
    await page.click('#mode-seg button[data-mode="fight"]');
    check((await visible(page, "#fun-hero")) && !(await visible(page, "#punch-table")), "one tap on Fight returns to the game view");
    check(await page.evaluate(() => localStorage.getItem("bw-box-mode") === "fight"), "the choice is remembered");
    await page.click('#mode-seg button[data-mode="lab"]');
    await page.reload(); await ready(page);
    check(await page.evaluate(() => document.documentElement.dataset.mode === "lab"), "Lab is remembered across a reload");
    await page.click('#mode-seg button[data-mode="fight"]');
    await page.context().close();
  }
} catch (e) {
  failures.push(`exception: ${e.message}`);
  console.error(e);
}

try {
  // ---- C: the first win, Fight view, 390 px, Simulate
  const page = await newPage();
  await page.goto(`${PAGE}?round=0.5&rest=0.05&rounds=2`);
  await ready(page);
  check(await page.evaluate(() => document.documentElement.dataset.mode === "fight"), "the page opens in Fight view");
  check((await visible(page, "#fun-hero")) && (await txt(page, "#hero-title")) === "Bag work, but it talks back.", "hero: Bag work, but it talks back");
  check((await txt(page, "#hero-warmup")).includes("30-second warm-up") && (await txt(page, "#hero-sim")).includes("Simulate"), "hero offers the warm-up and Simulate (no sensors)");
  check((await txt(page, "#hero-safety")) === "Wrap your hands. Warm up first. Stop if anything hurts.", "the safety line is under the buttons");
  check(!(await visible(page, "#punch-table")) && !(await visible(page, "#cm-wrap")), "lab details are collapsed in Fight view");
  check((await overflow(page)) <= 1, `no horizontal scroll at 390 px (hero)`);
  await page.screenshot({ path: path.join(OUT, "01-hero.png"), fullPage: true });

  // no sensors, no Simulate: a gentle hint instead of a dead round
  await page.click("#hero-warmup");
  check((await visible(page, "#hero-hint")) && (await txt(page, "#hero-hint")).includes("No wrist sensor"), "warm-up without a sensor or Simulate says what to do, and starts no round");

  const t0 = Date.now();
  await page.click("#hero-sim");
  const gotPunch = await until(page, () => window.__bwBoxing.S.punches.length > 0, 4000, "the first punch");
  const firstMs = Date.now() - t0;
  check(gotPunch && firstMs < 1500, `first punch lands inside about a second (${firstMs} ms)`);
  await page.waitForTimeout(250);
  check((await visible(page, "#fun-stage")) && !(await visible(page, "#fun-hero")), "the stage replaces the hero while the round runs");
  check((await txt(page, "#stage-last")) === (await txt(page, "#last-type")) && (await txt(page, "#stage-last")) !== "—", `the punch is on the stage as it lands (${await txt(page, "#stage-last")})`);
  check((await txt(page, "#stage-phase")) === "Warm-up round", "phase: Warm-up round");
  check((await txt(page, "#stage-time")).match(/^0:\d\d$/) != null, "the round time is on the stage");
  check((await txt(page, "#fun-status")).includes("Simulate: XP isn't saved, except your Welcome Bonus."), "status: Simulate: XP isn't saved, except your Welcome Bonus");
  await page.screenshot({ path: path.join(OUT, "02-warmup.png"), fullPage: false });

  // the unit switch changes the stage speed too, stored value stays m/s
  const u = await page.evaluate(() => {
    const peak = window.__bwBoxing.S.punches.at(-1).peakV, ms = document.getElementById("stage-speed").textContent;
    document.querySelector('#units-seg button[data-unit="mph"]').click();
    return { ms, mph: document.getElementById("stage-speed").textContent, unit: document.querySelector("#stage-live .u-speed").textContent, peak };
  });
  check(u.ms === u.peak.toFixed(1) && u.mph === (u.peak * 2.2369362920544).toFixed(1) && u.unit === "mph", `m/s -> mph on the stage (${u.ms} m/s = ${u.mph} mph, stored ${u.peak.toFixed(2)} m/s)`);
  await page.click('#units-seg button[data-unit="ms"]');
  check((await overflow(page)) <= 1, "no horizontal scroll at 390 px (warm-up)");

  const gradeUp = await until(page, () => !document.getElementById("fun-grade").hidden, 40000, "the Round Grade stamp");
  const gradeMs = Date.now() - t0;
  check(gradeUp && gradeMs > 28000 && gradeMs < 36000, `the Round Grade stamp lands at about 31 s (${(gradeMs / 1000).toFixed(1)} s)`);
  check((await txt(page, "#grade-stamp")) === "Warm-up" && (await txt(page, "#grade-xp")).startsWith("+"), `grade: ${await txt(page, "#grade-stamp")}, ${await txt(page, "#grade-xp")}`);
  const modal = await until(page, () => !!document.querySelector(".fk-modal"), 5000, "the level-up modal");
  check(modal, "Level 2 modal");
  if (modal) { check((await txt(page, ".fk-modal-title")).includes("level 2") && (await txt(page, ".fk-modal-sub")) === "Wrap Hands", `level-up: ${await txt(page, ".fk-modal-title")} / ${await txt(page, ".fk-modal-sub")}`); await page.screenshot({ path: path.join(OUT, "03-levelup.png"), fullPage: false }); await dismissModal(page); }
  const recapOpen = await until(page, () => document.getElementById("fun-recap").open, 6000, "the recap");
  check(recapOpen, "the recap sheet opens after the level-up");
  check((await page.$$eval(".fk-recap-card", (c) => c.length)) === 3, "recap has three cards (Rounds, Combo highlight, Up next)");
  check((await page.$$eval(".fk-recap-eyebrow", (c) => c.map((x) => x.textContent))).join("|") === "Rounds|Combo highlight|Up next", "card names");
  await page.screenshot({ path: path.join(OUT, "04-recap.png"), fullPage: false });
  const fw = await page.evaluate(() => window.__bwFun.firstWin.state());
  check(fw.done && fw.timeToWinMs < 60000, `createFirstWin().state().timeToWinMs = ${fw.timeToWinMs} ms (under 60 s)`);
  const xp = await page.evaluate(() => ({ real: window.__bwFun.kit.xp.info(), demo: window.__bwFun.getDemoKit().xp.info(), keys: Object.keys(localStorage).filter((k) => k.startsWith("fk:boxing-demo:")) }));
  check(xp.demo.level >= 2 && xp.real.total === 40, `demo profile reached Level ${xp.demo.level}; the real profile kept only the Welcome Bonus (${xp.real.total} XP)`);
  check(!xp.keys.some((k) => /badges|streak|pb$/.test(k)), "no demo badge, streak or best was saved");
  check(await visible(page, "#ics-box"), "the recap offers Add my next session (a downloadable calendar file)");
  check(await page.evaluate(() => !document.getElementById("card-book").hidden && document.querySelectorAll("#book-list .book-page").length >= 11), "the Combo Book appears after the first combo, with its named pages");
  check(await page.evaluate(() => document.getElementById("card-pb").hidden), "no personal best from the warm-up round");
  // the one-tap feedback
  check(await visible(page, "#recap-feedback"), "Loved it / Fine / Not for me is on the first recap");
  await page.click('#seg-recap-fb button[data-v="loved"]');
  const fb = await page.evaluate(() => window.__bwFun.kit.store.get("log.feedback", []));
  check(fb.length === 1 && fb[0].choice === "loved" && fb[0].winMs === fw.timeToWinMs, "feedback saved locally with the first-win time");
  check(!JSON.stringify(fb).match(/peak|speed|accel/i), "no sensor value in the feedback record");

  // ---- the coached set: calls, judgments, Flow
  await page.click("#recap-cta");
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__bwBoxing.S.rounds.length === 1 && window.__bwBoxing.S.sim), "Round 1: Coach Calls starts a fresh set and keeps Simulate on");
  check((await txt(page, "#stage-phase")).startsWith("Round 1 of 2"), "phase: Round 1 of 2");
  const stamped = await until(page, () => !document.getElementById("call-stamp").hidden, 25000, "the first judgment stamp");
  check(stamped, "a coach call was judged");
  if (stamped) {
    const j = await page.$eval("#call-stamp", (e) => ({ j: e.dataset.j, text: e.textContent.trim(), glyph: e.dataset.glyph }));
    check(["perfect", "great", "good", "count", "missed"].includes(j.j) && j.glyph && j.text.length > 3, `judgment is shape plus word: ${j.glyph} ${j.text}`);
    check(await page.evaluate(() => document.getElementById("call-digits").textContent.trim().length > 0 && document.getElementById("call-names").textContent.trim().length > 0), "the call was on screen as large text with names");
    await page.screenshot({ path: path.join(OUT, "05-call.png"), fullPage: false });
  }
  check(await visible(page, "#stage-flow"), "the Flow chip shows in a called round");
  // round 1 ends, rest, round 2, done
  await until(page, () => document.getElementById("fun-recap").open, 90000, "the coached recap");
  const set = await page.evaluate(() => window.__bwFun.set.rounds.map((r) => ({ n: r.n, grade: r.grade, calls: r.calls.length, xp: r.xp })));
  check(set.length === 2 && set.every((r) => r.calls >= 1), `two rounds graded with calls (${JSON.stringify(set)})`);
  check(await page.evaluate(() => [...document.querySelectorAll("#book-list .book-page")].some((li) => li.dataset.locked === "0" && /Perfect|Great|Good|Free work|Counted/.test(li.textContent))), "Combo Book pages fill in with their best judgment");
  check((await txt(page, "#recap-cta")) === "Play again", "coached recap offers Play again");
  await page.screenshot({ path: path.join(OUT, "06-coached-recap.png"), fullPage: false });
  await page.click("#recap-later");
  check((await visible(page, "#fun-grade")) && (await visible(page, "#grade-actions")), "after the recap: the grade stays with Recap and Play again");

  // reduced motion: the in-app control wins and every animation stops
  await page.click('#seg-motion button[data-v="reduce"]');
  check(await page.evaluate(() => document.documentElement.dataset.motion === "reduce" && getComputedStyle(document.getElementById("grade-stamp")).animationName === "none"), "Settings > Motion > Reduced: data-motion=reduce and no animation runs");
  await page.click('#seg-motion button[data-v="auto"]');

  // Lab details and the Lab view are one tap away
  await page.click("#btn-lab");
  check((await visible(page, "#punch-table")) && (await visible(page, "#summary-card")), "Show lab details reveals every table");
  await page.click("#btn-lab");
  check(!(await visible(page, "#punch-table")), "and hides them again");
  await page.click('#mode-seg button[data-mode="lab"]');
  check((await visible(page, "#punch-table")) && !(await visible(page, "#fun-status")) && (await visible(page, "#btn-left")), "Lab view: the original page, header controls included");
  await page.click('#mode-seg button[data-mode="fight"]');

  // Setup: the sensor and export controls are behind one labelled button in Fight view
  check(!(await visible(page, "#btn-export")), "Fight view: exports are tucked behind Setup");
  await page.click("#btn-setup");
  check((await visible(page, "#btn-export")) && (await visible(page, "#btn-left")) && (await visible(page, "#btn-reset")), "Setup shows the sensor, simulate, export and reset controls");

  // Forget my data
  await page.click("#btn-forget");
  check((await txt(page, "#btn-forget")) === "Click again to forget", "Forget my data asks for a second click");
  await page.click("#btn-forget");
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => ({ xp: window.__bwFun.kit.xp.total, done: window.__bwFun.firstWin.isDone(), keys: Object.keys(localStorage).filter((k) => k.startsWith("fk:boxing-demo:") && !k.endsWith(":__v")) }));
  check(gone.xp === 0 && !gone.done && gone.keys.length === 0, `Forget my data: XP ${gone.xp}, first win cleared, no kit keys left (${gone.keys.join(",") || "none"})`);
  await page.screenshot({ path: path.join(OUT, "07-settings.png"), fullPage: true });
  await page.context().close();

  // ---- D: reduced motion from the device, light look, 414 px
  {
    const page2 = await newPage({ reducedMotion: "reduce", colorScheme: "light", viewport: { width: 414, height: 896 } });
    await page2.goto(`${PAGE}?round=0.5&rest=0.05&rounds=1`);
    await ready(page2);
    check(await page2.evaluate(() => document.documentElement.dataset.theme === "light"), "a light device gets the light look");
    check((await overflow(page2)) <= 1, "no horizontal scroll at 414 px");
    await page2.click("#hero-sim");
    await until(page2, () => !document.getElementById("fun-grade").hidden, 40000, "the grade");
    check(await page2.evaluate(() => getComputedStyle(document.getElementById("grade-stamp")).animationName === "none" && !document.documentElement.dataset.motion), "device reduced motion: no animation, no in-app override needed");
    await dismissModal(page2);
    await page2.screenshot({ path: path.join(OUT, "08-light-reduced.png"), fullPage: false });
    await page2.context().close();
  }
} catch (e) {
  failures.push(`exception: ${e.message}`);
  console.error(e);
}

clearTimeout(hard);
console.log(errors.length ? `JS/console errors:\n${errors.join("\n")}` : "no JS/console errors");
if (errors.length) failures.push("console errors");
await browser.close();
server.close();
console.log(failures.length ? `\nFUN SMOKE FAILED (${failures.length})` : "\nFUN SMOKE PASSED");
process.exit(failures.length ? 1 : 0);
