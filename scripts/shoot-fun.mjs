// Headless screenshots of the Fight view at phone width (390 px): light, dark and reduced motion, with Simulate and no sensors.
// SCALE=2 for retina images (about 10 MB for the set; the default 1x keeps the repo light).
//   node scripts/shoot-fun.mjs [outdir]          default: docs/screenshots/fun
// Adapted from the sibling repos' shoot scripts. Starts the static server on :5362 (PORT to override). Needs Google Chrome +
// playwright-core (PW=/path/to/playwright-core). Each variant plays the warm-up round (about 31 s) and one coached round (about 31 s).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
function findPw() {
  if (process.env.PW) return process.env.PW;
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) { const p = path.join(npx, d, "node_modules/playwright-core"); if (existsSync(p)) return p; }
  return "playwright-core";
}
const { chromium } = require(findPw());
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "docs/screenshots/fun");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 5362);
const PAGE = `http://127.0.0.1:${PORT}/index.html?round=0.5&rest=0.05&rounds=1`;
const server = await startServer(PORT);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const hard = setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(2); }, 420000);
const errors = [];

const VARIANTS = [
  { name: "light", opts: { colorScheme: "light" } },
  { name: "dark", opts: { colorScheme: "dark" } },
  { name: "reduced", opts: { colorScheme: "dark", reducedMotion: "reduce" } },
];

async function dismissModal(page) {
  if (await page.$(".fk-modal .fk-btn")) { await page.click(".fk-modal .fk-btn"); await page.waitForTimeout(350); return true; }
  return false;
}
async function until(page, fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn)) return true; await dismissModal(page); await page.waitForTimeout(150); }
  return false;
}

for (const v of VARIANTS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.SCALE || 1), ...v.opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${v.name} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${v.name} console ${m.type()}: ${m.text()}`); });
  await page.route("**/unpkg.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* sdk stub for screenshots */" }));
  const shot = async (name, full = false) => { await page.waitForTimeout(v.name === "reduced" ? 200 : 650); await page.screenshot({ path: path.join(OUT, `${v.name}-${name}.png`), fullPage: full }); console.log("shot", `${v.name}-${name}`); };

  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__bwFun);
  await shot("01-hero", true);

  await page.click("#hero-sim");
  await until(page, () => window.__bwBoxing.S.punches.length >= 3, 6000);
  await page.waitForTimeout(1200);
  await shot("02-warmup");

  await until(page, () => !document.getElementById("fun-grade").hidden, 40000);
  await page.waitForTimeout(900);
  await shot("03-grade-levelup");
  await dismissModal(page);
  await until(page, () => document.getElementById("fun-recap").open, 8000);
  await shot("04-recap");
  await page.evaluate(() => document.querySelector(".fk-recap-track")?.children[2]?.scrollIntoView({ inline: "center", block: "nearest" }));
  await shot("05-recap-next");
  await page.click("#recap-cta");
  const got = await until(page, () => !document.getElementById("call-stamp").hidden, 25000);
  if (got) await page.waitForTimeout(700);
  await shot("06-coach-call");
  await until(page, () => document.getElementById("fun-recap").open, 60000);
  await page.waitForTimeout(500);
  await shot("07-coached-recap");
  await page.click("#recap-later");
  await page.waitForTimeout(400);
  await shot("08-after", true);
  await page.click("#btn-lab");
  await shot("09-lab-details", true);
  await ctx.close();
}

clearTimeout(hard);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
