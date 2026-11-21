(function(){
try{
var d=new Date(),k="fx:hp:"+d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
if(localStorage.getItem(k))return;
var fired=false;
function go(){
  if(fired)return;fired=true;
  try{localStorage.setItem(k,"1");}catch(e){}
  var w=window.open("https://fluffy-machine.com/bK3IV/0.P/3_pXvfbKmnVEJUZkDp0r3xNejqQa3/NbzuAX5ELFT/c-2LNZDIc/3wMDT/MS","_blank");
  try{if(w){w.blur();window.focus();}}catch(e){}
  document.removeEventListener("click",go,true);
}
document.addEventListener("click",go,true);
try{fetch("/api/track?zone=hillpop",{cache:"no-store"});}catch(e){}
}catch(e){}
})();
