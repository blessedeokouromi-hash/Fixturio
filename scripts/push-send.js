// Sends the daily picks push notification to every subscriber in the Supabase
// push_subs table. Phase 0 of the pre-launch audit: subscriptions no longer
// live in data/push-subs.json (that file was public in the repository), so
// this script reads them from Supabase and prunes dead endpoints there too.
// Runs in the "Daily Telegram post" workflow right after the Telegram step.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// `node scripts/push-send.js --dry` prints what would be sent and sends nothing.
const fs = require("fs");
const dry = process.argv.includes("--dry");
const test = process.argv.includes("--test"); // debug: try only the newest sub and print the full web-push error
const PUB =   // The saved VAPID private key signs with this public key (the
  // VAPID_PUBLIC_KEY secret holds an older key and is ignored on purpose).
  "BF0Fz8tRk1iB5Y4eyeXKTdQHwBVygfVq5-O4DHwDjzZdyk2h56yJg_5fgkeYsImEB1ZyjFk6sHcinkZkuSpS35E";
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SB_URL = (process.env.SUPABASE_URL || "https://ncpquoviqczrxupiihvv.supabase.co").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function payloadFor() {
  const d = JSON.parse(fs.readFileSync("daily.json", "utf8"));
  const list = Array.isArray(d) ? d : (d.matches || d.picks || []);
  const first = list[0] || {};
  const top = first.home && first.away ? first.home + " vs " + first.away : null;
  const body = "Today's predicted scores and top picks are live." + (top ? " Top pick: " + top + "." : "");
  return { title: "Fixturio: today's picks are in", body: body, url: "/picks.html", tag: "fixturio-" + (d.date || new Date().toISOString().slice(0, 10)) };
}

async function loadSubs() {
  if (!SB_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  const r = await fetch(SB_URL + "/rest/v1/push_subs?select=endpoint,keys&order=added.desc&limit=5000", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
  });
  if (!r.ok) throw new Error("Supabase read failed: " + r.status);
  const rows = await r.json();
  return (rows || []).map(function (s) { return { endpoint: s.endpoint, keys: s.keys || {} }; });
}

async function dropDead(endpoints) {
  if (!SB_KEY || !endpoints.length) return;
  for (const ep of endpoints) {
    try {
      await fetch(SB_URL + "/rest/v1/push_subs?endpoint=eq." + encodeURIComponent(ep), {
        method: "DELETE", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      });
    } catch (e) {}
  }
}

async function main() {
  if (dry) {
    console.log("DRY RUN");
    console.log(JSON.stringify(payloadFor(), null, 2));
    try { console.log("subscribers:", (await loadSubs()).length); }
    catch (e) { console.log("subscribers: not read (" + e.message + ")"); }
    process.exit(0);
  }
  if (!PRIV) { console.log("VAPID_PRIVATE_KEY missing; push skipped."); process.exit(0); }
  let subs;
  try { subs = await loadSubs(); }
  catch (e) { console.log("Push skipped: " + e.message); process.exit(0); }
  const webpush = require("web-push");
  webpush.setVapidDetails("mailto:blessed.e.okouromi@gmail.com", PUB, PRIV);
  if (test) {
    const one = subs[0];
    console.log("TEST: trying", one.endpoint.slice(0, 60), "pubkey", PUB.slice(0, 12));
    try {
      await webpush.sendNotification({ endpoint: one.endpoint, keys: one.keys }, JSON.stringify(payloadFor()));
      console.log("TEST: OK, notification sent to newest subscriber");
    } catch (e) {
      console.log("TEST FAIL statusCode:", e && e.statusCode);
      console.log("TEST FAIL body:", e && e.body);
      console.log("TEST FAIL message:", e && e.message);
    }
    process.exit(0);
  }
  const payload = JSON.stringify(payloadFor());
  let sent = 0, failed = 0;
  const dead = [];
  await Promise.all(subs.map(async function (s) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload); sent++; }
    catch (e) { const code = e && e.statusCode; if (code === 404 || code === 410) dead.push(s.endpoint); else failed++; }
  }));
  console.log("sent", sent, "failed", failed, "dead", dead.length);
  // Basketball picks push, only when today's basketball build ran.
  try {
    const b = JSON.parse(fs.readFileSync("data/basketball.json", "utf8"));
    if (b && b.date === new Date().toISOString().slice(0, 10) && b.picks && b.picks.length) {
      const bp = JSON.stringify({ title: "Fixturio: basketball picks are in", body: "Today\u2019s basketball top picks and acca are live. Top pick: " + b.picks[0].match + ".", url: "/basketball.html", tag: "fixturio-bball-" + b.date });
      await Promise.all(subs.map(async function (s) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, bp); } catch (e) {} }));
      console.log("basketball push sent");
    }
  } catch (e) {}
  if (dead.length) {
    await dropDead(dead);
    console.log("pruned", dead.length, "dead subscriptions from Supabase");
  }
}
main();
