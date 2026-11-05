module.exports = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",")
      .map(x => parseInt(x, 10)).filter(Boolean))]
      .sort((a, b) => a - b).slice(0, 10);
    const risk = ["safe", "balanced", "risky"].includes(req.query.risk) ? req.query.risk : "balanced";
    if (ids.length < 2) return res.status(400).json({ error: "Pick at least 2 matches" });

    const base = "https://" + req.headers.host;
    const rows = await Promise.all(ids.map(async id => {
      try {
        const d = await (await fetch(base + "/api/predictions?fixture=" + id)).json();
        const p = d.response && d.response[0];
        if (!p) return null;
        return {
          fixture: id,
          league: p.league && p.league.name,
          home: p.teams.home.name,
          away: p.teams.away.name,
          percent: p.predictions.percent,
          advice: p.predictions.advice,
          under_over: p.predictions.under_over,
          goals: p.predictions.goals,
          form: p.comparison && p.comparison.form,
          total: p.comparison && p.comparison.total
        };
      } catch (e) { return null; }
    }));
    const matches = rows.filter(Boolean);
    if (matches.length < 2) return res.status(200).json({ error: "Not enough data for these matches" });

    const system = "You are a careful football analyst building an accumulator ticket. Use ONLY the data given. For each match choose ONE market from: Home win, Away win, Draw, Double chance 1X, Double chance X2, Double chance 12, Over 2.5 goals, Under 2.5 goals. In under_over, '-2.5' suggests under 2.5 goals and '+2.5' suggests over. Risk level: " + risk + " (safe = prefer double chance and high-probability picks; balanced = a mix; risky = allow riskier win picks). Give an honest estimated probability from 0 to 100, never above 90, that each pick wins. Add a one-sentence reason based on the data. Reply with ONLY JSON, no other text: {\"picks\":[{\"fixture\":number,\"match\":\"Home vs Away\",\"market\":\"...\",\"probability\":number,\"reason\":\"...\"}],\"summary\":\"two sentences\"}";

    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: JSON.stringify(matches) }]
      })
    });
    const ad = await ar.json();
    if (ad.error) return res.status(200).json({ error: "AI service unavailable right now" });
    const text = (ad.content || []).map(c => c.text || "").join("");
    const out = JSON.parse(text.replace(/```json|```/g, "").trim());

    let combined = 1;
    out.picks.forEach(p => {
      combined *= Math.min(90, Math.max(1, Number(p.probability) || 50)) / 100;
    });
    out.combined = Math.round(combined * 1000) / 10;
    out.legs = out.picks.length;

    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: "Could not build ticket" });
  }
};
