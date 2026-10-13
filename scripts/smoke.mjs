// Headless smoke test of Simulate mode in system Chrome (playwright-core).
//   node scripts/smoke.mjs [outdir]
// Starts the static server on :5362 (PORT to override), drives a short 3-round
// session, asserts the feature set renders, the unit switch works, and that the
// page logged zero JS/console errors. Needs Google Chrome + playwright-core
// (PW=/path/to/playwright-core, default: the npx cache used by the sibling repos).
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
const OUT = process.argv[2] || path.join(os.tmpdir(), "boxing-shots");
mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };

const server = await startServer(PORT);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const hard = setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(2); }, 150000);

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.route("**/unpkg.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* sdk stub for smoke test */" }));
  return page;
}
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());

try {
  // ---- A: full 3-round session with sim insoles ----
  const page = await newPage({ width: 1360, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?round=0.15&rest=0.05&rounds=3`);
  check((await txt(page, "#clock-sub")).startsWith("9 s round · 3 s rest"), "URL params set the timer (9 s / 3 s)");
  await page.click("#btn-sim");
  await page.click("#btn-rounds");
  await page.waitForFunction(() => document.getElementById("clock-phase").textContent.includes("Round 1"), null, { timeout: 5000 });
  await page.waitForTimeout(7000);
  check((await txt(page, "#wt-state")) === "sim insoles", "insole channel detected while simulating");
  check((await txt(page, "#wt-last")) !== "—", "weight transfer shown for last punch");
  check((await txt(page, "#combo-cur")) !== "—", `combo string shown (${await txt(page, "#combo-cur")})`);
  // units switch on live data
  const msVal = Number(await txt(page, "#last-speed"));
  await page.click('#units-seg button[data-unit="mph"]');
  const mphVal = Number(await txt(page, "#last-speed"));
  check(Math.abs(mphVal / msVal - 2.23694) < 0.08, `m/s -> mph switch (${msVal} m/s = ${mphVal} mph)`);
  check((await txt(page, ".u-speed")) === "mph", "unit label follows the switch");
  const stored = await page.evaluate(() => window.__bwBoxing.S.punches[window.__bwBoxing.S.punches.length - 1].peakV);
  check(stored > 1 && stored < 20, `speed stays stored in m/s (${stored.toFixed(2)})`);
  await page.click('#units-seg button[data-unit="ms"]');
  await page.waitForFunction(() => document.getElementById("clock-phase").textContent.includes("Session complete"), null, { timeout: 60000 });
  await page.waitForTimeout(600);

  const nPunches = Number(await txt(page, "#count-total"));
  check(nPunches >= 12, `punches detected through the real pipeline (${nPunches})`);
  const roundRows = await page.$$eval("#round-table tbody tr.round-row", (r) => r.length);
  check(roundRows === 3, `3 per-round rows (${roundRows})`);
  const perRound = await page.$$eval("#round-table tbody tr.round-row", (rows) => rows.map((r) => r.children[1].textContent));
  check(perRound.every((n) => Number(n) >= 3), `each round has punches (${perRound.join("/")})`);
  check(Number(perRound.reduce((a, b) => a + Number(b), 0)) <= nPunches, "round punches never exceed total");
  check(await page.$("#fx-wrap svg.fx") != null, "fatigue curve drawn");
  const cmTag = await txt(page, "#cm-tag");
  check(/^\d+ reviewed/.test(cmTag) && !cmTag.startsWith("0 "), `confusion matrix from sim labels (${cmTag})`);
  const kpis = await page.$$eval("#kpis .kpi", (k) => k.length);
  check(kpis === 8, "8 summary KPIs");
  const notes = await page.$$eval("#notes .n", (n) => n.length);
  check(notes >= 2, `coach notes (${notes})`);
  check((await txt(page, "#summary-tag")).startsWith("complete"), "summary marked complete");
  check((await txt(page, "#btn-sim")) === "Simulate", "sim auto-stops when rounds finish");

  // review a punch by hand: relabel the newest punch, the matrix and the log react
  const sel = "#punch-table tbody tr:first-child select";
  const cur = await page.$eval(sel, (e) => e.value);
  const pick = cur === "uppercut" ? "jab" : "uppercut";
  const cmBefore = await page.$eval("#cm-wrap", (e) => e.innerHTML);
  await page.selectOption(sel, pick);
  await page.waitForTimeout(300);
  check((await page.$eval("#cm-wrap", (e) => e.innerHTML)) !== cmBefore, `manual correction moves the confusion matrix (-> ${pick})`);
  check((await txt(page, "#log")).includes(`→ ${pick}`) || (await txt(page, "#log")).includes("confirmed"), "correction logged");
  check((await page.$eval(sel, (e) => e.value)) === pick, "dropdown keeps the corrected label after re-render");

  // CSV exports
  const [dl1] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export-rounds")]);
  const fs = await import("node:fs/promises");
  const csv1 = await fs.readFile(await dl1.path(), "utf8"), csv2 = await fs.readFile(await dl2.path(), "utf8");
  check(csv1.split("\n")[0].includes("peak_speed_ms") && csv1.split("\n").length === nPunches + 1, `punch CSV rows (${csv1.split("\n").length - 1})`);
  check(csv2.split("\n").length === 4, "rounds CSV: header + 3 rounds");
  await page.screenshot({ path: path.join(OUT, "desktop-session.png"), fullPage: true });
  console.log("shot desktop-session.png");

  // mobile layout of the same page
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `no horizontal page scroll at 390 px (overflow ${overflow}px)`);
  await page.screenshot({ path: path.join(OUT, "mobile-session.png"), fullPage: true });
  console.log("shot mobile-session.png");
  await page.context().close();

  // ---- B: optional insoles absent ----
  const pb = await newPage({ width: 1360, height: 900 });
  await pb.goto(`http://127.0.0.1:${PORT}/index.html`);
  await pb.uncheck("#sim-insoles");
  await pb.uncheck("#sim-truth");
  await pb.click("#btn-sim");
  await pb.waitForTimeout(9000);
  check(Number(await txt(pb, "#count-total")) >= 3, "free-work punches without rounds");
  check((await txt(pb, "#wt-state")) === "no insoles", "no insoles -> chip says so");
  check((await txt(pb, "#wt-last")) === "—", "no insoles -> no weight-transfer value");
  await pb.click('#units-seg button[data-unit="mph"]');
  check((await txt(pb, "#round-table thead .u-speed")) === "mph", "round table header follows unit");
  await pb.screenshot({ path: path.join(OUT, "desktop-free-work.png"), fullPage: true });
  await pb.click("#btn-sim");
  // unreviewed punches don't count until confirmed
  const nB = Number(await txt(pb, "#count-total"));
  check((await txt(pb, "#cm-tag")) === "0 reviewed", "unreviewed punches stay out of the confusion matrix");
  await pb.click("#btn-confirm-all");
  const cmB = await txt(pb, "#cm-tag");
  check(cmB === `${nB} reviewed · 100% match`, `confirm-all marks every punch reviewed (${cmB})`);
  // reset flow (two-click confirm)
  await pb.click("#btn-reset");
  await pb.click("#btn-reset");
  check((await txt(pb, "#count-total")) === "0", "reset clears the session");
  await pb.context().close();
} catch (e) {
  failures.push(`exception: ${e.message}`);
  console.error(e);
}

clearTimeout(hard);
console.log(errors.length ? `JS/console errors:\n${errors.join("\n")}` : "no JS/console errors");
if (errors.length) failures.push("console errors");
await browser.close();
server.close();
console.log(failures.length ? `\nSMOKE FAILED (${failures.length})` : "\nSMOKE PASSED");
process.exit(failures.length ? 1 : 0);
