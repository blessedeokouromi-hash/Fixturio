const { loadAll, markets, byProb, reason } = require("../lib/engine");
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

    const ms = await loadAll(base, cands.map(m => ({
      id: m.fixture.id, league: m.league.name, kickoff: m.fixture.date
    })));
    if (ms.length < 2) return res.status(200).json({ error: "Data is not ready yet. Try again in a minute." });

    const all = [];
    ms.forEach(m => {
      const mk = markets(m);
      const sorted = byProb(mk.list);
      const best = sorted[0];
      const single = sorted.find(x => x.kind === "single");
      const chosen = [best];
      if (single && single !== best && single.prob >= 0.5) chosen.push(single);
      chosen.forEach(c => all.push({
        fixture: m.id,
        match: m.home + " vs " + m.away,
        market: c.market,
        probability: Math.round(Math.min(90, c.prob * 100)),
        reason: reason(m, mk.src),
        kickoff: m.kickoff,
        league: m.league
      }));
    });
    all.sort((a, b) => b.probability - a.probability);
    const picks = all.slice(0, 15);

    const full = ms.length === cands.length;
    res.setHeader("Cache-Control", full ? "s-maxage=10800, stale-while-revalidate=3600" : "s-maxage=120");
    res.status(200).json({
      picks,
      summary: "Ranked by estimated chance of winning, from bookmaker odds and form data. Safer markets like double chance rank higher, so always check the market before you decide."
    });
  } catch (e) {
    res.status(500).json({ error: "Could not build picks" });
  }
};
