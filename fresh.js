(function () {
  if (typeof load !== "function") return;
  window.load = function () {
    var d0 = day;
    fetch("/api/matches?date=" + dateStr(day)).then(function (r) { return r.json(); }).then(function (d) {
      if (d0 !== day) return;
      data = d.response || [];
      failed = (!data.length && d.errors && Object.keys(d.errors).length) ? "Match data is temporarily unavailable. Please try again in a few minutes." : "";
      loaded = true;
      render();
      var g = d.generated ? new Date(d.generated) : new Date();
      $("upd").textContent = "Scores as of " + tm(g);
    }).catch(function () {
      if (d0 !== day) return;
      failed = "Matches could not be loaded. Check your connection and reload.";
      loaded = true;
      render();
    });
  };
  load();
})();
