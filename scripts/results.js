const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

function grade(market, h, a) {
  if (market === "Home win") return h > a;
  if (market === "Away win") return a > h;
  if (market.indexOf("Double chance 1X") === 0) return h >= a;
  if (market.indexOf("Double chance X2") === 0) return a >= h;
  if (market.indexOf("Double chance 12") === 0) return h !== a;
  if (market === "Over 2.5 goals") return h + a > 2.5;
  if (market === "Under 2.5 goals") return h + a < 2.5;
  if (market === "Both teams to score") return h > 0 && a > 0;
  if (market === "Both teams not to score") return h === 0 || a === 0;
  return null;
}

(async () => {
  if (!fs.existsSync("history.json")) fs.writeFileSync("history.json", JSON.stringify({ days: [] }));
  const old = load("daily.json", null);
  const hist = load("history.json", { days: [] });
  if (!old || !old.picks || !old.picks.length || !old.date) { console.log("No previous picks to check"); return; }
  const today = new Date().toISOString().slice(0, 10);
  if (old.date >= today) { console.log("Previous picks are from today, nothing to check yet"); return; }
  if (hist.days.some(d => d.date === old.date)) { console.log("Already checked " + old.date); return; }

  const r = await fetch("https://v3.football.api-sports.io/fixtures?date=" + old.date,
    { headers: { "x-apisports-key": KEY } });
  const fx = await r.json();
  await sleep(7000);
  if ((fx.errors && Object.keys(fx.errors).length) || !fx.response) {
    console.error("Could not load results: " + JSON.stringify(fx.errors));
    return;
  }

  const byId = {};
  fx.response.forEach(m => { byId[m.fixture.id] = m; });
  const FIN = ["FT", "AET", "PEN"];
  let won = 0, lost = 0, voided = 0;
  const picks = old.picks.map(p => {
    const m = byId[p.fixture];
    let result = "void", score = null;
    if (m && FIN.indexOf(m.fixture.status.short) >= 0) {
      const ft = m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals;
      const ok = grade(p.market, ft.home, ft.away);
      if (ok !== null) { result = ok ? "won" : "lost"; score = ft.home + "-" + ft.away; }
    }
    if (result === "won") won++; else if (result === "lost") lost++; else voided++;
    return { match: p.match, market: p.market, probability: p.probability, result, score };
  });

  hist.days.push({ date: old.date, won, lost, voided, picks });
  hist.days = hist.days.slice(-60);
  fs.writeFileSync("history.json", JSON.stringify(hist));
  // Public performance tracker, computed here in the daily job and served as a
  // static file, so visitors read it without any extra API use.
  const now = Date.now();
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const rate = days => {
    let w = 0, l = 0;
    days.forEach(d => { w += d.won; l += d.lost; });
    return { won: w, lost: l, rate: (w + l) ? Math.round(w * 100 / (w + l)) : null };
  };
  fs.writeFileSync("track.json", JSON.stringify({
    updated: new Date().toISOString(),
    d7: rate(hist.days.filter(d => d.date >= iso(now - 6 * 864e5))),
    d30: rate(hist.days.filter(d => d.date >= iso(now - 29 * 864e5))),
    days: hist.days.length,
    since: hist.days[0].date
  }));
  // Stage 4: grade the full model, not just the picks. The previous build
  // saved every prediction (data/preds.json); grade them against the same
  // results response already fetched above, so no extra API calls are spent.
  try {
    const preds = load("data/preds.json", null);
    if (preds && preds.date === old.date && preds.m) {
      const gr = load("grading.json", { updated: null, since: null, days: [], sum: { n: 0, brier: 0, hit: 0, sc: 0, goals: [0, 0], mk: {} } });
      const MK = [
        ["Home win", q => q.h / 100, (h, a) => h > a],
        ["Away win", q => q.a / 100, (h, a) => a > h],
        ["Draw", q => q.d / 100, (h, a) => h === a],
        ["Double chance 1X (home or draw)", q => (q.h + q.d) / 100, (h, a) => h >= a],
        ["Double chance X2 (away or draw)", q => (q.d + q.a) / 100, (h, a) => a >= h],
        ["Double chance 12", q => (q.h + q.a) / 100, (h, a) => h !== a],
        ["Over 2.5 goals", q => q.o / 100, (h, a) => h + a > 2.5],
        ["Under 2.5 goals", q => 1 - q.o / 100, (h, a) => h + a < 2.5],
        ["Both teams to score", q => q.b / 100, (h, a) => h > 0 && a > 0],
        ["Both teams not to score", q => 1 - q.b / 100, (h, a) => h === 0 || a === 0]
      ];
      let n = 0, B = 0, hits = 0, sc = 0, gPred = 0, gAct = 0;
      const mk = {};
      MK.forEach(x => { mk[x[0]] = { p: 0, w: 0, n: 0 }; });
      Object.keys(preds.m).forEach(fid => {
        const q = preds.m[fid];
        if (q.kd !== old.date) return;
        const m = byId[fid];
        if (!m || FIN.indexOf(m.fixture.status.short) < 0) return;
        const ft = m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals;
        if (!ft || ft.home === null || ft.away === null) return;
        const h = ft.home, a = ft.away;
        n++;
        const yh = h > a ? 1 : 0, yd = h === a ? 1 : 0, ya = a > h ? 1 : 0;
        const ph = q.h / 100, pd = q.d / 100, pa = q.a / 100;
        B += ((ph - yh) * (ph - yh) + (pd - yd) * (pd - yd) + (pa - ya) * (pa - ya)) / 3;
        const best = ph >= pd && ph >= pa ? "H" : (pd >= pa ? "D" : "A");
        if ((best === "H" && yh) || (best === "D" && yd) || (best === "A" && ya)) hits++;
        if (q.s === h + "-" + a) sc++;
        gPred += (q.x || 0) + (q.y || 0);
        gAct += h + a;
        MK.forEach(x => {
          const t = mk[x[0]];
          t.p += x[1](q);
          if (x[2](h, a)) t.w++;
          t.n++;
        });
      });
      if (n > 0) {
        // The day's acca, graded leg by leg from the same response.
        let acca = null;
        if (old.acca && old.acca.legs && old.acca.legs.length) {
          let ok = true, allWon = true, prod = 1;
          old.acca.legs.forEach(leg => {
            const m = byId[leg.fixture];
            if (!m || FIN.indexOf(m.fixture.status.short) < 0) { ok = false; return; }
            const ft = m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals;
            if (!ft || ft.home === null || ft.away === null) { ok = false; return; }
            const g = grade(leg.market, ft.home, ft.away);
            if (g === null) { ok = false; return; }
            prod *= (leg.probability || 1);
            if (!g) allWon = false;
          });
          if (ok) acca = { legs: old.acca.legs.length, prob: +prod.toFixed(3), result: allWon ? "won" : "lost" };
        }
        gr.updated = new Date().toISOString();
        if (!gr.since) gr.since = old.date;
        gr.days.push({ date: old.date, n, brier: +(B / n * 100).toFixed(2), hit: +(hits / n * 100).toFixed(1), sc: +(sc / n * 100).toFixed(1), goals: [+(gPred / n).toFixed(2), +(gAct / n).toFixed(2)], acca });
        gr.days = gr.days.slice(-60);
        const s = gr.sum;
        MK.forEach(x => {
          const t = s.mk[x[0]] || (s.mk[x[0]] = { p: 0, w: 0, n: 0 });
          t.p += mk[x[0]].p; t.w += mk[x[0]].w; t.n += mk[x[0]].n;
        });
        s.n += n; s.brier += B; s.hit += hits; s.sc += sc;
        s.goals[0] += gPred; s.goals[1] += gAct;
        fs.writeFileSync("grading.json", JSON.stringify(gr));
        // The public tracker gains the model's own record (new fields only).
        const track = load("track.json", {});
        const bt = s.mk["Both teams to score"];
        track.model = {
          updated: gr.updated, since: gr.since, days: gr.days.length, n: s.n,
          brier: +(s.brier / s.n * 100).toFixed(2),
          hit: +(s.hit / s.n * 100).toFixed(1),
          btts: { pred: +(bt.p / bt.n * 100).toFixed(1), real: +(bt.w / bt.n * 100).toFixed(1) },
          goals: [+(s.goals[0] / s.n).toFixed(2), +(s.goals[1] / s.n).toFixed(2)]
        };
        fs.writeFileSync("track.json", JSON.stringify(track));
        console.log("Graded model on " + n + " matches: brier " + (B / n * 100).toFixed(2) + ", favourite hit " + (hits / n * 100).toFixed(1) + "%");
      } else {
        console.log("No finished model matches for " + old.date);
      }
    } else {
      console.log("No preds snapshot for " + old.date + ", model grading skipped");
    }
  } catch (e) {
    console.error("Model grading skipped: " + e.message);
  }
  console.log("Checked " + old.date + ": " + won + " won, " + lost + " lost, " + voided + " void");
})();
