// Refreshes today's match statuses and scores: 1 API request per run.
// Skips itself when the free plan's daily budget is nearly out, so live
// refreshes can never push the account into suspension.
const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const FLOOR = 4;

(async () => {
  fs.mkdirSync("data", { recursive: true });
  let q = {};
  try { q = JSON.parse(fs.readFileSync("data/quota.json", "utf8")); } catch (e) {}
  const date = new Date().toISOString().slice(0, 10);
  // Live refreshes run in the evening (17:00-22:59 UTC), when the big games
  // play and the budget is tight. Dispatches can force a run with
  // LIVE_REFRESH_FORCE=1.
  const hr = new Date().getUTCHours();
  if (hr < 17 && process.env.LIVE_REFRESH_FORCE !== "1") {
    console.log("Skipped: outside the evening refresh window");
    return;
  }
  if (q.date === date && typeof q.remaining === "number" && q.remaining < FLOOR) {
    console.log("Skipped: only " + q.remaining + " API calls left today (floor " + FLOOR + ")");
    return;
  }
  const r = await fetch("https://v3.football.api-sports.io/fixtures?date=" + date,
    { headers: { "x-apisports-key": KEY } });
  const rem = parseInt(r.headers.get("x-ratelimit-remaining") || "", 10);
  if (!isNaN(rem)) fs.writeFileSync("data/quota.json", JSON.stringify({ date, remaining: rem, checked: new Date().toISOString() }));
  const d = await r.json();
  if (d.errors && Object.keys(d.errors).length) {
    console.log("Skipped " + date + ": " + JSON.stringify(d.errors));
    return;
  }
  const response = (d.response || []).map(m => ({
    fixture: {
      id: m.fixture.id, timestamp: m.fixture.timestamp, date: m.fixture.date,
      status: { short: m.fixture.status.short, elapsed: m.fixture.status.elapsed }
    },
    league: { id: m.league.id, name: m.league.name, country: m.league.country, logo: m.league.logo },
    teams: {
      home: { id: m.teams.home.id, name: m.teams.home.name, logo: m.teams.home.logo },
      away: { id: m.teams.away.id, name: m.teams.away.name, logo: m.teams.away.logo }
    },
    goals: m.goals
  }));
  fs.writeFileSync("data/d0.json", JSON.stringify({ date, generated: new Date().toISOString(), response }));
  console.log("Live refresh " + date + ": " + response.length + " matches" + (isNaN(rem) ? "" : ", " + rem + " API calls left today"));
})();
