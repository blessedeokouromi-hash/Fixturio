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
    "Australia":"\u{1F1E6}\u{1F1FA}","Saudi Arabia":"\u{1F1F8}\u{1F1E6}","Qatar":"\u{1F1F6}\u{1F1F6}",
    "Greece":"\u{1F1EC}\u{1F1F7}","Poland":"\u{1F1F5}\u{1F1F1}","Austria":"\u{1F1E6}\u{1F1F9}",
    "Switzerland":"\u{1F1E8}\u{1F1ED}","Denmark":"\u{1F1E9}\u{1F1F0}","Sweden":"\u{1F1F8}\u{1F1EA}",
    "Norway":"\u{1F1F3}\u{1F1F4}","Russia":"\u{1F1F7}\u{1F1FA}","Ukraine":"\u{1F1FA}\u{1F1E6}",
    "Croatia":"\u{1F1ED}\u{1F1F7}","Serbia":"\u{1F1F7}\u{1F1F8}","Romania":"\u{1F1F7}\u{1F1F4}",
    "Hungary":"\u{1F1ED}\u{1F1FA}","Ireland":"\u{1F1EE}\u{1F1EA}","Colombia":"\u{1F1E8}\u{1F1F2}",
    "Chile":"\u{1F1E8}\u{1F1F1}","Uruguay":"\u{1F1FA}\u{1F1FE}","Indonesia":"\u{1F1EE}\u{1F1E9}",
    "India":"\u{1F1EE}\u{1F1F3}","World":"\u{1F30D}","Europe":"\u{1F30D}"
  };
  var INK = "#0B1220", CARD = "#131C30", GREEN = "#123F33", TX = "#E8EDF7", MU = "#8B98B4", AMB = "#F5B544";

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
  function clip(x, a, b, w, h, r, draw) {
    x.save();
    rr(x, a, b, w, h, r); x.clip();
    draw();
    x.restore();
  }
  function fit(x, text, weight, size, maxW) {
    for (;;) {
      x.font = weight + " " + size + "px Manrope, system-ui, sans-serif";
      if (x.measureText(text).width <= maxW || size <= 20) return;
      size -= 2;
    }
  }

  function draw(rows, dateLine, logoImg) {
    var W = 1080, H = 1920, P = 64;
    var RH = 118, N = Math.min(rows.length, 12);
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var x = c.getContext("2d");

    // Background
    x.fillStyle = INK; x.fillRect(0, 0, W, H);

    // Header band, the app's green
    x.fillStyle = GREEN; x.fillRect(0, 0, W, 300);
    x.fillStyle = AMB; x.fillRect(0, 300, W, 6);

    if (logoImg && logoImg.complete && logoImg.naturalWidth) {
      clip(x, P, 64, 130, 130, 30, function () { x.drawImage(logoImg, P, 64, 130, 130); });
      x.strokeStyle = "rgba(255,255,255,0.25)"; x.lineWidth = 3;
      rr(x, P, 64, 130, 130, 30); x.stroke();
    } else {
      x.fillStyle = AMB; rr(x, P, 64, 130, 130, 30); x.fill();
      x.fillStyle = GREEN; x.font = "800 84px Manrope, system-ui, sans-serif";
      x.fillText("f", P + 44, 158);
    }
    x.fillStyle = TX;
    x.font = "800 62px Manrope, system-ui, sans-serif";
    x.textBaseline = "top";
    x.fillText("Fixturio", P + 170, 78);
    x.fillStyle = "rgba(232,237,247,0.75)";
    x.font = "600 32px Manrope, system-ui, sans-serif";
    x.fillText(dateLine, P + 172, 152);
    x.fillStyle = AMB;
    x.font = "700 30px Manrope, system-ui, sans-serif";
    x.fillText("Today's top " + N + " picks", P + 172, 200);
    x.fillStyle = "rgba(232,237,247,0.6)";
    x.font = "500 24px Manrope, system-ui, sans-serif";
    x.fillText("Confidence from odds and form", P + 174, 246);

    var y = 348;
    rows.slice(0, N).forEach(function (p, i) {
      var bh = RH - 12;
      x.fillStyle = CARD; rr(x, P, y, W - P * 2, bh, 18); x.fill();

      // Rank badge
      x.fillStyle = AMB;
      x.beginPath(); x.arc(P + 44, y + bh / 2, 24, 0, Math.PI * 2); x.fill();
      x.fillStyle = INK; x.font = "800 27px Manrope, system-ui, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(i + 1), P + 44, y + bh / 2 + 1);
      x.textAlign = "left"; x.textBaseline = "top";

      var lx = P + 92, maxW = W - P * 2 - lx - 170;
      x.fillStyle = TX; x.font = "800 33px Manrope, system-ui, sans-serif";
      fit(x, p.match, "800", 33, maxW);
      x.fillText(p.match, lx, y + 14);
      x.fillStyle = AMB; x.font = "700 27px Manrope, system-ui, sans-serif";
      fit(x, p.market, "700", 27, maxW);
      x.fillText(p.market, lx, y + 52);
      x.fillStyle = MU; x.font = "600 23px Manrope, system-ui, sans-serif";
      var lg = flag(p.country) + " " + p.league + (p.country ? " \u00B7 " + p.country : "") + " \u00B7 " + hhmm(p.kickoff);
      fit(x, lg, "600", 23, maxW);
      x.fillText(lg, lx, y + 84);

      // Confidence on the right: percentage plus a bar
      x.fillStyle = TX; x.font = "800 44px Manrope, system-ui, sans-serif";
      x.textAlign = "right"; x.textBaseline = "top";
      x.fillText(p.probability + "%", W - P - 24, y + 16);
      var bw = 150, bx = W - P - 24 - bw, by = y + 72;
      x.fillStyle = "rgba(139,152,180,0.35)"; rr(x, bx, by, bw, 10, 5); x.fill();
      x.fillStyle = p.probability >= 75 ? AMB : "#4CAF7D";
      rr(x, bx, by, Math.max(14, bw * p.probability / 100), 10, 5); x.fill();
      x.textAlign = "left"; x.textBaseline = "top";
      y += RH;
    });

    // Footer
    var fy = 1808;
    x.fillStyle = MU; x.font = "500 24px Manrope, system-ui, sans-serif";
    x.fillText("18+ only. Predictions are estimates, not guarantees.", P, fy);
    x.fillStyle = AMB; x.font = "800 40px Manrope, system-ui, sans-serif";
    x.fillText("fixturio.vercel.app", P, fy + 44);
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
      var logo = new Image();
      var load = new Promise(function (res) { logo.onload = logo.onerror = res; });
      logo.src = "/logo.png?v=2";
      load.then(function () {
        var dateLine = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
        var c = draw(picks, dateLine, logo);
        c.toBlob(function (b) {
          if (!b) return;
          var f = null;
          try { f = new File([b], "fixturio-today.png", { type: "image/png" }); } catch (e) {}
          if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
            navigator.share({ files: [f], title: "Fixturio", text: "Today's football picks" }).then(function () {
              toast("Shared. Nice one.");
            }).catch(function () {
              toast("Share cancelled. Tap again to save it instead.");
            });
            return;
          }
          var a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = "fixturio-today.png";
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          toast("Image saved. Check your downloads or gallery.");
        }, "image/png");
      });
    });
  }
  window.shareImage = shareImage;
})();
