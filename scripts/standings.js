// Builds standings.json (and scorers.json when the plan allows) for the main
// leagues with matches today. Two routes:
//   1. the standings endpoint (paid plans, or free plans on older seasons)
//   2. free plans cannot read the current season's standings, so the table is
//      computed from the season's finished fixtures, which the free plan serves
// Free-plan friendly: capped leagues, stops on any API error.
const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX = parseInt(process.env.STANDINGS_MAX || "10", 10);
const TOP = [39,140,135,78,61,88,94,2,3,848,203,253,71,268,307,144,179,188,98,292,262,169,119,309,257];

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path, { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

(async () => {
  let today;
  try { today = JSON.parse(fs.readFileSync("data/d0.json", "utf8")); } catch (e) { console.log("No d0.json, skipping standings"); return; }
  const d = today.date || new Date().toISOString().slice(0,10);
  const y = new Date(d).getUTCFullYear();
  const season = new Date(d).getUTCMonth() + 1 >= 7 ? y : y - 1;

  const seen = {};
  (today.response || []).forEach(m => { if (!seen[m.league.id]) seen[m.league.id] = m.league; });
  const picks = [];
  TOP.forEach(id => { if (seen[id] && picks.length < MAX) picks.push(seen[id]); });
  if (!picks.length) { console.log("No ranked leagues playing today"); return; }

  const leagues = [], scorers = [];
  for (const lg of picks) {
    let rows = null;
    const s = await api("/standings?league=" + lg.id + "&season=" + season);
    if (s.errors && Object.keys(s.errors).length) {
      // Route 2: compute the table from the season's finished fixtures.
      const fx = await api("/fixtures?league=" + lg.id + "&season=" + season + "&status=FT");
      if (fx.errors && Object.keys(fx.errors).length) { console.log("Stop at " + lg.id + ": " + JSON.stringify(fx.errors)); break; }
      const tab = {};
      (fx.response || []).forEach(m => {
        if (!m.goals || m.goals.home == null || m.goals.away == null) return;
        [[m.teams.home, m.goals.home, m.goals.away], [m.teams.away, m.goals.away, m.goals.home]].forEach(pr => {
          const t = pr[0], gf = pr[1], ga = pr[2];
          const r = tab[t.id] || (tab[t.id] = { t: { id: t.id, n: t.name, l: t.logo }, pl: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, f: [] });
          r.pl++; r.gf += gf; r.ga += ga;
          r.f.push({ date: m.fixture.date, res: gf > ga ? "W" : gf === ga ? "D" : "L" });
          if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
        });
      });
      rows = Object.values(tab).map(r => {
        r.f.sort((a, b) => a.date.localeCompare(b.date));
        const form = r.f.slice(-5).map(x => x.res).join("");
        const p = r.w * 3 + r.d, gd = r.gf - r.ga;
        return { r: 0, t: r.t, p, pl: r.pl, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd, f: form };
      }).sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf);
      rows.forEach((r, i) => { r.r = i + 1; });
      console.log(lg.id + ": table computed from the season's finished fixtures (" + rows.length + " teams)");
    } else {
      const g = ((s.response || [])[0] || {}).league;
      const st = g && g.standings && g.standings[0] ? g.standings[0] : [];
      if (st.length) rows = st.map(r => ({
        r: r.rank, t: { id: r.team.id, n: r.team.name, l: r.team.logo },
        p: r.points, pl: r.all.played, w: r.all.win, d: r.all.draw, l: r.all.lose,
        gf: r.all.goals.for, ga: r.all.goals.against, gd: r.goalsDiff, f: r.form || ""
      }));
      const t = await api("/players/topscorers?league=" + lg.id + "&season=" + season);
      if (!(t.errors && Object.keys(t.errors).length)) {
        const list = (t.response || []).slice(0, 10).map(p => {
          const stt = (p.statistics || [])[0] || {};
          return { n: p.player.name, t: stt.team ? stt.team.name : "", g: stt.goals ? (stt.goals.total || 0) : 0, a: stt.goals ? (stt.goals.assists || 0) : 0, pk: stt.goals ? (stt.goals.penalty || 0) : 0 };
        }).filter(x => x.g > 0);
        if (list.length) scorers.push({ id: lg.id, name: lg.name, country: lg.country, list });
      }
    }
    if (rows && rows.length) leagues.push({ id: lg.id, name: lg.name, country: lg.country, logo: lg.logo, rows });
  }

  if (!leagues.length) { console.log("No standings built (quota reached or none available); keeping the site as it is"); return; }
  fs.writeFileSync("standings.json", JSON.stringify({ date: d, generated: new Date().toISOString(), leagues }));
  fs.writeFileSync("scorers.json", JSON.stringify({ date: d, generated: new Date().toISOString(), leagues: scorers }));
  console.log("Saved standings for " + leagues.length + " leagues, scorers for " + scorers.length);
})();
