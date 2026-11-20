// Ad impression beacon. Counts nothing yet: this stub logs and returns 204, and
// revenue/analytics reporting is wired to a real store in the next stage.
module.exports = (req, res) => {
  const zone = String(req.query.zone || "unknown").replace(/[^a-z]/gi, "").slice(0, 20);
  console.log(JSON.stringify({ t: "ad_impression", zone, at: new Date().toISOString(), ua: (req.headers["user-agent"] || "").slice(0, 120) }));
  res.status(204).end();
};
