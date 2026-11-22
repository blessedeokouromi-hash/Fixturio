// Posts today's picks to the Fixturio Telegram channel.
// Needs two repository secrets: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
// Missing secrets are skipped quietly so the schedule never shows a red X.
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.log("Telegram secrets missing; skipping the post.");
  process.exit(0);
}

const d = JSON.parse(fs.readFileSync("daily.json", "utf8"));
const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const picks = (d.picks || []).slice(0, 5);
let msg = "<b>Fixturio \u2014 today\u2019s top picks</b>\n<i>" + esc(d.date) + "</i>\n\n";
picks.forEach((p, i) => {
  msg += (i + 1) + ". <b>" + esc(p.match) + "</b>\n" + esc(p.market) + (p.odd ? " @" + p.odd : "") + " \u00b7 " + p.probability + "%\n";
});
if (d.acca && d.acca.legs && d.acca.legs.length) {
  msg += "\n<b>Acca of the day</b> \u00b7 total odds " + d.acca.total + "\n";
  d.acca.legs.forEach(l => { msg += "\u2022 " + esc(l.match) + ": " + esc(l.market) + " @" + l.odd + "\n"; });
}
msg += "\nAll 15 picks and stats: https://fixturio.vercel.app/picks.html\n18+. Predictions are estimates, not guarantees.";

fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "HTML" })
}).then(r => r.json()).then(j => {
  if (j.ok) console.log("Posted to Telegram: message id " + j.result.message_id);
  else { console.error("Telegram refused the post: " + JSON.stringify(j)); process.exit(1); }
}).catch(e => { console.error("Telegram post failed: " + (e && e.message ? e.message : e)); process.exit(1); });
