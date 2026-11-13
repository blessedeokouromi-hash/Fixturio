const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const TOP = [2,3,848,39,140,135,78,61,88,94,144,203,40,253,71,128,179];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => parseFloat(String(v == null ? "" : v).replace("%", "")) || 0;

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

function twoWay(bet, k1, k2) {
  if (!bet) return null;
  const o = {};
  (bet.values || []).forEach(v => { o[v.value] = parseFloat(v.odd); });
  if (!(o[k1] > 1 && o[k2] > 1)) return null;
  const x = 1 / o[k1], y = 1 / o[k2];
  return [x / (x + y), y / (x + y)];
}

function pickBets(od) {
  const bms = ((od.response || [])[0] || {}).bookmakers || [];
  const bm = bms.find(b => (b.bets || []).some(x => x.id === 1)) || bms[0];
  return bm ? (bm.bets || []) : [];
}

function analyze(p, bets) {
  const pc = p.predictions.percent || {};
  let h = num(pc.home), d = num(pc.draw), a = num(pc.away);
  const s = h + d + a;
  if (s > 0) { h /= s; d /= s; a /= s; } else { h = d = a = 1 / 3; }
  let src = "form and statistics data";
  const w = bets.find(b => b.id === 1);
  if (w) {
    const o = {};
    (w.values || []).forEach(v => { o[v.value] = parseFloat(v.odd); });
    if (o.Home > 1 && o.Draw > 1 && o.Away > 1) {
      const ih = 1 / o.Home, ix = 1 / o.Draw, ia = 1 / o.Away;
      const t = ih + ix + ia;
      h = 0.7 * (ih / t) + 0.3 * h;
      d = 0.7 * (ix / t) + 0.3 * d;
      a = 0.7 * (ia / t) + 0.3 * a;
      src = "bookmaker odds blended with form data";
    }
  }
  const list = [
    { market: "Home win", prob: h, kind: "single" },
    { market: "Away win", prob: a, kind: "single" },
    { market: "Double chance 1X (home or draw)", prob: h + d, kind: "dc" },
    { market: "Double chance X2 (away or draw)", prob: d + a, kind: "dc" },
    { market: "Double chance 12 (no draw)", prob: h + a, kind: "dc" }
  ];
  const ou = twoWay(bets.find(b => b.id === 5), "Over 2.5", "Under 2.5");
  if (ou) {
    list.push({ market: "Over 2.5 goals", prob: ou[0], kind: "single" });
    list.push({ market: "Under 2.5 goals", prob: ou[1], kind: "single" });
  }
  const bt = twoWay(bets.find(b => b.id === 8), "Yes", "No");
  if (bt) {
    list.push({ market: "Both teams to score", prob: bt[0], kind: "single" });
    list.push({ market: "Both teams not to score", prob: bt[1], kind: "single" });
  }
  return { src, list };
}

function reason(m) {
  const f = m.form && m.form.home && m.form.away
    ? " Recent form: " + m.home + " " + m.form.home + " vs " + m.away + " " + m.form.away + "."
    : "";
  return "Based on " + m.src + "." + f;
}

(async () => {
  const date = new Date().toISOString().slice(0, 10);
  const fx = await api("/fixtures?date=" + date);
  if (fx.errors && Object.keys(fx.errors).length) {
    console.error(JSON.stringify(fx.errors));
    process.exit(1);
  }
  const rank = m => { const i = TOP.indexOf(m.league.id); return i === -1 ? 99 : i; };
  const cands = (fx.response || [])
        .filter(m => m.fixture.status.short === "NS" && !/\bU\s?(1[5-9]|2[0-3])\b|youth|reserve/i.test(m.teams.home.name + " " + m.teams.away.name + " " + m.league.name))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 8)

  const matches = [];
  for (const c of cands) {
    const pr = await api("/predictions?fixture=" + c.fixture.id);
    const p = pr.response && pr.response[0];
    if (!p) continue;
    const od = await api("/odds?fixture=" + c.fixture.id);
    const a = analyze(p, pickBets(od));
    matches.push({
      id: c.fixture.id,
      league: c.league.name,
      kickoff: c.fixture.date,
      home: c.teams.home.name,
      away: c.teams.away.name,
      src: a.src,
      form: p.comparison && p.comparison.form ? p.comparison.form : null,
      markets: a.list.map(x => ({
        market: x.market,
        prob: Math.round(x.prob * 1000) / 1000,
        kind: x.kind
      }))
    });
  }
  if (matches.length < 2) { console.error("Not enough matches"); process.exit(1); }

  const picks = [];
  matches.forEach(m => {
    const sorted = m.markets.slice().sort((x, y) => y.prob - x.prob);
    const best = sorted[0];
    const single = sorted.find(x => x.kind === "single");
    const chosen = [best];
    if (single && single !== best && single.prob >= 0.5) chosen.push(single);
    chosen.forEach(c => picks.push({
      fixture: m.id,
      match: m.home + " vs " + m.away,
      market: c.market,
      probability: Math.round(Math.min(90, c.prob * 100)),
      reason: reason(m),
      kickoff: m.kickoff,
      league: m.league
    }));
  });
  picks.sort((a, b) => b.probability - a.probability);

  fs.writeFileSync("daily.json", JSON.stringify({
    date,
    generated: new Date().toISOString(),
    matches,
    picks: picks.slice(0, 15),
    summary: "Ranked by estimated chance of winning, from bookmaker odds and form data. Safer markets like double chance rank higher, so always check the market before you decide."
  }));
  console.log("Wrote " + matches.length + " matches");
})();
