/* ---------------- Mode poche (navigateur) ----------------
   Dans un navigateur, le GPS s'arrête dès que l'écran se verrouille. Le mode poche garde l'écran allumé
   (verrou d'écran) mais entièrement noir : sur un écran OLED les pixels noirs sont éteints, la batterie
   tient, et rien ne se déclenche dans la poche. Appui long (2 s) pour revenir. */
const POCKET_HOLD=2000;
const Pocket={on:false,t:null,hold:null,pos:0,
  open(){
    if(this.on)return;this.on=true;Wake.on();
    const el=$('#pocket');el.hidden=false;document.body.classList.add('pocketon');
    try{const r=document.documentElement;if(r.requestFullscreen&&!document.fullscreenElement)r.requestFullscreen({navigationUI:'hide'}).catch(()=>{})}catch(e){}
    $('#pkWarn').hidden='wakeLock' in navigator;
    this.tick();clearInterval(this.t);this.t=setInterval(()=>this.tick(),20000);
    setTimeout(()=>{try{el.focus({preventScroll:true})}catch(e){}},50);
  },
  close(){
    if(!this.on)return;this.on=false;clearInterval(this.t);this.cancel();
    $('#pocket').hidden=true;document.body.classList.remove('pocketon');
    try{if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})}catch(e){}
    vib(60);
  },
  /* infos discrètes (gris très sombre), déplacées régulièrement pour ne pas marquer l'écran */
  tick(){
    if(!this.on)return;
    const R=typeof Ride!=='undefined'&&Ride.on?Ride:null,s=R&&R.stats;
    $('#pkClock').textContent=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    $('#pkInfo').textContent=R?fmtKm(s.dist)+' km · '+fmtTime(Date.now()-(R.runStart||R.start))+(R.m&&!R.m.connected?' · hors réseau':''):'';
    this.pos=(this.pos+1)%4;const box=$('#pocket .pk');
    box.style.top=[18,58,34,72][this.pos]+'%';box.style.left=[50,46,54,50][this.pos]+'%';
  },
  start(){this.cancel();$('#pocket').classList.add('holding');this.hold=setTimeout(()=>this.close(),POCKET_HOLD)},
  cancel(){clearTimeout(this.hold);this.hold=null;const el=$('#pocket');if(el)el.classList.remove('holding')}
};
(()=>{const el=$('#pocket');if(!el)return;
  el.addEventListener('pointerdown',e=>{e.preventDefault();Pocket.start()});
  ['pointerup','pointercancel','pointerleave'].forEach(k=>el.addEventListener(k,()=>Pocket.cancel()));
  el.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Enter'||e.key===' '){e.preventDefault();Pocket.close()}});
  /* écran rallumé après une coupure : on reprend le verrou d'écran */
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Pocket.on){Wake.on();Pocket.tick()}});
})();
