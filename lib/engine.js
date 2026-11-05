const num = v => parseFloat(String(v == null ? "" : v).replace("%", "")) || 0;

async function getJSON(url) {
  try { return await (await fetch(url)).json(); } catch (e) { return null; }
}

async function getMatch(base, id, meta) {
  const pj = await getJSON(base + "/api/predictions?fixture=" + id);
  const p = pj && pj.response && pj.response[0];
  if (!p) return null;
  const oj = await getJSON(base + "/api/odds?fixture=" + id);
  return {
    id,
    league: (meta && meta.league) || (p.league && p.league.name) || "",
    kickoff: meta && meta.kickoff,
    home: p.teams.home.name,
    away: p.teams.away.name,
    pct: p.predictions.percent || {},
    form: p.comparison && p.comparison.form,
    bets: (oj && oj.bets) || []
  };
}

async function loadAll(base, items) {
  const out = [];
  for (let i = 0; i < items.length; i += 5) {
    const chunk = items.slice(i, i + 5);
    out.push(...await Promise.all(chunk.map(it => getMatch(base, it.id, it))));
  }
  return out.filter(Boolean);
}

function probs(m) {
  let h = num(m.pct.home), d = num(m.pct.draw), a = num(m.pct.away);
  const s = h + d + a;
  if (s > 0) { h /= s; d /= s; a /= s; } else { h = d = a = 1 / 3; }
  let src = "form and statistics data";
  const w = m.bets.find(b => b.id === 1);
  if (w) {
    const o = {};
    (w.values || []).forEach(v => { o[v.value] = parseFloat(v.odd); });
    if (o.Home > 1 && o.Draw > 1 && o.Away > 1) {
      const ih = 1 / o.Home, ix = 1 / o.Draw, ia = 1 / o.Away;
      const t = ih + ix + ia;
      h = 0.7 * (ih / t) + 0.3 * h;
      d = 0.7 * (ix / t) + 0.3 * d;
      a = 0.7 * (ia / t) + 0.3 * a;
      src = "bookmaker odds blended with form data";
    }
  }
  return { h, d, a, src };
}

function twoWay(bet, k1, k2) {
  if (!bet) return null;
  const o = {};
  (bet.values || []).forEach(v => { o[v.value] = parseFloat(v.odd); });
  if (!(o[k1] > 1 && o[k2] > 1)) return null;
  const x = 1 / o[k1], y = 1 / o[k2];
  return [x / (x + y), y / (x + y)];
}

function markets(m) {
  const p = probs(m);
  const list = [
    { market: "Home win", prob: p.h, kind: "single" },
    { market: "Away win", prob: p.a, kind: "single" },
    { market: "Double chance 1X (home or draw)", prob: p.h + p.d, kind: "dc" },
    { market: "Double chance X2 (away or draw)", prob: p.d + p.a, kind: "dc" },
    { market: "Double chance 12 (no draw)", prob: p.h + p.a, kind: "dc" }
  ];
  const ou = twoWay(m.bets.find(b => b.id === 5), "Over 2.5", "Under 2.5");
  if (ou) {
    list.push({ market: "Over 2.5 goals", prob: ou[0], kind: "single" });
    list.push({ market: "Under 2.5 goals", prob: ou[1], kind: "single" });
  }
  const bt = twoWay(m.bets.find(b => b.id === 8), "Yes", "No");
  if (bt) {
    list.push({ market: "Both teams to score", prob: bt[0], kind: "single" });
    list.push({ market: "Both teams not to score", prob: bt[1], kind: "single" });
  }
  return { list, src: p.src };
}

function byProb(arr) {
  return arr.slice().sort((x, y) => y.prob - x.prob);
}

function choose(list, risk) {
  const all = byProb(list);
  const singles = byProb(list.filter(x => x.kind === "single"));
  if (risk === "risky") return singles[0] || all[0];
  if (risk === "balanced") {
    const s = singles[0];
    return s && s.prob >= 0.55 ? s : all[0];
  }
  return all[0];
}

function reason(m, src) {
  const f = m.form && m.form.home && m.form.away
    ? " Recent form: " + m.home + " " + m.form.home + " vs " + m.away + " " + m.form.away + "."
    : "";
  return "Based on " + src + "." + f;
}

module.exports = { loadAll, markets, choose, byProb, reason };
