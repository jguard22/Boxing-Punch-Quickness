// Entry point of the fun layer, a plain script (not a module) so that even a browser that refuses ES modules, such as a page opened
// straight from disk, still runs it and takes the fallback below. ?fun=0 turns the layer off: nothing is even fetched, so the page is
// the original one and no storage is touched. If the layer cannot start for any reason, the page becomes the original page again
// (the lab view with the fun-only parts hidden) and keeps working.
(function () {
  var off = new URLSearchParams(location.search).get("fun") === "0";
  if (off) return;
  import("./start.js").catch(function (e) {
    try { console.warn("[bag work] the fun layer could not start", e); } catch (err) { /* none */ }
    document.documentElement.dataset.fun = "off";
    document.documentElement.dataset.mode = "lab";
  });
})();
