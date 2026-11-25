const fs = require("fs");

// Scoreline fallback: used only when all.json has no entry for a match. It fits
// a Dixon-Coles Poisson to the blended 1X2 probabilities and picks the modal
// scoreline for the top outcome. The nightly model in all.js already produces a
// deterministic scoreline from its own matrix, so this path rarely runs.
function fact(n){ let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function dcCells(lh, la, RHO){
  const N = 6, ph = [], pa = [];
  for (let i = 0; i < N; i++){ ph[i] = Math.exp(-lh) * Math.pow(lh, i) / fact(i); pa[i] = Math.exp(-la) * Math.pow(la, i) / fact(i); }
  const cells = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
    let p = ph[i] * pa[j];
    if (i === 0 && j === 0) p *= 1 - lh * la * RHO;
    else if ((i === 0 && j === 1) || (i === 1 && j === 0)) p *= 1 + RHO;
    else if (i === 1 && j === 1) p *= 1 - RHO;
    cells.push({ i: i, j: j, w: Math.max(0, p) });
  }
  return cells;
}
function fitScore(ph, pd, pa){
  const RHO = -0.10;
  let best = null;
  for (let hi = 3; hi <= 72; hi++){
    const lh = hi / 20;
    for (let ai = 3; ai <= 72; ai++){
      const la = ai / 20;
      const cs = dcCells(lh, la, RHO);
      let h = 0, d = 0, aw = 0;
      for (const c of cs){ if (c.i > c.j) h += c.w; else if (c.i === c.j) d += c.w; else aw += c.w; }
      const err = (h - ph) * (h - ph) + (d - pd) * (d - pd) + (aw - pa) * (aw - pa);
      if (!best || err < best.err) best = { err: err, lh: lh, la: la };
    }
  }
  return best;
}
function lcg(seed){ let s = (seed % 2147483647) || 1; return function(){ s = s * 48271 % 2147483647; return s / 2147483647; }; }
function get12(list){
  const g = k => { const x = list.find(y => y.market === k); return x ? x.prob : null; };
  const h = g("Home win"), d = g("Draw"), aw = g("Away win");
  return h != null && d != null && aw != null ? [h, d, aw] : null;
}
function pickScore(id, ph, pd, pa){
  if (!(ph > 0 && pd > 0 && pa > 0) || ph + pd + pa > 1.05) return null;
  const f = fitScore(ph, pd, pa);
  if (!f) return null;
  const cells = dcCells(f.lh, f.la, -0.10);
  const top = ph >= pd && ph >= pa ? "H" : (pa >= ph && pa >= pd ? "A" : "D");
  const clear = Math.max(ph, pd, pa) >= 0.5;
  let pool = cells.filter(c => (c.i > c.j ? "H" : (c.i === c.j ? "D" : "A")) === top);
  if (!clear) pool = cells.slice();
  pool.sort((x, y) => y.w - x.w);
  pool = pool.slice(0, 12);
  const rnd = lcg(id);
  let total = 0; for (const c of pool) total += c.w;
  let r = rnd() * total, pick = pool[0];
  for (const c of pool){ r -= c.w; if (r <= 0){ pick = c; break; } }
  return { s: pick.i + "-" + pick.j, st: pool.slice(0, 3).map(c => c.i + "-" + c.j).join(", ") };
}

const KEY = process.env.API_FOOTBALL_KEY;
const TOP = [1,2,4,5,6,3,848,39,140,135,78,61,88,94,144,203,40,253,71,128,179,29,32,10,12];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path) {
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  const d = await r.json();
  await sleep(7000);
  return d;
}

function twoWay(bet, k1, k2) {
  if (!bet) return null;
  const o = {};
  (bet.values || []).forEach(v => { o[v.value] = parseFloat(v.odd); });
  if (!(o[k1] > 1 && o[k2] > 1)) return null;
  const x = 1 / o[k1], y = 1 / o[k2];
  return [x / (x + y), y / (x + y)];
}

