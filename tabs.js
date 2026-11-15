(function () {
  var TABS = [["main", "Predictions"], ["1x2", "1X2"], ["ou", "Over/Under 2.5"], ["btts", "Both teams to score"], ["cs", "Correct score"]];
  var NOTES = {
    "1x2": "Most likely result: 1 is a home win, X a draw, 2 an away win. The percentage is the model’s chance.",
    "ou": "Whether the model expects 3 or more goals (Over) or 2 or fewer (Under), with its chance.",
    "btts": "Whether the model expects both teams to score, with its chance.",
    "cs": "The most likely exact score and its chance. Exact scores are hard to predict, so these chances are small."
  };
  var mkMode = "main";

  var st = document.createElement("style");
  st.textContent = ".mkt{display:flex;gap:20px;overflow-x:auto;padding:0 16px;border-bottom:1px solid var(--line);background:#fff}" +
    ".mkt button{flex:none;background:none;border:0;padding:12px 0;font-weight:700;font-size:14px;color:var(--mu);border-bottom:3px solid transparent;margin-bottom:-1px;font-family:inherit;cursor:pointer}" +
    ".mkt button.on{color:var(--tx);border-bottom-color:var(--pitch,#0B6E47)}" +
    ".cf{font-size:11px;font-weight:700;color:var(--mu)}.cf.s3{color:#0B8A4F}.cf.s2{color:#9A6400}.cf.s1{color:#C62828}";
  document.head.appendChild(st);

  function pois(l, k) { var p = Math.exp(-l); for (var i = 1; i <= k; i++) p *= l / i; return p; }
  function csBest(p) {
    if (!(p.x > 0 && p.y > 0)) return null;
    var best = [0, 0, -1];
    for (var i = 0; i <= 6; i++) for (var j = 0; j <= 6; j++) {
      var q = pois(p.x, i) * pois(p.y, j);
      if (q > best[2]) best = [i, j, q];
    }
    return best;
  }
  function tipOf(p, mode) {
    var mx = Math.max(p.h, p.d, p.a);
    if (mode === "1x2") {
      var l = p.h >= p.d && p.h >= p.a ? "1" : (p.a >= p.d ? "2" : "X");
      return { l: l, c: mx };
    }
    if (mode === "ou") return p.o >= 50 ? { l: "Over", c: p.o } : { l: "Under", c: 100 - p.o };
    if (mode === "btts") return p.b >= 50 ? { l: "Yes", c: p.b } : { l: "No", c: 100 - p.b };
    if (mode === "cs") {
      var b = csBest(p);
      return b ? { l: b[0] + "-" + b[1], c: Math.round(b[2] * 100), cs: 1 } : { l: p.s, c: null, cs: 1 };
    }
    return { l: p.s, c: mx };
  }
  function hit(m, mode, t) {
    if (DONE.indexOf(m.fixture.status.short) < 0 || m.goals.home === null) return "";
    var h = m.goals.home, a = m.goals.away, ok;
    if (mode === "main") {
      var sp = t.l.split("-"), po = +sp[0] > +sp[1] ? "H" : +sp[0] < +sp[1] ? "A" : "D";
      ok = po === (h > a ? "H" : h < a ? "A" : "D");
    } else if (mode === "1x2") ok = t.l === (h > a ? "1" : h < a ? "2" : "X");
    else if (mode === "ou") ok = t.l === "Over" ? h + a > 2 : h + a < 3;
    else if (mode === "btts") ok = t.l === "Yes" ? (h > 0 && a > 0) : !(h > 0 && a > 0);
    else ok = t.l === h + "-" + a;
    return ok ? " ok" : " bad";
  }

  window.predCell = function (m) {
    var p = pred[m.fixture.id];
    if (!p) return '<div class="pr"></div>';
    var t = tipOf(p, mkMode), thin = p.n != null && p.n < 3;
    var cls = hit(m, mkMode, t);
    var lv = t.c == null || t.cs ? 0 : (thin ? 1 : (t.c >= 60 ? 3 : t.c >= 45 ? 2 : 1));
    var tip = thin ? "Limited data, so low confidence" : (t.c != null ? "Model chance " + t.c + "%" : "Most likely score");
    var sub;
    if (mkMode === "main") {
      sub = '<span class="sig s' + lv + '" role="img" aria-label="Confidence ' + (lv === 3 ? "high" : lv === 2 ? "medium" : "low") + '"><i></i><i></i><i></i></span>';
    } else {
      sub = t.c == null ? "" : '<span class="cf' + (lv ? " s" + lv : "") + '">' + t.c + "%</span>";
    }
    return '<div class="pr" title="' + esc(tip) + '"><span class="pill' + cls + '">' + esc(t.l) + "</span>" + sub + "</div>";
  };

  var _render = window.render;
  window.render = function () {
    _render();
    var c = document.getElementById("cov");
    if (c && mkMode !== "main") c.textContent = NOTES[mkMode];
  };

  function drawTabs() {
    var d = document.getElementById("mkt");
    if (!d) return;
    d.innerHTML = TABS.map(function (t) {
      return '<button class="' + (mkMode === t[0] ? "on" : "") + '" onclick="setMk(\'' + t[0] + '\')">' + t[1] + "</button>";
    }).join("");
  }
  window.setMk = function (m) { mkMode = m; drawTabs(); render(); };

  var ch = document.getElementById("chips");
  if (ch && !document.getElementById("mkt")) {
    var d = document.createElement("div");
    d.id = "mkt";
    d.className = "mkt";
    ch.parentNode.insertBefore(d, ch);
    drawTabs();
    render();
  }
})();
