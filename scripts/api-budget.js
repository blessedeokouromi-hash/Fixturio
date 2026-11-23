// Central API-Football request ledger. Every live API call made by the
// nightly workflows logs here, so data/api-usage.json shows exactly how much
// of the free plan's 100-requests-per-day quota was used and on what.
// The ledger resets at midnight UTC, matching the provider's quota reset.
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "data", "api-usage.json");
// Self-stop ceiling: a normal nightly build uses about 85, so 97 only ever
// trips on a runaway loop, and keeps a small margin below the plan's 100.
const HARD_CAP = 97;

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, "utf8")); if (d && d.day) return d; } catch (e) {}
  return { day: todayUTC(), total: 0, log: [] };
}
function save(d) { try { fs.writeFileSync(FILE, JSON.stringify(d)); } catch (e) {} }
function status() {
  const d = load();
  if (d.day !== todayUTC()) { d.day = todayUTC(); d.total = 0; d.log = []; }
  return d;
}
function track(what, n) {
  const d = status();
  const num = n || 1;
  d.total += num;
  d.log.push({ t: new Date().toISOString().slice(11, 19) + "Z", n: num, what: String(what || "").slice(0, 60) });
  if (d.log.length > 500) d.log = d.log.slice(-500);
  save(d);
  return d.total;
}
function remaining() { return Math.max(0, 100 - status().total); }
function gate() {
  if (status().total >= HARD_CAP) {
    throw new Error("API-Football daily budget reached (" + status().total + " requests). Stopping to protect the plan.");
  }
  return true;
}
module.exports = { track, remaining, status, gate, HARD_CAP };
