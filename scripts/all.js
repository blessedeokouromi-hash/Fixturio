const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const WINDOW = 45;
const MIN_GAMES = 3;
// Lighter smoothing than before, so real team differences show through as
// results accumulate instead of every team being pulled to the league average.
const K = 1.5;
// Dixon-Coles style low-score correction: tight, low-scoring results are more
// common in real football than a plain Poisson matrix admits.
const RHO = -0.10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasErr = d => d.errors && Object.keys(d.errors).length > 0;
const iso = t => new Date(t).toISOString().slice(0, 10);

const budget = require("./api-budget");
async function api(path) {
  budget.gate();
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  budget.track(path);
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

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function model(lh, la, seed) {
  const cells = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      let p = pois(lh, i) * pois(la, j);
      if (i === 0 && j === 0) p *= 1 - lh * la * RHO;
      else if ((i === 0 && j === 1) || (i === 1 && j === 0)) p *= 1 + RHO;
      else if (i === 1 && j === 1) p *= 1 - RHO;
      cells.push({ i, j, p });
    }
  }
  const tot = cells.reduce((s, c) => s + c.p, 0);
  let ph = 0, pd = 0, pa = 0, over = 0, btts = 0;
  cells.forEach(c => {
    const k = c.i > c.j ? "H" : c.i === c.j ? "D" : "A";
    if (k === "H") ph += c.p; else if (k === "D") pd += c.p; else pa += c.p;
    if (c.i + c.j >= 3) over += c.p;
    if (c.i > 0 && c.j > 0) btts += c.p;
  });
  ph /= tot; pd /= tot; pa /= tot; over /= tot; btts /= tot;
  const top = ph >= pd && ph >= pa ? "H" : pa >= pd ? "A" : "D";
  const ranked = cells.slice().sort((a, b) => b.p - a.p).slice(0, 5);
  // For a clear favourite the displayed score should match the likely result;
  // in tight games any of the top cells is a fair answer.
  const clear = Math.max(ph, pd, pa) >= 0.5;
  const pool = clear ? ranked.filter(c => (c.i > c.j ? "H" : c.i === c.j ? "D" : "A") === top) : ranked;
  const use = pool.length ? pool : ranked;
  // Deterministic weighted pick among the likeliest cells, seeded by fixture
  // id: scorelines vary between matches instead of repeating one number.
  const rnd = mulberry32(seed || 1);
  const w = use.map(c => Math.pow(c.p / tot, 1.5));
  const sum = w.reduce((a, b) => a + b, 0);
  let x = rnd() * sum, idx = 0;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) { idx = i; break; } }
  const pick = use[idx];
  return {
    s: pick.i + "-" + pick.j,
    st: ranked.slice(0, 3).map(c => c.i + "-" + c.j).join(", "),
    h: Math.round(ph * 100), d: Math.round(pd * 100), a: Math.round(pa * 100),
    o: Math.round(over * 100), b: Math.round(btts * 100)
  };
}

