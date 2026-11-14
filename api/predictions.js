module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  res.status(200).json({ response: [] });
};
