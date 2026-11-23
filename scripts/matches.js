// Saves trimmed fixture lists for the given day offsets, e.g. node scripts/matches.js -1,0,1
const fs = require("fs");
const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

(async () => {
  const offs = String(process.argv[2] || "0").split(",")
    .map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  fs.mkdirSync("data", { recursive: true });
  let wrote = 0;
  for (const o of offs) {
    const date = new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
    const d = await api("/fixtures?date=" + date);
    if (d.errors && Object.keys(d.errors).length) {
      console.log("Skipped " + date + ": " + JSON.stringify(d.errors));
      continue;
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
    fs.writeFileSync("data/d" + o + ".json", JSON.stringify({
      date, generated: new Date().toISOString(), response
    }));
    wrote++;
    console.log("Saved " + date + " (" + response.length + " matches)");
  }
  console.log("Saved " + wrote + " day file(s)");
})();
