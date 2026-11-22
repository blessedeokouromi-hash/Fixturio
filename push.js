// Fixturio push notifications: one soft opt-in on the homepage, then silent.
(function () {
  var PUBKEY = "BPk7rMe5Lm9CpW1UbtMrWzvJb55OQb9pWmxh2ZnDJkDS-lMgSwROSPH5GSkKQ4uXOtftoTX-zAFGVGpwV4IQAL0";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  var KEY = "fx-push", state = null;
  try { state = localStorage.getItem(KEY); } catch (e) {}
  if (state === "off") return;

  function urlB64(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function reg() {
    return navigator.serviceWorker.getRegistration("/").then(function (r) {
      return r || navigator.serviceWorker.register("/sw.js");
    });
  }
  function subscribed() {
    return reg().then(function (r) { return r.pushManager.getSubscription(); })
      .then(function (s) { return !!s; }).catch(function () { return false; });
  }
  function enable() {
    reg().then(function (r) { return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(PUBKEY) }); })
      .then(function (sub) {
        var j = sub.toJSON();
        return fetch("/api/push-subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }) });
      })
      .then(function (r) { if (r.ok) { try { localStorage.setItem(KEY, "on"); } catch (e) {} } hide(); })
      .catch(function () { hide(); });
  }
  function hide() { var c = document.getElementById("fx-push-card"); if (c) c.remove(); }

  if (Notification.permission === "granted") {
    // Already allowed at some point: make sure a subscription exists, quietly.
    subscribed().then(function (yes) {
      if (!yes && state !== "off") enable();
    });
    return;
  }
  if (Notification.permission !== "default") return; // denied earlier: never nag

  function show() {
    if (document.getElementById("fx-push-card")) return;
    var d = document.createElement("div");
    d.id = "fx-push-card";
    d.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;max-width:520px;margin:0 auto;z-index:9999;" +
      "background:#123F33;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.35);" +
      "display:flex;align-items:center;gap:12px;font-family:inherit";
    d.innerHTML =
      '<div style="flex:1;min-width:0"><b style="font-size:14px">Never miss today\u2019s picks</b>' +
      '<div style="font-size:12px;opacity:.85;margin-top:2px">Get a notification when today\u2019s predictions go live.</div></div>' +
      '<button id="fx-push-yes" style="flex:none;background:#FFD54A;color:#123F33;border:0;border-radius:9px;' +
      'padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer">Notify me</button>' +
      '<button id="fx-push-no" aria-label="Dismiss" style="flex:none;background:none;border:0;color:#fff;' +
      'font-size:18px;cursor:pointer;padding:4px">&times;</button>';
    document.body.appendChild(d);
    document.getElementById("fx-push-yes").addEventListener("click", enable);
    document.getElementById("fx-push-no").addEventListener("click", function () {
      try { localStorage.setItem(KEY, "off"); } catch (e) {}
      hide();
    });
  }
  // Show once the visitor has settled in, not on the first paint.
  setTimeout(function () { if (Notification.permission === "default") subscribed().then(function (yes) { if (!yes) show(); }); }, 12000);
})();
