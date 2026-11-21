// Config-driven ad loader. Reads /ads.json (edited from the admin dashboard).
// Frequency limits: popunder once per visitor per day, social bar and banner once
// per page. Every shown zone pings the tracker for later revenue reporting.
(function () {
  var POP = "fixturio:ad:pop";
  function shownToday() {
    try { return JSON.parse(localStorage.getItem(POP) || '""') === new Date().toISOString().slice(0, 10); }
    catch (e) { return false; }
  }
  function markToday() {
    try { localStorage.setItem(POP, JSON.stringify(new Date().toISOString().slice(0, 10))); } catch (e) {}
  }
  function track(zone) {
    try { fetch("/api/track?zone=" + zone, { keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function iframeBanner(host, zone, unit) {
    if (!host || !unit || !unit.key || !unit.invoke) return;
    var opt = document.createElement("script");
    opt.textContent = "atOptions = {'key':'" + unit.key + "','format':'iframe','height':" + unit.h + ",'width':" + unit.w + ",'params':{}};";
    host.appendChild(opt);
    var s = document.createElement("script");
    s.src = unit.invoke;
    s.async = true;
    host.appendChild(s);
    track(zone);
  }
  function run(src, host, zone) {
    if (!src || !host) return;
    // Adsterra native async fills a div named container-<zonehash>; add it
    // before the script so the native banner has somewhere to render.
    var m = /([0-9a-f]{32})/.exec(src);
    if (zone === "native" && m && !document.getElementById("container-" + m[1])) {
      var box = document.createElement("div");
      box.id = "container-" + m[1];
      host.appendChild(box);
    }
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    host.appendChild(s);
    track(zone);
  }
  fetch("/ads.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled) return;
      var banner = document.getElementById("ad-banner");
      if (banner) {
        var small = window.innerWidth < 480;
        var unit = small && cfg.mobileBanner ? cfg.mobileBanner : cfg.banner;
        if (unit && unit.invoke) iframeBanner(banner, "banner", unit);
        else if (unit && unit.src) run(unit.src, banner, "banner");
      }
      var native = document.getElementById("ad-native");
      if (native) run(cfg.native && cfg.native.src, native, "native");
      if (cfg.socialbar && cfg.socialbar.src) run(cfg.socialbar.src, document.getElementById("ad-socialbar") || document.body, "socialbar");
      if (cfg.popunder && cfg.popunder.src && !shownToday()) {
        markToday();
        run(cfg.popunder.src, document.body, "popunder");
      }
      window.fixturioVastUrl = cfg.vast && cfg.vast.url ? cfg.vast.url : null;
    })
    .catch(function () {});
})();
