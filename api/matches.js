module.exports = async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const r = await fetch(
      "https://v3.football.api-sports.io/fixtures?date=" + date,
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    const data = await r.json();
    const hasError = data.errors && Object.keys(data.errors).length > 0;
    const live = (data.response || []).some(m =>
      ["1H","2H","HT","ET","BT","P","LIVE"].includes(m.fixture.status.short));
    const sec = hasError ? 300 : live ? 2700 : 7200;
    res.setHeader("Cache-Control", "s-maxage=" + sec + ", stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "fetch failed" });
  }
};
