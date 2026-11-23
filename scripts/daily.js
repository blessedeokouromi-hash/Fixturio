const fs = require("fs");

// Scoreline consistency: the predicted score must agree with the same H/D/A
// probabilities the picks use, not drift off a cold model. Fit a Dixon-Coles
// Poisson (same correction as all.js) to the blended probabilities, then pick
// the modal scoreline for the top outcome.
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
const num = v => parseFloat(String(v == null ? "" : v).replace("%", "")) || 0;

const budget = require("./api-budget");
async function api(path) {
  budget.gate();
  const r = await fetch("https://v3.football.api-sports.io" + path,
    { headers: { "x-apisports-key": KEY } });
  budget.track(path);
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

function analyze(p, bets, q) {
  const pc = p.predictions.percent || {};
  let ph = num(pc.home), pd = num(pc.draw), pa = num(pc.away);
  const s = ph + pd + pa;
  if (s > 0) { ph /= s; pd /= s; pa /= s; } else { ph = pd = pa = 1 / 3; }

  const w = bets.find(b => b.id === 1);
  const o1 = {};
  if (w) (w.values || []).forEach(v => { o1[v.value] = parseFloat(v.odd); });
  const has1 = o1.Home > 1 && o1.Draw > 1 && o1.Away > 1;
  let ih, ix, ia;
  if (has1) {
    ih = 1 / o1.Home; ix = 1 / o1.Draw; ia = 1 / o1.Away;
    const t = ih + ix + ia; ih /= t; ix /= t; ia /= t;
  }

  // Our own nightly score simulation (all.json): the model's view of this
  // match, independent of what the bookmakers price.
  const mh = q ? q.h / 100 : null, md = q ? q.d / 100 : null, ma = q ? q.a / 100 : null;
  const mo = q ? q.o / 100 : null; // over 2.5 from the model
  const mb = q ? q.b / 100 : null; // both teams to score, yes

  let src;
  if (mh != null && has1) src = "our score model blended with bookmaker odds";
  else if (mh != null) src = "our score model, built from recent results";
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
  const ou = twoWay(bets.find(b => b.id === 5), "Over 2.5", "Under 2.5");
  const bt = twoWay(bets.find(b => b.id === 8), "Yes", "No");
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
  ].filter(Boolean);

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
  return { src, list };
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
  // the cap.
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
    const pr = await api("/predictions?fixture=" + c.fixture.id);
    if (pr.errors && Object.keys(pr.errors).length) {
      console.log("API quota reached mid-run, keeping the existing picks.");
      break;
    }
    const p = pr.response && pr.response[0];
    if (!p) continue;
    const lm = await leagueBets(c.league.id);
    let bets = lm && lm[c.fixture.id];
    if (!bets) {
      if (fixOddsLeft <= 0) continue;
      const od = await api("/odds?fixture=" + c.fixture.id);
      if (od.errors && Object.keys(od.errors).length) {
        console.log("API quota reached mid-run, keeping the existing picks.");
        break;
      }
      fixOddsLeft--;
      bets = pickBets(od);
    }
    const a = analyze(p, bets);
    const q = pred && pred[c.fixture.id];
    const okForm = f => /^[WDL ]{1,9}$/.test(String(f || "")) ? String(f).replace(/ /g, "") : null;
    const hf = okForm(p.teams && p.teams.home && p.teams.home.league ? p.teams.home.league.form : "");
    const af = okForm(p.teams && p.teams.away && p.teams.away.league ? p.teams.away.league.form : "");
    const f5h = hf || (q && q.form && q.form.h ? String(q.form.h).replace(/ /g, "").slice(-5) : null);
    const f5a = af || (q && q.form && q.form.a ? String(q.form.a).replace(/ /g, "").slice(-5) : null);
    const pv = get12(a.list);
    const os = pv ? pickScore(c.fixture.id, pv[0], pv[1], pv[2]) : null;
    matches.push({
      id: c.fixture.id,
      league: c.league.name,
      country: c.league.country,
      kickoff: c.fixture.date,
      home: c.teams.home.name,
      away: c.teams.away.name,
      src: a.src,
      form: p.comparison && p.comparison.form ? p.comparison.form : null,
      form5: { h: f5h, a: f5a },
      cs: os ? os.s : (q ? q.s : null),
      sTop: os ? os.st : (q ? q.st : null),
      why: q ? q.why : null,
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

  // Wider pool: the featured slate carries per-fixture odds, but the day has
  // hundreds of other fixtures in the leagues we already follow. One
  // league-level odds request per league (the same endpoint, one call instead
  // of one per match) prices the whole slate without new per-fixture API
  // calls: the nightly model in all.json already holds every fixture's chances.
  let wideMatches = [];
  // Wider acca pool: the featured matches above carry per-fixture odds, but the
  // day has hundreds of other fixtures in the leagues we already follow. One
  // league-level odds request per league (the same endpoint, one call instead
  // of one per match) unlocks safe legs from the whole slate without new
  // per-fixture API calls: the nightly model in all.json already holds every
  // fixture's chances, so all we need is the prices.
  try {
    const d0 = JSON.parse(fs.readFileSync("data/d0.json", "utf8"));
    const todayFixtures = (d0.response || []).filter(f => f.league && TOP.includes(f.league.id));
    const featuredIds = new Set(matches.map(m => m.id));
    const byLeague = {};
    todayFixtures.forEach(f => { (byLeague[f.league.id] = byLeague[f.league.id] || []).push(f); });
    const yy = Number(date.slice(0, 4));
    const season = Number(date.slice(5, 7)) >= 7 ? yy : yy - 1;
    wideMatches = [];
    let wideLeagues = 0;
    for (const lid of Object.keys(byLeague)) {
      const oddsByFixture = (await leagueBets(lid)) || {};
      wideLeagues++;
      if (!Object.keys(oddsByFixture).length) { console.log("Wide pool: odds unavailable for league " + lid + ", skipping."); continue; }
      for (const f of byLeague[lid]) {
        if (featuredIds.has(f.fixture.id)) continue;
        if (f.fixture.status && f.fixture.status.short !== "NS") continue;
        const q = pred && pred[f.fixture.id];
        if (!q) continue;
        const bets = oddsByFixture[f.fixture.id];
        if (!bets) continue;
        const p = { predictions: { percent: { home: q.h + "%", draw: q.d + "%", away: q.a + "%" } }, comparison: { form: null } };
        const a = analyze(p, bets, q);
        wideMatches.push({
          id: f.fixture.id, league: f.league.name, country: f.league.country,
          kickoff: f.fixture.date, home: f.teams.home.name, away: f.teams.away.name,
          src: a.src, form: null, form5: q.form || null, cs: q.s || null, sTop: q.st || null, why: q.why || null,
          markets: a.list.map(x => ({ market: x.market, prob: Math.round(x.prob * 1000) / 1000, kind: x.kind, odd: x.odd || null, skip: !!x.skip })),
          wide: true
        });
      }
    }
    console.log("Wide pool: added " + wideMatches.length + " priced matches beyond the featured slate.");
  } catch (e) { console.log("Wide acca pool skipped: " + (e && e.message ? e.message : e)); }

  // The full candidate pool: featured matches plus every other priced fixture,
  // so the Top 15 and the acca both shop the whole day, lower leagues included.
  const poolMatches = matches.concat(wideMatches);

  const picks = [];
  poolMatches.forEach(m => {
    // Best market first: rank every market by blended probability, ignore the
    // ones the model and the odds disagree on, and hold picks to a 55%
    // confidence floor so coin-flip markets never become recommendations.
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
      probability: Math.round(Math.min(90, c.prob * 100)),
      reason: m.why || reason(m),
      cs: m.cs,
      odd: c.odd || null,
      value: !!(c.odd && c.prob * c.odd >= 1.08),
      kickoff: m.kickoff,
      league: m.league,
      country: m.country
    }));
  });
  // Rank by the best chance per unit of odds, so safe picks with real prices
  // lead the list and the safer-but-tiny markets no longer crowd out the
  // higher-odds ones. Picks without odds fall back to raw probability.
  const valScore = p => (p.odd > 1 ? Math.log(p.probability / 100) / Math.log(p.odd) : p.probability / 100);
  picks.sort((a, b) => valScore(b) - valScore(a));
  // The banker: the day's most confident pick, tagged only when it is a real
  // banker (75% or better). Otherwise no banker is shown that day.
  const bankerPick = picks.filter(p => p.probability >= 75).sort((a, b) => b.probability - a.probability)[0];
  if (bankerPick) bankerPick.banker = true;


  // Acca of the day: predicted on its own, never lifted from the Top 15 or
  // any other ranked list. Every priced match of the day (the featured slate
  // plus the wider pool) offers its markets here, and the builder chooses legs
  // with two passes of its own: chance per unit of odds, and pure safety. It
  // caps how many legs one league (2) or country (4) can hold so the slip is
  // not stacked on a single competition, refuses near-dead prices below 1.12,
  // and keeps the slip whose legs are jointly most likely to land with total
  // odds between 20 and 50. A shorter slip falls back to the same independent
  // pool, never the picks list.
  const candAcca = [];
  poolMatches.forEach(m => {
    (m.markets || []).forEach(x => {
      if (x.skip || !(x.odd >= 1.12)) return;
      const prob = Math.round(x.prob * 100);
      if (prob < 55) return;
      candAcca.push({ fixture: m.id, match: m.home + " vs " + m.away, market: x.market, odd: x.odd, probability: prob, kickoff: m.kickoff, league: m.league, country: m.country });
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
  const mkLeg = p => ({ fixture: p.fixture, match: p.match, market: p.market, odd: p.odd, probability: p.probability, kickoff: p.kickoff, league: p.league, country: p.country });
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
