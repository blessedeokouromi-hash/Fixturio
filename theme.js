(function () {
  var KEY = "fx-theme", root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  var sys = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = saved || (sys ? "dark" : "light");
  var ICON = {
    dark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    light: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  var btn = document.createElement("button");
  btn.id = "themeBtn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Switch between light and dark mode");
  function meta(t) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "dark" ? "#0A3D2A" : "#0B5A3C");
  }
  function set(t, store) {
    theme = t;
    root.setAttribute("data-theme", t);
    if (store) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    btn.innerHTML = ICON[t];
    btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
    meta(t);
  }
  btn.onclick = function () { set(theme === "dark" ? "light" : "dark", true); };
  set(theme, false);
  (document.body || root).appendChild(btn);
})();
