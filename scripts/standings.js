// Builds standings.json from football-data.org, whose free plan serves the
// CURRENT season. One standings call and one topscorers call per competition,
// well inside the 10-per-minute free limit. Stops gracefully: if every call
// fails, the existing site files are left untouched.
const fs = require("fs");
const KEY = process.env.FOOTBALL_DATA_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COMPS = [
  ["PL", "Premier League"], ["CL", "UEFA Champions League"], ["PD", "La Liga"], ["SA", "Serie A"],
  ["FL1", "Ligue 1"], ["BL1", "Bundesliga"], ["DED", "Eredivisie"], ["PPL", "Primeira Liga"],
  ["BSA", "Serie A Brazil"]
];

async function api(path) {
  const r = await fetch("https://api.football-data.org/v4" + path, { headers: { "X-Auth-Token": KEY } });
  if (!r.ok) { console.log(path + " -> HTTP " + r.status); return null; }
  return r.json();
}

(async () => {
  if (!KEY) { console.log("FOOTBALL_DATA_KEY missing; keeping the site as it is"); return; }
  const leagues = [], scorers = [];
  for (const [code, label] of COMPS) {
    const d = await api("/competitions/" + code + "/standings");
    if (!d || !d.standings) { await sleep(7000); continue; }
    const tab = d.standings.find(s => s.type === "TOTAL") || d.standings[0];
    if (tab && tab.table && tab.table.length) {
      const rows = tab.table.map(row => ({
        r: row.position,
        t: { id: row.team.id, n: row.team.name, l: row.team.crest || "" },
        p: row.points, pl: row.playedGames, w: row.won, d: row.draw, l: row.lost,
        gf: row.goalsFor, ga: row.goalsAgainst, gd: row.goalDifference,
        f: (row.form || "").replace(/,/g, ""), fd: 1
      }));
      leagues.push({ id: code, name: code === "PD" ? "La Liga" : (code === "BSA" ? "Serie A Brazil" : d.competition.name), country: d.competition.area ? d.competition.area.name : "", logo: d.competition.emblem || "", rows });
      console.log(code + ": " + rows.length + " teams, season " + (d.season ? d.season.startDate.slice(0, 4) : "?"));
    }
    await sleep(7000);
    const ts = await api("/competitions/" + code + "/topscorers");
    if (ts && ts.scorers && ts.scorers.length) {
      scorers.push({ id: code, name: d.competition.name, list: ts.scorers.slice(0, 10).map(s => ({ n: s.player ? s.player.name : "?", t: s.team ? s.team.name : "", g: s.goals || 0 })) });
    }
    await sleep(7000);
  }
  if (!leagues.length) { console.log("No tables from football-data.org; keeping the site as it is"); return; }
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync("standings.json", JSON.stringify({
    date, generated: new Date().toISOString(), season: 2026,
    note: "Live tables for the current season, refreshed each morning.",
    leagues
  }));
  fs.writeFileSync("scorers.json", JSON.stringify({ date, generated: new Date().toISOString(), leagues: scorers }));
  console.log("Saved live standings for " + leagues.length + " leagues, scorers for " + scorers.length);
})();
