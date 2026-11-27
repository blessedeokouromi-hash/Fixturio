// Bet-code converter (stage 1 of the BetRelay feature, Nov 27 2026).
// A visitor pastes a booking code, picks the source and target bookmaker,
// and gets the same slip as a new code on the other bookmaker.
//
// Upstream: BetRelay developer API v1 (https://betrelay.com.ng/api/v1).
//   GET  /bookmakers   PUBLIC, no key: bookmakers grouped with countries.
//   POST /convert      needs X-API-Key; JSON {code, from, to, country}.
// The BETRELAY_API_KEY lives only in Vercel environment variables: it is
// never sent to the browser and never appears in this repository.
// The free API plan allows 5 requests/day, so /bookmakers is cached in
// memory for 24 h and only conversions ever touch the key.
const supa = require("../lib/supa");

const BASE = "https://betrelay.com.ng/api/v1";
const DAILY_LIMIT = 3; // per visitor, enforced by our rate_limits table
const CACHE_MS = 24 * 3600 * 1000;

let cache = null; // { at, bookies }

function key() {
  // Strip accidental surrounding quotes/whitespace from the saved value.
  return (process.env.BETRELAY_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
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

// Public list: {data:[{name:"sportybet", countries:[{country:"Nigeria", code:"ng"}]}]}
// -> one entry per bookmaker-country pair: {key:"sportybet|ng", bookie, country, countryName}
function parseBookies(data) {
  const out = [];
  if (Array.isArray(data)) {
    data.forEach(function (b) {
      if (!b || !b.name || !Array.isArray(b.countries)) return;
      const name = String(b.name).toLowerCase();
      b.countries.forEach(function (c) {
        if (!c || !c.code) return;
        out.push({
          key: name + "|" + String(c.code).toLowerCase(),
          bookie: name,
          country: String(c.code).toLowerCase(),
          countryName: c.country || String(c.code).toUpperCase()
        });
      });
    });
  }
  out.sort(function (a, b) { return a.bookie.localeCompare(b.bookie) || a.country.localeCompare(b.country); });
  return out;
}

async function bookiesList() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.bookies;
  const r = await fetch(BASE + "/bookmakers");
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  const list = data && Array.isArray(data.data) ? parseBookies(data.data) : [];
  if (!list.length) throw new Error("bookies unavailable");
  cache = { at: Date.now(), bookies: list };
  return list;
}

module.exports = async (req, res) => {
  const ip = supa.clientIp(req);

  if (req.method === "GET") {
    const want = String(req.query.action || "bookies");
    if (want === "usage") {
      // One upstream call to /usage: tells us whether the key is accepted
      // (200), unknown (401) or domain-blocked (403).
      if (!key()) { res.status(503).json({ error: "no key on file" }); return; }
      try {
        const r = await fetch(BASE + "/usage", { headers: { "X-API-Key": key() } });
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        res.status(200).json({ status: r.status, data: data, body: data ? undefined : text.slice(0, 200) });
      } catch (e) {
        res.status(502).json({ error: "upstream unreachable" });
      }
      return;
    }
    if (want !== "bookies") { res.status(400).json({ error: "Unknown action." }); return; }
    try {
      const bookies = await bookiesList();
      res.status(200).json({ bookies: bookies, left: await remainingToday(ip), limit: DAILY_LIMIT });
    } catch (e) {
      res.status(502).json({ error: "Could not load the bookmaker list. Try again in a moment." });
    }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }

  let body = {};
  try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); } catch (e) {}
  const code = String(body.code || "").trim().toUpperCase();
  const from = String(body.from || "").trim().toLowerCase(); // "sportybet|ng"
  const to = String(body.to || "").trim().toLowerCase();
  if (!/^[A-Z0-9]{4,32}$/.test(code)) { res.status(400).json({ error: "Enter a booking code (letters and numbers, 4-32 characters)." }); return; }
  if (!from || !to || from === to) { res.status(400).json({ error: "Pick two different bookmakers." }); return; }

  if (await supa.hitRate("brc", ip, DAILY_LIMIT, 86400)) {
    res.status(429).json({ error: "You've used your " + DAILY_LIMIT + " free conversions for today. Come back tomorrow.", left: 0, limit: DAILY_LIMIT });
    return;
  }

  const fp = from.split("|"), tp = to.split("|");
  const fB = fp[0], fC = fp[1] || "ng", tB = tp[0], tC = tp[1] || "ng";

  try {
    const r = await fetch(BASE + "/convert", {
      method: "POST",
      headers: { "X-API-Key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, from: fB, to: tB, country: tC === fC ? fC : fC })
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    const left = await remainingToday(ip);

    if (r.status === 401 || r.status === 403) {
      res.status(502).json({ error: "The conversion service is not accepting our key. We're on it.", left: left });
      return;
    }
    if (r.status === 429 || r.status === 402) {
      res.status(429).json({ error: "Today's conversion quota is used up. New codes go live tomorrow.", left: left, quota: true });
      return;
    }
    if (!data || data.message !== "success" || !data.data || !data.data.shareCode) {
      const msg = data && typeof data.message === "string" ? data.message : "";
      const friendly = /not found|no match|invalid code/i.test(msg)
        ? "Could not match that code. Double-check the code and that the source bookmaker is right."
        : /quota|limit|exceed/i.test(msg)
          ? "Today's conversion quota is used up. New codes go live tomorrow."
          : "Could not convert that code. Check the code and bookmakers, or try again in a moment.";
      res.status(200).json({ error: (msg ? friendly + " (" + msg.slice(0, 120) + ")" : friendly), left: left });
      return;
    }

    const d = data.data;
    res.status(200).json({
      code: d.shareCode,
      url: d.shareURL || null,
      from: fB + "|" + fC,
      to: tB + "|" + tC,
      selections: Array.isArray(d.selections) ? d.selections.map(function (s) {
        return {
          home: s.home || "", away: s.away || "",
          market: s.market || "", pick: s.pick || "",
          so: s.sourceOdds || null, to2: s.targetOdds || null
        };
      }) : [],
      usage: data.usage || null,
      left: left,
      limit: DAILY_LIMIT
    });
  } catch (e) {
    res.status(502).json({ error: "Conversion failed on our side. Try again in a moment.", left: await remainingToday(ip) });
  }
};
