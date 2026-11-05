const { loadAll, markets, choose, reason } = require("../lib/engine");

module.exports = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",")
      .map(x => parseInt(x, 10)).filter(Boolean))]
      .sort((a, b) => a - b).slice(0, 10);
    const risk = ["safe", "balanced", "risky"].includes(req.query.risk) ? req.query.risk : "balanced";
    if (ids.length < 2) return res.status(400).json({ error: "Pick at least 2 matches" });

    const base = "https://" + req.headers.host;
    const ms = await loadAll(base, ids.map(id => ({ id })));
    if (ms.length < 2) return res.status(200).json({ error: "Not enough data for these matches. Try again in a minute." });

    const picks = ms.map(m => {
      const mk = markets(m);
      const c = choose(mk.list, risk);
      return {
        fixture: m.id,
        match: m.home + " vs " + m.away,
        market: c.market,
        probability: Math.round(Math.min(90, c.prob * 100)),
        reason: reason(m, mk.src)
      };
    });

    let combined = 1;
    picks.forEach(p => { combined *= p.probability / 100; });

    const full = ms.length === ids.length;
    res.setHeader("Cache-Control", "s-maxage=" + (full ? 1800 : 120));
    res.status(200).json({
      picks,
      combined: Math.round(combined * 1000) / 10,
      legs: picks.length,
      summary: "Each pick is the best market for your " + risk + " setting. The combined chance multiplies every leg together, so it drops quickly as you add legs."
    });
  } catch (e) {
    res.status(500).json({ error: "Could not build ticket" });
  }
};
