module.exports = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",")
      .map(x => parseInt(x, 10)).filter(Boolean))]
      .sort((a, b) => a - b).slice(0, 10);
    const risk = ["safe", "balanced", "risky"].includes(req.query.risk) ? req.query.risk : "balanced";
    if (ids.length < 2) return res.status(400).json({ error: "Pick at least 2 matches" });

    const r = await fetch("https://" + req.headers.host + "/daily.json");
    if (!r.ok) return res.status(200).json({ error: "Today's picks are still being prepared. Check back soon." });
    const d = await r.json();
    const pool = {};
    (d.matches || []).forEach(m => { pool[m.id] = m; });
    const ms = ids.map(id => pool[id]).filter(Boolean);
    if (ms.length < 2) return res.status(200).json({ error: "Tickets use the matches analyzed for today's Top 15. Pick at least 2 of those." });

    const by = arr => arr.slice().sort((x, y) => y.prob - x.prob);
    const picks = ms.map(m => {
      const all = by(m.markets);
      const singles = by(m.markets.filter(x => x.kind === "single"));
      let c = all[0];
      if (risk === "risky") c = singles[0] || all[0];
      else if (risk === "balanced" && singles[0] && singles[0].prob >= 0.55) c = singles[0];
      const f = m.form && m.form.home && m.form.away
        ? " Recent form: " + m.home + " " + m.form.home + " vs " + m.away + " " + m.form.away + "." : "";
      return {
        fixture: m.id,
        match: m.home + " vs " + m.away,
        market: c.market,
        probability: Math.round(Math.min(90, c.prob * 100)),
        reason: "Based on " + m.src + "." + f
      };
    });

    let combined = 1;
    picks.forEach(p => { combined *= p.probability / 100; });
    const left = ids.length - ms.length;
    res.setHeader("Cache-Control", "s-maxage=600");
    res.status(200).json({
      picks,
      combined: Math.round(combined * 1000) / 10,
      legs: picks.length,
      summary: "Each pick is the best market for your " + risk + " setting. The combined chance multiplies every leg together, so it drops quickly as you add legs." +
        (left > 0 ? " " + left + " selected match(es) were not analyzed today and were left out." : "")
    });
  } catch (e) {
    res.status(500).json({ error: "Could not build ticket" });
  }
};
