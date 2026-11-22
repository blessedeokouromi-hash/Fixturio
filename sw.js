// --- Fixturio push notifications ---
// (Root-scope worker previously shared with Monetag; Monetag code removed 2026-11-22.)
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || "Fixturio", {
    body: d.body || "Today's predicted scores and top picks are live.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || "fixturio-daily",
    data: { url: d.url || "/picks.html" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/picks.html";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    return clients.openWindow(url);
  }));
});
