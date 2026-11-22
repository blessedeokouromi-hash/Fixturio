self.options = {
    "domain": "3nbf4.com",
    "zoneId": 12323978
}
self.lary = ""
importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw')

// --- Fixturio push notifications (same worker as the ad network, so they share the root scope) ---
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
