const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const WINDOW = 45;        // days of stored results the model looks back on
const MIN_GAMES = 3;      // a team with fewer weighted games is flagged thin
const K_TEAM = 8;         // team shrinkage: about 8 games of evidence before a
                          // team's own record carries half the weight
const K_LEAGUE = 50;      // league scoring averages shrink toward the global
                          // average with this much counterweight
const K_FORM = 4;         // recent-form shrinkage: about 4 games before form
                          // carries its full weight
const W_FORM = 0.30;      // the most weight recent form can take from
                          // season-long strength (tuned in calibration)
const DECAY = 0.80;       // a result one day older weighs 80% of a fresher one
const RHO = 0;            // Dixon-Coles low-score correction (backtest: 0 beats -0.10 so far; refit when history deepens)
const THIN_GAMES = 6;     // combined sample below this marks a match thin
const VERYTHIN_GAMES = 3; // combined sample below this marks it very thin
const CUP_RE = /cup|copa|coppa|pokal|trophy|shield|super\s?cup|friendly|play-?offs?|qualif/i;

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

// One Dixon-Coles score matrix per match. Every market (1X2, over/under 2.5,
// BTTS, correct score) is read off this single matrix, so the markets on a
// match can never disagree with each other.
function model(lh, la) {
  const cells = [];
  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 9; j++) {
      let p = pois(lh, i) * pois(la, j);
      if (i === 0 && j === 0) p *= 1 - lh * la * RHO;
      else if ((i === 0 && j === 1) || (i === 1 && j === 0)) p *= 1 + RHO;
      else if (i === 1 && j === 1) p *= 1 - RHO;
      if (p < 0) p = 0;
      cells.push({ i: i, j: j, p: p });
    }
  }
  const tot = cells.reduce((s, c) => s + c.p, 0);
  cells.forEach(c => { c.p /= tot; });
  let ph = 0, pd = 0, pa = 0, over = 0, btts = 0;
  cells.forEach(c => {
    if (c.i > c.j) ph += c.p; else if (c.i === c.j) pd += c.p; else pa += c.p;
    if (c.i + c.j >= 3) over += c.p;
    if (c.i > 0 && c.j > 0) btts += c.p;
  });
  const ranked = cells.slice().sort((a, b) => b.p - a.p);
  const top = ranked[0];
  return {
    s: top.i + "-" + top.j,
    st: ranked.slice(0, 3).map(c => c.i + "-" + c.j).join(", "),
    csP: Math.round(top.p * 100),
    csList: ranked.slice(0, 5).map(c => ({ s: c.i + "-" + c.j, p: Math.round(c.p * 1000) / 10 })),
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

  // Every stored result carries a recency weight.
  const all = [];
  Object.keys(db.days).forEach(d => {
    const ago = Math.round((now - new Date(d + "T00:00:00Z").getTime()) / 864e5);
    db.days[d].forEach(r => all.push([r[0], r[1], r[2], r[3], r[4], Math.pow(DECAY, Math.max(0, ago))]));
  });
  console.log("Finished matches in history: " + all.length);

  // League scoring averages, home and away separate. A league with few games
  // shrinks toward the global average instead of switching to it wholesale,
  // so a 4-game league keeps a little of its own flavour without wild swings.
  const L = {};
  let gn = 0, ghg = 0, gag = 0;
  all.forEach(r => {
    const l = L[r[0]] || (L[r[0]] = { n: 0, h: 0, a: 0 });
    const w = r[5];
    l.n += w; l.h += w * r[3]; l.a += w * r[4];
    gn += w; ghg += w * r[3]; gag += w * r[4];
  });
  const G = { h: ghg / gn || 1.4, a: gag / gn || 1.1 };
  function lgAv(lid) {
    const l = L[lid];
    if (!l || l.n <= 0) return G;
    return {
      h: (l.h + G.h * K_LEAGUE) / (l.n + K_LEAGUE) || G.h,
      a: (l.a + G.a * K_LEAGUE) / (l.n + K_LEAGUE) || G.a
    };
  }

  // Per-team attack and defence, kept separate for home and away. Each is the
  // team's weighted goals scored or conceded in that venue, shrunk toward the
  // league average for that venue, expressed as a ratio (1 = average).
  const T = {};
  const mkT = () => ({ nh: 0, gh: 0, cgH: 0, na: 0, ga: 0, cgA: 0 });
  all.forEach(r => {
    const H = T[r[1]] || (T[r[1]] = mkT());
    const A = T[r[2]] || (T[r[2]] = mkT());
    H.nh += r[5]; H.gh += r[5] * r[3]; H.cgH += r[5] * r[4];
    A.na += r[5]; A.ga += r[5] * r[4]; A.cgA += r[5] * r[3];
  });
  const attH = (t, av) => t && t.nh > 0 ? (t.gh + K_TEAM * av.h) / (t.nh + K_TEAM) / av.h : 1;
  const defH = (t, av) => t && t.nh > 0 ? (t.cgH + K_TEAM * av.a) / (t.nh + K_TEAM) / av.a : 1;
  const attA = (t, av) => t && t.na > 0 ? (t.ga + K_TEAM * av.a) / (t.na + K_TEAM) / av.a : 1;
  const defA = (t, av) => t && t.na > 0 ? (t.cgA + K_TEAM * av.h) / (t.na + K_TEAM) / av.h : 1;

  // Recent form per team: last six matches, recency-weighted, venue-aware
  // (goals are compared to the average for the venue they were played at).
  const formOf = {};
  Object.keys(db.days).forEach(d => {
    const ago = Math.round((now - new Date(d + "T00:00:00Z").getTime()) / 864e5);
    db.days[d].forEach(r => {
      (formOf[r[1]] = formOf[r[1]] || []).push({ gf: r[3], ga: r[4], home: true, lg: r[0], ago: ago });
      (formOf[r[2]] = formOf[r[2]] || []).push({ gf: r[4], ga: r[3], home: false, lg: r[0], ago: ago });
    });
  });
  const last5 = id => (formOf[id] || [])
    .slice().sort((a, b) => a.ago - b.ago).slice(-5)
    .map(m => m.gf > m.ga ? "W" : m.gf === m.ga ? "D" : "L").join("");
  function formRatios(id) {
    const list = (formOf[id] || []).slice().sort((a, b) => a.ago - b.ago).slice(-6);
    if (!list.length) return null;
    let sw = 0, att = 0, def = 0;
    list.forEach(m => {
      const av = lgAv(m.lg);
      const w = Math.pow(DECAY, Math.max(0, m.ago));
      const gfN = m.home ? m.gf / av.h : m.gf / av.a;
      const gaN = m.home ? m.ga / av.a : m.ga / av.h;
      att += w * gfN; def += w * gaN; sw += w;
    });
    if (sw <= 0) return null;
    return {
      att: (att + K_FORM) / (sw + K_FORM),
      def: (def + K_FORM) / (sw + K_FORM),
      w: sw
    };
  }
  // Blend: season-long strength leads, recent form takes up to W_FORM of the
  // say, and less when the form sample is short.
  function blend(form, base, key) {
    if (!form) return base;
    const wF = W_FORM * Math.min(1, form.w / 6);
    return (1 - wF) * base + wF * form[key];
  }

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
    const w = s.split("W").length - 1, d = s.split("D").length - 1, l = s.split("L").length - 1;
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

  const out = {};
  const lg = {};
  let thin = 0;
  function predict(m) {
    if (["PST", "CANC", "ABD", "AWD", "WO"].indexOf(m.fixture.status.short) >= 0) return;
    const av = lgAv(m.league.id);
    const H = T[m.teams.home.id], A = T[m.teams.away.id];
    const fH = formRatios(m.teams.home.id), fA = formRatios(m.teams.away.id);
    const bAttH = blend(fH, attH(H, av), "att");
    const bDefA = blend(fA, defA(A, av), "def");
    const bAttA = blend(fA, attA(A, av), "att");
    const bDefH = blend(fH, defH(H, av), "def");
    let lh = av.h * bAttH * bDefA;
    let la = av.a * bAttA * bDefH;
    lh = Math.min(3.5, Math.max(0.2, lh));
    la = Math.min(3.5, Math.max(0.2, la));
    const mod = model(lh, la);
    mod.x = +lh.toFixed(2);
    mod.y = +la.toFixed(2);
    mod.form = { h: last5(m.teams.home.id), a: last5(m.teams.away.id) };
    mod.h2h = h2hFor(m.teams.home.id, m.teams.away.id);
    mod.why = formWords(m.teams.home.name, mod.form.h) + ". " + formWords(m.teams.away.name, mod.form.a) +
      ". The model expects about " + (lh + la).toFixed(1) + " goals.";
    // How much data stands behind this match: each side's weighted games.
    const nh = H ? H.nh + H.na : 0, na = A ? A.na + A.nh : 0;
    mod.n = { h: +nh.toFixed(1), a: +na.toFixed(1) };
    const minN = Math.min(nh, na);
    mod.q = minN < VERYTHIN_GAMES ? "very-thin" : minN < THIN_GAMES ? "thin" : "ok";
    mod.cupish = CUP_RE.test(m.league.name || "");
    mod.lg = m.league.id;
    mod.kd = (m.fixture.date || "").slice(0, 10);
    if (minN < MIN_GAMES) thin++;
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
  // Slim snapshot of every prediction made today, for the next build to grade
  // against final scores (it reuses the results call, so no extra API use).
  const slim = {};
  Object.keys(out).forEach(id => {
    const m = out[id];
    slim[id] = { lg: m.lg, kd: m.kd, x: m.x, y: m.y, h: m.h, d: m.d, a: m.a, o: m.o, b: m.b, s: m.s, csP: m.csP, q: m.q, n: m.n };
  });
  try {
    fs.writeFileSync("data/preds.json", JSON.stringify({ date: today, generated: new Date().toISOString(), m: slim }));
    console.log("Saved preds snapshot: " + Object.keys(slim).length + " matches");
  } catch (e) { console.error("preds snapshot failed: " + e.message); }
})();
