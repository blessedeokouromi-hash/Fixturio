// Fan votes: "Who will win?" counts, stored in votes.json in this repo.
// GET /api/vote?fixture=123      -> { counts:{h,d,a} }
// POST { fixture, choice:"h|d|a" } -> { ok:true, counts:{h,d,a} }
// Writes use the GITHUB_TOKEN already configured for the admin API.
// Votes are kept per day and old days are pruned, so the file stays small.
const REPO = process.env.ADMIN_REPO || "blessedeokouromi-hash/Fixturio";
const FILE = "votes.json";
const BRANCH = "main";
const auth = process.env.GITHUB_TOKEN ? { "Authorization": "Bearer " + process.env.GITHUB_TOKEN } : {};

function api(path) { return "https://api.github.com/repos/" + REPO + "/contents/" + path + "?ref=" + BRANCH; }
const headers = Object.assign({ "Accept": "application/vnd.github+json", "User-Agent": "fixturio-votes" }, auth);

async function current() {
  const r = await fetch(api(FILE), { headers });
  const j = await r.json();
  return { sha: j.sha || null, data: j.content ? JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) : null };
}

function prune(d) {
  const cut = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  Object.keys(d.days || {}).forEach(k => { if (k < cut) delete d.days[k]; });
  return d;
}

module.exports = async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (req.method === "GET") {
      const id = String(req.query.fixture || "").replace(/\D/g, "");
      if (!id) return res.status(400).json({ error: "fixture required" });
      const base = "https://" + req.headers.host;
      let counts = { h: 0, d: 0, a: 0 };
      try {
        const r = await fetch(base + "/votes.json", { headers: { "Cache-Control": "no-cache" } });
        if (r.ok) {
          const d = await r.json();
          const day = (d.days || {})[today] || {};
          counts = day[id] || counts;
        }
      } catch (e) {}
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ counts });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
    if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: "Votes are not set up yet." });
    const b = typeof req.body === "object" ? req.body : {};
    const id = String(b.fixture || "").replace(/\D/g, "");
    const c = String(b.choice || "");
    if (!id || !/^[hda]$/.test(c)) return res.status(400).json({ error: "fixture and choice (h, d or a) required" });

    const cur = await current();
    const d = cur.data && typeof cur.data === "object" ? cur.data : { days: {} };
    d.days = d.days || {};
    d.days[today] = d.days[today] || {};
    const day = d.days[today];
    const rec = day[id] && typeof day[id] === "object" ? day[id] : { h: 0, d: 0, a: 0 };
    rec[c]++;
    day[id] = rec;
    prune(d);

    const r = await fetch(api(FILE), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message: "Record fan vote",
        content: Buffer.from(JSON.stringify(d)).toString("base64"),
        branch: BRANCH,
        sha: cur.sha
      })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return res.status(502).json({ error: "Could not save the vote: " + (j.message || r.status) });
    }
    return res.status(200).json({ ok: true, counts: rec });
  } catch (e) {
    return res.status(502).json({ error: "Vote service is having trouble. Try again shortly." });
  }
};
