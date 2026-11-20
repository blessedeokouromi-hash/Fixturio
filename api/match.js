// On-demand match detail: events, statistics, lineups for one match.
// Served from cache, so any number of visitors on the same match costs the API once.
const CACHE = new Map();
let calls = 0;
const CAP = 150;
const KEY = () => process.env.API_FOOTBALL_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path, { headers: { "x-apisports-key": KEY() } });
  return r.json();
}

module.exports = async (req, res) => {
  try {
    const id = String(req.query.id || "").replace(/\D/g, "");
    if (!id) return res.status(400).json({ error: "Match id is required" });
    const now = Date.now();
    const hit = CACHE.get(id);
    if (hit && now < hit.exp) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json(hit.d);
    }
    if (calls >= CAP) {
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(200).json({ error: "Live stats have reached the limit for now. Please try again in a little while." });
    }
    const fx = await api("/fixtures?id=" + id);
    calls++;
    if ((fx.errors && Object.keys(fx.errors).length) || !(fx.response || []).length) {
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(200).json({ error: "Match details are not available for this match." });
    }
    const m = fx.response[0];
    let stats = [];
    try {
      await sleep(800);
      const st = await api("/fixtures/statistics?fixture=" + id);
      calls++;
      stats = (((st.response || [])[0] || {}).statistics || []);
    } catch (e) {}
    const trimEv = ev => ({
      t: ev.time ? ev.time.elapsed : null,
      team: ev.team ? ev.team.name : "",
      p: ev.player ? ev.player.name : "",
      a: ev.assist ? ev.assist.name : "",
      ty: ev.type, d: ev.detail
    });
    const out = {
      id: +id,
      status: m.fixture.status.short,
      elapsed: m.fixture.status.elapsed,
      score: m.score && m.score.fulltime && m.score.fulltime.home !== null ? m.score.fulltime : m.goals,
      venue: m.fixture.venue || null,
      referee: m.fixture.referee || null,
      events: (m.events || []).map(trimEv),
      stats: stats.map(t => ({ team: t.team.name, s: (t.statistics || []).map(x => ({ k: x.type, v: x.value })) })),
      lineups: (m.lineups || []).map(l => ({
        team: l.team.name, formation: l.formation,
        xi: ((l.startXI || []).map(p => p.player.name) || []).slice(0, 12)
      })),
      generated: new Date().toISOString()
    };
    const live = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(out.status);
    CACHE.set(id, { d: out, exp: now + (live ? 90000 : 30 * 60000) });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: "Could not load match details" });
  }
};
