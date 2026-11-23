const KEY = process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const p of ["/fixtures?league=39&last=5", "/fixtures?league=39&season=2026&last=5"]) {
    const r = await fetch("https://v3.football.api-sports.io" + p, { headers: { "x-apisports-key": KEY } });
    const d = await r.json();
    console.log("QUERY " + p);
    if (d.errors && Object.keys(d.errors).length) console.log("  ERRORS " + JSON.stringify(d.errors));
    (d.response || []).forEach(m => console.log("  " + m.fixture.date + " " + m.teams.home.name + " " + m.goals.home + "-" + m.goals.away + " " + m.teams.away.name + " (" + m.league.round + ")"));
    await sleep(3000);
  }
})();
