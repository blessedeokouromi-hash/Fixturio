// Stage 4: nightly self-recalibration. Replays the stored match history in
// date order (the model only sees results from before the match it predicts),
// sweeps a small grid around the current constants, and records the result in
// grading.json. A constant change is applied only when the same better setting
// has won the validation days seven nights in a row by a clear margin, so one
// lucky weekend can never rewrite the engine.
const fs = require("fs");
const { execSync } = require("child_process");

const K_TEAM = 8, K_FORM = 4, W_FORM = 0.30, THIN_CAPS = { ok: 90, thin: 82, very: 70 };
const GRID = [];
[20, 50, 100].forEach(kl => [0.75, 0.80, 0.85].forEach(dc => [-0.05, 0, 0.05].forEach(rho =>
  GRID.push({ kl: kl, dc: dc, rho: rho }))));

function load(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return fb; } }
function iso(t) { return new Date(t).toISOString().slice(0, 10); }
function dayMs(d) { return new Date(d + "T00:00:00Z").getTime(); }

function pois(l, k) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }

// One 10x10 score matrix per lambda pair; markets read off it.
function matrix(lh, la, rho) {
  const cells = [];
  for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) {
    let p = pois(lh, i) * pois(la, j);
    if (i === 0 && j === 0) p *= 1 - lh * la * rho;
    else if ((i === 0 && j === 1) || (i === 1 && j === 0)) p *= 1 + rho;
    else if (i === 1 && j === 1) p *= 1 - rho;
    if (p < 0) p = 0;
    cells.push(p);
  }
  let tot = 0; for (const p of cells) tot += p;
  let ph = 0, pd = 0;
  for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) {
    const p = cells[i * 10 + j] / tot;
    if (i > j) ph += p; else if (i === j) pd += p;
  }
  return { ph: ph, pd: pd, pa: 1 - ph - pd };
}

// Walk-forward strengths for one evaluation date, from one config.
function strengths(days, evalDate, cfg) {
  const now = dayMs(evalDate);
  const L = {}; let gn = 0, ghg = 0, gag = 0;
  const T = {}; const F = {};
  const ago = d => Math.round((now - dayMs(d)) / 864e5);
  Object.keys(days).forEach(d => {
    if (d >= evalDate) return;
    const a = ago(d), w0 = Math.pow(cfg.dc, Math.max(0, a));
    days[d].forEach(r => {
      const lg = r[0], h = r[1], aw = r[2], hg = r[3], ag = r[4];
      const l = L[lg] || (L[lg] = { n: 0, h: 0, a: 0 });
      l.n += w0; l.h += w0 * hg; l.a += w0 * ag;
      gn += w0; ghg += w0 * hg; gag += w0 * ag;
      const H = T[h] || (T[h] = { nh: 0, gh: 0, cgH: 0, na: 0, ga: 0, cgA: 0 });
      const A = T[aw] || (T[aw] = { nh: 0, gh: 0, cgH: 0, na: 0, ga: 0, cgA: 0 });
      H.nh += w0; H.gh += w0 * hg; H.cgH += w0 * ag;
      A.na += w0; A.ga += w0 * ag; A.cgA += w0 * hg;
      (F[h] = F[h] || []).push({ ago: a, gf: hg, ga: ag, lg: lg, home: true });
      (F[aw] = F[aw] || []).push({ ago: a, gf: ag, ga: hg, lg: lg, home: false });
    });
  });
  const G = { h: gn > 0 ? ghg / gn : 1.4, a: gn > 0 ? gag / gn : 1.1 };
  const lavCache = {};
  function lgAv(lid) {
    if (lavCache[lid]) return lavCache[lid];
    const l = L[lid];
    const v = (!l || l.n <= 0) ? G : {
      h: (l.h + G.h * cfg.kl) / (l.n + cfg.kl) || G.h,
      a: (l.a + G.a * cfg.kl) / (l.n + cfg.kl) || G.a
    };
    lavCache[lid] = v;
    return v;
  }
  function formRatios(id) {
    const list = (F[id] || []).slice().sort((x, y) => x.ago - y.ago).slice(-6);
    if (!list.length) return null;
    let att = 0, def = 0, sw = 0;
    list.forEach(m => {
      const av = lgAv(m.lg), w = Math.pow(cfg.dc, Math.max(0, m.ago));
      att += w * (m.home ? m.gf / av.h : m.gf / av.a);
      def += w * (m.home ? m.ga / av.a : m.ga / av.h);
      sw += w;
    });
    if (sw <= 0) return null;
    return { att: (att + K_FORM) / (sw + K_FORM), def: (def + K_FORM) / (sw + K_FORM), w: sw };
  }
  return { T: T, lgAv: lgAv, formRatios: formRatios, G: G };
}

