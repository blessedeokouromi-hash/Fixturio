const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const WINDOW = 30;
const MIN_GAMES = 3;
const K = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasErr = d => d.errors && Object.keys(d.errors).length > 0;
const iso = t => new Date(t).toISOString().slice(0, 10);

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync("teamdata.json", "utf8"));
    if (d && d.days) return d;
  } catch (e) {}
  return { days: {} };
}

function pois(l, k) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

function model(lh, la) {
  let ph = 0, pd = 0, pa = 0, over = 0, btts = 0, tot = 0;
  const best = { H: [0, 0, -1], D: [0, 0, -1], A: [0, 0, -1] };
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = pois(lh, i) * pois(la, j);
      tot += p;
      const k = i > j ? "H" : i === j ? "D" : "A";
      if (k === "H") ph += p; else if (k === "D") pd += p; else pa += p;
      if (p > best[k][2]) best[k] = [i, j, p];
      if (i + j >= 3) over += p;
      if (i > 0 && j > 0) btts += p;
    }
  }
  ph /= tot; pd /= tot; pa /= tot; over /= tot; btts /= tot;
  const top = ph >= pd && ph >= pa ? "H" : pa >= pd ? "A" : "D";
  const b = best[top];
  return {
    s: b[0] + "-" + b[1],
    h: Math.round(ph * 100), d: Math.round(pd * 100), a: Math.round(pa * 100),
    o: Math.round(over * 100), b: Math.round(btts * 100)
  };
}

(async () => {
  const now = Date.now();
  const today = iso(now);
  const db = load();

  const missing = [];
  for (let i = 1; i <= WINDOW; i++) {
    const d = iso(now - i * 864e5);
    if (!db.days[d]) missing.push(d);
  }
  console.log("Days to fetch: " + missing.length);
  for (const d of missing) {
    const r = await api("/fixtures?date=" + d);
    if (hasErr(r)) { console.log("Stopped at " + d + ": " + JSON.stringify(r.errors)); break; }
    const rows = [];
    (r.response || []).forEach(m => {
      if (["FT", "AET", "PEN"].indexOf(m.fixture.status.short) < 0) return;
      const ft = m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals;
      if (!ft || ft.home === null || ft.away === null) return;
      rows.push([m.league.id, m.teams.home.id, m.teams.away.id, ft.home, ft.away]);
    });
    db.days[d] = rows;
  }
  Object.keys(db.days).forEach(d => { if (d < iso(now - WINDOW * 864e5)) delete db.days[d]; });
  fs.writeFileSync("teamdata.json", JSON.stringify(db));

  const all = [];
  Object.keys(db.days).forEach(d => db.days[d].forEach(r => all.push(r)));
  console.log("Finished matches in history: " + all.length);
  if (all.length < 200) { console.error("Not enough history yet"); process.exit(1); }

  const L = {};
  let gn = 0, ghg = 0, gag = 0;
  all.forEach(r => {
    const l = L[r[0]] || (L[r[0]] = { n: 0, h: 0, a: 0 });
    l.n++; l.h += r[3]; l.a += r[4];
    gn++; ghg += r[3]; gag += r[4];
  });
  const G = { h: ghg / gn || 1.4, a: gag / gn || 1.1 };
  const avgFor = id => {
    const l = L[id];
    return l && l.n >= 15 ? { h: l.h / l.n || G.h, a: l.a / l.n || G.a } : G;
  };

  const T = {};
  const team = id => T[id] || (T[id] = { n: 0, sc: 0, co: 0 });
  all.forEach(r => {
    const av = avgFor(r[0]);
    const H = team(r[1]), A = team(r[2]);
    H.n++; H.sc += r[3] / av.h; H.co += r[4] / av.a;
    A.n++; A.sc += r[4] / av.a; A.co += r[3] / av.h;
  });
  const att = t => (t.sc + K) / (t.n + K);
  const def = t => (t.co + K) / (t.n + K);

  const fx = await api("/fixtures?date=" + today);
  if (hasErr(fx)) { console.error("Fixtures error: " + JSON.stringify(fx.errors)); process.exit(1); }
  console.log("Fixtures today: " + (fx.response || []).length);

  const out = {};
  const lg = {};
  let skipped = 0;
  (fx.response || []).forEach(m => {
    if (["PST", "CANC", "ABD", "AWD", "WO"].indexOf(m.fixture.status.short) >= 0) return;
    const H = T[m.teams.home.id], A = T[m.teams.away.id];
    if (!H || !A || H.n < MIN_GAMES || A.n < MIN_GAMES) { skipped++; return; }
    const av = avgFor(m.league.id);
    let lh = av.h * att(H) * def(A);
    let la = av.a * att(A) * def(H);
    lh = Math.min(3.5, Math.max(0.2, lh));
    la = Math.min(3.5, Math.max(0.2, la));
    out[m.fixture.id] = Object.assign(model(lh, la), { x: +lh.toFixed(2), y: +la.toFixed(2) });
    lg[m.league.id] = 1;
  });
  console.log("Predicted " + Object.keys(out).length + " matches, skipped " + skipped + " with too little data");
  if (!Object.keys(out).length) { console.error("No predictions built"); process.exit(1); }
  fs.writeFileSync("all.json", JSON.stringify({
    date: today, generated: new Date().toISOString(),
    leagues: Object.keys(lg).length, m: out
  }));
})();
