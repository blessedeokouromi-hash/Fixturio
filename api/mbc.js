// Bet-code tools proxy (Manage Bet Codes API), Nov 28 2026.
// Powers /betcode.html: convert, convert-to-all, bulk convert, view slip
// (JSON and PNG), merge, split, book (search -> resolve -> book) and
// live tracking.
//
// Upstream: https://api.managebetcodes.app/v1, X-API-Key header.
// The MBC_API_KEY lives only in Vercel environment variables: it is never
// sent to the browser and never appears in this repository.
// Visitor policy: GET /bookmakers is public upstream (no key) and is cached
// 24 h. events/search and resolve cost 0 upstream credits. Every other
// action costs credits, so each visitor gets 3 metered actions a day
// (rate_limits table). MBC pricing Nov 2026: convert 2 cr/target, view 1,
// view image 2, merge 2 + 1 per extra same-bookie code / 2 per foreign,
// split 2 + 1 per extra part, book 2, track start 1. Credits reset daily.
const supa = require("../lib/supa");
const crypto = require("crypto");

const BASE = "https://api.managebetcodes.app/v1";
const DAILY_LIMIT = 3; // metered actions per visitor per day
const CACHE_MS = 24 * 3600 * 1000;

let bookieCache = null; // { at, data }

function key() {
  // Strip accidental surrounding quotes/whitespace from the saved value.
  return (process.env.MBC_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

function remainingToday(ip) {
  return supa.sbSelect("rate_limits", { key: "eq.mbc:" + ip, select: "hits,window_start", limit: 1 }).then(function (r) {
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (!row) return DAILY_LIMIT;
    const start = new Date(row.window_start).getTime();
    if (isNaN(start) || Date.now() - start >= 86400 * 1000) return DAILY_LIMIT;
    const left = DAILY_LIMIT - (row.hits || 0);
    return left > 0 ? left : 0;
  }).catch(function () { return DAILY_LIMIT; });
}

function headers() {
  return { "X-API-Key": key(), "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() };
}

function cleanCode(c) { return String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }

// Tolerant parse: upstream may wrap lists in data / tracks / results.
function listOf(d, ...names) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const n of names) if (Array.isArray(d[n])) return d[n];
    if (Array.isArray(d.data)) return d.data;
  }
  return [];
}

