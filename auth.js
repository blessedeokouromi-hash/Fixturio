(function(){
  var sb=null,user=null,enabled=false,readyProm=null,subs=[];
  function emit(u){user=u;subs.forEach(function(f){try{f(u)}catch(e){}});}
  function ready(){
    if(!readyProm){
      readyProm=fetch('/auth-config.json').then(function(r){return r.json();}).then(function(c){
        if(!c||!c.url||!c.key)return Promise.resolve(null);
        return new Promise(function(res){
          var s=document.createElement('script');
          s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
          s.onload=function(){
            try{sb=window.supabase.createClient(c.url,c.key);}catch(e){res(null);return;}
            enabled=true;
            sb.auth.getSession().then(function(g){emit(g&&g.data&&g.data.session?g.data.session.user:null);});
            try{sb.auth.onAuthStateChange(function(ev,sess){emit(sess&&sess.user?sess.user:null);});}catch(e){}
            res(sb);
          };
          s.onerror=function(){res(null);};
          document.head.appendChild(s);
        });
      }).catch(function(){return null;});
    }
    return readyProm;
  }
  function push(list){
    if(!sb||!user)return Promise.resolve();
    return sb.from('saves').upsert({user_id:user.id,items:list,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  }
  function pull(){
    if(!sb||!user)return Promise.resolve(null);
    return sb.from('saves').select('items').eq('user_id',user.id).maybeSingle().then(function(r){return r&&r.data&&r.data.items?r.data.items:null;});
  }
  window.fxAuth={
    ready:ready,
    enabled:function(){return enabled;},
    user:function(){return user;},
    on:function(f){subs.push(f);ready().then(function(s){if(!s)f(null);});return f;},
    signIn:function(email,pw){return sb?sb.auth.signInWithPassword({email:email,password:pw}):Promise.reject(new Error('not ready'));},
    signUp:function(email,pw){return sb?sb.auth.signUp({email:email,password:pw}):Promise.reject(new Error('not ready'));},
    reset:function(email){return sb?sb.auth.resetPasswordForEmail(email):Promise.reject(new Error('not ready'));},
    signOut:function(){return sb?sb.auth.signOut():Promise.resolve();},
    push:push,pull:pull
  };
})();
