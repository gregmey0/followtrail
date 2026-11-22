/* ---------------- Notifications système : messages, SOS, sorties de tracé ----------------
   Appli (Android, iPhone) : notifications locales ; sur Android, deux canaux : « Alertes SOS »
   (priorité maximale) et « Messages ». Toucher la notification ouvre l'appli au bon endroit.
   Navigateur : notifications du navigateur quand la page est en arrière-plan, si elles sont autorisées
   (sans serveur, elles n'arrivent que tant que le navigateur garde la page ouverte).
   Une même clé (« sos-<personne> ») remplace la notification précédente : l'alerte devient « tout va bien ». */
const Notify={
  async init(){
    if(NATIVE&&P.notif){
      try{await P.notif.createChannel({id:'sos',name:'Alertes SOS',description:'Demandes d\'aide et sorties de tracé',importance:5,visibility:1,vibration:true,lights:true,lightColor:'#FF2B2B'})}catch(e){}
      try{await P.notif.createChannel({id:'msg',name:'Messages',description:'Messages et encouragements',importance:4,visibility:1,vibration:true})}catch(e){}
      try{P.notif.addListener('localNotificationActionPerformed',a=>this.onTap(a&&a.notification&&a.notification.extra))}catch(e){}
    }else if('serviceWorker' in navigator){
      try{navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.flt==='tap')this.onTap(e.data.tap)})}catch(e){}
    }
  },
  idFor(key){let h=7;for(const c of String(key))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)%2000000000+1},
  /* o : {title, body, sos, key, tap: {k, w (suivi : code), pid}} */
  recent:{},
  show(o){
    if(!settings.notif)return;
    /* la même alerte arrive par deux chemins (message et état) : une seule sonnerie */
    if(o.key){const k=o.key+'|'+o.title,t=Date.now();if(t-(this.recent[k]||0)<8000)return;this.recent[k]=t}
    if(NATIVE&&P.notif){
      try{P.notif.schedule({notifications:[{id:this.idFor(o.key||uid()),title:o.title,body:o.body||'',channelId:o.sos?'sos':'msg',
        smallIcon:'ic_stat_followtrail',iconColor:o.sos?'#FF2B2B':'#FF8A1F',extra:o.tap||null,autoCancel:true}]}).catch(()=>{})}catch(e){}
      return;
    }
    if(!('Notification' in window)||Notification.permission!=='granted'||document.visibilityState==='visible')return;
    const opts={body:o.body||'',tag:o.key||undefined,renotify:!!o.key,icon:'icon-192.png',badge:'icon-192.png',requireInteraction:!!o.sos,data:o.tap||null,vibrate:o.sos?[600,200,600,200,900]:[80,60,80]};
    const direct=()=>{try{const n=new Notification(o.title,opts);n.onclick=()=>{try{window.focus()}catch(e){}this.onTap(o.tap);n.close()}}catch(e){}};
    if(navigator.serviceWorker&&navigator.serviceWorker.controller)navigator.serviceWorker.ready.then(r=>r.showNotification(o.title,opts)).catch(direct);else direct();
  },
  clear(key){
    if(NATIVE&&P.notif){try{P.notif.cancel({notifications:[{id:this.idFor(key)}]}).catch(()=>{})}catch(e){}return}
    if(navigator.serviceWorker)navigator.serviceWorker.getRegistration().then(r=>r&&r.getNotifications({tag:key})).then(ns=>(ns||[]).forEach(n=>n.close())).catch(()=>{});
  },
  /* toucher la notification : ouvrir l'endroit concerné */
  onTap(x){
    if(!x)return;
    if(x.w&&typeof Watch!=='undefined'&&Watch.src[x.w]){Watch.open();if(x.pid)Watch.select(x.w,x.pid);Watch.setTab(x.k==='msg'?'chat':Watch.wide?'run':'map');return}
    if(Ride.on){show('ride');if(x.k==='msg')Ride.setTab('chat');else{Ride.setTab('map');if(x.pid&&Ride.riders[x.pid])setTimeout(()=>RideMap.focus(x.pid),150)}}
  },
  /* navigateur : demande d'autorisation, à faire sur un geste de l'utilisateur */
  async ask(){
    if(NATIVE){ensureNotifPermission();return 'granted'}
    if(!('Notification' in window))return 'unsupported';
    if(Notification.permission!=='default')return Notification.permission;
    try{return await Notification.requestPermission()}catch(e){return 'denied'}
  },
  state(){return NATIVE?'native':!('Notification' in window)?'unsupported':Notification.permission}
};
Notify.init();
