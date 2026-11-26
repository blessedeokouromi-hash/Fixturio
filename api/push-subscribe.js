// Web-push subscriptions for the daily picks notification.
// POST { endpoint, keys:{p256dh, auth} } -> { ok:true }
// Phase 0 of the pre-launch audit: subscriptions are stored in the Supabase
// push_subs table. The old data/push-subs.json file (subscriber endpoints and
// user agents, public in the GitHub repository) was removed, and this endpoint
// no longer writes to GitHub at all, so subscribing never redeploys the site
// and subscriber data is no longer public. Writes are rate limited per IP.
const supa = require("../lib/supa");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!supa.configured()) return res.status(503).json({ error: "Push is not set up yet." });

  const b = typeof req.body === "object" ? req.body : {};
  const ep = String(b.endpoint || "");
  const keys = b.keys || {};
  if (!/^https:\/\/[a-z0-9.-]+\/\S+/i.test(ep) || ep.length > 500) return res.status(400).json({ error: "endpoint invalid" });
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || keys.p256dh.length > 200 || keys.auth.length > 60) return res.status(400).json({ error: "keys invalid" });

  if (await supa.hitRate("push", supa.clientIp(req), 10, 3600)) return res.status(429).json({ error: "Too many subscriptions right now. Try again later." });

  try {
    const rec = {
      endpoint: ep,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      ua: String(req.headers["user-agent"] || "").slice(0, 140),
      added: new Date().toISOString()
    };
    const put = await supa.sbInsert("push_subs", [rec], true); // upsert on endpoint
    if (!put.ok) return res.status(500).json({ error: "Could not save subscription" });
    // Housekeeping: drop subscriptions older than 180 days.
    supa.sbDelete("push_subs", { added: "lt." + new Date(Date.now() - 180 * 864e5).toISOString() }).catch(function () {});
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Could not save subscription" });
  }
};