function pickBets(od) {
  const bms = ((od.response || [])[0] || {}).bookmakers || [];
  const bm = bms.find(b => (b.bets || []).some(x => x.id === 1)) || bms[0];
  return bm ? (bm.bets || []) : [];
}

// Market probabilities for one match. The model (q, from all.json) and the
// bookmakers (bets) are blended where both have a view: 60% model, 40% market,
// each market's odds margin removed before blending. Matches with no odds at
// all are priced model-only, flagged by modelOnly.
function analyze(q, bets) {
  const mh = q ? q.h / 100 : null, md = q ? q.d / 100 : null, ma = q ? q.a / 100 : null;
  const mo = q ? q.o / 100 : null; // over 2.5 from the model
  const mb = q ? q.b / 100 : null; // both teams to score, yes

  const w = bets.find(b => b.id === 1);
  const o1 = {};
  if (w) (w.values || []).forEach(v => { o1[v.value] = parseFloat(v.odd); });
  const has1 = o1.Home > 1 && o1.Draw > 1 && o1.Away > 1;
  let ih, ix, ia;
  if (has1) {
    ih = 1 / o1.Home; ix = 1 / o1.Draw; ia = 1 / o1.Away;
    const t = ih + ix + ia; ih /= t; ix /= t; ia /= t;
  }
  const ou = twoWay(bets.find(b => b.id === 5), "Over 2.5", "Under 2.5");
  const bt = twoWay(bets.find(b => b.id === 8), "Yes", "No");
  const anyOdds = has1 || ou || bt;

  let src, modelOnly = false;
  if (mh != null && anyOdds) src = "our score model blended with bookmaker odds";
  else if (mh != null) { src = "our score model, built from recent results"; modelOnly = true; }
  else if (has1) src = "bookmaker odds blended with form data";
  else src = "form and statistics data";

  // Blend rule: where the model and the market both have a view, the model
  // leads but the market keeps a say. Where they disagree by more than 25
  // points the data is unreliable for that market, so it is marked skip and
  // never chosen as a pick.
  const entry = (market, kind, mp, ip) => {
    if (mp == null && ip == null) return null;
    const prob = mp != null && ip != null ? 0.6 * mp + 0.4 * ip : (mp != null ? mp : ip);
    const skip = mp != null && ip != null && Math.abs(mp - ip) > 0.25;
    return { market, kind, prob, skip };
  };
  // Markets the model can price on its own, straight from the goal-expectation
  // grid the score model uses, with no odds needed: team totals, handicaps and
  // first-half lines (first half modelled as about 45% of full-time goals).
  const gridMkts = (() => {
    if (!(q && q.x > 0 && q.y > 0)) return [];
    const N = 9;
    const pois = (lam, k) => { let p = Math.exp(-lam); for (let i = 1; i <= k; i++) p *= lam / i; return p; };
    const mk = (lh, la) => { const g = []; let tot = 0; for (let i = 0; i <= N; i++) { g[i] = []; for (let j = 0; j <= N; j++) { g[i][j] = pois(lh, i) * pois(la, j); tot += g[i][j]; } } for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) g[i][j] /= tot; return g; };
    const sm = (g, f) => { let s = 0; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) if (f(i, j)) s += g[i][j]; return s; };
    const g = mk(q.x, q.y);
    const hg = mk(q.x * 0.45, q.y * 0.45);
    const out = [];
    const add = (market, v) => { const e = entry(market, "single", v, null); if (e) out.push(e); };
    add("Home team over 0.5 goals", sm(g, (i) => i > 0));
    add("Home team over 1.5 goals", sm(g, (i) => i > 1));
    add("Home team under 1.5 goals", sm(g, (i) => i < 2));
    add("Away team over 0.5 goals", sm(g, (i, j) => j > 0));
    add("Away team over 1.5 goals", sm(g, (i, j) => j > 1));
    add("Away team under 1.5 goals", sm(g, (i, j) => j < 2));
    add("Handicap home -1.5", sm(g, (i, j) => i - j >= 2));
    add("Handicap away -1.5", sm(g, (i, j) => j - i >= 2));
    add("First half home", sm(hg, (i, j) => i > j));
    add("First half draw", sm(hg, (i, j) => i === j));
    add("First half away", sm(hg, (i, j) => i < j));
    add("First half over 0.5", sm(hg, (i, j) => i + j > 0.5));
    add("First half under 0.5", sm(hg, (i, j) => i + j < 0.5));
    add("First half over 1.5", sm(hg, (i, j) => i + j > 1.5));
    add("First half under 1.5", sm(hg, (i, j) => i + j < 1.5));
    return out;
  })();
  const list = [
    entry("Home win", "single", mh, has1 ? ih : null),
    entry("Draw", "single", md, has1 ? ix : null),
    entry("Away win", "single", ma, has1 ? ia : null),
    entry("Double chance 1X (home or draw)", "dc", mh != null ? mh + md : null, has1 ? ih + ix : null),
    entry("Double chance X2 (away or draw)", "dc", mh != null ? md + ma : null, has1 ? ix + ia : null),
    entry("Double chance 12 (no draw)", "dc", mh != null ? mh + ma : null, has1 ? ih + ia : null),
    entry("Over 2.5 goals", "single", mo, ou ? ou[0] : null),
    entry("Under 2.5 goals", "single", mo != null ? 1 - mo : null, ou ? ou[1] : null),
    entry("Both teams to score", "single", mb, bt ? bt[0] : null),
    entry("Both teams not to score", "single", mb != null ? 1 - mb : null, bt ? bt[1] : null)
  ].filter(Boolean).concat(gridMkts);

  // Keep the raw odds we already fetched, so the site can flag value picks
  // (our probability clearly above what the odds imply) without new API calls.
  const o = {};
  bets.forEach(b => (b.values || []).forEach(v => { if (v && v.value && parseFloat(v.odd) > 1) o[v.value] = parseFloat(v.odd); }));
  const KEYMAP = {
    "Home win": "Home", "Away win": "Away", "Draw": "Draw",
    "Over 2.5 goals": "Over 2.5", "Under 2.5 goals": "Under 2.5",
    "Both teams to score": "Yes", "Both teams not to score": "No",
    "Double chance 1X (home or draw)": "Home/Draw",
    "Double chance X2 (away or draw)": "Draw/Away",
    "Double chance 12 (no draw)": "Home/Away"
  };
  list.forEach(x => { if (KEYMAP[x.market] && o[KEYMAP[x.market]]) x.odd = o[KEYMAP[x.market]]; });
  // Guard: when the two-way odds for a market were missing the disagreement
  // check never ran, and a nonsense price can ride along (a 65% chance tagged
  // with a 4.8 price). If the attached odds imply a very different chance than
  // the blended probability, trust neither and mark the market skip.
  list.forEach(x => {
    if (x.skip || !(x.odd > 1)) return;
    if (Math.abs(x.prob - 1 / x.odd) > 0.25) x.skip = true;
  });
  return { src, list, modelOnly };
}

