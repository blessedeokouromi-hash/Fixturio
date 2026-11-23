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
msg += "\nAll 15 picks and stats: https://fixturio.vercel.app/picks.html";
msg += "\n\n<b>Back these picks on 1xBet</b>: https://refpa-65760.com/L?tag=d_6390619m_1599c_&site=6390619&ad=1599\n18+. T&amp;Cs apply. Predictions are estimates, not guarantees.";

function send(text) {
  return fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text, parse_mode: "HTML" })
  }).then(r => r.json()).then(j => {
    if (!j.ok) throw new Error(JSON.stringify(j));
    return j.result.message_id;
  });
}

// Basketball picks, only when today's basketball build actually ran.
let bbMsg = null;
try {
  const b = JSON.parse(fs.readFileSync("data/basketball.json", "utf8"));
  if (b && b.date === new Date().toISOString().slice(0, 10) && b.picks && b.picks.length) {
    const bp = (b.picks || []).slice(0, 5);
    let m2 = "<b>Fixturio basketball \u2014 today\u2019s top picks</b>\n<i>" + esc(b.date) + "</i>\n\n";
    bp.forEach((p, i) => { m2 += (i + 1) + ". <b>" + esc(p.match) + "</b>\n" + esc(p.market) + " @" + p.odd + " \u00b7 " + p.probability + "%\n"; });
    if (b.acca && b.acca.legs && b.acca.legs.length) {
      m2 += "\n<b>Basketball acca</b> \u00b7 total odds " + b.acca.total + "\n";
      b.acca.legs.forEach(l => { m2 += "\u2022 " + esc(l.match) + ": " + esc(l.market) + " @" + l.odd + "\n"; });
    }
    m2 += "\nAll basketball picks: https://fixturio.vercel.app/basketball.html";
    m2 += "\n\n<b>Back these picks on 1xBet</b>: https://refpa-65760.com/L?tag=d_6390619m_1599c_&site=6390619&ad=1599\n18+. Predictions are estimates, not guarantees.";
    bbMsg = m2;
  }
} catch (e) {}

send(msg).then(() => bbMsg ? send(bbMsg) : null).then(() => {
  console.log("Posted to Telegram" + (bbMsg ? " (football + basketball)" : " (football)"));
}).catch(e => { console.error("Telegram post failed: " + (e && e.message ? e.message : e)); process.exit(1); });
