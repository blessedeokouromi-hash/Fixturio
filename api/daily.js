const TOP = [2,3,848,39,140,135,78,61,88,94,144,203,40,253,71,128,179];

module.exports = async (req, res) => {
  try {
    const base = "https://" + req.headers.host;
    const mj = await (await fetch(base + "/api/matches")).json();
    const rank = m => { const i = TOP.indexOf(m.league.id); return i === -1 ? 99 : i; };
    const cands = (mj.response || [])
      .filter(m => m.fixture.status.short === "NS")
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 10);
    if (cands.length < 2) return res.status(200).json({ error: "Not enough upcoming matches yet. Check back later." });

    const rows = await Promise.all(cands.map(async m => {
      try {
        const id = m.fixture.id;
        const d = await (await fetch(base + "/api/predictions?fixture=" + id)).json();
        const p = d.response && d.response[0];
        if (!p) return null;
        return {
          fixture: id, league: m.league.name,
          home: m.teams.home.name, away: m.teams.away.name,
          percent: p.predictions.percent, advice: p.predictions.advice,
          under_over: p.predictions.under_over, goals: p.predictions.goals,
          form: p.comparison && p.comparison.form,
          total: p.comparison && p.comparison.total
        };
      } catch (e) { return null; }
    }));
    const matches = rows.filter(Boolean);
    if (matches.length < 2) return res.status(200).json({ error: "Prediction data is not ready yet. Try again in a few minutes." });

    const system = "You are a careful football analyst. Use ONLY the data given. Choose the strongest single picks from these matches, up to 15 in total and at most 2 different markets per match. Allowed markets: Home win, Away win, Draw, Double chance 1X, Double chance X2, Double chance 12, Over 2.5 goals, Under 2.5 goals. In under_over, '-2.5' suggests under 2.5 goals and '+2.5' suggests over. Give an honest estimated probability from 0 to 100, never above 90, that each pick wins. Add a one-sentence reason from the data. Reply with ONLY JSON, no other text: {\"picks\":[{\"fixture\":number,\"match\":\"Home vs Away\",\"market\":\"...\",\"probability\":number,\"reason\":\"...\"}],\"summary\":\"two sentences\"}";

    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: JSON.stringify(matches) }]
      })
    });
    const ad = await ar.json();
    if (ad.error) return res.status(200).json({ error: "AI service unavailable right now" });
    const text = (ad.content || []).map(c => c.text || "").join("");
    const out = JSON.parse(text.replace(/```json|```/g, "").trim());

    const byId = {};
    cands.forEach(m => { byId[m.fixture.id] = m; });
    const count = {};
    let picks = (out.picks || [])
      .filter(p => byId[p.fixture])
      .map(p => ({
        fixture: p.fixture, match: p.match, market: p.market, reason: p.reason,
        probability: Math.min(90, Math.max(1, Number(p.probability) || 50)),
        kickoff: byId[p.fixture].fixture.date,
        league: byId[p.fixture].league.name
      }))
      .sort((a, b) => b.probability - a.probability)
      .filter(p => { count[p.fixture] = (count[p.fixture] || 0) + 1; return count[p.fixture] <= 2; })
      .slice(0, 15);

    res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=3600");
    res.status(200).json({ picks, summary: out.summary });
  } catch (e) {
    res.status(500).json({ error: "Could not build picks" });
  }
};