function reason(m) {
  const f = m.form && m.form.home && m.form.away
    ? " Recent form: " + m.home + " " + m.form.home + " vs " + m.away + " " + m.form.away + "."
    : "";
  return "Based on " + m.src + "." + f;
}

(async () => {
  const date = new Date().toISOString().slice(0, 10);
  let fx;
  try {
    const f = JSON.parse(fs.readFileSync("data/d0.json", "utf8"));
    if (f.date === date && f.response) fx = { response: f.response };
  } catch (e) {}
  if (!fx) fx = await api("/fixtures?date=" + date);
  if (fx.errors && Object.keys(fx.errors).length) {
    const msg = JSON.stringify(fx.errors);
    if (/request limit|rate/i.test(msg)) {
      console.log("API quota reached, keeping the existing picks. They rebuild on the next run: " + msg);
      return;
    }
    console.error(msg);
    process.exit(1);
  }
  const rank = m => { const i = TOP.indexOf(m.league.id); return i === -1 ? 99 : i; };
  const cands = (fx.response || [])
    .filter(m => m.fixture.status.short === "NS" && !/\bU\s?(1[5-9]|2[0-3])\b|youth|reserve/i.test(m.teams.home.name + " " + m.teams.away.name + " " + m.league.name))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 16);

  let pred = null;
  try {
    const pj = JSON.parse(fs.readFileSync("all.json", "utf8"));
    if (pj && pj.date === date && pj.m) pred = pj.m;
  } catch (e) {}

  // Odds come from one league-level request per league (the same bookmaker data
  // the per-fixture endpoint returns), shared by the featured slate and the
  // wider acca pool below. A full day of pricing therefore costs a handful of
  // calls, and per-fixture odds are only a small fallback for leagues outside
  // the cap. The old per-fixture /predictions calls are gone: the nightly model
  // in all.json covers every fixture, so those ~16 calls a day are freed.
  const yy0 = Number(date.slice(0, 4));
  const season0 = Number(date.slice(5, 7)) >= 7 ? yy0 : yy0 - 1;
  const leagueOdds = new Map();
  const LEAGUE_ODDS_CAP = 18;
  async function leagueBets(lid) {
    if (leagueOdds.has(lid)) return leagueOdds.get(lid);
    if (leagueOdds.size >= LEAGUE_ODDS_CAP) { leagueOdds.set(lid, null); return null; }
    const od = await api("/odds?league=" + lid + "&season=" + season0 + "&date=" + date);
    if (od.errors && Object.keys(od.errors).length) { leagueOdds.set(lid, null); return null; }
    const map = {};
    (od.response || []).forEach(r => {
      if (!r.fixture || !r.bookmakers) return;
      const bm = r.bookmakers.find(b => (b.bets || []).some(x => x.id === 1)) || r.bookmakers[0];
      if (bm) map[r.fixture.id] = bm.bets || [];
    });
    leagueOdds.set(lid, map);
    return map;
  }
  let fixOddsLeft = 8;

  const matches = [];
  for (const c of cands) {
    const lm = await leagueBets(c.league.id);
    let bets = lm && lm[c.fixture.id];
    if (!bets && fixOddsLeft > 0) {
      const od = await api("/odds?fixture=" + c.fixture.id);
      if (od.errors && Object.keys(od.errors).length) {
        console.log("API quota reached mid-run, keeping the existing picks.");
        break;
      }
      fixOddsLeft--;
      bets = pickBets(od);
    }
    const q = pred && pred[c.fixture.id];
    if (!q && !bets) {
      // No model entry and no odds: keep a stub so the slate stays whole.
      matches.push({
        id: c.fixture.id, league: c.league.name, country: c.league.country,
        kickoff: c.fixture.date, home: c.teams.home.name, away: c.teams.away.name,
        src: "form and statistics data", form: null, form5: null,
        cs: null, sTop: null, why: null, markets: [],
        n: null, dataQ: "unknown", cupish: false, modelOnly: true, csProb: null, csList: null
      });
      continue;
    }
    const a = analyze(q, bets || []);
    const fh = q && q.form ? String(q.form.h || "").replace(/ /g, "") : null;
    const fa = q && q.form ? String(q.form.a || "").replace(/ /g, "") : null;
    // Form as a share of points from the stored last five (3 for a win, 1 for
    // a draw), shown the same way the old comparison figure was.
    const pct = s => {
      if (!s || !s.length) return null;
      const w = s.split("W").length - 1, d = s.split("D").length - 1;
      return Math.round((3 * w + d) / (3 * s.length) * 100) + "%";
    };
    const pv = get12(a.list);
    const os = q ? null : (pv ? pickScore(c.fixture.id, pv[0], pv[1], pv[2]) : null);
    matches.push({
      id: c.fixture.id,
      league: c.league.name,
      country: c.league.country,
      kickoff: c.fixture.date,
      home: c.teams.home.name,
      away: c.teams.away.name,
      src: a.src,
      form: fh || fa ? { home: pct(fh), away: pct(fa) } : null,
      form5: { h: fh, a: fa },
      cs: q ? q.s : (os ? os.s : null),
      sTop: q ? q.st : (os ? os.st : null),
      csProb: q ? q.csP : null,
      csList: q ? q.csList : null,
      why: q ? q.why : null,
      n: q ? q.n : null,
      dataQ: q ? (q.q || "unknown") : "unknown",
      cupish: q ? !!q.cupish : false,
      modelOnly: !!a.modelOnly,
      markets: a.list.map(x => ({
        market: x.market,
        prob: Math.round(x.prob * 1000) / 1000,
        kind: x.kind,
        odd: x.odd || null,
        skip: !!x.skip
      }))
    });
  }
  if (matches.length < 2) { console.error("Not enough matches"); process.exit(1); }

  // Wider pool: every other fixture today in the leagues we follow. One
  // league-level odds request per league prices the whole slate; matches whose
  // league has no odds available are kept as model-only entries so the picks
  // list never loses them, they just carry no prices.
  let wideMatches = [];
  try {
    const d0 = JSON.parse(fs.readFileSync("data/d0.json", "utf8"));
    const todayFixtures = (d0.response || []).filter(f => f.league && TOP.includes(f.league.id));
    const featuredIds = new Set(matches.map(m => m.id));
    const byLeague = {};
    todayFixtures.forEach(f => { (byLeague[f.league.id] = byLeague[f.league.id] || []).push(f); });
    wideMatches = [];
    for (const lid of Object.keys(byLeague)) {
      const oddsByFixture = (await leagueBets(lid)) || {};
      for (const f of byLeague[lid]) {
        if (featuredIds.has(f.fixture.id)) continue;
        if (f.fixture.status && f.fixture.status.short !== "NS") continue;
        const q = pred && pred[f.fixture.id];
        if (!q) continue;
        const bets = oddsByFixture[f.fixture.id];
        const a = analyze(q, bets || []);
        wideMatches.push({
          id: f.fixture.id, league: f.league.name, country: f.league.country,
          kickoff: f.fixture.date, home: f.teams.home.name, away: f.teams.away.name,
          src: a.src, form: null,
          form5: q.form || null,
          cs: q.s || null, sTop: q.st || null, csProb: q.csP || null, csList: q.csList || null,
          why: q.why || null,
          n: q.n || null, dataQ: q.q || "unknown", cupish: !!q.cupish,
          modelOnly: !!a.modelOnly,
          markets: a.list.map(x => ({ market: x.market, prob: Math.round(x.prob * 1000) / 1000, kind: x.kind, odd: x.odd || null, skip: !!x.skip })),
          wide: true
        });
      }
    }
    console.log("Wide pool: added " + wideMatches.length + " matches beyond the featured slate (" + wideMatches.filter(m => m.modelOnly).length + " model-only).");
  } catch (e) { console.log("Wide acca pool skipped: " + (e && e.message ? e.message : e)); }

  // The full candidate pool: featured matches plus every other fixture,
  // so the Top 15 and the acca both shop the whole day, lower leagues included.
  const poolMatches = matches.concat(wideMatches);

  // Confidence cap by how much data stands behind the match. A match built on
  // very little history, or a cup or friendly where form means less, cannot
  // claim the same certainty as a well-sampled league game. These caps are
  // provisional until the calibration stage tunes them against real results.
  const capFor = m => {
    let cap = 90;
    if (m.dataQ === "thin") cap = 82;
    if (m.dataQ === "very-thin") cap = 70;
    if (m.cupish) cap = Math.min(cap, 82);
    return cap;
  };

  const picks = [];
  poolMatches.forEach(m => {
    // Best market first: rank every market by blended probability, ignore the
    // ones the model and the odds disagree on, and hold picks to a 55%
    // confidence floor so coin-flip markets never become recommendations.
    if (!(m.markets || []).length) return;
    const ranked = m.markets.filter(x => !x.skip).sort((x, y) => y.prob - x.prob);
    const usable = ranked.filter(x => x.prob >= 0.55);
    const best = usable[0] || ranked[0];
    const single = usable.find(x => x.kind === "single");
    const chosen = [best];
    if (single && single !== best) chosen.push(single);
    chosen.forEach(c => picks.push({
      fixture: m.id,
      match: m.home + " vs " + m.away,
      market: c.market,
      probability: Math.round(Math.min(capFor(m), c.prob * 100)),
      reason: m.why || reason(m),
      cs: m.cs,
      odd: c.odd || null,
      value: !!(c.odd && c.prob * c.odd >= 1.08),
      kickoff: m.kickoff,
      league: m.league,
      country: m.country,
      dataQ: m.dataQ,
      cupish: !!m.cupish,
      modelOnly: !!m.modelOnly
    }));
  });
  // Rank by the best chance per unit of odds, so safe picks with real prices
  // lead the list and the safer-but-tiny markets no longer crowd out the
  // higher-odds ones. Picks without odds fall back to raw probability.
  const valScore = p => (p.odd > 1 ? Math.log(p.probability / 100) / Math.log(p.odd) : p.probability / 100);
  picks.sort((a, b) => valScore(b) - valScore(a));
  // The banker: the day's most confident pick, tagged only when it is a real
  // banker (75% or better) AND the match has enough stored data behind it.
  // Otherwise no banker is shown that day.
  const bankerPick = picks.filter(p => p.probability >= 75 && p.dataQ === "ok" && !p.cupish).sort((a, b) => b.probability - a.probability)[0];
  if (bankerPick) bankerPick.banker = true;


  // Acca of the day: predicted on its own, never lifted from the Top 15 or
  // any other ranked list. Every priced match of the day (the featured slate
  // plus the wider pool) offers its markets here, and the builder chooses legs
  // with two passes of its own: chance per unit of odds, and pure safety. It
  // caps how many legs one league (2) or country (4) can hold so the slip is
  // not stacked on a single competition, refuses near-dead prices below 1.12,
  // and keeps the slip whose legs are jointly most likely to land with total
  // odds between 20 and 50. A shorter slip falls back to the same independent
  // pool, never the picks list. Every leg needs odds, so the market checks
  // every leg; the thin-data confidence cap keeps weak-data legs modest.
  const candAcca = [];
  poolMatches.forEach(m => {
    (m.markets || []).forEach(x => {
      if (x.skip || !(x.odd >= 1.12)) return;
      // Legs carry the same thin-data cap as the picks: a leg built on very
      // little history shows its capped confidence, and the slip's joint
      // chance is computed from those capped numbers.
      const prob = Math.min(capFor(m), Math.round(x.prob * 100));
      if (prob < 55) return;
      candAcca.push({ fixture: m.id, match: m.home + " vs " + m.away, market: x.market, odd: x.odd, probability: prob, kickoff: m.kickoff, league: m.league, country: m.country, dataQ: m.dataQ });
    });
  });
  const valS = p => Math.log(p.probability / 100) / Math.log(p.odd);
  const buildSlip = order => {
    const seenF = {}, seenLg = {}, seenCt = {};
    const legs = [];
    let total = 1;
    for (const p of order) {
      if (legs.length >= 14) break;
      if (seenF[p.fixture]) continue;
      if ((seenLg[p.league] || 0) >= 2) continue;
      if ((seenCt[p.country] || 0) >= 4) continue;
      const nt = total * p.odd;
      if (nt > 50) continue;
      legs.push(p);
      seenF[p.fixture] = 1;
      seenLg[p.league] = (seenLg[p.league] || 0) + 1;
      seenCt[p.country] = (seenCt[p.country] || 0) + 1;
      total = nt;
      if (total >= 20) break;
    }
    if (legs.length < 2) return null;
    return { legs, total, hit: legs.reduce((t, l) => t * (l.probability / 100), 1) };
  };
  const byValue = candAcca.slice().sort((a, b) => valS(b) - valS(a));
  const bySafety = candAcca.slice().sort((a, b) => (b.probability - a.probability) || (valS(b) - valS(a)));
  let accaBest = null;
  for (const order of [byValue, bySafety]) {
    const s = buildSlip(order);
    if (s && s.total >= 20) {
      const better = !accaBest
        || s.hit > accaBest.hit * 1.005
        || (s.hit >= accaBest.hit * 0.995 && s.legs.length < accaBest.legs.length);
      if (better) accaBest = s;
    }
  }
  if (!accaBest) {
    // Fallback: the strongest short combination between 1.50 and 2.00, chosen
    // from the same independent pool so the acca never borrows the picks list.
    const short = candAcca.slice().sort((a, b) => b.probability - a.probability).slice(0, 30);
    const seenS = {};
    const uniqShort = short.filter(p => (seenS[p.fixture] ? false : (seenS[p.fixture] = 1, true)));
    const consider = legs => {
      const total = legs.reduce((t, l) => t * l.odd, 1);
      if (total < 1.5 || total > 2.0) return;
      const hit = legs.reduce((t, l) => t * (l.probability / 100), 1);
      if (!accaBest || hit > accaBest.hit) accaBest = { legs, total, hit };
    };
    for (let i = 0; i < uniqShort.length; i++)
      for (let j = i + 1; j < uniqShort.length; j++) {
        consider([uniqShort[i], uniqShort[j]]);
        for (let k = j + 1; k < uniqShort.length; k++) consider([uniqShort[i], uniqShort[j], uniqShort[k]]);
      }
  }
  const mkLeg = p => ({ fixture: p.fixture, match: p.match, market: p.market, odd: p.odd, probability: p.probability, kickoff: p.kickoff, league: p.league, country: p.country, dataQ: p.dataQ });
  const acca = accaBest
    ? { legs: accaBest.legs.map(mkLeg), total: Math.round(accaBest.total * 100) / 100, chance: Math.round(accaBest.hit * 1000) / 10 }
    : null;

  fs.writeFileSync("daily.json", JSON.stringify({
    date,
    generated: new Date().toISOString(),
    matches,
    picks: picks.slice(0, 15),
    acca,
    summary: "Ranked by the best chance per unit of odds, from every league we follow. Safer picks with bigger prices lead the list, so always check the market before you decide."
  }));
  console.log("Wrote " + matches.length + " matches");

  // Head-to-head history for the featured matches: five recent meetings per
  // match, one API request each, saved into all.json for the match pages.
  try {
    const aj = JSON.parse(fs.readFileSync("all.json", "utf8"));
    if (aj && aj.date === date && aj.m) {
      const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const fmt = d => { const D = new Date(d); return D.getUTCDate() + " " + MO[D.getUTCMonth()] + " " + D.getUTCFullYear(); };
      let got = 0;
      for (const c of cands) {
        const slot = aj.m[c.fixture.id];
        if (!slot || slot.h2h) continue;
        if (got >= 10) break;
        const hh = await api("/fixtures/headtohead?h2h=" + c.teams.home.id + "-" + c.teams.away.id);
        if (hh.errors && Object.keys(hh.errors).length) { console.log("H2H stopped: " + JSON.stringify(hh.errors)); break; }
        const done = (hh.response || []).filter(x => x.fixture.status.short === "FT").slice(-5);
        if (!done.length) continue;
        const list = done.map(x => ({ d: fmt(x.fixture.date), sh: x.goals.home, sa: x.goals.away }));
        let hw = 0, dr = 0, aw = 0;
        done.forEach(x => {
          const thisHome = x.teams.home.id === c.teams.home.id;
          const gh = thisHome ? x.goals.home : x.goals.away, ga = thisHome ? x.goals.away : x.goals.home;
          if (gh > ga) hw++; else if (gh === ga) dr++; else aw++;
        });
        slot.h2h = { list, hw, dr, aw };
        got++;
      }
      if (got) {
        fs.writeFileSync("all.json", JSON.stringify(aj));
        console.log("H2H added for " + got + " matches");
      }
    }
  } catch (e) { console.log("H2H skipped: " + e.message); }
})();
