// Shared Supabase helpers for Fixturio serverless functions.
// Phase 0 of the pre-launch audit (Nov 2026): user data (community posts,
// votes, push subscriptions, ad settings) lives in Supabase tables instead of
// JSON files committed to the public repository. The service-role key stays
// in Vercel environment variables and is never logged or returned.
const crypto = require("crypto");

const DEFAULT_URL = "https://ncpquoviqczrxupiihvv.supabase.co";

function url() {
  return (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
}
function serviceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return k.length > 20 ? k : "";
}
function configured() {
  return !!serviceKey();
}

async function rest(path, options) {
  const opts = options || {};
  const headers = Object.assign({
    "apikey": serviceKey(),
    "Authorization": "Bearer " + serviceKey(),
    "Content-Type": "application/json"
  }, opts.headers || {});
  const r = await fetch(url() + path, { method: opts.method || "GET", headers: headers, body: opts.body });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { ok: r.ok, status: r.status, data: data };
}

function sbSelect(table, params) {
  const qs = new URLSearchParams(params || {}).toString();
  return rest("/rest/v1/" + table + (qs ? "?" + qs : ""));
}
function sbInsert(table, rows, upsert) {
  return rest("/rest/v1/" + table, {
    method: "POST",
    headers: upsert ? { "Prefer": "resolution=merge-duplicates,return=minimal" } : { "Prefer": "return=minimal" },
    body: JSON.stringify(rows)
  });
}
function sbUpdate(table, params, row) {
  const qs = new URLSearchParams(params || {}).toString();
  return rest("/rest/v1/" + table + (qs ? "?" + qs : ""), { method: "PATCH", body: JSON.stringify(row) });
}
function sbDelete(table, params) {
  const qs = new URLSearchParams(params || {}).toString();
  return rest("/rest/v1/" + table + (qs ? "?" + qs : ""), { method: "DELETE" });
}
function sbRpc(fn, args) {
  return rest("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) });
}

// Verify a Supabase access token with the project's own public key and
// return { id, email }, or null when the token is missing or invalid.
let anonCfg = null;
async function who(token, host) {
  if (!token || typeof token !== "string") return null;
  if (!anonCfg) {
    try {
      const r = await fetch("https://" + host + "/auth-config.json", { headers: { "Cache-Control": "no-cache" } });
      const c = await r.json();
      anonCfg = c && c.url && c.key ? c : null;
    } catch (e) { anonCfg = null; }
  }
  if (!anonCfg) return null;
  try {
    const r = await fetch(anonCfg.url.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { "apikey": anonCfg.key, "Authorization": "Bearer " + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id && u.email ? { id: u.id, email: u.email } : null;
  } catch (e) { return null; }
}

function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "");
  const first = xff.split(",")[0].trim();
  if (first) return first.slice(0, 60);
  return String(req.headers["x-real-ip"] || "unknown").slice(0, 60);
}

// Fixed-window rate limiter, atomically backed by the rate_limits table via
// the rate_limit_hit function. Falls back to per-server-instance memory when
// Supabase is unreachable, so a Supabase outage never turns into an outage of
// the whole endpoint (limits are then best-effort per instance).
const mem = new Map();
function memHit(key, limit, windowMs) {
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.start + windowMs < now) { mem.set(key, { start: now, hits: 1 }); return false; }
  e.hits++;
  if (mem.size > 5000) { mem.forEach(function (v, k) { if (v.start + windowMs < now) mem.delete(k); }); }
  return e.hits > limit;
}
async function hitRate(scope, ip, limit, windowSec) {
  const key = (scope + ":" + ip).slice(0, 200);
  if (!configured()) return memHit(key, limit, windowSec * 1000);
  try {
    const r = await sbRpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_secs: windowSec });
    const d = Array.isArray(r.data) ? (r.data[0] || null) : r.data;
    if (r.ok && d && typeof d.rate_limit_hit === "boolean") return d.rate_limit_hit;
    if (r.ok && d && typeof d.over === "boolean") return d.over;
  } catch (e) {}
  return memHit(key, limit, windowSec * 1000);
}

// Constant-time comparison: hash both sides first so length never leaks.
function sameToken(a, b) {
  if (typeof a !== "string" || !a) return false;
  if (!b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  try { return crypto.timingSafeEqual(ha, hb); } catch (e) { return false; }
}

module.exports = { url: url, serviceKey: serviceKey, configured: configured, rest: rest, sbSelect: sbSelect, sbInsert: sbInsert, sbUpdate: sbUpdate, sbDelete: sbDelete, sbRpc: sbRpc, who: who, clientIp: clientIp, hitRate: hitRate, sameToken: sameToken };
