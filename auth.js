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
            try{sb.auth.onAuthStateChange(function(ev,sess){emit(sess&&sess.user?sess.user:(ev==="SIGNED_OUT"?null:user));});}catch(e){}
            setTimeout(function(){sessUser().then(function(u){emit(u);});},1500);
            res(sb);
          };
          s.onerror=function(){res(null);};
          document.head.appendChild(s);
        });
      }).catch(function(){return null;});
    }
    return readyProm;
  }
  function sessUser(){return sb?sb.auth.getSession().then(function(g){return g&&g.data&&g.data.session?g.data.session.user:null;}).catch(function(){return null;}):Promise.resolve(null);}
  function push(list){
    return ready().then(function(){
      if(!sb)return undefined;
      return sessUser().then(function(u){
        if(!u)return undefined;
        return sb.auth.updateUser({data:{fx_saves:list}}).then(function(r){return r&&r.error?Promise.reject(r.error):undefined;});
      });
    }).catch(function(e){try{console.warn('fxAuth.push failed',e);}catch(_){}});
  }
  function pull(){
    return ready().then(function(){
      if(!sb)return null;
      return sessUser().then(function(u){return u&&u.user_metadata&&u.user_metadata.fx_saves?u.user_metadata.fx_saves:null;});
    });
  }
  window.fxAuth={
    ready:ready,
    enabled:function(){return enabled;},
    user:function(){return user;},
    on:function(f){subs.push(f);ready().then(function(s){if(!s)f(null);});return f;},
    signIn:function(email,pw){return sb?sb.auth.signInWithPassword({email:email,password:pw}):Promise.reject(new Error('not ready'));},
    signUp:function(email,pw){return sb?sb.auth.signUp({email:email,password:pw}):Promise.reject(new Error('not ready'));},
    reset:function(email){return sb?sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/auth.html'}):Promise.reject(new Error('not ready'));},
    signOut:function(){return sb?sb.auth.signOut():Promise.resolve();},
    setPassword:function(pw){return sb?sb.auth.updateUser({password:pw}):Promise.reject(new Error('not ready'));},
    token:function(){return sb?sb.auth.getSession().then(function(g){return g&&g.data&&g.data.session?g.data.session.access_token:null;}):Promise.resolve(null);},push:push,pull:pull
  };
})();
