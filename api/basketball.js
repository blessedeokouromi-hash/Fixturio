// Basketball picks, served from the file the daily job keeps fresh, so any
// number of visitors costs the basketball API nothing.
// No live fallback: basketball data only exists when the build ran with a key.
module.exports = async (req, res) => {
  try {
    const base = "https://" + req.headers.host;
    const r = await fetch(base + "/data/basketball.json", { headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) return res.status(200).json({ date: null, picks: [], acca: null, m: [], empty: true });
    const d = await r.json();
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    return res.status(200).json(d);
  } catch (e) {
    return res.status(200).json({ date: null, picks: [], acca: null, m: [], empty: true });
  }
};
