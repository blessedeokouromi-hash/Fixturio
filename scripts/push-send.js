// Sends the daily picks push notification to every subscriber in data/push-subs.json.
// Runs in the "Daily Telegram post" workflow right after the Telegram step.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, GITHUB_TOKEN (optional, prunes dead
// subscriptions by committing the cleaned file), ADMIN_REPO (optional).
// `node scripts/push-send.js --dry` prints what would be sent and sends nothing.
const fs = require("fs");
const REPO = process.env.ADMIN_REPO || "blessedeokouromi-hash/Fixturio";
const FILE = "data/push-subs.json";
const dry = process.argv.includes("--dry");
const PUB = process.env.VAPID_PUBLIC_KEY ||
  "BAO0iCFzZnpnxahZ4FoeW6toT8WX8kh-H4Gj43bg6r9hvZcBshhEItZLCirvEvqev7sBBXkJ7HiOstSLK1OQwRA";
const PRIV = process.env.VAPID_PRIVATE_KEY;

function payloadFor() {
  const d = JSON.parse(fs.readFileSync("daily.json", "utf8"));
  const list = Array.isArray(d) ? d : (d.matches || d.picks || []);
  const first = list[0] || {};
  const top = first.home && first.away ? first.home + " vs " + first.away : null;
  const body = "Today's predicted scores and top picks are live." + (top ? " Top pick: " + top + "." : "");
  return { title: "Fixturio: today's picks are in", body: body, url: "/picks.html", tag: "fixturio-" + (d.date || new Date().toISOString().slice(0, 10)) };
}

if (dry) {
  console.log("DRY RUN");
  console.log(JSON.stringify(payloadFor(), null, 2));
  const subs = (JSON.parse(fs.readFileSync(FILE, "utf8")).subs) || [];
  console.log("subscribers:", subs.length);
  process.exit(0);
}
if (!PRIV) { console.log("VAPID_PRIVATE_KEY missing; push skipped."); process.exit(0); }

const webpush = require("web-push");
webpush.setVapidDetails("mailto:blessed.e.okouromi@gmail.com", PUB, PRIV);

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const subs = data.subs || [];
const payload = JSON.stringify(payloadFor());
let sent = 0, failed = 0;
const dead = [];

(async () => {
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { dead.push(s.endpoint); }
      else failed++;
    }
  }));
  console.log("sent", sent, "failed", failed, "dead", dead.length);
  // Basketball picks push, only when today's basketball build ran.
  try {
    const b = JSON.parse(fs.readFileSync("data/basketball.json", "utf8"));
    if (b && b.date === new Date().toISOString().slice(0, 10) && b.picks && b.picks.length) {
      const bp = JSON.stringify({ title: "Fixturio: basketball picks are in", body: "Today\u2019s basketball top picks and acca are live. Top pick: " + b.picks[0].match + ".", url: "/basketball.html", tag: "fixturio-bball-" + b.date });
      await Promise.all(subs.map(async s => { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, bp); } catch (e) {} }));
      console.log("basketball push sent");
    }
  } catch (e) {}
  const kept = subs.filter(s => dead.indexOf(s.endpoint) === -1);
  if (dead.length && process.env.GITHUB_TOKEN) {
    const headers = { "Accept": "application/vnd.github+json", "User-Agent": "fixturio-push", "Authorization": "Bearer " + process.env.GITHUB_TOKEN };
    try {
      const cur = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + FILE + "?ref=main", { headers }).then(r => r.json());
      const body = JSON.stringify({ subs: kept, updated: new Date().toISOString() });
      const put = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + FILE + "?ref=main", {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        body: JSON.stringify({ message: "prune dead push subscriptions", content: Buffer.from(body).toString("base64"), sha: cur.sha, branch: "main" })
      });
      console.log("prune commit:", put.ok ? "ok" : put.status);
    } catch (e) { console.log("prune commit failed:", e.message); }
  }
})();
