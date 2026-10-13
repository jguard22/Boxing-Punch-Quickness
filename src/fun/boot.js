// Entry point of the fun layer. ?fun=0 turns it off: nothing below is even fetched, so the page is the original one and no
// storage is touched. If the layer cannot start for any reason, the page falls back to the lab view and keeps working.
const off = new URLSearchParams(location.search).get("fun") === "0";
if (!off) {
  import("./start.js").catch((e) => {
    try { console.warn("[bag work] the fun layer could not start", e); } catch { /* none */ }
    document.documentElement.dataset.mode = "lab";
  });
}
