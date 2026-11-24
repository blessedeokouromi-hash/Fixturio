// Community booking-code board ("Community slips").
// Slips are posted by signed-in users only. Fixturio cannot look inside a
// booking code, so nothing here is verified and nothing is ever shown as
// guaranteed. Stored in community.json in this repo, written with the
// GITHUB_TOKEN already configured for the admin API.
// GET                          -> { posts:[...] }  (posts with 3+ reports hidden)
// POST { token, action:"post", code, games, odds, note? }
// POST { token, action:"delete", id }
// POST { action:"report", id }                    (no sign-in needed)
// Admin may delete any post with the x-admin-token header.
const REPO = process.env.ADMIN_REPO || "blessedeokouromi-hash/Fixturio";
const FILE = "community.json";
const BRANCH = "main";
const auth = process.env.GITHUB_TOKEN ? { "Authorization": "Bearer " + process.env.GITHUB_TOKEN } : {};
function api(path) { return "https://api.github.com/repos/" + REPO + "/contents/" + path + "?ref=" + BRANCH; }
const headers = Object.assign({ "Accept": "application/vnd.github+json", "User-Agent": "fixturio-community" }, auth);

let sbCfg = null;
async function supabaseConfig(host) {
  if (sbCfg) return sbCfg;
  try {
    const r = await fetch("https://" + host + "/auth-config.json", { headers: { "Cache-Control": "no-cache" } });
    const c = await r.json();
    sbCfg = c && c.url && c.key ? c : null;
  } catch (e) { sbCfg = null; }
  return sbCfg;
}
// Verify a Supabase access token with the project's own public key and
// return { id, email }, or null when the token is missing or invalid.
async function who(token, host) {
  if (!token || typeof token !== "string") return null;
  const cfg = await supabaseConfig(host);
  if (!cfg) return null;
  try {
    const r = await fetch(cfg.url.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { apikey: cfg.key, Authorization: "Bearer " + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id && u.email ? { id: u.id, email: u.email } : null;
  } catch (e) { return null; }
}

const BANNED = /guarantee|100\s?%|sure\s?win|sure\s?game|fixed\s?match|fixed\s?game|banker\s?of\s?the\s?day/i;
function prune(d) {
  const cut = Date.now() - 30 * 864e5;
  d.posts = (d.posts || []).filter(p => new Date(p.created).getTime() >= cut).slice(-200);
  if (d.chat) d.chat = d.chat.filter(m => new Date(m.created).getTime() >= cut).slice(-200);
  return d;
}

module.exports = async (req, res) => {
  try {
    const host = req.headers.host;
    if (req.method === "GET") {
      let posts = [], chat = [];
      try {
        const r = await fetch("https://" + host + "/" + FILE, { headers: { "Cache-Control": "no-cache" } });
        if (r.ok) { const j = await r.json(); posts = j.posts || []; chat = j.chat || []; }
      } catch (e) {}
      posts = posts.filter(p => (p.reports || 0) < 3).sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, 100);
      posts.forEach(p => { p.c = (p.c || []).filter(c => (c.reports || 0) < 3); });
      chat = chat.filter(m => (m.reports || 0) < 3).sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, 100);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ posts, chat });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
    if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: "The community board is not set up yet." });
    const b = typeof req.body === "object" ? req.body : {};
    const action = String(b.action || "");

    if (action === "report") {
      const me = await who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to report a slip." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      const p = d.posts.find(x => x.id === id);
      if (!p) return res.status(404).json({ error: "Slip not found." });
      p.reports = (p.reports || 0) + 1;
      return await save(res, cur, d, "Report a community slip");
    }

    if (action === "like") {
      const me = await who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to like a slip." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      const p = d.posts.find(x => x.id === id);
      if (!p) return res.status(404).json({ error: "Slip not found." });
      p.likes = p.likes || [];
      const i = p.likes.indexOf(me.id);
      if (i >= 0) p.likes.splice(i, 1);
      else { if (p.likes.length >= 500) return res.status(429).json({ error: "Too many likes on this slip." }); p.likes.push(me.id); }
      return await save(res, cur, d, "Like a community slip");
    }

    if (action === "comment") {
      const me = await who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to comment." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (!id) return res.status(400).json({ error: "id required" });
      if (!text) return res.status(400).json({ error: "Write something first." });
      if (BANNED.test(text)) return res.status(400).json({ error: "Keep it honest: nothing here is guaranteed. Rephrase without the sure-win claim." });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      const p = d.posts.find(x => x.id === id);
      if (!p) return res.status(404).json({ error: "Slip not found." });
      p.c = p.c || [];
      const today = new Date().toISOString().slice(0, 10);
      const mine = d.posts.reduce((n, q) => n + (q.c || []).filter(c => c.uid === me.id && String(c.created).slice(0, 10) === today).length, 0);
      if (mine >= 30) return res.status(429).json({ error: "That is 30 comments today. Come back tomorrow." });
      if (p.c.length >= 50) p.c = p.c.slice(-49);
      p.c.push({ id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), uid: me.id, name: String(me.email).split("@")[0].slice(0, 20), text, created: new Date().toISOString(), reports: 0 });
      return await save(res, cur, d, "Comment on a community slip");
    }

    if (action === "chat") {
      const me = await who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to join the room." });
      const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (!text) return res.status(400).json({ error: "Write something first." });
      if (BANNED.test(text)) return res.status(400).json({ error: "Keep it honest: nothing here is guaranteed. Rephrase without the sure-win claim." });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      d.chat = d.chat || [];
      const today = new Date().toISOString().slice(0, 10);
      const mine = d.chat.filter(m => m.uid === me.id && String(m.created).slice(0, 10) === today).length;
      if (mine >= 30) return res.status(429).json({ error: "That is 30 messages today. Come back tomorrow." });
      if (d.chat.length >= 200) d.chat = d.chat.slice(-199);
      d.chat.push({ id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), uid: me.id, name: String(me.email).split("@")[0].slice(0, 20), text, created: new Date().toISOString(), reports: 0 });
      return await save(res, cur, d, "Community room message");
    }

    // delete needs either the poster's own session or the admin token
    if (action === "delete") {
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      const me = isAdmin ? null : await who(b.token, host);
      if (!isAdmin && !me) return res.status(401).json({ error: "Sign in to delete your own slips." });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      const p = d.posts.find(x => x.id === id);
      if (!p) return res.status(404).json({ error: "Slip not found." });
      if (!isAdmin && p.uid !== me.id) return res.status(403).json({ error: "You can only delete your own slips." });
      d.posts = d.posts.filter(x => x.id !== id);
      return await save(res, cur, d, "Delete a community slip");
    }

    const isAdmin = req.headers["x-admin-token"] && process.env.ADMIN_TOKEN && req.headers["x-admin-token"] === process.env.ADMIN_TOKEN;
    if (action === "delchat" || action === "delcomment") {
      const me = await who(b.token, host);
      if (!isAdmin && !me) return res.status(401).json({ error: "Sign in first." });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      if (action === "delchat") {
        const mid = String(b.mid || "").replace(/[^a-zA-Z0-9]/g, "");
        const m = (d.chat || []).find(x => x.id === mid);
        if (!m) return res.status(404).json({ error: "Message not found." });
        if (!isAdmin && m.uid !== me.id) return res.status(403).json({ error: "You can only delete your own messages." });
        d.chat = d.chat.filter(x => x.id !== mid);
        return await save(res, cur, d, "Delete a room message");
      }
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const cid = String(b.cid || "").replace(/[^a-zA-Z0-9]/g, "");
      const p = d.posts.find(x => x.id === id);
      const c = p && (p.c || []).find(x => x.id === cid);
      if (!c) return res.status(404).json({ error: "Comment not found." });
      if (!isAdmin && c.uid !== me.id) return res.status(403).json({ error: "You can only delete your own comments." });
      p.c = p.c.filter(x => x.id !== cid);
      return await save(res, cur, d, "Delete a community comment");
    }

    if (action === "reportm" || action === "reportc") {
      const me = await who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to report." });
      const cur = await current();
      const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
      if (action === "reportm") {
        const mid = String(b.mid || "").replace(/[^a-zA-Z0-9]/g, "");
        const m = (d.chat || []).find(x => x.id === mid);
        if (!m) return res.status(404).json({ error: "Message not found." });
        m.reports = (m.reports || 0) + 1;
        return await save(res, cur, d, "Report a room message");
      }
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const cid = String(b.cid || "").replace(/[^a-zA-Z0-9]/g, "");
      const p = d.posts.find(x => x.id === id);
      const c = p && (p.c || []).find(x => x.id === cid);
      if (!c) return res.status(404).json({ error: "Comment not found." });
      c.reports = (c.reports || 0) + 1;
      return await save(res, cur, d, "Report a community comment");
    }

    if (action !== "post") return res.status(400).json({ error: "Unknown action." });
    const me = await who(b.token, host);
    if (!me) return res.status(401).json({ error: "Sign in to post a slip." });
    const code = String(b.code || "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{4,32}$/.test(code)) return res.status(400).json({ error: "Booking codes are 4-32 letters or digits." });
    const games = Math.floor(Number(b.games));
    if (!(games >= 1 && games <= 30)) return res.status(400).json({ error: "Games must be between 1 and 30." });
    const odds = Math.round(Number(b.odds) * 100) / 100;
    if (!(odds >= 1.01 && odds <= 10000)) return res.status(400).json({ error: "Enter the slip's total odds." });
    let note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 140);
    let bk = String(b.bookmaker || "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (BANNED.test(note) || BANNED.test(code) || (bk && BANNED.test(bk))) return res.status(400).json({ error: "Keep it honest: slips are never guaranteed. Rephrase without the sure-win claim." });

    const cur = await current();
    const d = prune(cur.data && typeof cur.data === "object" ? cur.data : { posts: [] });
    d.posts = d.posts || [];
    const today = new Date().toISOString().slice(0, 10);
    const mine = d.posts.filter(p => p.uid === me.id && String(p.created).slice(0, 10) === today).length;
    if (mine >= 3) return res.status(429).json({ error: "You have posted 3 slips today. Come back tomorrow." });
    d.posts.push({
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      uid: me.id, name: String(me.email).split("@")[0].slice(0, 20),
      code, games, odds, note, bk,
      created: new Date().toISOString(), reports: 0
    });
    return await save(res, cur, d, "Post a community slip");
  } catch (e) {
    return res.status(502).json({ error: "The community service is having trouble. Try again shortly." });
  }
};

async function current() {
  const r = await fetch(api(FILE), { headers });
  const j = await r.json();
  return { sha: j.sha || null, data: j.content ? JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) : null };
}
async function save(res, cur, d, message) {
  const r = await fetch(api(FILE), {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify({
      message: message,
      content: Buffer.from(JSON.stringify(d)).toString("base64"),
      branch: BRANCH,
      sha: cur.sha
    })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return res.status(502).json({ error: "Could not save: " + (j.message || r.status) });
  }
  return res.status(200).json({ ok: true });
}