function predictOne(st, lg, hid, aid, cfg) {
  const av = st.lgAv(lg);
  const H = st.T[hid], A = st.T[aid];
  const fH = st.formRatios(hid), fA = st.formRatios(aid);
  const blend = (f, base, key) => f ? (1 - W_FORM * Math.min(1, f.w / 6)) * base + W_FORM * Math.min(1, f.w / 6) * f[key] : base;
  const attH = H && H.nh > 0 ? (H.gh + K_TEAM * av.h) / (H.nh + K_TEAM) / av.h : 1;
  const defH = H && H.nh > 0 ? (H.cgH + K_TEAM * av.a) / (H.nh + K_TEAM) / av.a : 1;
  const attA = A && A.na > 0 ? (A.ga + K_TEAM * av.a) / (A.na + K_TEAM) / av.a : 1;
  const defA = A && A.na > 0 ? (A.cgA + K_TEAM * av.h) / (A.na + K_TEAM) / av.h : 1;
  let lh = av.h * blend(fH, attH, "att") * blend(fA, defA, "def");
  let la = av.a * blend(fA, attA, "att") * blend(fH, defH, "def");
  lh = Math.min(3.5, Math.max(0.2, lh));
  la = Math.min(3.5, Math.max(0.2, la));
  return matrix(lh, la, cfg.rho);
}

function sweep(days, evalDates, cfg) {
  const trainDates = evalDates.slice(0, -2), valDates = evalDates.slice(-2);
  const run = dates => {
    let n = 0, B = 0, hits = 0;
    dates.forEach(D => {
      const st = strengths(days, D, cfg);
      days[D].forEach(r => {
        const m = predictOne(st, r[0], r[1], r[2], cfg);
        const yh = r[3] > r[4] ? 1 : 0, yd = r[3] === r[4] ? 1 : 0, ya = r[4] > r[3] ? 1 : 0;
        B += ((m.ph - yh) * (m.ph - yh) + (m.pd - yd) * (m.pd - yd) + (m.pa - ya) * (m.pa - ya)) / 3;
        const best = m.ph >= m.pd && m.ph >= m.pa ? "H" : (m.pd >= m.pa ? "D" : "A");
        if ((best === "H" && yh) || (best === "D" && yd) || (best === "A" && ya)) hits++;
        n++;
      });
    });
    return { n: n, brier: n ? B / n * 100 : 999, hit: n ? hits / n * 100 : 0 };
  };
  const tr = run(trainDates), va = run(valDates);
  return { cfg: cfg, trainN: tr.n, trainB: +tr.brier.toFixed(2), trainHit: +tr.hit.toFixed(1), valN: va.n, valB: +va.brier.toFixed(2), valHit: +va.hit.toFixed(1) };
}

function currentConstants() {
  const src = fs.readFileSync("scripts/all.js", "utf8");
  const num = re => { const m = src.match(re); return m ? parseFloat(m[1]) : null; };
  return { kl: num(/const K_LEAGUE = ([-\d.]+);/), dc: num(/const DECAY = ([-\d.]+);/), rho: num(/const RHO = ([-\d.]+);/) };
}

