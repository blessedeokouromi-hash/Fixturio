// Builds news.json from public RSS feeds. No API key and no football API requests.
const fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FEEDS = [
  ["BBC Sport", "http://feeds.bbci.co.uk/sport/football/rss.xml"],
  ["Sky Sports", "https://www.skysports.com/rss/12040"],
  ["ESPN", "https://www.espn.com/espn/rss/soccer/news"]
];

function tag(x, t) {
  const m = x.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">", "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
}

(async () => {
  const items = [];
  for (const [src, url] of FEEDS) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Fixturio/1.0)" } });
      const xml = await r.text();
      const blocks = xml.match(/<item[ >][\s\S]*?<\/item>/g) || [];
      blocks.slice(0, 14).forEach(b => {
        const title = tag(b, "title"), link = tag(b, "link");
        if (!title || !link) return;
        const desc = tag(b, "description");
        const dt = tag(b, "pubDate");
        const ts = dt ? new Date(dt).getTime() : Date.now();
        items.push({ title, link, source: src, desc: desc.slice(0, 220), ts,
          cat: /transfer|signs|deal|loan|fee|bid for|agree|move to|completes move/i.test(title) ? "transfers" : "news" });
      });
    } catch (e) { console.log("Feed failed: " + src); }
    await sleep(1500);
  }
  items.sort((a, b) => b.ts - a.ts);
  fs.writeFileSync("news.json", JSON.stringify({ generated: new Date().toISOString(), items: items.slice(0, 40) }));
  console.log("Saved " + Math.min(40, items.length) + " news items");
})();
