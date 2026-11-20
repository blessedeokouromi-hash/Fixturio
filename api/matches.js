module.exports = async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let date = String(req.query.date || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
    let diff = Math.round((new Date(date) - new Date(today)) / 864e5);
    if (Math.abs(diff) > 1) { diff = 0; date = today; }
    const base = "https://" + req.headers.host;

    async function fromFile(maxAgeMin) {
      try {
        const r = await fetch(base + "/data/d" + diff + ".json");
        if (!r.ok) return null;
        const d = await r.json();
        if (!d || !d.response || !d.response.length) return null;
        if (d.date && d.date !== date) return null;
        if (maxAgeMin && d.generated) {
          const age = (now - new Date(d.generated)) / 60000;
          if (age > maxAgeMin) return null;
        }
        return d;
      } catch (e) { return null; }
    }

    // Matches are served from the files the daily job keeps fresh, so any
    // number of visitors costs the football API nothing. The live API is only
    // used when the saved file is missing or out of date.
    const saved = await fromFile(diff === 0 ? 35 : 0);
    if (saved) {
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(saved);
    }

    let live = null;
    try {
      const r2 = await fetch("https://v3.football.api-sports.io/fixtures?date=" + date,
        { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
      const d = await r2.json();
      if (d && d.response && !(d.errors && Object.keys(d.errors).length)) live = d;
    } catch (e) {}

    if (live) {
      const response = live.response.map(m => ({
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
      const hr = now.getUTCHours();
      const sec = diff === 0 ? ((hr >= 11 || hr < 3) ? 1500 : 3600) : 21600;
      res.setHeader("Cache-Control", "s-maxage=" + sec + ", stale-while-revalidate=120");
      return res.status(200).json({ date, generated: now.toISOString(), response });
    }

    const older = await fromFile(0);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    if (older) return res.status(200).json(older);
    return res.status(200).json({ response: [], errors: { data: "Match data is temporarily unavailable" } });
  } catch (e) {
    res.status(500).json({ error: "load failed" });
  }
};