(async () => {
  const now = Date.now();
  const today = iso(now);
  const yesterday = iso(now - 864e5);
  const db = load();

  // matches.js saves the day lists at the start of this build, so read those
  // files and only fall back to the API when one is missing or stale.
  async function loadDay(off) {
    try {
      const f = JSON.parse(fs.readFileSync("data/d" + off + ".json", "utf8"));
      if (f.date === iso(now + off * 864e5)) return { response: f.response || [] };
    } catch (e) {}
    return api("/fixtures?date=" + iso(now + off * 864e5));
  }

  // Free plans can only reach the last day or two, so history grows one day per run.
  // Every day adds yesterday's finished matches, and the model gets sharper as it grows.
  const ry = await loadDay(-1);
  if (hasErr(ry)) {
    console.log("Yesterday unavailable: " + JSON.stringify(ry.errors));
  } else {
    const rows = [];
    (ry.response || []).forEach(m => {
      if (["FT", "AET", "PEN"].indexOf(m.fixture.status.short) < 0) return;
      const ft = m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals;
      if (!ft || ft.home === null || ft.away === null) return;
      rows.push([m.league.id, m.teams.home.id, m.teams.away.id, ft.home, ft.away]);
    });
    db.days[yesterday] = rows;
    console.log("Stored " + rows.length + " finished matches from " + yesterday);
  }
  Object.keys(db.days).forEach(d => { if (d < iso(now - WINDOW * 864e5)) delete db.days[d]; });
  fs.writeFileSync("teamdata.json", JSON.stringify(db));

  // Each stored result carries a recency weight: last week counts about 85%
  // of this week, so a team's rating tracks what it is doing now, not what it
  // did five weeks ago.
  const all = [];
  Object.keys(db.days).forEach(d => {
    const ago = Math.round((now - new Date(d + "T00:00:00Z").getTime()) / 864e5);
    db.days[d].forEach(r => all.push([r[0], r[1], r[2], r[3], r[4], Math.pow(0.85, Math.max(0, ago))]));
  });
  console.log("Finished matches in history: " + all.length);

  const L = {};
  let gn = 0, ghg = 0, gag = 0;
  all.forEach(r => {
    const l = L[r[0]] || (L[r[0]] = { n: 0, h: 0, a: 0 });
    const w = r[5];
    l.n += w; l.h += w * r[3]; l.a += w * r[4];
    gn += w; ghg += w * r[3]; gag += w * r[4];
  });
  const G = { h: ghg / gn || 1.4, a: gag / gn || 1.1 };
  const avgFor = id => {
    const l = L[id];
    return l && l.n >= 10 ? { h: l.h / l.n || G.h, a: l.a / l.n || G.a } : G;
  };

  const T = {};
  const team = id => T[id] || (T[id] = { n: 0, sc: 0, co: 0 });
  all.forEach(r => {
    const av = avgFor(r[0]);
    const H = team(r[1]), A = team(r[2]);
    H.n += r[5]; H.sc += r[5] * r[3] / av.h; H.co += r[5] * r[4] / av.a;
    A.n += r[5]; A.sc += r[5] * r[4] / av.a; A.co += r[5] * r[3] / av.h;
  });

  // Recent form per team, oldest to newest, straight from the stored results.
  const formOf = {};
  Object.keys(db.days).sort().forEach(d => db.days[d].forEach(r => {
    const hw = r[3] > r[4], dr = r[3] === r[4];
    (formOf[r[1]] = formOf[r[1]] || []).push(hw ? "W" : dr ? "D" : "L");
    (formOf[r[2]] = formOf[r[2]] || []).push(hw ? "L" : dr ? "D" : "W");
  }));
  const last5 = id => (formOf[id] || []).slice(-5);

  // Head to head from the stored results, most recent last.
  function h2hFor(hid, aid) {
    const rows = [];
    Object.keys(db.days).sort().forEach(d => db.days[d].forEach(r => {
      if ((r[1] === hid && r[2] === aid) || (r[1] === aid && r[2] === hid)) {
        rows.push({ d: d, sh: r[1] === hid ? r[3] : r[4], sa: r[1] === hid ? r[4] : r[3] });
      }
    }));
    if (!rows.length) return null;
    let hw = 0, dr = 0, aw = 0;
    rows.forEach(r => { if (r.sh > r.sa) hw++; else if (r.sh < r.sa) aw++; else dr++; });
    return { list: rows.slice(-5), hw, dr, aw };
  }

  function formWords(name, s) {
    if (!s || !s.length) return name + ": not enough recent results stored yet";
    const w = s.filter(x => x === "W").length, d = s.filter(x => x === "D").length;
    const l = s.filter(x => x === "L").length;
    const head = w >= 3 ? "in strong form" : w === 0 && l >= 3 ? "struggling" : "mixed form";
    return name + " " + head + " (" + w + "W " + d + "D " + l + "L in their last " + s.length + ")";
  }

  const tomorrow = iso(now + 864e5);
  const fx = await loadDay(0);
  if (hasErr(fx)) { console.error("Fixtures error: " + JSON.stringify(fx.errors)); process.exit(1); }
  console.log("Fixtures today: " + (fx.response || []).length);
  const fxt = await loadDay(1);
  const tomorrowList = hasErr(fxt) ? [] : (fxt.response || []);
  console.log("Fixtures tomorrow: " + tomorrowList.length);

  // Teams with little or no history fall back to neutral strength instead of
  // being dropped, so every match gets a prediction.
  const att = t => t ? (t.sc + K) / (t.n + K) : 1;
  const def = t => t ? (t.co + K) / (t.n + K) : 1;

  const out = {};
  const lg = {};
  let thin = 0;
  function predict(m) {
    if (["PST", "CANC", "ABD", "AWD", "WO"].indexOf(m.fixture.status.short) >= 0) return;
    const av = avgFor(m.league.id);
    const H = T[m.teams.home.id], A = T[m.teams.away.id];
    if (!H || !A || H.n < MIN_GAMES || A.n < MIN_GAMES) thin++;
    let lh = av.h * att(H) * def(A);
    let la = av.a * att(A) * def(H);
    lh = Math.min(3.5, Math.max(0.2, lh));
    la = Math.min(3.5, Math.max(0.2, la));
    const mod = model(lh, la, m.fixture.id);
    const fh = last5(m.teams.home.id), fa = last5(m.teams.away.id);
    mod.x = +lh.toFixed(2);
    mod.y = +la.toFixed(2);
    mod.form = { h: fh.join(" "), a: fa.join(" ") };
    mod.h2h = h2hFor(m.teams.home.id, m.teams.away.id);
    mod.why = formWords(m.teams.home.name, fh) + ". " + formWords(m.teams.away.name, fa) +
      ". The model expects about " + (lh + la).toFixed(1) + " goals.";
    out[m.fixture.id] = mod;
    lg[m.league.id] = 1;
  }
  fx.response.forEach(predict);
  tomorrowList.forEach(predict);
  console.log("Predicted " + Object.keys(out).length + " matches (" + thin + " on thin data)");
  if (!Object.keys(out).length) { console.error("No predictions built"); process.exit(1); }
  fs.writeFileSync("all.json", JSON.stringify({
    date: today, generated: new Date().toISOString(),
    leagues: Object.keys(lg).length, m: out
  }));
})();
