// Config-driven affiliate CTA. Reads /affiliate.json (edited from the repo/admin).
// Adds a "Bet these picks" button wherever a .bet-cta slot is rendered.
(function(){
  var cfg=null;
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  fetch("/affiliate.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.enabled||!d.url)return;
    cfg=d;
    var st=document.createElement("style");
    st.textContent=".bet-cta{margin:10px 0 4px}.betbtn{display:block;width:100%;padding:12px;border:0;border-radius:10px;background:#0E4A34;color:#fff;font-weight:700;text-align:center;text-decoration:none;font-size:15px}.betfine{margin:6px 0 0;font-size:11px;color:#5b6b60;text-align:center}";
    document.head.appendChild(st);
    fill();setInterval(fill,1200);
  }).catch(function(){});
  function fill(){
    if(!cfg)return;
    var slots=document.querySelectorAll(".bet-cta:not([data-done])");
    for(var i=0;i<slots.length;i++){
      var s=slots[i];s.setAttribute("data-done","1");
      s.innerHTML='<a class="betbtn" href="'+esc(cfg.url)+'" target="_blank" rel="nofollow sponsored noopener">Bet these picks on '+esc(cfg.brand||"1xBet")+'</a><p class="betfine">18+. Opens the bookmaker in a new tab.</p>';
    }
  }
})();
