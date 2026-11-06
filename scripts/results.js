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
  console.log("Checked " + old.date + ": " + won + " won, " + lost + " lost, " + voided + " void");
})();
