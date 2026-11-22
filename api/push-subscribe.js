// Web-push subscriptions for the daily picks notification, stored in data/push-subs.json.
// POST { endpoint, keys:{p256dh, auth} } -> { ok:true }
// GET -> 405 (the subscriber list never leaves the repo). Writes use the GITHUB_TOKEN
// already configured for the admin API; subscriptions are deduped by endpoint and capped.
const REPO = process.env.ADMIN_REPO || "blessedeokouromi-hash/Fixturio";
const FILE = "data/push-subs.json";
const BRANCH = "main";
const auth = process.env.GITHUB_TOKEN ? { "Authorization": "Bearer " + process.env.GITHUB_TOKEN } : {};

function api(path) { return "https://api.github.com/repos/" + REPO + "/contents/" + path + "?ref=" + BRANCH; }
const headers = Object.assign({ "Accept": "application/vnd.github+json", "User-Agent": "fixturio-push" }, auth);

async function current() {
  const r = await fetch(api(FILE), { headers });
  if (r.status === 404) return { sha: null, data: { subs: [] } };
  const j = await r.json();
  return { sha: j.sha || null, data: j.content ? JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) : { subs: [] } };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: "Push is not set up yet." });
  const b = typeof req.body === "object" ? req.body : {};
  const ep = String(b.endpoint || "");
  const keys = b.keys || {};
  if (!/^https:\/\/[a-z0-9.-]+\/\S+/i.test(ep) || ep.length > 500) return res.status(400).json({ error: "endpoint invalid" });
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || keys.p256dh.length > 200 || keys.auth.length > 60) return res.status(400).json({ error: "keys invalid" });
  try {
    const cur = await current();
    const subs = (cur.data && Array.isArray(cur.data.subs)) ? cur.data.subs : [];
    const i = subs.findIndex(s => s.endpoint === ep);
    const rec = { endpoint: ep, keys: { p256dh: keys.p256dh, auth: keys.auth }, ua: String(req.headers["user-agent"] || "").slice(0, 140), added: i >= 0 ? subs[i].added : new Date().toISOString() };
    if (i >= 0) subs[i] = rec; else subs.push(rec);
    const body = JSON.stringify({ subs: subs.slice(-5000), updated: new Date().toISOString() });
    const put = await fetch(api(FILE), { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify({ message: "push subscription", content: Buffer.from(body).toString("base64"), sha: cur.sha, branch: BRANCH }) });
    if (!put.ok) return res.status(500).json({ error: "Could not save subscription" });
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "Could not save subscription" }); }
};
