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
    b.style.cssText = "border:1px solid #DDE5E0;background:#fff;color:#0F1C16;border-radius:8px;padding:9px 14px;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer";
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
    var link = function (t, h) { return '<a href="/info.html#' + h + '" style="color:#56665D">' + t + "</a>"; };
    d.innerHTML = link("About", "about") + link("Responsible gambling", "responsible") + link("Privacy", "privacy") + link("Terms", "terms") + link("Contact", "contact");
    if (!sub) d.appendChild(mk("Share Fixturio"));
    foot.parentNode.insertBefore(d, foot.nextSibling);
  }
})();

if (typeof predCell === "function" && typeof pred !== "undefined") {
  window.predCell = function (m) {
    var p = pred[m.fixture.id];
    if (!p) return '<div class="pr"></div>';
    var sp = p.s.split("-"), ps = +sp[0], pa = +sp[1];
    var mx = Math.max(p.h, p.d, p.a);
    var thin = p.n != null && p.n < 3;
    var lv = thin ? 1 : (mx >= 60 ? 3 : mx >= 45 ? 2 : 1);
    var cls = "";
    if (DONE.indexOf(m.fixture.status.short) >= 0 && m.goals.home !== null) {
      var po = ps > pa ? "H" : ps < pa ? "A" : "D";
      var ao = m.goals.home > m.goals.away ? "H" : m.goals.home < m.goals.away ? "A" : "D";
      cls = po === ao ? " ok" : " bad";
    }
    var tip = thin ? "Predicted score, limited data so low confidence" : "Predicted score, confidence " + mx + "%";
    return '<div class="pr" title="' + tip + '"><span class="pill' + cls + '">' + esc(p.s) + '</span><span class="sig s' + lv + '" role="img" aria-label="Confidence ' + (lv === 3 ? "high" : lv === 2 ? "medium" : "low") + '"><i></i><i></i><i></i></span></div>';
  };
}
