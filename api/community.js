// Community booking-code board ("Community slips") + community room.
// Slips are posted by signed-in users only. Fixturio cannot look inside a
// booking code, so nothing here is verified and nothing is ever shown as
// guaranteed. Phase 0 of the pre-launch audit: posts, comments and room
// messages live in Supabase tables (community_posts, community_comments,
// community_chat) instead of community.json in the public repository, so a
// post no longer commits to the repo, never redeploys the site, and two
// people posting at the same moment can no longer lose each other's data.
// GET   -> { posts:[...], chat:[...] }   (posts with 3+ reports hidden)
// POST  { token, action:"post",    code, games, odds, note?, bookmaker? }
// POST  { token, action:"like",    id }
// POST  { token, action:"comment", id, text }
// POST  { token, action:"chat",    text }
// POST  { token, action:"delete",  id }                      (own slip only)
// POST  { token, action:"delcomment", id, cid }              (own only)
// POST  { token, action:"delchat",  mid }                    (own only)
// POST  { token, action:"report"|"reportc"|"reportm", id/cid/mid }
// Admin may delete anything with the x-admin-token header.
// All write actions are rate limited per IP. While SUPABASE_SERVICE_ROLE_KEY
// is not yet set on Vercel, GET still reads the last saved community.json so
// visitors see the board; writes answer with a friendly upgrade notice.
const supa = require("../lib/supa");

const BANNED = /guarantee|100\s?%|sure\s?win|sure\s?game|fixed\s?match|fixed\s?game|banker\s?of\s?the\s?day/i;

function nameOf(me) { return String(me.email).split("@")[0].slice(0, 20); }
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function dayStart() { return todayUTC() + "T00:00:00Z"; }
function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function monthAgo() { return new Date(Date.now() - 30 * 864e5).toISOString(); }

// Best-effort housekeeping: rows older than 30 days leave the tables.
function pruneOld() {
  supa.sbDelete("community_posts", { created: "lt." + monthAgo() }).catch(function () {});
  supa.sbDelete("community_comments", { created: "lt." + monthAgo() }).catch(function () {});
  supa.sbDelete("community_chat", { created: "lt." + monthAgo() }).catch(function () {});
}

