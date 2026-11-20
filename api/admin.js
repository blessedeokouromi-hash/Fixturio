// Admin API for ad settings. GET is a public read of the current config.
// POST requires two environment variables set in Vercel:
//   ADMIN_TOKEN  the password the admin page asks for
//   GITHUB_TOKEN a GitHub token with write access to this repository
// Saving writes ads.json to the repo, which redeploys the site automatically.
const REPO = process.env.ADMIN_REPO || "blessedeokouromi-hash/Fixturio";
const FILE = "ads.json";
const BRANCH = "main";

module.exports = async (req, res) => {
  const api = "https://api.github.com/repos/" + REPO + "/contents/" + FILE + "?ref=" + BRANCH;
  const auth = process.env.GITHUB_TOKEN ? { "Authorization": "Bearer " + process.env.GITHUB_TOKEN } : {};
  const headers = Object.assign({ "Accept": "application/vnd.github+json", "User-Agent": "fixturio-admin" }, auth);

  async function current() {
    const r = await fetch(api, { headers });
    const j = await r.json();
    return {
      sha: j.sha || null,
      content: j.content ? Buffer.from(j.content, "base64").toString("utf8") : null
    };
  }

  if (req.method === "GET") {
    if (!process.env.GITHUB_TOKEN) return res.status(200).json({ connected: false });
    try {
      const c = await current();
      let cfg = null;
      try { cfg = JSON.parse(c.content || "null"); } catch (e) { cfg = null; }
      return res.status(200).json({ connected: true, sha: c.sha, config: cfg });
    } catch (e) {
      return res.status(200).json({ connected: false, error: "Could not read the ad settings." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
  const t = req.headers["x-admin-token"] || "";
  if (!process.env.ADMIN_TOKEN || t !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "Admin token missing or wrong." });
  if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: "Server not connected yet: add GITHUB_TOKEN in Vercel settings." });

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || null);
  let cfg;
  try { cfg = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "The settings are not valid JSON." }); }
  if (!cfg || typeof cfg.enabled !== "boolean") return res.status(400).json({ error: 'Settings must include "enabled": true or false.' });

  try {
    const c = await current();
    const r = await fetch(api, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message: "Update ad settings",
        content: Buffer.from(JSON.stringify(cfg, null, 2)).toString("base64"),
        branch: BRANCH,
        sha: c.sha
      })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return res.status(502).json({ error: "GitHub refused the save: " + (j.message || r.status) });
    }
    res.status(200).json({ ok: true, note: "Saved. The site redeploys in about a minute." });
  } catch (e) {
    res.status(502).json({ error: "Could not save the settings." });
  }
};
