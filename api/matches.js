module.exports = async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const r = await fetch(
      "https://v3.football.api-sports.io/fixtures?date=" + date,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "fetch failed" });
  }
};
