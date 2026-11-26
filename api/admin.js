// Admin API for the site's advertising settings. GET is a public read of the
// current config; POST requires the ADMIN_TOKEN environment variable.
// Phase 0 of the pre-launch audit: settings are saved to the admin_settings
// table in Supabase instead of committing ads.json to the repository, so
// saving no longer redeploys the site. The token is compared in constant time
// and attempts are rate limited. The static /ads.json file stays as the
// fallback config that ads.js reads while the table is empty or the service
// key is not yet set on Vercel.
const supa = require("../lib/supa");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      if (!supa.configured()) return res.status(200).json({ connected: false });
      try {
        const r = await supa.sbSelect("admin_settings", { select: "config", id: "eq.1", limit: "1" });
        const cfg = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].config : null;
        return res.status(200).json({ connected: true, config: cfg });
      } catch (e) {
        return res.status(200).json({ connected: false, error: "Could not read the ad settings." });
      }
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
    if (!supa.configured()) return res.status(503).json({ error: "Server not connected yet: add SUPABASE_SERVICE_ROLE_KEY in Vercel settings." });

    const t = String(req.headers["x-admin-token"] || "");
    if (!process.env.ADMIN_TOKEN || !supa.sameToken(t, process.env.ADMIN_TOKEN)) {
      return res.status(401).json({ error: "Admin token missing or wrong." });
    }
    if (await supa.hitRate("admin", supa.clientIp(req), 10, 900)) {
      return res.status(429).json({ error: "Too many attempts. Wait 15 minutes." });
    }

    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || null);
    let cfg;
    try { cfg = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "The settings are not valid JSON." }); }
    if (!cfg || typeof cfg.enabled !== "boolean") return res.status(400).json({ error: 'Settings must include "enabled": true or false.' });

    const put = await supa.sbRpc("save_admin_settings", { p_config: cfg });
    if (!put.ok) return res.status(502).json({ error: "Could not save the settings. Try again shortly." });
    return res.status(200).json({ ok: true, note: "Saved. The change reaches visitors within minutes; no redeploy needed." });
  } catch (e) {
    res.status(502).json({ error: "Could not save the settings." });
  }
};
