const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const TOP = [2,3,848,39,140,135,78,61,88,94,144,203,40,253,71,128,179];
const MAX_LEAGUES = 25;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasErr = d => d.errors && Object.keys(d.errors).length > 0;

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

const side = (t, s) => {
  const x = (t && t[s]) || {}, g = x.goals || {};
  return { p: +x.played || 0, f: +g.for || 0, a: +g.against || 0 };
};

function parseStandings(d) {
  const out = {};
  const groups = (((d.response || [])[0] || {}).league || {}).standings || [];
  groups.forEach(g => (g || []).forEach(t => { if (t && t.team) out[t.team.id] = t; }));
  return out;
}

function leagueAvg(tm) {
  let hg = 0, hp = 0, ag = 0, ap = 0;
  Object.values(tm).forEach(t => {
    const h = side(t, "home"), a = side(t, "away");
    hg += h.f; hp += h.p; ag += a.f; ap += a.p;
  });
  return { h: hp ? hg / hp : 1.4, a: ap ? ag / ap : 1.1 };
}

function strength(gf, gp, avg) {
  if (!gp || !avg) return 1;
  const w = gp / (gp + 4);
  return w * ((gf / gp) / avg) + (1 - w);
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
  const date = new Date().toISOString().slice(0, 10);
  const fx = await api("/fixtures?date=" + date);
  if (hasErr(fx)) { console.error("Fixtures error: " + JSON.stringify(fx.errors)); process.exit(1); }
  console.log("Fixtures today: " + (fx.response || []).length);

  const skip = ["PST", "CANC", "ABD", "AWD", "WO"];
  const all = (fx.response || []).filter(m => skip.indexOf(m.fixture.status.short) < 0);
  const groups = {};
  all.forEach(m => {
    const k = m.league.id + "|" + m.league.season;
    (groups[k] = groups[k] || []).push(m);
  });
  const rank = id => { const i = TOP.indexOf(id); return i === -1 ? 99 : i; };
  const keys = Object.keys(groups)
    .sort((a, b) => (rank(+a.split("|")[0]) - rank(+b.split("|")[0])) || (groups[b].length - groups[a].length))
    .slice(0, MAX_LEAGUES);
  console.log("Leagues to check: " + keys.length);

  const out = {};
  let leagues = 0;
  for (const k of keys) {
    const parts = k.split("|");
    const sd = await api("/standings?league=" + parts[0] + "&season=" + parts[1]);
    if (hasErr(sd)) {
      const msg = JSON.stringify(sd.errors);
      console.log("League " + parts[0] + " error: " + msg);
      if (/limit|request|rate|quota/i.test(msg)) { console.log("Stopping: request limit reached"); break; }
      continue;
    }
    const tm = parseStandings(sd);
    const nt = Object.keys(tm).length;
    if (nt < 4) { console.log("League " + parts[0] + ": no usable standings (" + nt + " teams)"); continue; }
    const avg = leagueAvg(tm);
    let n = 0;
    groups[k].forEach(m => {
      const H = tm[m.teams.home.id], A = tm[m.teams.away.id];
      if (!H || !A) return;
      const hh = side(H, "home"), ha = side(H, "away"), ah = side(A, "home"), aa = side(A, "away");
      let lh = avg.h * strength(hh.f, hh.p, avg.h) * strength(aa.a, aa.p, avg.h);
      let la = avg.a * strength(aa.f, aa.p, avg.a) * strength(hh.a, hh.p, avg.a);
      lh = Math.min(3.5, Math.max(0.2, lh));
      la = Math.min(3.5, Math.max(0.2, la));
      out[m.fixture.id] = model(lh, la);
      n++;
    });
    console.log("League " + parts[0] + ": " + n + " of " + groups[k].length + " matches predicted");
    if (n) leagues++;
  }
  if (!Object.keys(out).length) { console.error("No predictions built"); process.exit(1); }
  fs.writeFileSync("all.json", JSON.stringify({ date, generated: new Date().toISOString(), leagues, m: out }));
  console.log("Predicted " + Object.keys(out).length + " matches in " + leagues + " leagues");
})();
