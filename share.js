(function () {
  var url = location.origin + "/picks.html";
  function share(btn) {
    var data = { title: "Fixturio", text: "Today’s football picks on Fixturio", url: url };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        var old = btn.textContent;
        btn.textContent = "Link copied";
        setTimeout(function () { btn.textContent = old; }, 2000);
      });
    }
  }
  function mk(label) {
    var b = document.createElement("button");
    b.textContent = label;
    b.className = "sharebtn";
    b.onclick = function () { share(b); };
    return b;
  }
  var sub = document.getElementById("sub");
  if (sub) {
    var w = document.createElement("div");
    w.style.margin = "12px 0 0";
    w.appendChild(mk("Share today’s picks"));
    sub.parentNode.appendChild(w);
  }
  var foot = document.querySelector(".fine.foot") || document.querySelector(".fine");
  if (foot) {
    var d = document.createElement("div");
    d.style.cssText = "padding:0 16px 28px;font-size:13px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center";
    var link = function (t, h) { return '<a href="/info.html#' + h + '" style="color:var(--mu)">' + t + "</a>"; };
    d.innerHTML = link("About", "about") + link("Responsible gambling", "responsible") + link("Privacy", "privacy") + link("Terms", "terms") + link("Contact", "contact");
    if (!sub) d.appendChild(mk("Share Fixturio"));
    foot.parentNode.insertBefore(d, foot.nextSibling);
  }
  var list = ["/theme.js"];
  if (document.getElementById("chips")) list.push("/tabs.js", "/fresh.js");
  list.forEach(function (src) {
    var s = document.createElement("script");
    s.async = false;
    s.src = src;
    document.body.appendChild(s);
  });
})();
