// Builds standings.json for the big leagues by accumulating results ourselves.
// The free data plan blocks the current season on every endpoint except
// date queries, so we collect each day's finished matches into a running
// table (data/standings-state.json) and rebuild the tables from it.
// Backfill: up to 15 past dates per run from the spare request budget, so the
// tables become complete a few mornings after launch. Until then the previous
// standings.json is left untouched.
const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = "2026-07-27";           // merge from the day before this season's openings
const INCLUDED = { 39: 1, 140: 1, 135: 1, 78: 1, 61: 1, 88: 1, 40: 1, 203: 1, 188: 1 };
const BUDGET = 15;

function shift(dateStr, days) {
  const t = new Date(dateStr + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path, { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

function merge(state, matches) {
  (matches || []).forEach(m => {
    if (!m.goals || m.goals.home == null || m.goals.away == null) return;
    if (!["FT", "AET", "PEN"].includes(m.fixture.status.short)) return;
    const lg = m.league;
    if (!INCLUDED[lg.id]) return;
    if (state.seen[m.fixture.id]) return;
    state.seen[m.fixture.id] = 1;
    const t = state.tables[lg.id] || (state.tables[lg.id] = { id: lg.id, name: lg.name, country: lg.country, logo: lg.logo, teams: {} });
    if (!t.name) { t.name = lg.name; t.country = lg.country; t.logo = lg.logo; }
    [[m.teams.home, m.goals.home, m.goals.away], [m.teams.away, m.goals.away, m.goals.home]].forEach(pr => {
      const T = pr[0], gf = pr[1], ga = pr[2];
      const r = t.teams[T.id] || (t.teams[T.id] = { n: T.name, l: T.logo, pl: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, f: [] });
      r.pl++; r.gf += gf; r.ga += ga;
      r.f.push({ d: m.fixture.date.slice(0, 10), r: gf > ga ? "W" : gf === ga ? "D" : "L" });
      if (r.f.length > 6) r.f = r.f.slice(-6);
      if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
    });
  });
}

function build(state) {
  const leagues = [];
  Object.values(state.tables).forEach(t => {
    const rows = Object.entries(t.teams).map(([id, r]) => ({
      r: 0, t: { id: +id, n: r.n, l: r.l }, p: r.w * 3 + r.d, pl: r.pl, w: r.w, d: r.d, l: r.l,
      gf: r.gf, ga: r.ga, gd: r.gf - r.ga, f: r.f.slice(-5).map(x => x.r).join("")
    }));
    rows.sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf);
    rows.forEach((x, i) => { x.r = i + 1; });
    if (rows.length) leagues.push({ id: t.id, name: t.name, country: t.country, logo: t.logo, rows });
  });
  leagues.sort((a, b) => a.name.localeCompare(b.name));
  return leagues;
}

(async () => {
  let y;
  try { y = JSON.parse(fs.readFileSync("data/d-1.json", "utf8")); } catch (e) { console.log("No d-1.json, skipping standings"); return; }
  const target = y.date;
  let state;
  try { state = JSON.parse(fs.readFileSync("data/standings-state.json", "utf8")); } catch (e) {
    state = { lastDate: START, seen: {}, tables: {} };
  }
  if (!state.tables) state.tables = {};

  const backfill = state.lastDate < shift(target, -7);
  let dates;
  if (state.lastDate < target) {
    dates = [];
    for (let d = shift(state.lastDate, 1); d <= target; d = shift(d, 1)) dates.push(d);
    if (!backfill) dates.unshift(state.lastDate);   // re-check yesterday-1 for late finishers
  } else {
    dates = [state.lastDate];                        // steady state: catch late finishers only
  }

  let used = 0, stopped = null;
  for (const date of dates) {
    if (used >= BUDGET) { stopped = date; break; }
    let ms;
    if (date === target) { ms = y.response || []; }
    else {
      const r = await api("/fixtures?date=" + date);
      if (r.errors && Object.keys(r.errors).length) { console.log("Stop at " + date + ": " + JSON.stringify(r.errors)); stopped = date; break; }
      ms = r.response || [];
    }
    merge(state, ms);
    state.lastDate = date; used++;
  }

  fs.writeFileSync("data/standings-state.json", JSON.stringify(state));
  console.log("Merged " + used + " day(s), table now covers through " + state.lastDate + (stopped ? " (next run continues from " + stopped + ")" : ""));

  if (state.lastDate >= target) {
    const leagues = build(state);
    if (!leagues.length) { console.log("No league tables yet; keeping the site as it is"); return; }
    fs.writeFileSync("standings.json", JSON.stringify({
      date: target, generated: new Date().toISOString(), season: 2026,
      note: "Live tables for the current season, built from every played match and refreshed each morning.",
      leagues
    }));
    console.log("Saved live standings for " + leagues.length + " leagues");
  } else {
    console.log("Backfill still running (" + used + "/" + BUDGET + " this run); keeping the existing standings.json");
  }
})();
