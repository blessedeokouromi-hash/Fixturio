module.exports = async (req, res) => {
  try {
    const id = parseInt(req.query.fixture, 10);
    if (!id) return res.status(400).json({ error: "missing fixture" });
    const r = await fetch(
      "https://v3.football.api-sports.io/predictions?fixture=" + id,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    const data = await r.json();
    const hasError = data.errors && Object.keys(data.errors).length > 0;
    const has = data.response && data.response.length;
    const sec = hasError ? 300 : has ? 86400 : 3600;
    res.setHeader("Cache-Control", "s-maxage=" + sec + ", stale-while-revalidate=600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "fetch failed" });
  }
};
