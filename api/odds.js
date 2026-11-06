module.exports = async (req, res) => {
  try {
    const id = parseInt(req.query.fixture, 10);
    if (!id) return res.status(400).json({ error: "missing fixture" });
    const r = await fetch("https://v3.football.api-sports.io/odds?fixture=" + id,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
    const data = await r.json();
    const hasError = data.errors && Object.keys(data.errors).length > 0;
    const bms = ((data.response || [])[0] || {}).bookmakers || [];
    const want = [1, 5, 8, 12];
    const bm = bms.find(b => (b.bets || []).some(x => x.id === 1)) || bms[0];
    const bets = bm ? (bm.bets || []).filter(x => want.includes(x.id)) : [];
    const sec = hasError ? 300 : bets.length ? 43200 : 21600;
    res.setHeader("Cache-Control", "s-maxage=" + sec + ", stale-while-revalidate=600");
    res.status(200).json({ bookmaker: bm ? bm.name : null, bets });
  } catch (e) {
    res.status(500).json({ error: "fetch failed" });
  }
};
