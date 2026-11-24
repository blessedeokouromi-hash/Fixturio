// Basketball daily build. Same shape as football's daily.json, powered by
// api-basketball (v1.basketball.api-sports.io, free plan: 100 requests/day).
// Reads BASKETBALL_KEY from the environment; without it the build skips
// quietly so the schedule never shows a red X. Moneyline probabilities are
// odds-implied (overround removed) because basketball has no historical
// model here yet; nothing is presented as guaranteed.
// Writes data/basketball.json: { date, generated, picks[15], acca, m[] }
// Budget: 1 games call + up to 18 odds calls. MOCK=1 runs on sample data.
const fs = require("fs");
const KEY = process.env.BASKETBALL_KEY;
const HOST = "https://v1.basketball.api-sports.io";
const OUT = process.env.MOCK === "1" ? "/tmp/basketball.json" : "data/basketball.json";
const today = new Date().toISOString().slice(0, 10);

// Major leagues by name so one games call covers the whole day worldwide.
const KEEP = /nba|wnba|ncaa|euroleague|eurocup|aba|acb|liga acb|serie a|lega|bbl|pro a|lnb|nbdl|gleague|kbl|cba|bsl|tbsl|bsk|lbl|nbl|big v|bcl|basketball champions/i;
const MIN_ODD = 1.05, ACCA_MAX_ODD = 2.2;

