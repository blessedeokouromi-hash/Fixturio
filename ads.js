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
      // Social bar also waits for the page to load, then shows on the
      // visitor's first tap, so the site is never covered on arrival.
      if (cfg.socialbar && cfg.socialbar.src) {
        var sbArmed = false;
        var armSb = function () {
          if (sbArmed) return;
          sbArmed = true;
          var go = function () {
            document.removeEventListener("click", go, true);
            document.removeEventListener("touchstart", go, true);
            run(cfg.socialbar.src, document.getElementById("ad-socialbar") || document.body, "socialbar");
          };
          document.addEventListener("click", go, true);
          document.addEventListener("touchstart", go, true, { passive: true });
        };
        if (document.readyState === "complete") setTimeout(armSb, 4000);
        else window.addEventListener("load", function () { setTimeout(armSb, 4000); });
      }
      // Popunder waits for the page to finish loading and fires on the
      // visitor's first tap, so it can never hijack the site mid-load.
      if (cfg.popunder && cfg.popunder.src && !shownToday()) {
        var armed = false;
        var arm = function () {
          if (armed || shownToday()) return;
          armed = true;
          var go = function () {
            document.removeEventListener("click", go, true);
            document.removeEventListener("touchstart", go, true);
            if (shownToday()) return;
            markToday();
            run(cfg.popunder.src, document.body, "popunder");
          };
          document.addEventListener("click", go, true);
          document.addEventListener("touchstart", go, true, { passive: true });
        };
        if (document.readyState === "complete") setTimeout(arm, 4000);
        else window.addEventListener("load", function () { setTimeout(arm, 4000); });
      }
      window.fixturioVastUrl = cfg.vast && cfg.vast.url ? cfg.vast.url : null;
      // In-feed slots: small banner units between league blocks on the homepage.
      // Refills automatically whenever the list re-renders (filter, show more).
      // Each slot gets its own isolated iframe carrying the native banner
      // code, so every placement renders independently (no id clashes).
      if (cfg.inFeed !== false && cfg.native && cfg.native.src) {
        var nm = /([0-9a-f]{32})/.exec(cfg.native.src);
        var fill = nm ? function () {
          var slots = document.querySelectorAll(".ad-infeed:not(.filled)");
          for (var i = 0; i < slots.length; i++) {
            slots[i].className = "adslot ad-infeed filled";
            var f = document.createElement("iframe");
            f.setAttribute("width", "100%");
            f.setAttribute("height", "300");
            f.setAttribute("frameborder", "0");
            f.setAttribute("scrolling", "no");
            f.setAttribute("title", "advertisement");
            f.srcdoc = '<body style="margin:0;overflow:hidden"><div id="container-' + nm[1] + '"></div><script async data-cfasync="false" src="' + cfg.native.src + '"><\/script>';
            slots[i].appendChild(f);
            track("feed");
          }
        } : null;
        if (fill) {
          fill();
          var appEl = document.getElementById("app");
          if (appEl && window.MutationObserver) new MutationObserver(fill).observe(appEl, { childList: true, subtree: true });
        }
      }
    })
    .catch(function () {});
})();