function applyConstants(cfg, cur) {
  let a = fs.readFileSync("scripts/all.js", "utf8");
  const d = fs.readFileSync("scripts/daily.js", "utf8");
  const a0 = a, d0 = d;
  try {
    a = a.replace(/const K_LEAGUE = [-\d.]+;/, "const K_LEAGUE = " + cfg.kl + ";");
    a = a.replace(/const DECAY = [-\d.]+;/, "const DECAY = " + cfg.dc + ";");
    a = a.replace(/const RHO = [-\d.]+;/, "const RHO = " + cfg.rho + ";");
    const d2 = d.replace(/const RHO = [-\d.]+;/, "const RHO = " + cfg.rho + ";");
    fs.writeFileSync("scripts/all.js", a);
    fs.writeFileSync("scripts/daily.js", d2);
    execSync("node --check scripts/all.js && node --check scripts/daily.js", { stdio: "ignore" });
    return true;
  } catch (e) {
    fs.writeFileSync("scripts/all.js", a0);
    fs.writeFileSync("scripts/daily.js", d0);
    return false;
  }
}

module.exports = async function recalibrate() {
  const db = load("teamdata.json", null);
  if (!db || !db.days) { console.log("Recalibration skipped: no team history"); return; }
  const cur = currentConstants();
  const allDates = Object.keys(db.days).sort();
  const evalDates = allDates.filter((d, i) => i > 0 && d > allDates[0]).slice(-14);
  if (evalDates.length < 3) { console.log("Recalibration skipped: not enough history yet"); return; }
  const table = GRID.map(cfg => sweep(db.days, evalDates, cfg));
  const curRow = table.find(r => r.cfg.kl === cur.kl && r.cfg.dc === cur.dc && r.cfg.rho === cur.rho)
    || sweep(db.days, evalDates, cur);
  const best = table.reduce((a, b) => (b.valB < a.valB ? b : a));
  const margin = +(curRow.valB - best.valB).toFixed(2);
  const same = r => r.cfg.kl === best.cfg.kl && r.cfg.dc === best.cfg.dc && r.cfg.rho === best.cfg.rho;
  const gr = load("grading.json", {});
  const refit = gr.refit || { streak: 0, pending: null, history: [] };
  const bestKey = "kl" + best.cfg.kl + ",dc" + best.cfg.dc + ",rho" + best.cfg.rho;
  if (bestKey === refit.pending) refit.streak = (refit.streak || 0) + 1;
  else { refit.streak = 1; refit.pending = bestKey; }
  let applied = false;
  if (refit.streak >= 7 && margin >= 0.3 && best.trainB <= curRow.trainB && !same(curRow)) {
    applied = applyConstants(best.cfg, cur);
    refit.history.push({ date: iso(Date.now()), applied: applied, from: cur, to: best.cfg, margin: margin });
    refit.history = refit.history.slice(-20);
    if (applied) { refit.streak = 0; refit.pending = null; }
    console.log("Recalibration " + (applied ? "APPLIED new constants" : "failed to apply") + ": " + bestKey + " (margin " + margin + ")");
  }
  table.sort((x, y) => x.valB - y.valB);
  refit.updated = new Date().toISOString();
  refit.current = cur;
  refit.best = best.cfg;
  refit.margin = margin;
  refit.table = table.slice(0, 10).map(r => ({ kl: r.cfg.kl, dc: r.cfg.dc, rho: r.cfg.rho, trainB: r.trainB, valB: r.valB, valHit: r.valHit }));
  gr.refit = refit;
  fs.writeFileSync("grading.json", JSON.stringify(gr));
  console.log("Recalibration swept " + GRID.length + " settings over " + evalDates.length + " days; best " + bestKey + " (current margin " + margin + ", streak " + refit.streak + ")");
};

if (require.main === module) module.exports().catch(e => { console.error("Recalibration error: " + e.message); });
