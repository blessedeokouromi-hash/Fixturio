(function () {
  var TABS = [["main", "Predictions"], ["1x2", "1X2"], ["ou", "Over/Under"], ["btts", "Both teams to score"], ["cs", "Correct score"]];
  var NOTES = {
    "1x2": "Most likely result: 1 is a home win, X a draw, 2 an away win. The percentage is the model’s chance.",
    "ou": "Each match shows the goal line the model is most confident about: Over 2.5 means 3 or more goals in total. The percentage is the model\u2019s chance for that line.",
    "btts": "Whether the model expects both teams to score, with its chance.",
    "cs": "The most likely exact score and its chance. Exact scores are hard to predict, so these chances are small."
  };
  var mkMode = "main";

  var st = document.createElement("style");
  st.textContent = ".mkt{display:flex;gap:20px;overflow-x:auto;padding:0 16px;border-bottom:1px solid var(--line);background:var(--ink)}" +
    ".mkt button{flex:none;background:none;border:0;padding:12px 0;font-weight:700;font-size:14px;color:var(--mu);border-bottom:3px solid transparent;margin-bottom:-1px;font-family:inherit;cursor:pointer}" +
    ".mks{display:none;gap:8px;padding:10px 16px 0}" +
    ".mks button{flex:none;border:1px solid var(--line);background:transparent;padding:6px 14px;border-radius:999px;font-weight:600;font-size:13px;white-space:nowrap;font-family:inherit;cursor:pointer;color:var(--mu)}" +
    ".mks button.on{background:var(--tx);color:var(--ink);border-color:var(--tx)}" +
    ".mkt button.on{color:var(--tx);border-bottom-color:var(--pitch,#0B6E47)}" +
    ".cf{font-size:11px;font-weight:700;color:var(--mu)}.cf.s3{color:#0B8A4F}.cf.s2{color:#9A6400}.cf.s1{color:#C62828}" +
"    .rs{font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;margin-left:6px;white-space:nowrap}" +
".rs.ok{background:var(--okbg);border:1px solid var(--okbd);color:var(--okfg)}" +
".rs.bad{background:var(--badbg);border:1px solid var(--badbd);color:var(--badfg)}";
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
    if (mode === "ou") {
      var lam = (p.x || 0) + (p.y || 0);
      if (lam > 0) {
        var cum = function (l, k) { var s2 = 0; for (var i2 = 0; i2 <= k; i2++) s2 += pois(l, i2); return s2; };
        var overAt = function (l) { return 1 - cum(lam, Math.floor(l)); };
        var side = p.o >= 50 ? "Over" : "Under";
        var pick, c;
        if (side === "Over") {
          pick = 1.5;
          var hi = [3.5, 2.5, 1.5];
          for (var i3 = 0; i3 < hi.length; i3++) { if (overAt(hi[i3]) >= 0.6) { pick = hi[i3]; break; } }
          c = Math.round(overAt(pick) * 100);
        } else {
          pick = 2.5;
          var lo = [1.5, 2.5, 3.5];
          for (var j2 = 0; j2 < lo.length; j2++) { if (1 - overAt(lo[j2]) >= 0.6) { pick = lo[j2]; break; } }
          c = Math.round((1 - overAt(pick)) * 100);
          if (pick === 2.5 && p.o != null) c = 100 - p.o;
        }
        return { l: side, line: pick, lab: side + " " + pick, c: c };
      }
      return p.o >= 50 ? { l: "Over", line: 2.5, lab: "Over 2.5", c: p.o } : { l: "Under", line: 2.5, lab: "Under 2.5", c: 100 - p.o };
    }
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
    else if (mode === "ou") { var ln = t.line || 2.5; ok = t.l === "Over" ? h + a > ln : h + a < ln + 0.5; }
    else if (mode === "btts") ok = t.l === "Yes" ? (h > 0 && a > 0) : !(h > 0 && a > 0);
    else ok = t.l === h + "-" + a;
    return ok ? " ok" : " bad";
  }

  window.tipOf = tipOf;
  var SUB = { "1x2": ["1", "X", "2"], "ou": ["Over", "Under"], "btts": ["Yes", "No"] };
  window.mkSel = window.mkSel || "all";

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
    var res = "";
    var fin = DONE.indexOf(m.fixture.status.short) >= 0 && m.goals.home !== null && m.goals.away !== null;
    if (fin) {
      var hg = m.goals.home, ag = m.goals.away, won = cls === " ok";
      var word;
      if (mkMode === "main" || mkMode === "1x2") word = hg > ag ? "Home win" : hg < ag ? "Away win" : "Draw";
      else word = won ? "Hit" : "Miss";
      res = '<span class="rs' + cls + '">' + word + "</span>";
    }
    return '<div class="pr" title="' + esc(tip) + '"><span class="pill' + cls + '">' + esc(t.lab || t.l) + "</span>" + res + sub + "</div>";
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
  function drawSub() {
    var d = document.getElementById("mks");
    if (!d) return;
    var opts = SUB[mkMode];
    if (!opts) { d.innerHTML = ""; d.style.display = "none"; return; }
    d.style.display = "flex";
    var rows = ["all"].concat(opts);
    d.innerHTML = rows.map(function (v) {
      return '<button class="' + (window.mkSel === v ? "on" : "") + '" onclick="setMkSel(\'' + v + '\')">' + (v === "all" ? "All" : v) + "</button>";
    }).join("");
  }
  window.setMkSel = function (v) { window.mkSel = v; drawSub(); render(); };
  window.setMk = function (m) { mkMode = m; window.mkMode = m; window.mkSel = "all"; drawTabs(); drawSub(); render(); };

  var ch = document.getElementById("chips");
  if (ch && !document.getElementById("mkt")) {
    var d = document.createElement("div");
    d.id = "mkt";
    d.className = "mkt";
    var s = document.createElement("div");
    s.id = "mks";
    s.className = "mks";
    ch.parentNode.insertBefore(d, ch);
    ch.parentNode.insertBefore(s, ch);
    drawTabs();
    drawSub();
    render();
  }
})();
