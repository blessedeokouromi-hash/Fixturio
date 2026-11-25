// Evening basketball status refresh. One /games call for today, then patch
// statuses, scores and team logos into the built data/basketball.json.
// Never touches picks, the acca or odds: the morning build owns those.
// Budget: exactly 1 api call per run (api-basketball free plan: 100/day).
const fs = require("fs");
const KEY = process.env.BASKETBALL_KEY;
const HOST = "https://v1.basketball.api-sports.io";
const today = new Date().toISOString().slice(0, 10);

(async () => {
  if (!KEY) { console.log("Basketball key missing; skipping the refresh."); process.exit(0); }
  const r = await fetch(HOST + "/games?date=" + today, { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  if (d.errors && Object.keys(d.errors).length) throw new Error("api error " + JSON.stringify(d.errors).slice(0, 200));
  const byId = {}; (d.response || []).forEach(g => { byId[g.id] = g; });
  const bb = JSON.parse(fs.readFileSync("data/basketball.json", "utf8"));
  if (bb.date !== today) { console.log("basketball.json is for " + bb.date + ", not " + today + "; skipping."); process.exit(0); }
  let patched = 0, live = 0, done = 0;
  bb.m.forEach(row => {
    const g = byId[row.game_id];
    if (!g) return;
    patched++;
    if (g.status && g.status.short) row.status = g.status.short;
    if (g.scores) {
      if (g.scores.home && g.scores.home.total != null) row.sc_h = g.scores.home.total;
      if (g.scores.away && g.scores.away.total != null) row.sc_a = g.scores.away.total;
    }
    if (g.teams && g.teams.home && g.teams.home.logo) row.lh = row.lh || g.teams.home.logo;
    if (g.teams && g.teams.away && g.teams.away.logo) row.la = row.la || g.teams.away.logo;
  });
  ["Q1","Q2","Q3","Q4","OT","BT","HT","LIVE"].forEach(s => { live += bb.m.filter(r2 => r2.status === s).length; });
  ["FT","AOT","POST"].forEach(s => { done += bb.m.filter(r2 => r2.status === s).length; });
  bb.generated = new Date().toISOString();
  fs.writeFileSync("data/basketball.json", JSON.stringify(bb));
  console.log("basketball refresh: patched " + patched + "/" + bb.m.length + " rows, live " + live + ", finished " + done + ", 1 api call");
})().catch(e => { console.error("Basketball refresh failed: " + (e && e.message ? e.message : e)); process.exit(1); });
