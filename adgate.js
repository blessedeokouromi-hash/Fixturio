// Ad frequency gate for the Monetag MultiTag (zone 313892).
// The ad tag loads at most AD_TIMES_PER_DAY times per visitor per day,
// and never twice within AD_GAP_MINUTES, so popunders and full-screen
// ads cannot fire on every page view. Tune the two numbers below.
(function () {
  var AD_TIMES_PER_DAY = 3;
  var AD_GAP_MINUTES = 5;
  var KEY = "fx-ad-gate";
  var ok = true;
  try {
    var now = Date.now();
    var day = new Date().setHours(0, 0, 0, 0);
    var s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { s = {}; }
    if (!s.d || s.d !== day) s = { d: day, n: 0, t: 0 };
    if (s.n >= AD_TIMES_PER_DAY) ok = false;
    else if (s.t && now - s.t < AD_GAP_MINUTES * 60000) ok = false;
    if (ok) { s.n++; s.t = now; localStorage.setItem(KEY, JSON.stringify(s)); }
  } catch (e) { ok = true; }
  if (!ok) return;
  var sc = document.createElement("script");
  sc.src = "https://quge5.com/88/tag.min.js";
  sc.setAttribute("data-zone", "313892");
  sc.async = true;
  sc.setAttribute("data-cfasync", "false");
  document.head.appendChild(sc);
})();
