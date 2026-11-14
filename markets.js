(function () {
  var st = document.createElement("style");
  st.textContent = ".more{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}.more summary{cursor:pointer;font-weight:700;color:var(--amb)}";
  document.head.appendChild(st);

  var N = 9;
  function pois(l, k) { var p = Math.exp(-l); for (var i = 1; i <= k; i++) p *= l / i; return p; }
  function grid(lh, la) {
    var g = [], tot = 0, i, j;
    for (i = 0; i <= N; i++) { g[i] = []; for (j = 0; j <= N; j++) { g[i][j] = pois(lh, i) * pois(la, j); tot += g[i][j]; } }
    for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) g[i][j] /= tot;
    return g;
  }
  function sum(g, f) { var s = 0, i, j; for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) if (f(i, j)) s += g[i][j]; return s; }
  function pc(v) { return Math.max(0, Math.min(100, Math.round(v * 100))); }

  window.modelRows = function (p, home, away) {
    var r = [];
    function add(g, label, v) { r.push({ g: g, label: label, p: pc(v) }); }
    if (!(p.x > 0 && p.y > 0)) {
      add("Match result", home + " win", p.h / 100); add("Match result", "Draw", p.d / 100); add("Match result", away + " win", p.a / 100);
      add("Double chance", home + " or draw", (p.h + p.d) / 100); add("Double chance", away + " or draw", (p.d + p.a) / 100); add("Double chance", home + " or " + away, (p.h + p.a) / 100);
      add("Total goals", "Over 2.5", p.o / 100); add("Total goals", "Under 2.5", 1 - p.o / 100);
      add("Both teams to score", "Yes", p.b / 100); add("Both teams to score", "No", 1 - p.b / 100);
      return r;
    }
    var g = grid(p.x, p.y);
    var H = sum(g, function (i, j) { return i > j; });
    var D = sum(g, function (i, j) { return i === j; });
    var A = sum(g, function (i, j) { return i < j; });
    add("Match result", home + " win", H);
    add("Match result", "Draw", D);
    add("Match result", away + " win", A);
    add("Double chance", home + " or draw", H + D);
    add("Double chance", away + " or draw", D + A);
    add("Double chance", home + " or " + away, H + A);
    [1.5, 2.5, 3.5].forEach(function (l) {
      var o = sum(g, function (i, j) { return i + j > l; });
      add("Total goals", "Over " + l, o);
      add("Total goals", "Under " + l, 1 - o);
    });
    var bt = sum(g, function (i, j) { return i > 0 && j > 0; });
    add("Both teams to score", "Yes", bt);
    add("Both teams to score", "No", 1 - bt);
    add("Draw no bet", home, H / (H + A));
    add("Draw no bet", away, A / (H + A));
    add("Team goals", home + " over 0.5", sum(g, function (i) { return i > 0; }));
    add("Team goals", home + " over 1.5", sum(g, function (i) { return i > 1; }));
    add("Team goals", away + " over 0.5", sum(g, function (i, j) { return j > 0; }));
    add("Team goals", away + " over 1.5", sum(g, function (i, j) { return j > 1; }));
    add("Clean sheet and win to nil", home + " win to nil", sum(g, function (i, j) { return i > 0 && j === 0; }));
    add("Clean sheet and win to nil", away + " win to nil", sum(g, function (i, j) { return j > 0 && i === 0; }));
    add("Clean sheet and win to nil", home + " clean sheet", sum(g, function (i, j) { return j === 0; }));
    add("Clean sheet and win to nil", away + " clean sheet", sum(g, function (i) { return i === 0; }));
    add("Handicap", home + " -1.5", sum(g, function (i, j) { return i - j >= 2; }));
    add("Handicap", away + " +1.5", sum(g, function (i, j) { return i - j < 2; }));
    add("Handicap", away + " -1.5", sum(g, function (i, j) { return j - i >= 2; }));
    add("Handicap", home + " +1.5", sum(g, function (i, j) { return j - i < 2; }));
    add("More goal lines", "Over 0.5", sum(g, function (i, j) { return i + j > 0.5; }));
    add("More goal lines", "Under 0.5", sum(g, function (i, j) { return i + j < 0.5; }));
    add("More goal lines", "Over 4.5", sum(g, function (i, j) { return i + j > 4.5; }));
    add("More goal lines", "Under 4.5", sum(g, function (i, j) { return i + j < 4.5; }));
    add("Odd or even goals", "Odd", sum(g, function (i, j) { return (i + j) % 2 === 1; }));
    add("Odd or even goals", "Even", sum(g, function (i, j) { return (i + j) % 2 === 0; }));
    var sc = [], a, b;
    for (a = 0; a <= 5; a++) for (b = 0; b <= 5; b++) sc.push([a + "-" + b, g[a][b]]);
    sc.sort(function (x, y) { return y[1] - x[1]; });
    sc.slice(0, 5).forEach(function (x) { add("Most likely scores", x[0], x[1]); });
    return r;
  };

  window.panel = function (rows, notes) {
    if (!rows.length) return '<p class="note">' + esc(notes) + "</p>";
    var cand = rows.filter(function (r) { return r.p <= 92 && r.g !== "More goal lines"; });
    if (!cand.length) cand = rows;
    var top = function (a, b) { return b.p > a.p ? b : a; };
    var b1 = cand.reduce(top);
    var singles = cand.filter(function (r) { return r.g !== "Double chance" && r.g !== "Draw no bet" && r.label !== "Draw"; });
    var b2 = singles.length ? singles.reduce(top) : null;
    var h = '<div class="two"><div><small>Safest pick</small><b>' + esc(b1.label) + "</b><em>" + b1.p + "%</em></div>";
    if (b2 && b2 !== b1) h += '<div><small>Best single market</small><b>' + esc(b2.label) + "</b><em>" + b2.p + "%</em></div>";
    h += "</div>";
    var order = [], grp = {};
    rows.forEach(function (r) { if (!grp[r.g]) { grp[r.g] = []; order.push(r.g); } grp[r.g].push(r); });
    var main = ["Match result", "Double chance", "Total goals", "Both teams to score"];
    function block(k) {
      var s = '<div class="sec"><h4>' + esc(k) + "</h4>";
      grp[k].forEach(function (r) {
        s += '<div class="mrow' + (r === b1 ? " best" : "") + '"><span class="nm">' + esc(r.label) + '</span><span class="pv">' + r.p + '%</span><div class="tr"><i style="width:' + r.p + '%"></i></div></div>';
      });
      return s + "</div>";
    }
    var more = "";
    order.forEach(function (k) { if (main.indexOf(k) >= 0) h += block(k); else more += block(k); });
    if (more) h += '<details class="more"><summary>More markets</summary>' + more + "</details>";
    return h + (notes ? '<p class="note">' + esc(notes) + "</p>" : "");
  };
})();
