/* ---------------- Suivre des coureurs (famille, amis, assistance) ----------------
   Chaque lien suivi (code) est une « source » : un partage de course (live) ou une sortie Group Run (en spectateur).
   Le suiveur ne partage pas sa position : il lit positions, traces, tracés et messages,
   et publie seulement sa présence (w/<pid>) et ses encouragements (m/<pid>). */
const QUICK_FAN=[{k:'go',t:'💪 Allez !'},{k:'top',t:'🔥 Tu gères !'},{k:'bravo',t:'👏 Bravo !'},{k:'love',t:'❤️ On pense fort à toi'},
  {k:'eat',t:'🥤 Pense à boire et manger'},{k:'fin',t:'🏁 On t\'attend à l\'arrivée'}];
const Watch={on:false,src:{},sel:null,tab:'map',map:null,mk:{},pl:{},rl:{},chatSrc:null,fitted:false,wide:false,
  me(){let w=store.get(K.watcher,null);if(!w||!w.pid){w={pid:uid(),name:store.get(K.me,'')||''};store.set(K.watcher,w)}return w},
  setName(n){const w=this.me();w.name=String(n||'').trim().slice(0,30);store.set(K.watcher,w);if(w.name&&!store.get(K.me,''))store.set(K.me,w.name);Object.values(this.src).forEach(S=>this.presence(S));this.renderHead()},
  saveList(){store.set(K.watch,{codes:Object.keys(this.src),open:this.on&&current==='watch',sel:this.sel,chat:this.chatSrc})},
  srcList(){return Object.values(this.src)},
  /* ---------- ouverture, ajout, retrait ---------- */
  open(){
    if(!this.map){const m=this.map=makeMap($('#wMap'));this.routeLay=L.layerGroup().addTo(m);this.trailLay=L.layerGroup().addTo(m);this.riderLay=L.layerGroup().addTo(m);
      m.on('dragstart',()=>{this.follow=false})}
    this.on=true;show('watch');this.layout();this.setTab(this.wide&&this.tab==='map'?'run':this.tab);
    clearInterval(this.tickI);this.tickI=setInterval(()=>this.tick(),2000);
    Voice.unlock();Snd.unlock();this.renderHead();this.saveList();if(NATIVE)ensureNotifPermission();
    setTimeout(()=>{this.map.invalidateSize();this.update()},60);
  },
  async add(code,{silent,noOpen}={}){
    code=normCode(code);if(!validCode(code)){if(!silent)toast('Code invalide : il faut le code complet (chiffres et lettres) ou le lien reçu.',true);return false}
    if(!noOpen)this.open();
    if(this.src[code]){this.select(code,null);return true}
    const S={code,link:null,session:null,riders:{},routes:{},msgs:new Map(),myMsgs:[],lastRead:Date.now(),status:'load',syncT:Date.now(),wp:new Set()};
    this.src[code]=S;this.saveList();this.render(true);
    let link=null;try{link=await SessionLink.connect(code,{silent:true})}catch(e){}
    if(this.src[code]!==S){if(link)link.close();return false}
    if(!link||(!link.session&&!silent)){if(link)link.close();delete this.src[code];this.saveList();this.render(true);
      if(!silent)toast(link?'Partage introuvable ou effacé : vérifie le lien.':'Relais injoignable : vérifie la connexion internet.',true);return false}
    Object.assign(S,{link,key:link.key,base:link.base,m:link.m});
    if(!link.session)S.status=link.m.connected?'gone':'load';
    link.onSession=s=>this.onSession(S,s);link.onState=c=>{if(c)this.presence(S);this.renderHead()};
    S.m.onMessage((t,pl)=>this.onMsg(S,t,pl));
    ['/p/+','/t/+/+','/r/+','/m/+','/route/+','/w/+'].forEach(t=>S.m.subscribe(S.base+t));
    if(link.session)this.onSession(S,link.session);
    setTimeout(()=>{if(this.src[S.code]===S&&this.abandoned(S))this.cleanup(S)},7000);
    this.presence(S);this.render(true);
    return true;
  },
  async remove(code,ask){
    const S=this.src[code];if(!S)return;
    if(ask){const v=await modal({title:'Ne plus suivre ?',body:`<p><b>${esc(this.srcName(S))}</b> disparaît de ton suivi. Tu pourras le reprendre avec le lien.</p>`,buttons:[{label:'🗑 Ne plus suivre',value:true,danger:true},{label:'Annuler',value:false}]});if(!v)return}
    if(S.m&&S.status!=='closed'){const e=new Uint8Array(0),m=S.m;m.publish(S.base+'/w/'+this.me().pid,e,true);setTimeout(()=>{try{m.close()}catch(err){}},2500)}else if(S.link)S.link.close();
    delete this.src[code];if(this.sel&&this.sel.startsWith(code+'|'))this.sel=null;if(this.chatSrc===code)this.chatSrc=null;
    Object.keys(this.mk).forEach(k=>{if(k.startsWith(code+'|')){this.riderLay.removeLayer(this.mk[k]);delete this.mk[k]}});
    Object.keys(this.pl).forEach(k=>{if(k.startsWith(code+'|')){this.trailLay.removeLayer(this.pl[k]);delete this.pl[k]}});
    this.routesDirty=true;this.saveList();this.render(true);
  },
  async restore(open){
    const w=store.get(K.watch,null);if(!w||!w.codes||!w.codes.length)return;
    this.sel=w.sel||null;this.chatSrc=w.chat||null;
    if(open)this.open();
    for(const c of w.codes)this.add(c,{silent:true,noOpen:true});
  },
  /* ---------- relais ---------- */
  presence(S){
    if(!S.m||S.status==='closed'||S.status==='gone')return;const w=this.me();
    seal(S.key,{pid:w.pid,name:w.name||'Quelqu\'un',upd:Date.now()}).then(b=>S.m.publish(S.base+'/w/'+w.pid,b,true));S.presT=Date.now();
  },
  onSession(S,s){
    if(!s)return;const was=S.status;S.session=s;
    S.status=s.status==='deleted'?'gone':s.status==='closed'?'closed':'open';if(was==='load'||was==='gone')S.syncT=Date.now();
    if(S.status!=='open'&&was==='open'){const R=this.runner(S);toast(S.status==='closed'?'🏁 '+(R&&R.st?R.st.name:this.srcName(S))+' a terminé '+(this.isLive(S)?'sa course':'la sortie'):'Le partage a été effacé');Snd.ok()}
    if(S.status!=='open'&&S.m){S.m.publish(S.base+'/w/'+this.me().pid,new Uint8Array(0),true)}
    this.routesDirty=true;this.render(true);
  },
  async onMsg(S,topic,pl){
    if(!this.src[S.code]||!topic.startsWith(S.base+'/'))return;
    const parts=topic.slice(S.base.length+1).split('/'),kind=parts[0],id=parts[1];
    if(kind==='s'||!id)return;
    let o=null;if(pl.length){try{o=await unseal(S.key,pl)}catch(e){return}}
    const me=this.me().pid;
    if(kind==='w'){S.wp.add(id);return}
    if(kind==='route'){if(!o)delete S.routes[id];else{const r=decRoute(o);if(r){r.id=id;S.routes[id]=r}}this.routesDirty=true;this.dirty(true);return}
    if(kind==='m'){if(!o||!Array.isArray(o.msgs))return;
      if(id===me&&!S.myMsgs.length)S.myMsgs=o.msgs.filter(x=>x&&x.pid===me).slice(-40);
      o.msgs.forEach(x=>{if(x&&x.id&&x.pid===id)this.addMsg(S,x)});return}
    if(id===me)return;
    const R=S.riders[id]||(S.riders[id]={pid:id,st:null,trail:[],chunks:{},route:null,ver:0,cache:null,cacheKey:''});
    if(kind==='p'){
      if(!o||!o.pid)return;if(R.st&&R.st.upd>o.upd)return;
      const prev=R.st;R.st=o;
      if(o.pos&&o.status==='on'){const tr=R.trail,l=tr[tr.length-1];if(!l||l[2]!==o.pos.t){tr.push([o.pos.lat,o.pos.lon,o.pos.t,o.pos.alt]);if(tr.length>4000)tr.splice(0,500)}}
      if(o.sos&&Date.now()-o.sos<SOS_MS&&(!prev||prev.sos!==o.sos)&&Date.now()-S.syncT>3000){Snd.sos();vib([600,200,600,200,900]);toast('🆘 '+o.name+' a besoin d\'aide',true);
        Notify.show({title:'🆘 '+o.name+' a besoin d\'aide',body:'Touche pour voir sa position.',sos:true,key:'sos-'+S.code+id,tap:{w:S.code,k:'sos',pid:id}})}
      if(!o.sos&&prev&&prev.sos&&Date.now()-S.syncT>3000){toast('✔ '+o.name+' : tout va bien');Notify.show({title:'✔ '+o.name+' : tout va bien',body:'Alerte levée.',key:'sos-'+S.code+id,tap:{w:S.code,k:'map',pid:id}})}
      if(!prev)this.routesDirty=true;
      if(prev&&prev.f!==o.f&&JSON.stringify(prev.f)!==JSON.stringify(o.f))this.routesDirty=true;
      this.dirty();return}
    if(kind==='t'){const k=+parts[2];if(!o)delete R.chunks[k];else R.chunks[k]=decTrack(o);R.ver++;this.dirty();return}
    if(kind==='r'){R.route=o?decRoute(o):null;this.routesDirty=true;this.dirty(true);return}
  },
  addMsg(S,m){
    if(S.msgs.has(m.id))return;m=Object.assign({},m,{rt:Date.now()});S.msgs.set(m.id,m);
    if(S.msgs.size>400){const old=[...S.msgs.values()].sort((a,b)=>a.t-b.t).slice(0,S.msgs.size-400);old.forEach(x=>S.msgs.delete(x.id))}
    const mine=m.pid===this.me().pid;
    if(!mine&&m.t>S.syncT-10000&&Date.now()-S.syncT>3000&&!Moder.hidden(m,this.blk(S))){
      const sos=m.k==='sos';
      if(sos){Snd.sos();vib([600,200,600,200,900])}else if(settings.msgSound&&!m.fw){Snd.msg();vib([80,60,80])}
      if(!m.fw||sos){const away=document.visibilityState==='hidden'||this.tab!=='chat'||this.chatSrc!==S.code;
        if(away||sos)toast((sos?'🆘 ':'💬 ')+m.name+' : '+Moder.clean(m.text),sos);
        if(away||sos)Notify.show({title:sos?'🆘 '+m.name+' a besoin d\'aide':'💬 '+m.name,body:sos?'Touche pour voir sa position.':Moder.clean(m.text),sos,
          key:(sos||m.k==='ok'?'sos-':'msg-')+S.code+m.pid,tap:{w:S.code,k:sos?'sos':'msg',pid:m.pid}})}
    }
    if(this.tab==='chat'&&this.chatSrc===S.code&&document.visibilityState==='visible')S.lastRead=Date.now();
    this.renderChat();this.renderHead();
  },
  async send(text,q){
    const S=this.src[this.chatSrc];text=String(text||'').trim().slice(0,300);if(!S||!text||!S.m)return false;
    if(S.status!=='open'){toast(this.isLive(S)?'La course est terminée : les messages ne partent plus.':'La sortie est terminée.',true);return false}
    let w=this.me();
    if(!w.name){const r=await modal({title:'Ton prénom',body:'<p>Il signe tes encouragements.</p>',input:{placeholder:'Prénom'},buttons:[{label:'✔ OK',value:true,primary:true},{label:'Annuler',value:false}]});
      if(!r||!r.value||!r.text)return false;this.setName(r.text);w=this.me()}
    const m={id:uid(),t:Date.now(),pid:w.pid,name:w.name,text,fw:1};if(q)m.k=q.k;
    S.myMsgs.push(m);if(S.myMsgs.length>40)S.myMsgs.shift();this.addMsg(S,m);
    seal(S.key,{pid:w.pid,name:w.name,fw:1,msgs:S.myMsgs.slice(-40)}).then(b=>S.m.publish(S.base+'/m/'+w.pid,b,true));
    this.presence(S);return true;
  },
  /* partage abandonné (rien de neuf depuis 48 h, jamais terminé) : le premier qui l'ouvre l'efface du relais */
  abandoned(S){
    if(S.status!=='open'||!S.session||!S.m||!S.m.connected)return false;
    const ups=Object.values(S.riders).filter(R=>R.st).map(R=>R.st.upd||0),last=Math.max(Date.parse(S.session.created)||0,...ups);
    return Date.now()-last>48*3600e3;
  },
  cleanup(S){
    const e=new Uint8Array(0),m=S.m,b=S.base,pids=new Set([...Object.keys(S.riders),...S.wp,this.me().pid]);
    pids.forEach(pid=>{['p','r','m','w'].forEach(k=>m.publish(b+'/'+k+'/'+pid,e,true));const R=S.riders[pid];if(R)Object.keys(R.chunks).forEach(k=>m.publish(b+'/t/'+pid+'/'+k,e,true))});
    Object.keys(S.routes).forEach(id=>m.publish(b+'/route/'+id,e,true));m.publish(b+'/s',e,true);
    S.status='gone';S.riders={};this.routesDirty=true;toast('Ce partage était abandonné depuis plus de 48 h : il a été effacé du relais.',true);this.render(true);
  },
  blk(S){return(S&&S.session&&S.session.blk)||[]},
  /* ---------- données ---------- */
  isLive(S){return!!(S.session&&S.session.type==='live')},
  srcName(S){return(S.session&&S.session.name)||(S.status==='load'?'Connexion…':'Partage '+fmtCode(S.code))},
  runner(S){const s=S.session;return s&&S.riders[s.org]||null},
  people(){const out=[];this.srcList().forEach(S=>Object.values(S.riders).forEach(R=>{if(R.st&&(R.st.status==='on'||R.st.status==='left'))out.push({S,R,key:S.code+'|'+R.pid})}));return out},
  routeOf(S,R){const st=R.st;if(!st||!st.f)return null;return st.f.k==='org'?S.routes[st.f.id]||null:R.route},
  selected(){if(!this.sel)return null;return this.people().find(x=>x.key===this.sel)||null},
  select(code,pid){
    if(!pid){const S=this.src[code];const R=S&&(this.runner(S)||Object.values(S.riders).find(x=>x.st));pid=R?R.pid:null}
    this.sel=pid?code+'|'+pid:null;this.chatSrc=code;this.saveList();
    const x=this.selected();if(x&&x.R.st.pos&&this.map){this.follow=true;this.map.setView([x.R.st.pos.lat,x.R.st.pos.lon],Math.max(this.map.getZoom(),14))}
    this.render(true);
  },
  /* ---------- affichage ---------- */
  layout(){const w=matchMedia('(min-width: 900px)').matches;if(w!==this.wide){this.wide=w;$('#watch').classList.toggle('wide',w);if(w&&this.tab==='map')this.setTab('run');setTimeout(()=>this.map&&this.map.invalidateSize(),60)}},
  setTab(t){
    this.tab=t;$$('#wTabs [data-wtab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.wtab===t)));
    $$('#watch .pane').forEach(p=>p.classList.toggle('active',p.id==='wp'+t[0].toUpperCase()+t.slice(1)));
    if(t==='map'||this.wide)setTimeout(()=>{this.map.invalidateSize();this.update()},30);
    if(t==='chat'){if(!this.chatSrc||!this.src[this.chatSrc])this.chatSrc=(this.srcList()[0]||{}).code||null;const S=this.src[this.chatSrc];if(S)S.lastRead=Date.now();this.renderChat(true);this.renderHead()}
    if(t==='run')this.renderRun();
  },
  dirty(now){if(this._rv)return;const wait=now?0:Math.max(0,900-(Date.now()-(this._rvT||0)));this._rv=setTimeout(()=>{this._rv=null;this._rvT=Date.now();this.render()},wait)},
  render(force){if(!this.on||current!=='watch')return;this.update();this.renderHead();if(this.tab==='run'&&(force||!this.busy))this.renderRun();if(this.tab==='chat'&&force)this.renderChat(true)},
  tick(){if(!this.on)return;const now=Date.now();
    this.srcList().forEach(S=>{if(S.m&&!S.m.connected&&document.visibilityState==='visible'&&now-(S.kickT||0)>20000){S.kickT=now;S.m.kick()}
      if(S.status==='open'&&document.visibilityState==='visible'&&now-(S.presT||0)>60000)this.presence(S)});
    if(current==='watch'){this.renderHead();if(this.tab==='run'&&!this.busy)this.renderRun();this.chips()}},
  renderHead(){
    if(!this.on)return;const ss=this.srcList(),ppl=this.people();
    $('#wTitle').textContent=ss.length?(ppl.length===1?'Suivi de '+ppl[0].R.st.name:ppl.length?'Suivi · '+ppl.length+' coureurs':this.srcName(ss[0])):'Suivi';
    const net=ss.length&&ss.every(S=>S.m&&S.m.connected);$('#wNet').textContent=net?'📡':'📡✖';$('#wNet').classList.toggle('off',!net);$('#wNet').title=net?'Connecté au relais':'Connexion au relais…';
    let u=0;ss.forEach(S=>S.msgs.forEach(m=>{if(!m.fw&&m.pid!==this.me().pid&&m.rt>S.lastRead&&!Moder.hidden(m,this.blk(S)))u++}));const b=$('#wBadge');b.hidden=!u;b.textContent=u>99?'99+':String(u);
    $('#wName').hidden=!!this.me().name||!ss.length;
    const now=Date.now(),sos=ppl.filter(x=>x.R.st.sos&&now-x.R.st.sos<SOS_MS&&x.R.st.status==='on');
    const el=$('#wSos');el.hidden=!sos.length;
    if(sos.length)el.innerHTML=sos.map(x=>`<button type="button" data-wsel="${esc(x.key)}">🆘 <b>${esc(x.R.st.name)}</b> a demandé de l'aide ${fmtAgo(now-x.R.st.sos)} · touche pour voir sa position</button>`).join('');
  },
  /* carte */
  update(){
    if(!this.map||!this.on||current!=='watch'||(!this.wide&&this.tab!=='map'))return;
    const ppl=this.people(),now=Date.now();
    if(this.routesDirty){this.routesDirty=false;this.routeLay.clearLayers();const done=new Set();
      ppl.forEach(({S,R})=>{const r=this.routeOf(S,R);if(!r||done.has(r))return;done.add(r);const col=colorOf(R.pid);
        L.polyline(r.pts.map(q=>[q[0],q[1]]),{color:'#000',weight:ppl.length>1?7:10,opacity:.4,interactive:false}).addTo(this.routeLay);
        /* un seul coureur : tracé jaune (sa trace est à sa couleur) ; plusieurs : tracé en pointillés à sa couleur, la trace parcourue reste en trait plein */
        L.polyline(r.pts.map(q=>[q[0],q[1]]),ppl.length>1?{color:col,weight:4,opacity:.75,dashArray:'9 8',interactive:false}:{color:'#FFD23F',weight:5,opacity:.9,interactive:false}).addTo(this.routeLay);
        const a=r.pts[0],b=r.pts[r.pts.length-1];L.marker([b[0],b[1]],{icon:flagIcon('end'),interactive:false}).addTo(this.routeLay);L.marker([a[0],a[1]],{icon:flagIcon('start'),interactive:false}).addTo(this.routeLay);
        (r.wpts||[]).forEach(w=>{if(w.a!=null)L.marker([w.lat,w.lon],{icon:L.divIcon({className:'wpmk',html:`<i></i><em>${esc(w.n)}</em>`,iconSize:[16,16],iconAnchor:[8,8]}),interactive:false}).addTo(this.routeLay)})})}
    const seenT=new Set(),seenM=new Set();
    ppl.forEach(({S,R,key})=>{const st=R.st,col=colorOf(R.pid);
      if(settings.showTrails){const tr=fullTrackOf(R);if(tr.length>1){seenT.add(key);let p=this.pl[key];if(!p){p=this.pl[key]=L.polyline([],{color:col,weight:4,opacity:.9,interactive:false}).addTo(this.trailLay);p._n=-1}
        if(p._n!==tr.length){p.setLatLngs(tr.map(q=>[q[0],q[1]]));p._n=tr.length}}}
      if(!st.pos)return;seenM.add(key);
      const stale=st.status!=='on'||now-st.pos.t>STALE_MS,sos=st.sos&&now-st.sos<SOS_MS,cls=(stale?'stale ':'')+(sos?'sos ':'')+(this.sel===key?'sel':'');
      let k=this.mk[key];const ik=st.name+'|'+cls;
      if(!k){k=this.mk[key]=L.marker([st.pos.lat,st.pos.lon],{icon:riderIcon(st.name,col,cls),zIndexOffset:sos?5000:1000}).on('click',()=>{this.select(S.code,R.pid);if(!this.wide)this.setTab('run')}).addTo(this.riderLay);k._ik=ik}
      else{k.setLatLng([st.pos.lat,st.pos.lon]);if(k._ik!==ik){k.setIcon(riderIcon(st.name,col,cls));k.setZIndexOffset(sos?5000:1000);k._ik=ik}}
    });
    Object.keys(this.pl).forEach(k=>{if(!seenT.has(k)){this.trailLay.removeLayer(this.pl[k]);delete this.pl[k]}});
    Object.keys(this.mk).forEach(k=>{if(!seenM.has(k)){this.riderLay.removeLayer(this.mk[k]);delete this.mk[k]}});
    if(!this.fitted&&(seenM.size||this.routeLay.getLayers().length)){this.fitted=true;this.fitAll(true)}
    const x=this.selected();if(this.follow&&x&&x.R.st.pos){const c=this.map.getCenter();if(dist({lat:c.lat,lon:c.lng},x.R.st.pos)>20)this.map.panTo([x.R.st.pos.lat,x.R.st.pos.lon],{animate:true,duration:.5})}
    this.chips();
  },
  fitAll(quiet){
    const b=L.latLngBounds([]);this.people().forEach(({S,R})=>{if(R.st.pos)b.extend([R.st.pos.lat,R.st.pos.lon]);const r=this.routeOf(S,R);if(r)r.pts.forEach(q=>b.extend([q[0],q[1]]))});
    if(!b.isValid()){if(!quiet)toast('Pas encore de position à afficher.',true);return}
    this.follow=false;this.map.fitBounds(b,{padding:[40,40],maxZoom:15});
  },
  chips(){
    if(!this.map)return;const now=Date.now();
    $('#wChips').innerHTML=this.people().map(({S,R,key})=>{const st=R.st,s=st.s||{},r=this.routeOf(S,R),pr=st.pr;
      const e=r&&pr&&!pr.w&&st.pe&&!st.fin?etaInfo(r,pr.a,st.pe,st.pos?st.pos.t:now):null,age=st.pos?now-st.pos.t:null;
      return`<button type="button" class="chip wchip${this.sel===key?' on':''}" data-wsel="${esc(key)}" style="--c:${colorOf(R.pid)}"><i></i>${esc(st.name)} · ${fmtKm(s.dist)} km${r&&pr&&!pr.w?' / '+fmtKm(r.L):''}${st.fin?' · 🏁 arrivé':e&&e.fin?' · 🏁 ~'+fmtClock(e.fin):''}${r&&pr&&!pr.w&&!st.fin&&hasPlan(r)&&st.t0?' · '+fmtDelta(planDelta(r,pr.a,st.t0,st.pos?st.pos.t:now),true):''}${st.status==='left'?' · terminé':age!=null&&age>STALE_MS?' · ⏳ '+fmtAgo(age):''}</button>`}).join('');
  },
  /* onglet coureurs : liste + fiche détaillée du coureur choisi */
  renderRun(){
    const box=$('#wRunBody');if(!box)return;const now=Date.now(),ss=this.srcList();
    if(!ss.length){box.innerHTML=`<section class="card"><h2>Personne à suivre</h2><p class="hint">Ouvre le lien reçu du coureur, ou ajoute son code.</p><button type="button" class="primary" data-wact="add">➕ Suivre un coureur</button></section>`;return}
    let h='';const ppl=this.people();
    if(!this.selected()&&ppl.length)this.sel=ppl[0].key;
    ss.forEach(S=>{
      if(S.status==='load')h+=`<section class="card"><p>⏳ Connexion au partage ${fmtCode(S.code)}…</p><button type="button" class="mini" data-wact="rm" data-code="${S.code}">✖ Annuler</button></section>`;
      else if(S.status==='gone')h+=`<section class="card"><p class="warnbox">Ce partage a été effacé.</p><button type="button" class="mini" data-wact="rm" data-code="${S.code}">🗑 Retirer</button></section>`;
      else if(!Object.values(S.riders).some(R=>R.st))h+=`<section class="card"><h2>${esc(this.srcName(S))}</h2><p class="hint">${S.status==='closed'?'Terminé.':'En attente de la première position…'}</p>${this.finBox(S)}<button type="button" class="mini" data-wact="rm" data-code="${S.code}">🗑 Ne plus suivre</button></section>`;
    });
    if(ppl.length>1)h+=`<ul class="group wlist">${ppl.map(({S,R,key})=>{const st=R.st,s=st.s||{},age=st.pos?now-st.pos.t:null;
      return`<li class="${this.sel===key?'on':''}${st.status==='left'?' left':''}"><button type="button" data-wsel="${esc(key)}"><span class="dot" style="background:${colorOf(R.pid)}">${esc(initials(st.name))}</span>
      <span class="gn"><b>${esc(st.name)}</b><small>${esc(this.srcName(S))}</small><small>${fmtKm(s.dist)} km · D+ ${Math.round(s.gain||0)} m</small></span>
      <span class="gr">${st.status==='left'?'terminé':age!=null?(age>STALE_MS?'⏳ ':'')+fmtAgo(age):'pas de GPS'}</span></button></li>`}).join('')}</ul>`;
    const x=this.selected();
    if(x){const{S,R}=x,st=R.st,v=riderView(R,()=>this.routeOf(S,R),colorOf(R.pid)),age=st.pos?now-st.pos.t:null;
      h+=`<section class="card rcard" style="--c:${colorOf(R.pid)}"><p class="rhead"><span class="dot" style="background:${colorOf(R.pid)}">${esc(initials(st.name))}</span><b>${esc(st.name)}</b><span class="tag">${esc(this.srcName(S))}</span></p>
        ${st.sos&&now-st.sos<SOS_MS?`<p class="warnbox">🆘 A demandé de l'aide ${fmtAgo(now-st.sos)}</p>`:''}
        <p class="hint">${st.status==='left'?'<b>Terminé</b> · ':''}Position ${age!=null?fmtAgo(age):'inconnue'}${age!=null&&age>STALE_MS&&st.status==='on'?' (zone sans réseau ? la trace se complète au retour du réseau)':''}${st.bat!=null?' · 🔋 '+st.bat+' %':''}${st.pos&&st.pos.sim?' · position simulée':''}</p>
        ${this.finBox(S)}${v.tiles}
        <div class="row"><button type="button" data-wact="center">🎯 Sur la carte</button><button type="button" data-wact="msg">📣 Encourager</button></div></section>
        ${v.rb}<section class="card">${segTable(v.tr,settings.seg)}</section>`;
    }
    h+=`<button type="button" data-wact="add">➕ Suivre un autre coureur</button>`;
    const sc=box.parentElement.scrollTop;box.innerHTML=h;box.parentElement.scrollTop=sc;
  },
  finBox(S){const f=S.session&&S.session.fin;if(!f||S.status!=='closed')return'';
    return`<p class="finbox">🏁 ${f.arrived?'Arrivé':'Course terminée'} : <b>${fmtKm(f.dist)} km</b> en <b>${fmtTime(f.t1-f.t0)}</b> · D+ ${f.gain} m · fin à ${fmtClock(f.t1)}</p>`},
  /* onglet encouragements */
  renderChat(force){
    if(!this.on)return;const ss=this.srcList();
    if(!this.chatSrc||!this.src[this.chatSrc])this.chatSrc=(ss[0]||{}).code||null;
    $('#wChatSrc').innerHTML=ss.length>1?ss.map(S=>{const R=this.runner(S);return`<button type="button" data-wsrc="${S.code}" aria-pressed="${S.code===this.chatSrc}">${esc(R&&R.st&&this.isLive(S)?R.st.name:this.srcName(S))}</button>`}).join(''):'';
    const S=this.src[this.chatSrc],list=$('#wChatList');
    if(!S){list.innerHTML='<li class="hint">Suis d\'abord un coureur.</li>';return}
    const me=this.me().pid,blk=this.blk(S),arr=[...S.msgs.values()].filter(m=>!Moder.hidden(m,blk)).sort((a,b)=>a.t-b.t),R=this.runner(S),who=R&&R.st?R.st.name:'le coureur';
    const near=list.scrollHeight-list.scrollTop-list.clientHeight<120;
    list.innerHTML=(arr.length?arr.map(m=>{const mine=m.pid===me,col=mine?'#00E5FF':colorOf(m.pid);
      return`<li class="msg${mine?' mine':''}${m.k==='sos'?' sos':''}${m.fw?'':' runner'}"${mine?'':` data-wmid="${esc(m.id)}"`}><div class="mh"><span class="dot" style="background:${col};${mine?'color:#000':''}">${esc(initials(m.name))}</span><b>${mine?'Moi':esc(m.name)}</b><time>${hhmm(m.t)}</time></div><p>${esc(Moder.clean(m.text))}</p>
      ${m.pos?`<button type="button" class="mini" data-wpos="${m.pos.lat},${m.pos.lon}">📍 Voir sur la carte</button>`:''}</li>`}).join('')
      :`<li class="hint">Envoie un encouragement à ${esc(who)} : ${this.isLive(S)?'il s\'affiche sur son téléphone et lui est lu à voix haute.':'tout le groupe le reçoit.'}</li>`)
      +(S.status!=='open'?'<li class="sys">Terminé : les messages ne partent plus.</li>':'');
    if(near||force)list.scrollTop=list.scrollHeight;
    $('#wQuick').innerHTML=QUICK_FAN.map((q,i)=>`<button type="button" data-wq="${i}">${q.t}</button>`).join('');
  },
  menu(){
    const box=document.createElement('div');box.className='menu';
    box.innerHTML=`<button type="button" class="primary" data-wm="add">➕ Suivre un autre coureur</button>
      <button type="button" data-wm="fit">👥 Voir tout le monde sur la carte</button>
      <button type="button" data-wm="replay">▶ Rejouer ${this.srcList().length>1?'(coureur choisi)':'depuis le départ'}</button>
      <button type="button" data-wm="map">🗂 Fond de carte</button>
      <button type="button" data-wm="name">✏ Mon prénom${this.me().name?' : '+esc(this.me().name):''}</button>
      ${Notify.state()==='default'?'<button type="button" data-wm="notif">🔔 Activer les notifications (messages, alertes)</button>':''}
      <h2>Suivis</h2><ul class="rlist">${this.srcList().map(S=>`<li><span><b>${esc(this.srcName(S))}</b><small>${this.isLive(S)?'Course':'Sortie Group Run'} · code ${fmtCode(S.code)}</small></span><button type="button" class="mini" data-wm="share" data-code="${S.code}" aria-label="Partager le lien">📤</button><button type="button" class="mini danger" data-wm="rm" data-code="${S.code}" aria-label="Ne plus suivre">🗑</button></li>`).join('')||'<li class="hint">Aucun</li>'}</ul>
      <button type="button" data-wm="help">❓ Aide</button><button type="button" data-wm="home">🏠 Accueil (le suivi continue)</button>`;
    Sheet.show('Suivi',box);
    box.onclick=async e=>{const b=e.target.closest('[data-wm]');if(!b)return;const k=b.dataset.wm;
      if(k==='add'){Sheet.hide();WAdd.open()}
      if(k==='fit'){Sheet.hide();if(!this.wide)this.setTab('map');setTimeout(()=>this.fitAll(),80)}
      if(k==='map'){MapOpts.open(true)}
      if(k==='name'){const r=await modal({title:'Ton prénom',body:'<p>Il signe tes encouragements et le coureur voit qui le suit.</p>',input:{value:this.me().name,placeholder:'Prénom'},buttons:[{label:'✔ OK',value:true,primary:true},{label:'Annuler',value:false}]});if(r&&r.value&&r.text){this.setName(r.text);Sheet.hide()}}
      if(k==='share'){const S=this.src[b.dataset.code];if(!S)return;const url=this.isLive(S)?liveURL(S.code):joinURL(S.code),text=`Suis « ${this.srcName(S)} » en direct sur Follow Trail : ${url}`;
        try{if(NATIVE)await P.share.share({title:'Follow Trail',text});else if(navigator.share)await navigator.share({title:'Follow Trail',text});else{await navigator.clipboard.writeText(text);toast('Lien copié')}}catch(err){}}
      if(k==='rm'){Sheet.hide();this.remove(b.dataset.code,true)}
      if(k==='help'){Sheet.hide();show('help')}
      if(k==='replay'){const x=this.selected(),code=x?x.S.code:(this.srcList()[0]||{}).code;const d=code&&watchReplayData(code);if(d)Replay.open(d);else toast('Rien à rejouer pour l\'instant.',true)}
      if(k==='notif'){const st=await Notify.ask();Sheet.hide();toast(st==='granted'?'Notifications activées':'Notifications refusées par le navigateur',st!=='granted')}
      if(k==='home'){Sheet.hide();show('home')}
    };
  }
};
$('#wTabs').addEventListener('click',e=>{const b=e.target.closest('[data-wtab]');if(b)Watch.setTab(b.dataset.wtab)});
$('#wMenu').onclick=()=>Watch.menu();
$('#wAll').onclick=()=>Watch.fitAll();
$('#wTrail').onclick=()=>{settings.showTrails=!settings.showTrails;saveSettings();$('#wTrail').classList.toggle('on',settings.showTrails);toast(settings.showTrails?'Positions + traces':'Positions seules');Watch.update()};
$('#wLayers').onclick=()=>MapOpts.open(true);
$('#wNameOk').onclick=()=>{const n=$('#wNameIn').value.trim();if(!n){$('#wNameIn').focus();return}Watch.setName(n);toast('Merci '+n+' !');Notify.ask()};
$('#wNameIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('#wNameOk').click()});
$('#watch').addEventListener('click',e=>{
  const s=e.target.closest('[data-wsel]');if(s){const[c,p]=s.dataset.wsel.split('|');Watch.select(c,p);if(!Watch.wide&&e.target.closest('#wSos'))Watch.setTab('map');return}
  const a=e.target.closest('[data-wact]');if(a){const k=a.dataset.wact,x=Watch.selected();
    if(k==='add')WAdd.open();
    if(k==='rm')Watch.remove(a.dataset.code,true);
    if(k==='center'&&x){Watch.follow=true;if(!Watch.wide)Watch.setTab('map');setTimeout(()=>{if(x.R.st.pos)Watch.map.setView([x.R.st.pos.lat,x.R.st.pos.lon],15);Watch.update()},60)}
    if(k==='msg'&&x){Watch.chatSrc=x.S.code;Watch.setTab('chat');setTimeout(()=>$('#wChatIn').focus(),80)}
    return}
  const q=e.target.closest('[data-wq]');if(q){const it=QUICK_FAN[+q.dataset.wq];Watch.send(it.t,it).then(ok=>{if(ok){vib(40);toast('Envoyé !')}});return}
  const sr=e.target.closest('[data-wsrc]');if(sr){Watch.chatSrc=sr.dataset.wsrc;const S=Watch.src[Watch.chatSrc];if(S)S.lastRead=Date.now();Watch.saveList();Watch.renderChat(true);Watch.renderHead();return}
  const wm=!e.target.closest('button,a')&&e.target.closest('li[data-wmid]');if(wm){const S=Watch.src[Watch.chatSrc],m=S&&S.msgs.get(wm.dataset.wmid);if(m)Moder.open(m,{org:false}).then(v=>{if(v){Watch.renderChat(true);Watch.renderHead()}});return}
  const ps=e.target.closest('[data-wpos]');if(ps){const[lat,lon]=ps.dataset.wpos.split(',').map(Number);if(!Watch.wide)Watch.setTab('map');Watch.follow=false;setTimeout(()=>{Watch.map.setView([lat,lon],16);L.circleMarker([lat,lon],{radius:22,color:'#FF2BD6',weight:4,fill:false,interactive:false}).addTo(Watch.routeLay)},80)}
});
$('#wChatForm').addEventListener('submit',e=>{e.preventDefault();const i=$('#wChatIn');Watch.send(i.value).then(ok=>{if(ok){i.value='';i.focus()}})});
$('#wRunBody').addEventListener('pointerdown',()=>{Watch.busy=true;clearTimeout(Watch.bt)});
['pointerup','pointercancel'].forEach(ev=>$('#wRunBody').addEventListener(ev,()=>{clearTimeout(Watch.bt);Watch.bt=setTimeout(()=>Watch.busy=false,600)}));
window.addEventListener('resize',()=>{if(Watch.on)Watch.layout()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Watch.on){Watch.srcList().forEach(S=>{if(S.m)S.m.kick();Watch.presence(S)});Watch.render(true)}});
window.addEventListener('online',()=>{Watch.srcList().forEach(S=>S.m&&S.m.kick())});

/* ---------------- Ajouter un coureur à suivre ---------------- */
const WAdd={
  open(){show('wadd');$('#waCode').value='';$('#waScan').hidden=!QR.ok();setTimeout(()=>$('#waCode').focus(),80)},
  go(){const c=normCode($('#waCode').value);if(!validCode(c)){toast('Code invalide : il faut le code complet (chiffres et lettres), ou colle le lien reçu.',true);return}QR.stop();Watch.add(c)}
};
$('#waGo').onclick=()=>WAdd.go();
$('#waCode').addEventListener('keydown',e=>{if(e.key==='Enter')WAdd.go()});
$('#waScan').onclick=()=>{if(QR.stream)QR.stop();else QR.start($('#waVideo'),$('#waScan'),c=>Watch.add(c))};
