// Builds videos.json from official league YouTube channels (public RSS feeds).
// Only official channels are used, and videos are embedded the way YouTube allows.
const fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHANNELS = [
  ["Premier League", "https://www.youtube.com/@premierleague"],
  ["LaLiga", "https://www.youtube.com/@LaLiga"],
  ["Serie A", "https://www.youtube.com/@SerieA"],
  ["Bundesliga", "https://www.youtube.com/@Bundesliga"],
  ["Ligue 1", "https://www.youtube.com/@Ligue1UberEats"],
  ["MLS", "https://www.youtube.com/@mls"]
];

(async () => {
  const out = [];
  for (const [name, url] of CHANNELS) {
    try {
      const page = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }).then(r => r.text());
      const m = page.match(/channel\/(UC[\w-]{22})/) || page.match(/"channelId":"(UC[\w-]{22})"/);
      if (!m) { console.log("No channel id for " + name); continue; }
      const rss = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + m[1]).then(r => r.text());
      const entries = rss.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      const vids = [];
      entries.slice(0, 6).forEach(e => {
        const id = (e.match(/<yt:videoId>([\\w-]+)</) || [])[1];
        const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
        const th = (e.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1];
        const dt = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1];
        if (id && t) vids.push({ id, title: t, thumb: th, ts: dt ? new Date(dt).getTime() : 0 });
      });
      if (vids.length) out.push({ name, url, videos: vids });
    } catch (e) { console.log("Channel failed: " + name); }
    await sleep(2000);
  }
  fs.writeFileSync("videos.json", JSON.stringify({ generated: new Date().toISOString(), channels: out }));
  console.log("Saved videos for " + out.length + " channels");
})();
