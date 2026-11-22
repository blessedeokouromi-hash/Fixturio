(function () {
  var FLAGS = {
    "England":"\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    "Scotland":"\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
    "Wales":"\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
    "Spain":"\u{1F1EA}\u{1F1F8}","Italy":"\u{1F1EE}\u{1F1F9}","Germany":"\u{1F1E9}\u{1F1EA}",
    "France":"\u{1F1EB}\u{1F1F7}","Netherlands":"\u{1F1F3}\u{1F1F1}","Portugal":"\u{1F1F5}\u{1F1F9}",
    "Belgium":"\u{1F1E7}\u{1F1EA}","Turkey":"\u{1F1F9}\u{1F1F7}","Brazil":"\u{1F1E7}\u{1F1F7}",
    "Argentina":"\u{1F1E6}\u{1F1F7}","Mexico":"\u{1F1F2}\u{1F1FD}","USA":"\u{1F1FA}\u{1F1F8}",
    "Nigeria":"\u{1F1F3}\u{1F1EC}","Ghana":"\u{1F1EC}\u{1F1ED}","Egypt":"\u{1F1EA}\u{1F1EC}",
    "Morocco":"\u{1F1F2}\u{1F1E6}","South Africa":"\u{1F1FF}\u{1F1E6}","Kenya":"\u{1F1F0}\u{1F1EA}",
    "Japan":"\u{1F1EF}\u{1F1F5}","South Korea":"\u{1F1F0}\u{1F1F7}","China PR":"\u{1F1E8}\u{1F1F3}",
    "Australia":"\u{1F1E6}\u{1F1FA}","Saudi Arabia":"\u{1F1F8}\u{1F1E6}","Qatar":"\u{1F1F6}\u{1F1E6}",
    "Greece":"\u{1F1EC}\u{1F1F7}","Poland":"\u{1F1F5}\u{1F1F1}","Austria":"\u{1F1E6}\u{1F1F9}",
    "Switzerland":"\u{1F1E8}\u{1F1ED}","Denmark":"\u{1F1E9}\u{1F1F0}","Sweden":"\u{1F1F8}\u{1F1EA}",
    "Norway":"\u{1F1F3}\u{1F1F4}","Russia":"\u{1F1F7}\u{1F1FA}","Ukraine":"\u{1F1FA}\u{1F1E6}",
    "Croatia":"\u{1F1ED}\u{1F1F7}","Serbia":"\u{1F1F7}\u{1F1F8}","Romania":"\u{1F1F7}\u{1F1F4}",
    "Hungary":"\u{1F1ED}\u{1F1FA}","Ireland":"\u{1F1EE}\u{1F1EA}","Colombia":"\u{1F1E8}\u{1F1F4}",
    "Chile":"\u{1F1E8}\u{1F1F1}","Uruguay":"\u{1F1FA}\u{1F1FE}","Indonesia":"\u{1F1EE}\u{1F1E9}",
    "India":"\u{1F1EE}\u{1F1F3}","World":"\u{1F30D}","Europe":"\u{1F30D}"
  };
  var INK = "#0B1220", S1 = "#121B2E", TX = "#E8EDF7", MU = "#93A0BA", AMB = "#F5B544";

  function hhmm(d) {
    return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  function flag(c) { return FLAGS[c] || "\u26BD"; }
  window.flagName = flag;
  function rr(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b);
    x.arcTo(a + w, b, a + w, b + h, r);
    x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r);
    x.arcTo(a, b, a + w, b, r);
    x.closePath();
  }

  function draw(rows, dateLine) {
    var W = 1080, P = 60, RH = 122, headH = 250, footH = 170;
    var H = headH + rows.length * RH + footH;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var x = c.getContext("2d");
    x.fillStyle = INK; x.fillRect(0, 0, W, H);

    x.fillStyle = AMB; rr(x, P, 64, 74, 74, 18); x.fill();
    x.strokeStyle = INK; x.lineWidth = 7;
    x.beginPath(); x.arc(P + 37, 101, 15, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(P + 37, 72); x.lineTo(P + 37, 130); x.stroke();

    x.fillStyle = TX;
    x.font = "800 46px Manrope, system-ui, sans-serif";
    x.fillText("Fixturio", P + 94, 102);
    x.fillStyle = MU;
    x.font = "600 27px Manrope, system-ui, sans-serif";
    x.fillText("Top 15 picks  \u00B7  " + dateLine, P + 96, 138);

    x.font = "700 24px Manrope, system-ui, sans-serif";
    x.fillStyle = MU;
    x.fillText("Estimated chance each pick lands, from odds and form.", P, 182);

    var y = headH;
    rows.forEach(function (p, i) {
      var bh = RH - 14;
      x.fillStyle = S1; rr(x, P, y, W - P * 2, bh, 16); x.fill();
      x.fillStyle = AMB;
      x.font = "800 34px Manrope, system-ui, sans-serif";
      x.textBaseline = "top";
      x.fillText(String(i + 1), P + 24, y + 34);
      var lx = P + 78;
      x.fillStyle = TX;
      x.font = "800 36px Manrope, system-ui, sans-serif";
      x.fillText(p.match, lx, y + 18, W - P * 2 - lx - 150);
      x.fillStyle = AMB;
      x.font = "800 30px Manrope, system-ui, sans-serif";
      x.fillText(p.market, lx, y + 58, W - P * 2 - lx - 150);
      x.fillStyle = MU;
      x.font = "600 24px Manrope, system-ui, sans-serif";
      var lg = flag(p.country) + " " + p.league + (p.country ? " \u00B7 " + p.country : "") + " \u00B7 " + hhmm(p.kickoff);
      x.fillText(lg, lx, y + 88, W - P * 2 - lx - 150);
      x.fillStyle = TX;
      x.font = "800 46px Manrope, system-ui, sans-serif";
      x.textAlign = "right";
      x.fillText(p.probability + "%", W - P - 28, y + 34);
      x.textAlign = "left";
      y += RH;
    });

    y += 8;
    x.fillStyle = MU;
    x.font = "600 25px Manrope, system-ui, sans-serif";
    x.fillText("18+ only. Predictions are estimates, not guarantees.", P, y);
    x.fillStyle = AMB;
    x.font = "800 27px Manrope, system-ui, sans-serif";
    x.fillText("fixturio.vercel.app", P, y + 38);
    return c;
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#0B1220;color:#E8EDF7;font:700 14px Manrope,system-ui,sans-serif;padding:12px 18px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:99999";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  function shareImage() {
    if (typeof picks === "undefined" || !picks || !picks.length) { toast("Picks are still loading. Try again in a moment."); return; }
    var ready = document.fonts && document.fonts.load
      ? document.fonts.load("800 40px Manrope").catch(function () {})
      : Promise.resolve();
    ready.then(function () {
      var dateLine = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
      var c = draw(picks.slice(0, 15), dateLine);
      c.toBlob(function (b) {
        if (!b) return;
        var f = null;
        try { f = new File([b], "fixturio-top15.png", { type: "image/png" }); } catch (e) {}
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: "Fixturio Top 15", text: "Today\u2019s football picks" }).then(function () {
            toast("Shared. Nice one.");
          }).catch(function () {
            toast("Share cancelled. Use Share as image again to save it instead.");
          });
          return;
        }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = "fixturio-top15.png";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        toast("Image saved. Check your downloads or gallery.");
      }, "image/png");
    });
  }
  window.shareImage = shareImage;
})();