module.exports = async (req, res) => {
  const ip = supa.clientIp(req);

  if (req.method === "GET") {
    const want = String(req.query.action || "bookies");

    if (want === "quota") {
      res.status(200).json({ left: await remainingToday(ip), limit: DAILY_LIMIT, configured: !!key() });
      return;
    }

    if (want !== "bookies") { res.status(400).json({ error: "Unknown action." }); return; }

    // Public upstream, no key, cached 24 h so the page never costs credits.
    try {
      if (bookieCache && Date.now() - bookieCache.at < CACHE_MS) {
        res.status(200).json({ bookies: bookieCache.data, left: await remainingToday(ip), limit: DAILY_LIMIT, configured: !!key() });
        return;
      }
      const r = await fetch(BASE + "/bookmakers");
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {}
      const raw = listOf(data, "bookmakers");
      const list = raw.map(function (b) {
        return {
          key: String(b.key || b.id || "").trim(),
          name: String(b.name || b.key || "").trim(),
          book: b.book === true || b.book === undefined ? true : !!b.book,
          search: !!b.search,
          track: !!b.track
        };
      }).filter(function (b) { return b.key; });
      if (!list.length) throw new Error("bookies unavailable");
      bookieCache = { at: Date.now(), data: list };
      res.status(200).json({ bookies: list, left: await remainingToday(ip), limit: DAILY_LIMIT, configured: !!key() });
    } catch (e) {
      res.status(502).json({ error: "Could not load the bookmaker list. Try again in a moment." });
    }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }

  let body = {};
  try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); } catch (e) {}
  const a = String(body.action || "").trim();
  if (!a) { res.status(400).json({ error: "Missing action." }); return; }

  const bk = cleanCode(body.bookmaker).length ? String(body.bookmaker || "").trim().toLowerCase() : String(body.bookmaker || "").trim().toLowerCase();

  // ---- Free / read actions (need the key, cost no credits, not metered) ----
  try {
    if (a === "search") {
      if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }
      const r = await fetch(BASE + "/events/search", { method: "POST", headers: headers(), body: JSON.stringify({
        bookmaker: String(body.bookmaker || "sportybet").toLowerCase(),
        sport: String(body.sport || "football").toLowerCase(),
        queries: Array.isArray(body.queries) ? body.queries : [],
        include_markets: body.include_markets !== false,
        market_filter: Array.isArray(body.market_filter) ? body.market_filter : undefined,
        include_unbookable: false,
        detail: "agent"
      }) });
      return forward(res, r);
    }

    if (a === "resolve") {
      if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }
      const r = await fetch(BASE + "/resolve", { method: "POST", headers: headers(), body: JSON.stringify({
        bookmaker: String(body.bookmaker || "sportybet").toLowerCase(),
        picks: Array.isArray(body.picks) ? body.picks : [],
        strict: body.strict !== false,
        accept_odds_change: !!body.accept_odds_change,
        detail: "agent"
      }) });
      return forward(res, r);
    }

    if (a === "track_get") {
      if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }
      const id = String(body.id || "").trim();
      if (!/^[A-Za-z0-9_-]+$/.test(id)) { res.status(400).json({ error: "Invalid track id." }); return; }
      const r = await fetch(BASE + "/track/" + encodeURIComponent(id), { headers: headers() });
      return forward(res, r);
    }

    if (a === "track_list") {
      if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }
      const st = String(body.status || "active");
      const r = await fetch(BASE + "/tracks?status=" + encodeURIComponent(st), { headers: headers() });
      return forward(res, r, "tracks");
    }

    if (a === "track_stop") {
      if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }
      const id = String(body.id || "").trim();
      if (!/^[A-Za-z0-9_-]+$/.test(id)) { res.status(400).json({ error: "Invalid track id." }); return; }
      const r = await fetch(BASE + "/track/" + encodeURIComponent(id), { method: "DELETE", headers: headers() });
      return forward(res, r);
    }
  } catch (e) {
    res.status(502).json({ error: "The bet-code service is unreachable. Try again in a moment." });
    return;
  }

  // ---- Metered actions (cost upstream credits; 3 per visitor per day) ----
  if (!["convert", "convert_all", "bulk", "view", "view_image", "merge", "split", "track_start", "book"].includes(a)) {
    res.status(400).json({ error: "Unknown action." });
    return;
  }
  if (!key()) { res.status(503).json({ error: "not_configured", message: "The bet-code service is not connected yet." }); return; }

  // Basic per-action validation before anything is spent.
  const code = cleanCode(body.code);
  if ((a === "convert" || a === "convert_all" || a === "view" || a === "view_image" || a === "split" || a === "track_start") && !/^[A-Z0-9]{4,32}$/.test(code)) {
    res.status(400).json({ error: "Enter a booking code (letters and numbers, 4-32 characters)." });
    return;
  }
  if ((a === "view" || a === "view_image" || a === "split" || a === "track_start" || a === "book") && !bk) {
    res.status(400).json({ error: "Choose a bookmaker." });
    return;
  }
  if (a === "merge") {
    const pairs = Array.isArray(body.pairs) ? body.pairs.filter(function (p) { return p && String(p.code || "").trim() && String(p.bookmaker || "").trim(); }) : [];
    if (pairs.length < 2 || pairs.length > 30) { res.status(400).json({ error: "Merge needs 2 to 30 codes." }); return; }
  }
  if (a === "split") {
    const count = parseInt(body.count, 10);
    if (!(count >= 2 && count <= 20)) { res.status(400).json({ error: "Split needs 2 to 20 parts." }); return; }
  }
  if (a === "bulk") {
    const codes = Array.isArray(body.codes) ? body.codes.map(cleanCode).filter(Boolean) : [];
    if (codes.length < 2 || codes.length > 4) { res.status(400).json({ error: "Bulk convert takes 2 to 4 codes per run." }); return; }
  }

  if (await supa.hitRate("mbc", ip, DAILY_LIMIT, 86400)) {
    res.status(429).json({ error: "You've used your 3 free bet-code actions for today. Come back tomorrow.", left: 0, limit: DAILY_LIMIT });
    return;
  }

  try {
    const left = await remainingToday(ip);

    if (a === "convert") {
      const r = await fetch(BASE + "/convert", { method: "POST", headers: headers(), body: JSON.stringify({ code: code, from: String(body.from).toLowerCase(), to: String(body.to).toLowerCase() }) });
      return forward(res, r, null, left);
    }
    if (a === "convert_all") {
      const r = await fetch(BASE + "/convert/all", { method: "POST", headers: headers(), body: JSON.stringify({ code: code, from: String(body.from).toLowerCase() }) });
      return forward(res, r, null, left);
    }
    if (a === "bulk") {
      const r = await fetch(BASE + "/convert/bulk", { method: "POST", headers: headers(), body: JSON.stringify({ codes: body.codes.map(cleanCode), from: String(body.from).toLowerCase(), to: String(body.to).toLowerCase() }) });
      return forward(res, r, null, left);
    }
    if (a === "view") {
      const r = await fetch(BASE + "/view?code=" + encodeURIComponent(code) + "&bookmaker=" + encodeURIComponent(bk), { headers: headers() });
      return forward(res, r, null, left);
    }
    if (a === "view_image") {
      const r = await fetch(BASE + "/view/image?code=" + encodeURIComponent(code) + "&bookmaker=" + encodeURIComponent(bk), { headers: headers() });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader("Content-Type", r.headers.get("content-type") || "image/png");
        res.status(200).send(buf);
      } else {
        return forward(res, r, null, left);
      }
      return;
    }
    if (a === "merge") {
      const pairs = body.pairs.map(function (p) { return { bookmaker: String(p.bookmaker).toLowerCase(), code: cleanCode(p.code) }; });
      const r = await fetch(BASE + "/merge", { method: "POST", headers: headers(), body: JSON.stringify({ pairs: pairs, target: String(body.target || pairs[0].bookmaker).toLowerCase() }) });
      return forward(res, r, null, left);
    }
    if (a === "split") {
      const payload = { code: code, bookmaker: bk, count: parseInt(body.count, 10), pattern: String(body.pattern || "equal"), order: String(body.order || "mixed") };
      if (payload.pattern === "target_odds" && body.target_odds) payload.target_odds = String(body.target_odds);
      if (payload.pattern === "custom" && Array.isArray(body.counts)) payload.counts = body.counts;
      const r = await fetch(BASE + "/split", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      return forward(res, r, null, left);
    }
    if (a === "track_start") {
      const payload = { code: code, bookmaker: bk, mode: String(body.mode || "ticket") === "game" ? "game" : "ticket" };
      if (body.label) payload.label = String(body.label).slice(0, 60);
      const r = await fetch(BASE + "/track", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      return forward(res, r, null, left);
    }
    if (a === "book") {
      const payload = { bookmaker: bk, strict: body.strict !== false, accept_odds_change: !!body.accept_odds_change };
      if (body.plan_id) payload.plan_id = String(body.plan_id);
      else if (Array.isArray(body.picks) && body.picks.length) payload.picks = body.picks;
      else { res.status(400).json({ error: "Nothing to book yet." }); return; }
      if (Array.isArray(body.to) && body.to.length) payload.to = body.to.map(String);
      const r = await fetch(BASE + "/book", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      return forward(res, r, null, left);
    }
  } catch (e) {
    res.status(502).json({ error: "The bet-code service is unreachable. Try again in a moment.", left: await remainingToday(ip) });
  }
};

// Forward an upstream JSON response with friendly wording for the common
// failure states, and pass the real error details through untouched.
async function forward(res, r, listKey, left) {
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  const extra = typeof left === "number" ? { left: left } : {};
  if (r.ok) {
    res.status(200).json(Object.assign({ ok: true, data: data }, extra));
    return;
  }
  if (r.status === 401 || r.status === 403) {
    res.status(502).json(Object.assign({ error: "The bet-code service is not accepting our key right now." }, extra));
    return;
  }
  if (r.status === 402 || r.status === 429) {
    res.status(429).json(Object.assign({ error: "The bet-code service's daily credits are used up. Actions unlock again when the credits reset.", quota: true }, extra));
    return;
  }
  const msg = data && (typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "");
  let friendly = "The bet-code service could not complete that. Check the details and try again.";
  if (/slip_not_found|not found|no slip/i.test(msg)) friendly = "No slip found for that code on that bookmaker. Double-check both.";
  else if (/invalid|validation/i.test(msg)) friendly = "That request is missing something. Check the inputs and try again.";
  else if (/plan_expired/i.test(msg)) friendly = "The booking plan expired (plans last 10 minutes). Resolve the picks again.";
  else if (/plan_not_found/i.test(msg)) friendly = "That booking plan is gone. Resolve the picks again.";
  else if (/odds_changed/i.test(msg)) friendly = "A price moved since you resolved. Re-resolve, or allow odds changes.";
  else if (/games_not_bookable|not_bookable|book_unsupported|book_failed/i.test(msg)) friendly = "That bookmaker refused the booking. The details below say which picks failed.";
  else if (/unsupported_bookmaker/i.test(msg)) friendly = "That bookmaker is not supported for this action.";
  else if (/invalid_merge/i.test(msg)) friendly = "Merge needs 2 to 30 codes.";
  else if (/invalid_split_count/i.test(msg)) friendly = "Split needs 2 to 20 parts.";
  else if (/bookmaker_unavailable/i.test(msg)) friendly = "That bookmaker is unreachable right now. Try again in a moment.";
  res.status(200).json(Object.assign({ error: friendly + (msg ? " (" + msg.slice(0, 140) + ")" : ""), detail: data || text.slice(0, 400) }, extra));
}
