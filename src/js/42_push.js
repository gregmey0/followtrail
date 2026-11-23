/* ---------------- Notifications push (relais Cloudflare) ----------------
   Dans un navigateur, la page ne reçoit plus rien une fois fermée ou endormie. Le relais garde l'adresse
   d'abonnement de chaque téléphone qui suit une sortie et le réveille quand quelqu'un envoie un message,
   lance ou lève un SOS, passe un point du GPX ou arrive. Le contenu est chiffré avec la clé de la sortie :
   le relais ne transmet qu'un paquet illisible, que le service worker du destinataire déchiffre.
   Android, ordinateur : dès que les notifications sont autorisées. iPhone : appli web ajoutée à l'écran d'accueil.
   Dans l'appli (Android, iPhone), les notifications locales prennent le relais tant qu'elle tourne. */
const PUSH_RELAYS=new Set(['3','9']);        /* relais qui savent envoyer des notifications push */
const relayHttp=code=>(BROKERS[code[0]]||'').replace(/^ws/,'http').replace(/\/mqtt$/,'');
const tidOf=link=>link.base.slice(7);
const b64uEnc=b=>{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const b64uDec=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
/* clés des sorties suivies, pour le service worker (IndexedDB : la clé reste non exportable) */
const PushKeys={db:null,
  open(){return this.db||(this.db=new Promise((res,rej)=>{const r=indexedDB.open('flt-push',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async op(fn){try{const db=await this.open();return await new Promise(res=>{const tx=db.transaction('keys','readwrite');fn(tx.objectStore('keys'));tx.oncomplete=()=>res(true);tx.onerror=()=>res(false);tx.onabort=()=>res(false)})}catch(e){return false}},
  put(k,v){return this.op(s=>s.put(v,k))},
  del(k){return this.op(s=>s.delete(k))}
};
const Push={
  supported(){return !NATIVE&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window},
  ios(){return /iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)},
  standalone(){try{return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(e){return false}},
  /* iPhone dans Safari : il faut d'abord ajouter l'appli web à l'écran d'accueil */
  needsInstall(){return !NATIVE&&this.ios()&&!this.standalone()},
  canFor(code){return this.supported()&&PUSH_RELAYS.has(String(code)[0])},
  id(){let i=store.get('flt.pushid',null);if(!i){i=uid();store.set('flt.pushid',i)}return i},
  async vapid(code){
    const k='flt.vapid.'+code[0],c=store.get(k,null);if(c)return c;
    try{const r=await fetch(relayHttp(code)+'/vapid');const j=await r.json();if(j&&j.key){store.set(k,j.key);return j.key}}catch(e){}
    return null;
  },
  async subscription(code){
    if(!this.canFor(code)||Notification.permission!=='granted'||!settings.notif)return null;
    const vk=await this.vapid(code);if(!vk)return null;
    if(!(await navigator.serviceWorker.getRegistration()))return null;
    const reg=await navigator.serviceWorker.ready;
    let s=await reg.pushManager.getSubscription();
    if(s&&s.options&&s.options.applicationServerKey&&b64uEnc(s.options.applicationServerKey)!==vk){try{await s.unsubscribe()}catch(e){}s=null}
    if(!s)s=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64uDec(vk)});
    return s;
  },
  /* inscrit ce téléphone pour une sortie : « w » = suit, « r » = court ; pid = son identifiant dans la sortie */
  async register(link,role,pid){
    if(!link||!link.m||!this.canFor(link.code))return false;
    try{
      const s=await this.subscription(link.code);if(!s)return false;
      await PushKeys.put(tidOf(link),{key:link.key,code:link.code,role});
      link.m.publish('fltpush/'+tidOf(link)+'/sub/'+this.id(),new TextEncoder().encode(JSON.stringify({sub:s.toJSON(),role,pid})));
      link.pushOn=true;return true;
    }catch(e){console.warn('push',e);return false}
  },
  unregister(link){
    if(!link||!link.m||!PUSH_RELAYS.has(link.code[0]))return;
    link.m.publish('fltpush/'+tidOf(link)+'/sub/'+this.id(),new Uint8Array(0));PushKeys.del(tidOf(link));link.pushOn=false;
  },
  /* envoi : « a » à tous, « r » aux coureurs, « w » à ceux qui suivent. Le contenu est chiffré avec la clé de la sortie. */
  async send(link,pid,aud,n,{high,group}={}){
    if(!link||!link.m||!PUSH_RELAYS.has(link.code[0]))return;
    try{const pl=await seal(link.key,n);link.m.publish('fltpush/'+tidOf(link)+'/send/'+pid+'/'+aud+'/'+(high?'h':'n')+(group?'/'+String(group).replace(/[^A-Za-z0-9_-]/g,'').slice(0,32):''),pl)}catch(e){}
  },
  /* iPhone dans Safari : marche à suivre. L'appli de l'écran d'accueil a sa propre mémoire : on copie les liens suivis. */
  async installHelp(){
    const links=typeof Watch!=='undefined'?Watch.srcList().map(S=>liveURL(S.code)):[];
    const v=await modal({title:'Notifications sur iPhone',body:`<p>Sur iPhone, un site ne peut envoyer de notifications, écran éteint, qu'une fois <b>ajouté à l'écran d'accueil</b> :</p>
      <ol><li>Touche <b>Partager</b> (le carré avec une flèche vers le haut).</li><li>Choisis <b>Sur l'écran d'accueil</b> puis <b>Ajouter</b> (laisse « Ouvrir comme app web » activé).</li>
      <li>Ouvre <b>Follow Trail</b> depuis l'écran d'accueil, touche <b>Suivre un coureur</b> et colle le lien.</li><li>Accepte les notifications quand elles sont proposées.</li></ol>
      <p class="hint">L'appli de l'écran d'accueil ne voit pas ce que Safari garde en mémoire : copie d'abord ${links.length>1?'les liens':'le lien'} de suivi.</p>`,
      buttons:links.length?[{label:'📋 Copier '+(links.length>1?'les liens':'le lien'),value:'copy',primary:true},{label:'Fermer',value:false}]:[{label:'OK',value:false,primary:true}]});
    if(v==='copy')try{await navigator.clipboard.writeText(links.join('\n'));toast('Copié : colle-le dans l\'appli de l\'écran d\'accueil')}catch(e){toast(links.join(' '))}
  },
  /* personnes bloquées : le service worker ne les affiche pas non plus */
  syncBlocked(){if(this.supported())PushKeys.put('_blocked',Moder.blocked().map(b=>b.pid))},
  /* tout réinscrire, par exemple quand l'autorisation vient d'être donnée */
  registerAll(){
    if(!this.supported())return;
    if(typeof Ride!=='undefined'&&Ride.on&&Ride.link)this.register(Ride.link,'r',Ride.pid);
    if(typeof Watch!=='undefined')Object.values(Watch.src).forEach(S=>{if(S.link)this.register(S.link,'w',Watch.me().pid)});
    this.syncBlocked();
  }
};
