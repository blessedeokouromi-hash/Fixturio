module.exports = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let date = String(req.query.date || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
    let diff = Math.round((new Date(date) - new Date(today)) / 864e5);
    if (Math.abs(diff) > 1) diff = 0;
    const r = await fetch("https://" + req.headers.host + "/data/d" + diff + ".json");
    if (!r.ok) return res.status(200).json({ response: [], errors: { data: "Match data is being prepared" } });
    const d = await r.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json(d);
  } catch (e) {
    res.status(500).json({ error: "load failed" });
  }
};
