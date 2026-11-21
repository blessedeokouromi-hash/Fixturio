// Config-driven affiliate CTA. Reads /affiliate.json (edited from the admin dashboard).
// Inline button inside slips/tickets; banner card wherever data-banner is set.
(function(){
  var cfg=null;
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  fetch("/affiliate.json").then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.enabled||!d.url)return;
    cfg=d;
    var st=document.createElement("style");
    st.textContent=".bet-cta{margin:14px 0 4px}"
    +".betcard{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#0E4A34,#17694A);color:#fff;box-shadow:0 6px 18px rgba(14,74,52,.25)}"
    +".betcard div{min-width:0}.betcard b{display:block;font-size:15px}.betcard small{display:block;font-size:12px;color:#cfe3d8;margin-top:2px}"
    +".betbtn{display:block;width:100%;padding:13px;border-radius:11px;background:linear-gradient(135deg,#F5B544,#E9A21C);color:#0B1220;font-weight:800;text-align:center;text-decoration:none;font-size:15px;box-shadow:0 4px 12px rgba(245,181,68,.35)}"
    +".betbtn:hover{filter:brightness(1.05)}"
    +".betbtn-s{width:auto;padding:11px 16px;font-size:14px;white-space:nowrap}"
    +".betfine{margin:6px 0 0;font-size:11px;color:#5b6b60;text-align:center}";
    document.head.appendChild(st);
    fill();setInterval(fill,1200);
  }).catch(function(){});
  function inlineBtn(){
    var b=esc(cfg.brand||"1xBet");
    return '<a class="betbtn" href="'+esc(cfg.url)+'" target="_blank" rel="nofollow sponsored noopener">Back these picks on '+b+'</a><p class="betfine">18+. Opens the bookmaker in a new tab.</p>';
  }
  function banner(){
    var b=esc(cfg.brand||"1xBet");
    return '<section class="betcard"><div><b>Think you can call today\'s games?</b><small>Back your picks on '+b+': live odds and a welcome bonus for new players. 18+, bet responsibly.</small></div><a class="betbtn betbtn-s" href="'+esc(cfg.url)+'" target="_blank" rel="nofollow sponsored noopener">Check the odds on '+b+'</a></section>';
  }
  function fill(){
    if(!cfg)return;
    var slots=document.querySelectorAll(".bet-cta:not([data-done])");
    for(var i=0;i<slots.length;i++){
      var s=slots[i];s.setAttribute("data-done","1");
      s.innerHTML=s.hasAttribute("data-banner")?banner():inlineBtn();
    }
  }
})();
