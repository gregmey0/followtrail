/* ---------------- Relais chiffré (MQTT sur WebSocket) ----------------
   Les messages passent par un relais public. Ils sont chiffrés (AES-GCM) avec une clé dérivée du code
   de la sortie (PBKDF2), et le nom du canal est lui aussi dérivé du code : sans le code, rien n'est lisible.
   Code : 12 chiffres (le premier désigne le relais) + une clé de 8 caractères, « 148291355720-K7P2XM4Q ».
   La clé rend impossible de retrouver les codes en essayant toutes les combinaisons hors ligne à partir
   de ce que voit n'importe qui sur un relais public. Les anciens codes de 12 chiffres seuls restent lisibles. */
const BROKERS={'1':'wss://broker.hivemq.com:8884/mqtt','2':'wss://broker.emqx.io:8084/mqtt'};
(()=>{const t=store.get('flt.testbroker',null);if(t)BROKERS['9']=t})();
const WEB_URL='https://gregmey0.github.io/followtrail/';
const APP={name:'Follow Trail',scheme:'followtrail',pkg:'io.github.gregmey0.followtrail',apk:'https://github.com/gregmey0/followtrail/releases/latest/download/FollowTrail.apk'};
function appIntent(code){const fb=location.origin+location.pathname+'?noapp=1#join-'+code;
  return`intent://join-${code}#Intent;scheme=${APP.scheme};package=${APP.pkg};S.browser_fallback_url=${encodeURIComponent(fb)};end`}
const SEC_ABC='23456789ABCDEFGHJKMNPQRSTUVWXYZ';   /* sans 0, 1, I, L, O : pas de confusion en tapant */
function newCode(b){let s=b,k='';
  while(s.length<12){const r=crypto.getRandomValues(new Uint8Array(16));for(const x of r)if(x<250&&s.length<12)s+=String(x%10)}
  while(k.length<8){const r=crypto.getRandomValues(new Uint8Array(16));for(const x of r)if(x<248&&k.length<8)k+=SEC_ABC[x%31]}
  return s+'-'+k}
/* forme canonique : « 148291355720 » (ancien) ou « 148291355720-K7P2XM4Q », à partir d'un lien ou d'un code tapé */
function normCode(s){s=String(s||'');
  const m=/(?:join|live)-(\d{12})(?:-([0-9a-z]{8}))?(?![0-9a-z])/i.exec(s);if(m)return m[1]+(m[2]?'-'+m[2].toUpperCase():'');
  const t=s.toUpperCase().replace(/[^0-9A-Z]/g,'');
  if(/^\d{12}[0-9A-Z]{8}$/.test(t))return t.slice(0,12)+'-'+t.slice(12);
  return t}
function validCode(c){return /^\d{12}(-[2-9A-HJKMNP-Z]{8})?$/.test(c)&&!!BROKERS[c[0]]}
const fmtCode=c=>{const[d,k]=String(c).split('-');return d.replace(/(\d{3})(?=\d)/g,'$1 ')+(k?' · '+k.slice(0,4)+' '+k.slice(4):'')};
const webBase=()=>NATIVE||!/^https?:/.test(location.protocol)?WEB_URL:location.origin+location.pathname;
function joinURL(code){return webBase()+'#join-'+code}
/* lien de suivi d'une course : s'ouvre dans un simple navigateur */
function liveURL(code){return webBase()+'#live-'+code}
async function deriveKey(code){
  const[d,k]=String(code).split('-'),enc=new TextEncoder(),base=await crypto.subtle.importKey('raw',enc.encode(k?d+':'+k:d),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(k?'followtrail-v2':'followtrail-v1'),iterations:150000,hash:'SHA-256'},base,384));
  const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['encrypt','decrypt']);
  return{key,tid:[...bits.slice(32,44)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
async function seal(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj))));
  const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return o}
async function unseal(key,b){const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12));return JSON.parse(new TextDecoder().decode(pt))}

/* Client MQTT 3.1.1 minimal (QoS 0, messages retenus), reconnexion automatique.
   Un message publié hors connexion est gardé (le dernier par canal) et part au retour du réseau. */
