module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=1800");
  try {
    const id = parseInt(req.query.fixture, 10);
    const base = "https://" + req.headers.host;
    const r = await fetch(base + "/all.json");
    if (!r.ok) return res.status(200).json({ response: [] });
    const all = await r.json();
    const p = id && all && all.m ? all.m[id] : null;
    if (!p) return res.status(200).json({ response: [] });
    const lean = p.o >= 50 ? "over" : "under";
    return res.status(200).json({
      response: [{
        predictions: {
          percent: { home: String(p.h), draw: String(p.d), away: String(p.a) },
          under_over: (p.o >= 50 ? "+" : "-") + "2.5",
          advice: "The model leans " + lean + " 2.5 goals (" + Math.max(p.o, 100 - p.o) + "%)"
        }
      }]
    });
  } catch (e) {
    return res.status(200).json({ response: [] });
  }
};