let nCalls = 0;
async function api(path) {
  if (!KEY) { console.log("Basketball key missing; skipping the build."); process.exit(0); }
  nCalls++;
  if (nCalls > 25) throw new Error("basketball call cap reached");
  await new Promise(r => setTimeout(r, 7500));
  const r = await fetch(HOST + path, { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  if (d.errors && Object.keys(d.errors).length) throw new Error("api error " + JSON.stringify(d.errors).slice(0, 200));
  return d.response || [];
}

function sample() {
  const L = (n, c) => ({ id: n.length * 7 + 3, name: n, country: { name: c } });
  const mk = (i, lh, ah, oh, oa, lg, co, t) => ({
    id: i, date: today + "T" + t, status: { short: "NS" },
    league: L(lg, co), country: { name: co },
    teams: { home: { name: lh }, away: { name: ah } },
    _odds: { Home: oh, Away: oa }
  });
  return [
    mk(1, "Boston Celtics", "Toronto Raptors", 1.18, 4.9, "NBA", "USA", "19:30"),
    mk(2, "Oklahoma City Thunder", "New Orleans Pelicans", 1.25, 3.95, "NBA", "USA", "20:00"),
    mk(3, "Denver Nuggets", "Utah Jazz", 1.22, 4.3, "NBA", "USA", "21:00"),
    mk(4, "Real Madrid", "Baskonia", 1.3, 3.5, "Liga ACB", "Spain", "19:00"),
    mk(5, "Barcelona", "Valencia", 1.42, 2.95, "Liga ACB", "Spain", "20:30"),
    mk(6, "Panathinaikos", "Maccabi Tel Aviv", 1.55, 2.5, "Euroleague", "Greece", "20:15"),
    mk(7, "Olympiacos", "Monaco", 1.48, 2.7, "Euroleague", "Greece", "19:45"),
    mk(8, "Fenerbahce", "Virtus Bologna", 1.36, 3.1, "Euroleague", "Turkey", "18:30"),
    mk(9, "Anadolu Efes", "Bayern Munich", 1.6, 2.4, "Euroleague", "Turkey", "17:30"),
    mk(10, "Lakers", "Warriors", 1.9, 1.95, "NBA", "USA", "03:30"),
    mk(11, "ASVEL", "Le Mans", 1.75, 2.1, "LNB Pro A", "France", "19:00"),
    mk(12, "London Lions", "Leicester Riders", 1.5, 2.6, "BBL", "UK", "19:30")
  ];
}

async function games() {
  if (process.env.MOCK === "1") return sample();
  return api("/games?date=" + today);
}

// Average moneyline odds across bookmakers for one game.
function moneyline(oddsRows) {
  const acc = { Home: [], Away: [] };
  // shape: response[] -> bookmakers[] -> bets[] -> values[]
  (oddsRows || []).forEach(r => (r.bookmakers || []).forEach(b => {
    const bets = b.bets || [];
    // try the two-way moneyline first, then the 3-way result's home/away legs
    const cands = bets.filter(bt => /^home\/away$/i.test((bt.name || "").trim()) || /3way result/i.test(bt.name || ""));
    for (const pick of cands) {
      let vh = null, va = null;
      (pick.values || []).forEach(v => {
        const s2 = String(v.value || "").trim().toLowerCase();
        const o = parseFloat(v.odd);
        if (!isFinite(o) || o < MIN_ODD) return;
        if (s2 === "home" || s2 === "1") vh = vh || o;
        if (s2 === "away" || s2 === "2") va = va || o;
      });
      if (vh && va) { acc.Home.push(vh); acc.Away.push(va); break; }
    }
  }));
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  return { home: avg(acc.Home), away: avg(acc.Away) };
}

function implProb(oh, oa) {
  const ih = 1 / oh, ia = 1 / oa;
  return { home: ih / (ih + ia), away: ia / (ih + ia) };
}

(async () => {
  const gs = await games();
  console.log("basketball debug: games returned " + gs.length);
  const kept = gs.filter(g => g && g.teams && g.teams.home && g.teams.away && KEEP.test(g.league && g.league.name || ""));
  console.log("basketball debug: kept after league filter " + kept.length);
  const open = kept.filter(g => !g.status || g.status.short === "NS").slice(0, 18);
  console.log("basketball debug: upcoming to price " + open.length);

  const priced = [];
  for (const g of open) {
    let ml = null;
    if (process.env.MOCK === "1") ml = { home: g._odds.Home, away: g._odds.Away };
    else {
      try {
        const rows = await api("/odds?game=" + g.id);
        ml = moneyline(rows);
        if (!ml || !ml.home || !ml.away) console.log("basketball debug: no moneyline in odds for game " + g.id + ", rows " + (rows.length||0) + ", bets " + (((rows[0]||{}).bookmakers||[]).reduce((a,b)=>a+((b.bets||[]).length||0),0))
        + (rows.length ? ", names: " + Array.from(new Set(((rows[0]||{}).bookmakers||[]).flatMap(b=>(b.bets||[]).map(bt=>bt.name)))).slice(0,8).join("|") : "") + (rows.length && (((rows[0]||{}).bookmakers||[])[0]||{}).bets ? ", sample: " + JSON.stringify((((rows[0].bookmakers||[])[0].bets||[]).find(bt=>/home\/away|3way/i.test(bt.name||""))||{}).values||[]).slice(0,160) : ""));
      } catch (e) { console.log("basketball debug: odds failed for game " + g.id + ": " + String(e.message).slice(0, 180)); ml = null; }
    }
    if (!ml || !ml.home || !ml.away) continue;
    const p = implProb(ml.home, ml.away);
    const when = (g.date || "").slice(11, 16) || g.time || "";
    const base = {
      game_id: g.id, league: g.league.name, country: (g.country && g.country.name) || "",
      time: when, status: (g.status && g.status.short) || "", home: g.teams.home.name, away: g.teams.away.name
    };
    priced.push(Object.assign({}, base, {
      market: "Home team to win", odd: Math.round(ml.home * 100) / 100,
      probability: Math.round(p.home * 100)
    }));
    priced.push(Object.assign({}, base, {
      market: "Away team to win", odd: Math.round(ml.away * 100) / 100,
      probability: Math.round(p.away * 100)
    }));
  }
  priced.sort((a, b) => b.probability - a.probability);

  const picks = priced.slice(0, 15).map(p => ({
    match: p.home + " vs " + p.away, market: p.market, odd: p.odd,
    probability: p.probability, league: p.league, country: p.country, time: p.time, game_id: p.game_id
  }));

  // Acca built independently from every priced leg, never copied from the
  // Top 15. Strict pass first (max 2 legs per league, 4 per country); if the
  // product cannot reach 20, top up with the next safest legs; if it ever
  // overshoots 50, drop the longest-odds legs until it fits.
  function buildSlip(pool, capLeague, capCountry, minOdd, maxOdd, minProb) {
    const perLeague = {}, perCountry = {};
    const legs = [];
    let total = 1;
    const atCap = p => (perLeague[p.league] || 0) >= capLeague || (perCountry[p.country] || 0) >= capCountry;
    for (const p of pool) {
      if (total >= 20) break;
      if (atCap(p)) continue;
      if (p.odd < minOdd || p.odd > maxOdd || p.probability < minProb) continue;
      if (total * p.odd > 50) continue; // too short, would overshoot
      legs.push(p); total *= p.odd;
      perLeague[p.league] = (perLeague[p.league] || 0) + 1;
      perCountry[p.country] = (perCountry[p.country] || 0) + 1;
    }
    return { legs, total, atCap };
  }
  function asAcca(legs, total) {
    return {
      total: Math.round(total * 100) / 100,
      joint: Math.round(legs.reduce((s, l) => s * l.probability / 100, 1) * 1000) / 10,
      legs: legs.map(l => ({ match: l.home + " vs " + l.away, market: l.market, odd: l.odd, probability: l.probability, league: l.league, country: l.country, time: l.time, game_id: l.game_id }))
    };
  }
  const allPool = priced.sort((a, b) => b.probability - a.probability);
  const first = buildSlip(allPool, 2, 4, 1.12, 2.6, 45);
  let legs = first.legs, total = first.total;
  if (total < 20) {
    // top-up: same safety order, league cap lifted
    const perLeague = {}, perCountry = {};
    legs.forEach(l => { perLeague[l.league] = (perLeague[l.league] || 0) + 1; perCountry[l.country] = (perCountry[l.country] || 0) + 1; });
    for (const p of allPool) {
      if (total >= 20) break;
      if (legs.includes(p)) continue;
      if ((perLeague[p.league] || 0) >= 3 || (perCountry[p.country] || 0) >= 5) continue;
      if (p.odd < 1.12 || p.odd > 2.6 || p.probability < 45) continue;
      if (total * p.odd > 50) continue;
      legs.push(p); total *= p.odd;
      perLeague[p.league] = (perLeague[p.league] || 0) + 1;
      perCountry[p.country] = (perCountry[p.country] || 0) + 1;
    }
  }
  while (total > 50 && legs.length > 4) { // overshoot: drop the longest shot
    const i = legs.reduce((best, l, j) => l.odd > legs[best].odd ? j : best, 0);
    total /= legs[i].odd; legs.splice(i, 1);
  }
  let acca = null;
  if (legs.length >= 3 && total >= 20) {
    acca = asAcca(legs, total);
  } else {
    const short = allPool.filter(p => p.odd >= 1.5 && p.odd <= 2.2 && p.probability >= 45).slice(0, 3);
    if (short.length) acca = asAcca(short, short.reduce((s, l) => s * l.odd, 1));
  }

  const out = {
    date: today, generated: new Date().toISOString(),
    picks, acca,
    m: priced.map(p => ({ h: p.home, a: p.away, market: p.market, odd: p.odd, probability: p.probability, league: p.league, country: p.country, time: p.time, status: p.status || "", game_id: p.game_id }))
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("basketball: " + priced.length / 2 + " priced games, " + picks.length + " picks, acca " + (acca ? acca.total + " (" + acca.legs.length + " legs, " + acca.joint + "%)" : "none") + ", " + nCalls + " api calls");
})().catch(e => { console.error("Basketball build failed: " + (e && e.message ? e.message : e)); process.exit(1); });
