// Fan votes: "Who will win?" counts, stored in the Supabase votes table.
// GET  /api/vote?fixture=123        -> { counts:{h,d,a} }
// POST { fixture, choice:"h|d|a", token } -> { ok:true, counts:{h,d,a} }
// Phase 0 of the pre-launch audit: votes moved out of votes.json (a file that
// was committed to the public repository on every vote, redeploying the site),
// a sign-in is now required to vote, and writes are rate limited per IP.
// The increments are atomic inside Postgres, so simultaneous votes cannot
// overwrite each other the way the old read-modify-write file could.
// While SUPABASE_SERVICE_ROLE_KEY is not yet set on Vercel, GET still reads
// the last saved votes.json so visitors see counts; writes stay off.
const supa = require("../lib/supa");

module.exports = async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (req.method === "GET") {
      const id = String(req.query.fixture || "").replace(/\D/g, "");
      if (!id) return res.status(400).json({ error: "fixture required" });
      let counts = { h: 0, d: 0, a: 0 };
      if (supa.configured()) {
        try {
          const r = await supa.sbSelect("votes", { select: "h,d,a", day: "eq." + today, fixture: "eq." + id, limit: "1" });
          const row = r.ok && Array.isArray(r.data) && r.data[0];
          if (row) counts = { h: row.h || 0, d: row.d || 0, a: row.a || 0 };
        } catch (e) {}
      } else {
        try {
          const r = await fetch("https://" + req.headers.host + "/votes.json", { headers: { "Cache-Control": "no-cache" } });
          if (r.ok) {
            const d = await r.json();
            const c = ((d.days || {})[today] || {})[id];
            if (c) counts = { h: c.h || 0, d: c.d || 0, a: c.a || 0 };
          }
        } catch (e) {}
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ counts: counts });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
    if (!supa.configured()) return res.status(503).json({ error: "Voting is being upgraded. It will be back shortly." });

    const b = typeof req.body === "object" ? req.body : {};
    const id = String(b.fixture || "").replace(/\D/g, "");
    const c = String(b.choice || "");
    if (!id || !/^[hda]$/.test(c)) return res.status(400).json({ error: "fixture and choice (h, d or a) required" });
    if (typeof b.token !== "string" || !b.token) return res.status(401).json({ error: "Sign in to vote." });

    const ip = supa.clientIp(req);
    if (await supa.hitRate("vote", ip, 20, 3600)) return res.status(429).json({ error: "Too many votes right now. Try again later." });

    const me = await supa.who(b.token, req.headers.host);
    if (!me) return res.status(401).json({ error: "Sign in to vote." });

    const inc = await supa.sbRpc("vote_increment", { p_day: today, p_fixture: id, p_choice: c });
    if (!inc.ok) return res.status(502).json({ error: "Could not save the vote. Try again shortly." });

    // Keep the table small: drop days older than three weeks, as before.
    supa.sbDelete("votes", { day: "lt." + new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10) }).catch(function () {});

    const r = await supa.sbSelect("votes", { select: "h,d,a", day: "eq." + today, fixture: "eq." + id, limit: "1" });
    const row = r.ok && Array.isArray(r.data) && r.data[0];
    const counts = row ? { h: row.h || 0, d: row.d || 0, a: row.a || 0 } : { h: 0, d: 0, a: 0 };
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, counts: counts });
  } catch (e) {
    return res.status(500).json({ error: "Vote failed. Try again shortly." });
  }
};
