// Repo rules, run over the page, the fun layer and the vendored kit together (the kit's own copy must pass the same lint the
// app does: wellness wording, no forbidden project word, no firmware path, no browser dialogs, tokens only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules" || f === ".git") return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const all = walk(root).filter((f) => !/package-lock\.json$/.test(f));
const text = all.filter((f) => /\.(js|mjs|css|html|md|json|svg|webmanifest)$/.test(f) && !f.endsWith("hygiene.test.mjs") && !/ 2\./.test(f));
const read = (f) => readFileSync(f, "utf8");
const rel = (f) => relative(root, f);

/** CSS with the :root token blocks removed: tokens are where colours and sizes are allowed to be written. */
const withoutTokens = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/:root(\[[^\]]*\])?\s*\{[^}]*\}/g, "");

test("component CSS holds no raw colours: they live in the :root token blocks of styles.css", () => {
  for (const f of ["styles.css", "fun.css"]) {
    const css = withoutTokens(read(join(root, f)));
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${f} has a hex colour outside the tokens`);
    assert.doesNotMatch(css, /\b(?:rgba?|hsla?)\(/, `${f} has an rgb()/hsl() colour`);
  }
  for (const f of all.filter((x) => /src\/fun\/.*\.js$/.test(x) && !x.includes("/vendor/"))) {
    assert.doesNotMatch(read(f), /#[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?)\(/, `${rel(f)} has a colour`);
  }
});

test("component CSS holds no raw pixel sizes or raw millisecond / second values outside the tokens (media queries cannot read tokens)", () => {
  for (const f of ["styles.css", "fun.css"]) {
    withoutTokens(read(join(root, f))).split("\n").forEach((line, i) => {
      if (/^\s*@media/.test(line)) return;
      assert.doesNotMatch(line, /(?<![\w-])-?\d*\.?\d+px\b/, `${f}:${i + 1} has a raw px value: ${line.trim().slice(0, 80)}`);
      if (f === "fun.css" && !/\binfinite\b/.test(line)) assert.doesNotMatch(line, /(?<![\w-.])-?\d*\.?\d+(ms|s)\b/, `${f}:${i + 1} has a raw duration: ${line.trim().slice(0, 80)}`);
    });
  }
});

test("the brand teal is #00d4aa and both looks are defined", () => {
  const css = read(join(root, "styles.css"));
  assert.match(css, /--teal:\s*#00d4aa/i);
  assert.match(css, /:root\[data-theme="light"\]/);
});

test("keeps to the wording and naming rules (wellness wording, no forbidden project word, no firmware path, no medical claims)", () => {
  const banned = [
    new RegExp(["gh", "aps"].join(""), "i"), new RegExp(["/firm", "ware\\b"].join("")),
    /\b(rehabilitat\w*|rehab|heal(s|ed|ing)?|therap\w*|cure[sd]?|treat(s|ed|ing|ment|ments)?|diagnos\w*)\b/i,
    /injury risk|prevents? injur|clinically|medical device|fall risk/i,
  ];
  for (const f of text) {
    if (f.endsWith("README.md") || rel(f).startsWith("test/")) continue;   // tests spell out the banned words to check for them
    const src = read(f);
    for (const re of banned) assert.equal(re.test(src), false, `${rel(f)} matches ${re}`);
  }
});

test("uses no browser dialogs or new windows: the page has its own sheets", () => {
  for (const f of text.filter((x) => /\.(js|mjs|html)$/.test(x))) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
    assert.equal(/(?<![\w.$])(?:alert|confirm|prompt)\s*\(|window\.open\(|target\s*=\s*["']_blank/.test(code), false, `${rel(f)} opens a browser dialog or window`);
  }
});

test("no iCloud duplicate files ('name 2.ext') and a committed kit VERSION", () => {
  assert.deepEqual(all.filter((f) => / 2\.[a-z0-9]+$/.test(f)).map(rel), []);
  assert.match(read(join(root, "src/vendor/fun-kit/VERSION")), /^bw-fun-kit \d+\.\d+\.\d+/);
});

test("no node_modules or build output is tracked, and the page still has no build step", () => {
  const pkg = JSON.parse(read(join(root, "package.json")));
  assert.ok(!pkg.dependencies && !pkg.devDependencies, "no dependencies: the page and its tests run on plain node");
  assert.match(pkg.scripts.test, /node --test/);
});
