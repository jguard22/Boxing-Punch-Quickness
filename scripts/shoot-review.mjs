// Design-review screenshots: the same screens at 1280 / 390 / 320 px, light and dark, named <prefix>-<screen>-<width>-<look>.png so a
// "before" and an "after" run line up as pairs.
//   node scripts/shoot-review.mjs <prefix> <outdir> [variants]      e.g.  before ~/Claude/overnight-2026-10-25/shots/boxing-punch-demo
//   VARIANTS=1280-dark,390-light  limits the run (default: 1280-dark, 1280-light, 390-dark, 390-light, 320-dark)
// Starts the static server on PORT (default 5362), needs Google Chrome and playwright-core (PW=/path/to/playwright-core).
// Each variant plays the Simulate warm-up (about 31 s) and one coached round (about 31 s), then seeds personal bests to shoot the returning first screen.
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
const PREFIX = process.argv[2] || "after";
const OUT = process.argv[3] || path.join(os.tmpdir(), "boxing-review");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5362);
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const PAGE = `${BASE}?round=0.5&rest=0.05&rounds=1`;
const ALL = {
  "1280-dark": { w: 1280, h: 800, scheme: "dark" }, "1280-light": { w: 1280, h: 800, scheme: "light" },
  "390-dark": { w: 390, h: 844, scheme: "dark" }, "390-light": { w: 390, h: 844, scheme: "light" },
  "320-dark": { w: 320, h: 640, scheme: "dark" }, "320-light": { w: 320, h: 640, scheme: "light" },
};
const want = (process.env.VARIANTS || "1280-dark,1280-light,390-dark,390-light,320-dark").split(",").map((s) => s.trim());
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const hard = setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(2); }, 900000);
const errors = [], notes = [];

async function dismissModal(page) {
  if (await page.$(".fk-modal .fk-btn")) { await page.click(".fk-modal .fk-btn"); await page.waitForTimeout(350); return true; }
  return false;
}
async function until(page, fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn)) return true; await dismissModal(page); await page.waitForTimeout(100); }
  return false;
}

for (const key of want) {
  const v = ALL[key];
  if (!v) continue;
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, colorScheme: v.scheme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${key} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${key} console ${m.type()}: ${m.text()}`); });
  await page.route("**/unpkg.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* sdk stub for screenshots */" }));
  const shot = async (name, full = false, settle = 650) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}-${key}.png`), fullPage: full });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ov > 1) notes.push(`${key} ${name}: ${ov}px of sideways overflow`);
    console.log("shot", `${PREFIX}-${name}-${key}`);
  };

  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__bwFun);
  await shot("hero", true);
  await shot("hero-fold", false, 50);

  await page.click("#hero-sim");
  await until(page, () => window.__bwBoxing.S.punches.length >= 2, 6000);
  const n0 = await page.evaluate(() => window.__bwBoxing.S.punches.length);
  await page.evaluate((n) => new Promise((r) => { const t = setInterval(() => { if (window.__bwBoxing.S.punches.length > n) { clearInterval(t); r(); } }, 10); }), n0);
  await shot("impact", false, 120);          // a moment after a punch landed: the slam is still playing
  await page.waitForTimeout(1500);
  await shot("warmup", false, 300);

  await until(page, () => !document.getElementById("fun-grade").hidden, 40000);
  await page.waitForTimeout(900);
  await shot("grade", false, 300);
  await dismissModal(page);
  await until(page, () => document.getElementById("fun-recap").open, 8000);
  await shot("recap");
  await page.click("#recap-cta");
  const got = await until(page, () => !document.getElementById("call-banner").hidden, 25000);
  if (got) { await page.waitForTimeout(500); await shot("call", false, 100); }
  const judged = await until(page, () => !document.getElementById("call-stamp").hidden, 25000);
  if (judged) await shot("judged", false, 500);
  await until(page, () => document.getElementById("fun-recap").open, 60000);
  await page.waitForTimeout(500);
  await shot("recap2");
  await page.click("#recap-later");
  await page.waitForTimeout(400);
  await shot("after", true);
  await page.click("#btn-lab");
  await shot("lab", true);

  // the returning visitor: seed personal bests the way a real session would have left them, then reload with the default round settings
  const seeded = await page.evaluate(() => {
    const demo = window.__bwFun.getDemoKit().pb.all().filter((x) => x.best != null);
    const kit = window.__bwFun.kit;
    const fallback = { speed_jab: 8.1, speed_cross: 9.4, speed_hook: 8.7, speed_uppercut: 7.6, roundGrade: 76, flow: 3, longestChain: 4 };
    for (const id of Object.keys(fallback)) kit.pb.submit(id, demo.find((d) => d.id === id)?.best ?? fallback[id], { at: Date.now() });
    return demo.length;
  });
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__bwFun);
  await shot("returning", true);
  await shot("returning-fold", false, 50);
  await page.click("#btn-setup");
  await page.click("nav.sections a[href='#fun-settings']");
  await shot("settings", false);
  notes.push(`${key}: ${seeded} bests came from the demo profile`);
  await ctx.close();
}

clearTimeout(hard);
console.log(notes.join("\n"));
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
