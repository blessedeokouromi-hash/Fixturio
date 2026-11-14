module.exports = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let date = String(req.query.date || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
    const diff = Math.round((new Date(date) - new Date(today)) / 864e5);
    if (Math.abs(diff) > 1) date = today;
    const d0 = date === today ? 0 : diff;
    const r = await fetch(
      "https://v3.football.api-sports.io/fixtures?date=" + date,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    const data = await r.json();
    const hasError = data.errors && Object.keys(data.errors).length > 0;
    const live = (data.response || []).some(m =>
      ["1H","2H","HT","ET","BT","P","LIVE"].includes(m.fixture.status.short));
    let sec = hasError ? 300 : 7200;
    if (!hasError && d0 === 0 && live) sec = 2700;
    if (!hasError && d0 === -1) sec = 21600;
    if (!hasError && d0 === 1) sec = 10800;
    res.setHeader("Cache-Control", "s-maxage=" + sec + ", stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "fetch failed" });
  }
};
