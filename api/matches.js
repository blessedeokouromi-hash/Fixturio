module.exports = async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let date = String(req.query.date || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
    let diff = Math.round((new Date(date) - new Date(today)) / 864e5);
    if (Math.abs(diff) > 1) { diff = 0; date = today; }
    const base = "https://" + req.headers.host;

    async function fromFile() {
      try {
        const r = await fetch(base + "/data/d" + diff + ".json");
        if (r.ok) {
          const d = await r.json();
          if (d && d.response && d.response.length && (!d.date || d.date === date)) return d;
        }
      } catch (e) {}
      return null;
    }

    if (diff !== 0) {
      const f = await fromFile();
      if (f) {
        res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=300");
        return res.status(200).json(f);
      }
    }

    let fresh = null;
    try {
      const r2 = await fetch("https://v3.football.api-sports.io/fixtures?date=" + date,
        { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
      const d = await r2.json();
      if (d && d.response && !(d.errors && Object.keys(d.errors).length)) fresh = d;
    } catch (e) {}

    if (fresh) {
      const response = fresh.response.map(m => ({
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

    const f = await fromFile();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    if (f) return res.status(200).json(f);
    return res.status(200).json({ response: [], errors: { data: "Match data is temporarily unavailable" } });
  } catch (e) {
    res.status(500).json({ error: "load failed" });
  }
};
