// Live-score alerts: kickoff, goal and full-time push notifications for
// today's featured picks and acca legs. Runs on the hourly "Daily picks"
// workflow right after "Refresh today's matches". Zero API-Football calls:
// it diffs the freshly built data/d0.json against data/live-state.json,
// which the same workflow commits back for the next run.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY. Without the private key it
// still tracks state (so nothing double-fires later) but sends nothing.
// `node scripts/live-alerts.js --dry` prints what would be sent.
const fs = require("fs");
const path = require("path");
const DRY = process.argv.includes("--dry");
const DATA = p => path.join(__dirname, "..", p);
const MAX_PER_RUN = 12;

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(DATA(file), "utf8")); }
  catch (e) { return fallback; }
}
const built = load("data/d0.json", null);
if (!built || !Array.isArray(built.response)) {
  console.log("no built match data; skipping"); process.exit(0);
}
const day = built.date || new Date().toISOString().slice(0, 10);
const byId = {};
(built.response || []).forEach(f => { byId[f.fixture && f.fixture.id] = f; });

const daily = load("daily.json", {});
const watch = [];
(daily.matches || []).forEach(m => watch.push({ id: m.id, label: (m.home + " vs " + m.away) }));
((daily.acca && daily.acca.legs) || []).forEach(l => watch.push({ id: l.fixture, label: l.match }));

const LIVE = s => ["1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(s);
let state = load("data/live-state.json", null);
if (!state || state.day !== day) state = { day: day, fx: {}, updated: null };

const events = [];
watch.forEach(w => {
  const cur = byId[w.id];
  if (!cur) return;
  const st = cur.fixture.status.short;
  const gh = cur.goals.home, ga = cur.goals.away;
  const prev = state.fx[w.id];
  state.fx[w.id] = { st: st, gh: gh, ga: ga };
  if (!prev) return; // first sighting today: seed only, never blast
  const label = w.label || (cur.teams.home.name + " vs " + cur.teams.away.name);
  const lg = cur.league ? cur.league.name + (cur.league.country ? " \u00b7 " + cur.league.country : "") : "";
  const start = gh === null ? 0 : gh + ga;
  if (LIVE(st) && !LIVE(prev.st) && prev.st !== "FT") {
    events.push({ title: "Kick off: " + label, body: (lg ? lg + " \u2014 " : "") + (gh === null ? "0-0" : gh + "-" + ga) + ", under way.", tag: "fx-" + w.id + "-ko" });
  }
  if (LIVE(st) && gh !== null && ga !== null && start > (prev.gh === null ? 0 : (prev.gh + (prev.ga || 0)))) {
    const who = gh > (prev.gh === null ? 0 : prev.gh) ? cur.teams.home.name : cur.teams.away.name;
    events.push({ title: "GOAL! " + who, body: label + " now " + gh + "-" + ga + (lg ? " \u00b7 " + lg : "") + ".", tag: "fx-" + w.id + "-g-" + gh + "-" + ga });
  }
  if (st === "FT" && prev.st !== "FT" && prev.st !== "AET" && prev.st !== "PEN") {
    events.push({ title: "Full time: " + label, body: "Final score " + (gh === null ? "?" : gh) + "-" + (ga === null ? "?" : ga) + (lg ? " \u00b7 " + lg : "") + ".", tag: "fx-" + w.id + "-ft" });
  }
});
state.updated = new Date().toISOString();
const send = events.slice(0, MAX_PER_RUN);
if (events.length > MAX_PER_RUN) console.log("capped", events.length - MAX_PER_RUN, "events");

if (DRY) {
  console.log("DRY RUN day", day, "watch", watch.length, "subs", (load("data/push-subs.json", { subs: [] }).subs || []).length);
  console.log(JSON.stringify(send, null, 1) || "no events");
  process.exit(0);
}
if (send.length && !process.env.VAPID_PRIVATE_KEY) {
  console.log("VAPID_PRIVATE_KEY missing; " + send.length + " event(s) skipped, state still saved.");
}
let sent = 0, failed = 0, dead = 0;
if (send.length && process.env.VAPID_PRIVATE_KEY) {
  const webpush = require("web-push");
  webpush.setVapidDetails("mailto:blessed.e.okouromi@gmail.com",
    process.env.VAPID_PUBLIC_KEY || "BPk7rMe5Lm9CpW1UbtMrWzvJb55OQb9pWmxh2ZnDJkDS-lMgSwROSPH5GSkKQ4uXOtftoTX-zAFGVGpwV4IQAL0",
    process.env.VAPID_PRIVATE_KEY);
  const subs = (load("data/push-subs.json", { subs: [] }).subs) || [];
  const payload = JSON.stringify({ url: "/" });
  (async () => {
    for (const ev of send) {
      const msg = JSON.stringify({ title: ev.title, body: ev.body, tag: ev.tag, url: "/" });
      for (const s of subs) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, msg); sent++; }
        catch (e) { const c = e && e.statusCode; if (c === 404 || c === 410) dead++; else failed++; }
      }
    }
    console.log("events", send.length, "sent", sent, "failed", failed, "dead", dead);
    done();
  })();
} else { console.log("events", send.length, "sent 0"); done(); }

function done() {
  fs.writeFileSync(DATA("data/live-state.json"), JSON.stringify(state));
  console.log("state saved for", day, "fixtures tracked", Object.keys(state.fx).length);
}
