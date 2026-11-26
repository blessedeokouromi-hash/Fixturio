// Temporary odds diagnostic, inert without data/probe.flag. Never prints the key.
const fs = require("fs");
const https = require("https");
const KEY = process.env.API_FOOTBALL_KEY;
function call(path, label) {
  return new Promise(res => {
    https.get({ host: "v3.football.api-sports.io", path: path, headers: { "x-apisports-key": KEY } }, r => {
      let b = ""; r.on("data", c => b += c); r.on("end", () => {
        try {
          const d = JSON.parse(b);
          const rows = d.response || [];
          console.log(label + ": HTTP " + r.statusCode + " results " + (d.results ?? "n/a") + " errors " + JSON.stringify(d.errors) + " remaining-requests " + (r.headers["x-ratelimit-requests-remaining"] ?? "?"));
          if (d.response && d.response.account) console.log("  account: " + JSON.stringify(d.response.account) + " subscription " + JSON.stringify(d.response.subscription) + " usage " + JSON.stringify(d.response.requests));
          const with1x2 = rows.filter(x => x.bookmakers && x.bookmakers.some(bk => (bk.bets || []).some(bt => bt.id === 1))).length;
          if (rows.length) console.log("  rows " + rows.length + " with1X2 " + with1x2 + " firstUpdate " + (rows[0].update || rows[0].fixture && rows[0].fixture.date || "?"));
        } catch (e) { console.log(label + ": HTTP " + r.statusCode + " unparseable (" + b.length + " bytes)"); }
        setTimeout(res, 7000);
      });
    }).on("error", e => { console.log(label + ": network error " + e.message); res(); });
  });
}
(async () => {
  const date = new Date().toISOString().slice(0, 10);
  console.log("probe at " + new Date().toISOString() + " for date " + date);
  let fid = null;
  try {
    const d0 = JSON.parse(fs.readFileSync("data/d0.json", "utf8"));
    const ns = (d0.response || []).find(f => f.league && f.league.id === 39 && f.fixture.status.short === "NS") || (d0.response || []).find(f => f.fixture && f.fixture.status.short === "NS");
    if (ns) fid = ns.fixture.id;
  } catch (e) {}
  await call("/status", "status");
  await call("/odds?league=39&season=2026&date=" + date, "league+season+date");
  await call("/odds?league=39&season=2026", "league+season");
  if (fid) await call("/odds?fixture=" + fid, "per-fixture " + fid);
  console.log("probe done");
  process.exit(0);
})();
