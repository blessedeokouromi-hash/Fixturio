// Bet-code converter (stage 1 of the BetRelay feature, Nov 27 2026).
// A visitor pastes a booking code, picks the source and target bookmaker,
// and gets the converted code. The BetRelay (convertbetcodes.com) API key
// lives only in Vercel environment variables: it is never sent to the
// browser and never appears in this public repository.
//
// GET  /api/betrelay?action=bookies
//        -> { bookies:[{key,bookie,country,from,to}], left, ttlHours }
//        Cached in memory for 6 h so repeated visits cost the key nothing.
// POST /api/betrelay   { code, from, to }
//        -> { code, bookie, games, odds, selections:[...] , left }
//        3 conversions per visitor per UTC day, backed by the Supabase
//        rate_limits table through lib/supa.js (in-memory fallback when
//        Supabase is unreachable).
const supa = require("../lib/supa");

const BASE = "https://convertbetcodes.com/api";
const DAILY_LIMIT = 3;
const CACHE_MS = 6 * 3600 * 1000;

let cache = null; // { at, bookies }
let lastUp = null; // diagnostics: status of the last upstream call

function key() { return (process.env.BETRELAY_API_KEY || "").trim(); }

async function brFetch(path) {
  const r = await fetch(BASE + path + (path.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(key()));
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  lastUp = { status: r.status, json: !!data, head: text.slice(0, 160) };
  return { ok: r.ok, status: r.status, data: data };
}

// "sportybet:ng" -> { key, bookie, country }
function parseBookies(raw) {
  const out = [];
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      if (!k || typeof raw[k] !== "object" || raw[k] === null) continue;
      const parts = k.split(":");
      out.push({
        key: k,
        bookie: parts[0],
        country: (parts[1] || "").toLowerCase(),
        from: raw[k].from === 1 || raw[k].from === true,
        to: raw[k].to === 1 || raw[k].to === true
      });
    }
  }
  out.sort(function (a, b) { return a.bookie.localeCompare(b.bookie) || a.country.localeCompare(b.country); });
  return out;
}

async function bookiesList() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.bookies;
  const r = await brFetch("/supported_bookies");
  if (!r.ok || !r.data) {
    if (cache) return cache.bookies; // serve stale rather than fail the page
    throw new Error("bookies unavailable");
  }
  const payload = r.data.data && typeof r.data.data === "object" ? r.data.data : r.data;
  const list = parseBookies(payload);
  if (!list.length) throw new Error("bookies unavailable");
  cache = { at: Date.now(), bookies: list };
  return list;
}

function remainingToday(ip) {
  return supa.sbSelect("rate_limits", { key: "eq.brc:" + ip, select: "hits,window_start", limit: 1 }).then(function (r) {
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    if (!row) return DAILY_LIMIT;
    const start = new Date(row.window_start).getTime();
    if (isNaN(start) || Date.now() - start >= 86400 * 1000) return DAILY_LIMIT;
    const left = DAILY_LIMIT - (row.hits || 0);
    return left > 0 ? left : 0;
  }).catch(function () { return DAILY_LIMIT; });
}

// The conversion dump lists every selection; shapes differ per bookie, so
// pull out the readable parts and tolerate everything else.
function selectionsOf(conv) {
  const dump = conv && conv.dump ? conv.dump : null;
  const lists = dump && Array.isArray(dump.lists) ? dump.lists : [];
  const out = [];
  lists.forEach(function (l) {
    (Array.isArray(l) ? l : [l]).forEach(function (item) {
      if (!item) return;
      const home = item.home || item;
      const name = home.item_name || home.name || item.item_name || item.name || "";
      const odd = home.odd || item.odd || null;
      if (name) out.push({ name: String(name).slice(0, 160), odd: odd ? Number(odd) : null });
    });
  });
  return out;
}

module.exports = async (req, res) => {
  const ip = supa.clientIp(req);
  if (!key()) { res.status(503).json({ error: "The converter is being set up. Try again soon." }); return; }

  if (req.method === "GET") {
    const want = String(req.query.action || "bookies");
    if (want !== "bookies") { res.status(400).json({ error: "Unknown action." }); return; }
    try {
      const bookies = await bookiesList();
      res.status(200).json({ bookies: bookies, left: await remainingToday(ip), limit: DAILY_LIMIT });
    } catch (e) {
      res.status(502).json({ error: "Could not load the bookmaker list. Try again in a moment.", up: lastUp });
    }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }

  let body = {};
  try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); } catch (e) {}
  const code = String(body.code || "").trim().toUpperCase();
  const from = String(body.from || "").trim().toLowerCase();
  const to = String(body.to || "").trim().toLowerCase();
  if (!/^[A-Z0-9]{4,32}$/.test(code)) { res.status(400).json({ error: "Enter a booking code (letters and numbers, 4-32 characters)." }); return; }
  if (!from || !to || from === to) { res.status(400).json({ error: "Pick two different bookmakers." }); return; }

  if (await supa.hitRate("brc", ip, DAILY_LIMIT, 86400)) {
    res.status(429).json({ error: "You've used your " + DAILY_LIMIT + " free conversions for today. Come back tomorrow.", left: 0, limit: DAILY_LIMIT });
    return;
  }

  try {
    const list = await bookiesList();
    const f = list.find(function (b) { return b.key === from && b.from; });
    const t = list.find(function (b) { return b.key === to && b.to; });
    if (!f || !t) { res.status(400).json({ error: "That bookmaker pair is not supported. Try another pair." }); return; }

    const r = await brFetch("/conversion_v2?from=" + encodeURIComponent(f.key) + "&to=" + encodeURIComponent(t.key) + "&booking_code=" + encodeURIComponent(code));
    if (!r.ok || !r.data) {
      res.status(502).json({ error: "The conversion service did not answer. Try again in a moment.", left: await remainingToday(ip) });
      return;
    }
    const payload = r.data.data || r.data;
    const errs = payload && Array.isArray(payload.errors) ? payload.errors : [];
    if (errs.length || !payload || !payload.conversion || !payload.conversion.destination_code) {
      const msg = errs.length && (errs[0].message || errs[0].error || errs[0])
        ? String(errs[0].message || errs[0].error || errs[0]) : "Could not convert that code. Check the code and bookmakers, or try again in a moment.";
      res.status(200).json({ error: msg.slice(0, 220), left: await remainingToday(ip) });
      return;
    }
    const conv = payload.conversion;
    const dest = String(conv.dump && conv.dump.away ? (conv.dump.away.bookie || "") : (to || "")).toLowerCase();
    res.status(200).json({
      code: conv.destination_code,
      source_code: code,
      bookie: dest || to,
      games: selectionsOf(conv).length || (conv.dump && conv.dump.home && conv.dump.home.no_of_entries) || null,
      odds: conv.dump && conv.dump.home && conv.dump.home.odds ? Number(conv.dump.home.odds) : null,
      selections: selectionsOf(conv),
      left: await remainingToday(ip),
      limit: DAILY_LIMIT
    });
  } catch (e) {
    res.status(502).json({ error: "Conversion failed on our side. Try again in a moment.", left: await remainingToday(ip).catch(function () { return null; }) });
  }
};