module.exports = async (req, res) => {
  const host = req.headers.host;
  try {
    if (req.method === "GET") {
      let posts = [], chat = [];
      if (supa.configured()) {
        try {
          const pr = await supa.sbSelect("community_posts", {
            select: "id,uid,name,code,games,odds,note,bk,likes,reports,created",
            created: "gte." + monthAgo(), reports: "lt.3", order: "created.desc", limit: "100"
          });
          if (pr.ok && Array.isArray(pr.data)) posts = pr.data;
          const cr = await supa.sbSelect("community_comments", {
            select: "id,post_id,uid,name,text,created,reports",
            created: "gte." + monthAgo(), reports: "lt.3", order: "created.asc", limit: "500"
          });
          const byPost = {};
          if (cr.ok && Array.isArray(cr.data)) cr.data.forEach(function (c) {
            (byPost[c.post_id] = byPost[c.post_id] || []).push(c);
          });
          posts.forEach(function (p) {
            p.c = byPost[p.id] || [];
            p.odds = Number(p.odds);
            p.likes = Array.isArray(p.likes) ? p.likes : [];
          });
          const ch = await supa.sbSelect("community_chat", {
            select: "id,uid,name,text,created,reports",
            created: "gte." + monthAgo(), reports: "lt.3", order: "created.desc", limit: "100"
          });
          if (ch.ok && Array.isArray(ch.data)) chat = ch.data;
        } catch (e) {}
      } else {
        try {
          const r = await fetch("https://" + host + "/community.json", { headers: { "Cache-Control": "no-cache" } });
          if (r.ok) { const j = await r.json(); posts = j.posts || []; chat = j.chat || []; }
        } catch (e) {}
        posts = posts.filter(function (p) { return (p.reports || 0) < 3; })
          .sort(function (a, b) { return new Date(b.created) - new Date(a.created); }).slice(0, 100);
        posts.forEach(function (p) { p.c = (p.c || []).filter(function (c) { return (c.reports || 0) < 3; }); });
        chat = chat.filter(function (m) { return (m.reports || 0) < 3; })
          .sort(function (a, b) { return new Date(b.created) - new Date(a.created); }).slice(0, 100);
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ posts: posts, chat: chat });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST" });
    const isAdmin = !!process.env.ADMIN_TOKEN && supa.sameToken(String(req.headers["x-admin-token"] || ""), process.env.ADMIN_TOKEN);
    if (!supa.configured()) return res.status(503).json({ error: "The community board is being upgraded. It will be back shortly." });

    const b = typeof req.body === "object" ? req.body : {};
    const action = String(b.action || "");
    const ip = supa.clientIp(req);

    if (action === "post") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to post a slip." });
      const code = String(b.code || "").toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{4,32}$/.test(code)) return res.status(400).json({ error: "Booking codes are 4-32 letters or digits." });
      const games = Math.floor(Number(b.games));
      if (!(games >= 1 && games <= 30)) return res.status(400).json({ error: "Games must be between 1 and 30." });
      const odds = Math.round(Number(b.odds) * 100) / 100;
      if (!(odds >= 1.01 && odds <= 10000)) return res.status(400).json({ error: "Enter the slip's total odds." });
      const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const bk = String(b.bookmaker || "").replace(/\s+/g, " ").trim().slice(0, 20);
      if (BANNED.test(note) || BANNED.test(code) || (bk && BANNED.test(bk))) return res.status(400).json({ error: "Keep it honest: slips are never guaranteed. Rephrase without the sure-win claim." });
      if (await supa.hitRate("cpost", ip, 10, 3600)) return res.status(429).json({ error: "Too many posts right now. Try again later." });
      const mine = await supa.sbSelect("community_posts", { select: "id", uid: "eq." + me.id, created: "gte." + dayStart(), limit: "4" });
      if (mine.ok && Array.isArray(mine.data) && mine.data.length >= 3) return res.status(429).json({ error: "You have posted 3 slips today. Come back tomorrow." });
      const ins = await supa.sbInsert("community_posts", [{
        id: newId(), uid: me.id, name: nameOf(me), code: code, games: games, odds: odds,
        note: note, bk: bk, likes: [], reports: 0, created: new Date().toISOString()
      }]);
      if (!ins.ok) return res.status(502).json({ error: "Could not save the slip. Try again shortly." });
      pruneOld();
      return res.status(200).json({ ok: true });
    }

    if (action === "comment") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to comment." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (!id) return res.status(400).json({ error: "id required" });
      if (!text) return res.status(400).json({ error: "Write something first." });
      if (BANNED.test(text)) return res.status(400).json({ error: "Keep it honest: nothing here is guaranteed. Rephrase without the sure-win claim." });
      if (await supa.hitRate("ccomment", ip, 20, 3600)) return res.status(429).json({ error: "Too many comments right now. Try again later." });
      const mine = await supa.sbSelect("community_comments", { select: "id", uid: "eq." + me.id, created: "gte." + dayStart(), limit: "31" });
      if (mine.ok && Array.isArray(mine.data) && mine.data.length >= 30) return res.status(429).json({ error: "That is 30 comments today. Come back tomorrow." });
      const ex = await supa.sbSelect("community_posts", { select: "id", id: "eq." + id, limit: "1" });
      if (!ex.ok || !Array.isArray(ex.data) || !ex.data[0]) return res.status(404).json({ error: "Slip not found." });
      const ins = await supa.sbInsert("community_comments", [{ id: newId(), post_id: id, uid: me.id, name: nameOf(me), text: text, created: new Date().toISOString(), reports: 0 }]);
      if (!ins.ok) return res.status(502).json({ error: "Could not save the comment. Try again shortly." });
      return res.status(200).json({ ok: true });
    }

    if (action === "chat") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to join the room." });
      const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (!text) return res.status(400).json({ error: "Write something first." });
      if (BANNED.test(text)) return res.status(400).json({ error: "Keep it honest: nothing here is guaranteed. Rephrase without the sure-win claim." });
      if (await supa.hitRate("cchat", ip, 20, 3600)) return res.status(429).json({ error: "Too many messages right now. Try again later." });
      const mine = await supa.sbSelect("community_chat", { select: "id", uid: "eq." + me.id, created: "gte." + dayStart(), limit: "31" });
      if (mine.ok && Array.isArray(mine.data) && mine.data.length >= 30) return res.status(429).json({ error: "That is 30 messages today. Come back tomorrow." });
      const ins = await supa.sbInsert("community_chat", [{ id: newId(), uid: me.id, name: nameOf(me), text: text, created: new Date().toISOString(), reports: 0 }]);
      if (!ins.ok) return res.status(502).json({ error: "Could not save the message. Try again shortly." });
      return res.status(200).json({ ok: true });
    }

    if (action === "like") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to like a slip." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      if (await supa.hitRate("clike", ip, 60, 3600)) return res.status(429).json({ error: "Too many actions right now. Try again later." });
      const g = await supa.sbSelect("community_posts", { select: "likes", id: "eq." + id, limit: "1" });
      const row = g.ok && Array.isArray(g.data) && g.data[0];
      if (!row) return res.status(404).json({ error: "Slip not found." });
      const likes = Array.isArray(row.likes) ? row.likes : [];
      const i = likes.indexOf(me.id);
      if (i >= 0) likes.splice(i, 1);
      else {
        if (likes.length >= 500) return res.status(429).json({ error: "Too many likes on this slip." });
        likes.push(me.id);
      }
      const u = await supa.sbUpdate("community_posts", { id: "eq." + id }, { likes: likes });
      if (!u.ok) return res.status(502).json({ error: "Could not save that. Try again shortly." });
      return res.status(200).json({ ok: true });
    }

    if (action === "report") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to report a slip." });
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      if (await supa.hitRate("creport", ip, 60, 3600)) return res.status(429).json({ error: "Too many reports right now. Try again later." });
      const r = await supa.sbRpc("report_bump", { p_table: "post", p_id: id });
      if (!r.ok) return res.status(502).json({ error: "Could not save the report. Try again shortly." });
      return res.status(200).json({ ok: true });
    }

    if (action === "reportm" || action === "reportc") {
      const me = await supa.who(b.token, host);
      if (!me) return res.status(401).json({ error: "Sign in to report." });
      if (await supa.hitRate("creport", ip, 60, 3600)) return res.status(429).json({ error: "Too many reports right now. Try again later." });
      if (action === "reportm") {
        const mid = String(b.mid || "").replace(/[^a-zA-Z0-9]/g, "");
        const r = await supa.sbRpc("report_bump", { p_table: "chat", p_id: mid });
        if (!r.ok) return res.status(404).json({ error: "Message not found." });
        return res.status(200).json({ ok: true });
      }
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const cid = String(b.cid || "").replace(/[^a-zA-Z0-9]/g, "");
      const r = await supa.sbRpc("report_bump", { p_table: "comment", p_id: cid });
      if (!r.ok) return res.status(404).json({ error: "Comment not found." });
      return res.status(200).json({ ok: true });
    }

    // delete needs either the poster's own session or the admin token
    if (action === "delete" || action === "delcomment" || action === "delchat") {
      const me = isAdmin ? null : await supa.who(b.token, host);
      if (!isAdmin && !me) return res.status(401).json({ error: "Sign in first." });
      if (action === "delete") {
        const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
        if (!id) return res.status(400).json({ error: "id required" });
        const g = await supa.sbSelect("community_posts", { select: "uid", id: "eq." + id, limit: "1" });
        const row = g.ok && Array.isArray(g.data) && g.data[0];
        if (!row) return res.status(404).json({ error: "Slip not found." });
        if (!isAdmin && String(row.uid) !== me.id) return res.status(403).json({ error: "You can only delete your own slips." });
        await supa.sbDelete("community_posts", { id: "eq." + id });
        await supa.sbDelete("community_comments", { post_id: "eq." + id });
        return res.status(200).json({ ok: true });
      }
      if (action === "delchat") {
        const mid = String(b.mid || "").replace(/[^a-zA-Z0-9]/g, "");
        const g = await supa.sbSelect("community_chat", { select: "uid", id: "eq." + mid, limit: "1" });
        const row = g.ok && Array.isArray(g.data) && g.data[0];
        if (!row) return res.status(404).json({ error: "Message not found." });
        if (!isAdmin && String(row.uid) !== me.id) return res.status(403).json({ error: "You can only delete your own messages." });
        await supa.sbDelete("community_chat", { id: "eq." + mid });
        return res.status(200).json({ ok: true });
      }
      const id = String(b.id || "").replace(/[^a-zA-Z0-9]/g, "");
      const cid = String(b.cid || "").replace(/[^a-zA-Z0-9]/g, "");
      const g = await supa.sbSelect("community_comments", { select: "uid", id: "eq." + cid, post_id: "eq." + id, limit: "1" });
      const row = g.ok && Array.isArray(g.data) && g.data[0];
      if (!row) return res.status(404).json({ error: "Comment not found." });
      if (!isAdmin && String(row.uid) !== me.id) return res.status(403).json({ error: "You can only delete your own comments." });
      await supa.sbDelete("community_comments", { id: "eq." + cid });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(502).json({ error: "The community service is having trouble. Try again shortly." });
  }
};
