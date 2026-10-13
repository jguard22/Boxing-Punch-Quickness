// The fun layer's own display preferences, in this browser only: look, motion, sound, coach voice, coach calls, and which view
// (Fight or Lab) to open in. Every read and write is wrapped, so a browser with storage turned off still runs the page.
// "Forget my data" removes both keys. The page's units and timer settings are the lab page's own and are not touched here.

const KEY = "bw-box-fun-v1";
const MODE_KEY = "bw-box-mode";

export const DEFAULTS = Object.freeze({ theme: "auto", motion: "auto", sound: "on", voice: "off", calls: "on" });
const ALLOWED = Object.freeze({
  theme: ["auto", "light", "dark"], motion: ["auto", "reduce", "full"], sound: ["on", "off"], voice: ["on", "off"], calls: ["on", "off"],
});

export function clean(p = {}) {
  const out = { ...DEFAULTS };
  for (const [k, ok] of Object.entries(ALLOWED)) if (ok.includes(p?.[k])) out[k] = p[k];
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return clean(JSON.parse(storage.getItem(KEY) || "{}")); } catch { return { ...DEFAULTS }; }
}
export function save(p, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(clean(p))); return true; } catch { return false; }
}
export function loadMode(storage = globalThis.localStorage) {
  try { return storage.getItem(MODE_KEY) === "lab" ? "lab" : "fight"; } catch { return "fight"; }
}
export function saveMode(mode, storage = globalThis.localStorage) {
  try { storage.setItem(MODE_KEY, mode === "lab" ? "lab" : "fight"); return true; } catch { return false; }
}
export function forget(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); storage.removeItem(MODE_KEY); } catch { /* nothing stored */ }
}
