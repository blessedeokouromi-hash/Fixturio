// Builds standings.json and scorers.json for the main leagues with matches today.
// Free plan friendly: standings + top scorers only, capped, stops on any API error.
const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX = parseInt(process.env.STANDINGS_MAX || "20", 10);
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
    const s = await api("/standings?league=" + lg.id + "&season=" + season);
    if (s.errors && Object.keys(s.errors).length) { console.log("Stop at standings " + lg.id + ": " + JSON.stringify(s.errors)); break; }
    const g = ((s.response || [])[0] || {}).league;
    const rows = g && g.standings && g.standings[0] ? g.standings[0] : [];
    if (rows.length) {
      leagues.push({
        id: lg.id, name: lg.name, country: lg.country, logo: lg.logo,
        rows: rows.map(r => ({
          r: r.rank, t: { id: r.team.id, n: r.team.name, l: r.team.logo },
          p: r.points, pl: r.all.played, w: r.all.win, d: r.all.draw, l: r.all.lose,
          gf: r.all.goals.for, ga: r.all.goals.against, gd: r.goalsDiff, f: r.form || ""
        }))
      });
    }
    const t = await api("/players/topscorers?league=" + lg.id + "&season=" + season);
    if (t.errors && Object.keys(t.errors).length) { console.log("Stop at scorers " + lg.id + ": " + JSON.stringify(t.errors)); break; }
    const list = (t.response || []).slice(0, 10).map(p => {
      const st = (p.statistics || [])[0] || {};
      return { n: p.player.name, t: st.team ? st.team.name : "", g: st.goals ? (st.goals.total || 0) : 0, a: st.goals ? (st.goals.assists || 0) : 0, pk: st.goals ? (st.goals.penalty || 0) : 0 };
    }).filter(x => x.g > 0);
    if (list.length) scorers.push({ id: lg.id, name: lg.name, country: lg.country, list });
  }

  if (!leagues.length) { console.log("No standings built (quota reached or none available); keeping the site as it is"); return; }
  fs.writeFileSync("standings.json", JSON.stringify({ date: d, generated: new Date().toISOString(), leagues }));
  fs.writeFileSync("scorers.json", JSON.stringify({ date: d, generated: new Date().toISOString(), leagues: scorers }));
  console.log("Saved standings for " + leagues.length + " leagues, scorers for " + scorers.length);
})();