class Mqtt{
  constructor(url){this.url=url;this.subs=new Set();this.handlers=[];this.pending=new Map();this.connected=false;this.closed=false;this.pid=1;this.retry=0;this.onstate=null;this.lastRx=0;this.lastPing=0}
  static str(s){const b=new TextEncoder().encode(s),o=new Uint8Array(2+b.length);o[0]=b.length>>8;o[1]=b.length&255;o.set(b,2);return o}
  static pkt(h,parts){const len=parts.reduce((a,p)=>a+p.length,0),lb=[];let x=len;do{let d=x%128;x=Math.floor(x/128);if(x>0)d|=128;lb.push(d)}while(x>0);
    const o=new Uint8Array(1+lb.length+len);o[0]=h;o.set(lb,1);let k=1+lb.length;for(const p of parts){o.set(p,k);k+=p.length}return o}
  connect(){
    if(this.closed)return;let ws;
    try{ws=new WebSocket(this.url,['mqtt'])}catch(e){this._later();return}
    ws.binaryType='arraybuffer';this.ws=ws;this.buf=new Uint8Array(0);
    ws.onopen=()=>{this._send(Mqtt.pkt(0x10,[Mqtt.str('MQTT'),new Uint8Array([4,2,0,40]),Mqtt.str('flt_'+Math.random().toString(36).slice(2,12))]))};
    ws.onmessage=e=>this._feed(new Uint8Array(e.data));
    ws.onclose=()=>{if(this.ws!==ws)return;const was=this.connected;this.connected=false;clearInterval(this.ka);if(was&&this.onstate)this.onstate(false);this._later()};
    ws.onerror=()=>{try{ws.close()}catch(e){}};
  }
  /* reconnexion immédiate (retour au premier plan, réseau revenu) */
  kick(){if(this.closed||this.connected)return;clearTimeout(this.rt);this.retry=0;try{if(this.ws)this.ws.onclose=null,this.ws.close()}catch(e){}this.connect()}
  _later(){if(this.closed)return;clearTimeout(this.rt);this.rt=setTimeout(()=>this.connect(),Math.min(15000,800*Math.pow(1.7,this.retry++)))}
  _send(b){try{if(this.ws&&this.ws.readyState===1){this.ws.send(b);return true}}catch(e){}return false}
  _feed(chunk){
    const nb=new Uint8Array(this.buf.length+chunk.length);nb.set(this.buf);nb.set(chunk,this.buf.length);this.buf=nb;
    for(;;){const b=this.buf;if(b.length<2)return;let i=1,mult=1,rem=0,c;
      do{if(i>=b.length)return;c=b[i++];rem+=(c&127)*mult;mult*=128}while(c&128&&i<5);
      if(b.length<i+rem)return;this._handle(b[0],b.slice(i,i+rem));this.buf=b.slice(i+rem)}
  }
  _handle(h,body){
    this.lastRx=Date.now();const t=h>>4;
    if(t===2){if(body[1]!==0){try{this.ws.close()}catch(e){}return}
      this.connected=true;this.retry=0;this.lastPing=Date.now();this.subs.forEach(s=>this._sub(s));this._flush();
      clearInterval(this.ka);this.ka=setInterval(()=>{const n=Date.now();
        if(n-this.lastRx>65000){try{this.ws.close()}catch(e){}return}
        if(n-this.lastPing>20000){this.lastPing=n;this._send(new Uint8Array([0xC0,0]))}},5000);
      if(this.onstate)this.onstate(true);return}
    if(t===3){const q=(h>>1)&3,tl=(body[0]<<8)|body[1],topic=new TextDecoder().decode(body.slice(2,2+tl));let j=2+tl;if(q>0)j+=2;
      const pl=body.slice(j);this.handlers.forEach(fn=>{try{fn(topic,pl,!!(h&1))}catch(e){console.error(e)}})}
  }
  onMessage(fn){this.handlers.push(fn)}
  subscribe(t){this.subs.add(t);if(this.connected)this._sub(t)}
  _sub(t){const id=(this.pid++%65535)||1;this._send(Mqtt.pkt(0x82,[new Uint8Array([id>>8,id&255]),Mqtt.str(t),new Uint8Array([0])]))}
  publish(t,payload,retain){this.pending.set(t,{payload,retain});if(this.connected)this._flush()}
  _flush(){for(const[t,m]of[...this.pending]){if(!this._send(Mqtt.pkt(0x30|(m.retain?1:0),[Mqtt.str(t),m.payload])))return;this.pending.delete(t)}}
  waitConnected(ms){return new Promise(res=>{if(this.connected)return res(true);const t0=Date.now(),i=setInterval(()=>{if(this.connected||Date.now()-t0>ms){clearInterval(i);res(this.connected)}},100)})}
  close(){this.closed=true;clearTimeout(this.rt);clearInterval(this.ka);try{this._send(new Uint8Array([0xE0,0]));this.ws&&this.ws.close()}catch(e){}}
}
/* relais : serveur de test éventuel, puis HiveMQ, puis EMQX */
async function pickBroker(b){
  const old=b.innerHTML;b.disabled=true;b.textContent='⏳ Connexion au relais…';let broker=null;
  for(const k of['9','1','2']){if(!BROKERS[k])continue;const m=new Mqtt(BROKERS[k]);m.connect();const ok=await m.waitConnected(7000);m.close();if(ok){broker=k;break}}
  b.disabled=false;b.innerHTML=old;
  if(!broker)toast('Relais injoignable : vérifie la connexion internet puis réessaie.',true);return broker;
}
/* Lien avec une sortie : connexion au relais et lecture de la fiche de la sortie */
const SessionLink={
  async connect(code,{silent}={}){
    code=normCode(code);if(!validCode(code))return null;
    const{key,tid}=await deriveKey(code),base='flt/v1/'+tid,m=new Mqtt(BROKERS[code[0]]);
    const link={code,key,base,m,session:null,connected:false,onSession:null,onState:null,close(){m.close()}};
    let waiter=null;
    m.onstate=c=>{link.connected=c;if(link.onState)link.onState(c)};
    m.onMessage(async(topic,pl)=>{
      if(topic!==base+'/s')return;
      let s=null;if(!pl.length)s={status:'deleted'};else try{s=await unseal(key,pl)}catch(e){return}
      link.session=s;if(link.onSession)link.onSession(s);if(waiter){waiter(s);waiter=null}
    });
    m.subscribe(base+'/s');m.connect();
    const s=await new Promise(res=>{waiter=res;setTimeout(()=>res(null),12000)});waiter=null;
    if(!s&&!silent){m.close();return null}
    return link;
  }
};
