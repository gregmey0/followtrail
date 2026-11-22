/* ---------------- Rejouer la sortie ----------------
   Tout le monde sur la carte, en accéléré : frise du temps, lecture/pause, vitesse.
   Données : [{name, col, pts:[[lat,lon,t,alt]]}] et les tracés suivis. Disponible pendant la sortie
   (menu), dans le bilan (les traces de tous sont gardées à la fin) et dans le suivi. */
const REPLAY_SPEEDS=[10,30,60,120,300,600,1200];
const Replay={map:null,P:[],t0:0,t1:0,t:0,playing:false,speed:60,back:'home',follow:null,raf:null,
  open(d){
    const P=(d.people||[]).filter(p=>p&&p.pts&&p.pts.length>1).map(p=>{const c=[0];for(let k=1;k<p.pts.length;k++)c.push(c[k-1]+dist(p.pts[k-1],p.pts[k]));return{name:p.name,col:p.col,pts:p.pts,cum:c,i:0}});
    if(!P.length){toast('Pas encore de trace à rejouer.',true);return}
    this.stop();this.back=current==='replay'?this.back:current;this.P=P;this.follow=null;
    this.t0=Math.min(...P.map(p=>p.pts[0][2]));this.t1=Math.max(...P.map(p=>p.pts[p.pts.length-1][2]));
    Sheet.hide();show('replay');$('#rpTitle').textContent=d.title||'Rejouer';
    if(!this.map){this.map=makeMap($('#rpMap'));this.lay=L.layerGroup().addTo(this.map);this.map.on('dragstart',()=>{this.follow=null;this.chips()})}
    this.lay.clearLayers();
    (d.routes||[]).forEach(r=>{if(r&&r.pts)L.polyline(r.pts.map(q=>[q[0],q[1]]),{color:'#FFD23F',weight:4,opacity:.7,dashArray:'8 8',interactive:false}).addTo(this.lay)});
    P.forEach(p=>{
      L.polyline(p.pts.map(q=>[q[0],q[1]]),{color:p.col,weight:3,opacity:.22,interactive:false}).addTo(this.lay);
      p.line=L.polyline([],{color:p.col,weight:5,opacity:.95,interactive:false}).addTo(this.lay);
      p.mk=L.marker([p.pts[0][0],p.pts[0][1]],{icon:riderIcon(p.name,p.col,''),zIndexOffset:1000}).addTo(this.lay).on('click',()=>this.setFollow(p));
    });
    const dur=(this.t1-this.t0)/1000;
    /* vitesse par défaut : toute la sortie en une minute et demie environ */
    this.speed=REPLAY_SPEEDS.reduce((b,s)=>Math.abs(s-dur/90)<Math.abs(b-dur/90)?s:b,REPLAY_SPEEDS[0]);
    $('#rpSpeed').innerHTML=REPLAY_SPEEDS.map(s=>`<option value="${s}"${s===this.speed?' selected':''}>× ${s}</option>`).join('');
    const sl=$('#rpSlider');sl.max=String(Math.max(1,Math.round(dur)));sl.value='0';
    $('#rpDur').textContent=fmtTime(dur*1000);
    setTimeout(()=>{this.map.invalidateSize();const b=L.latLngBounds([]);P.forEach(p=>p.pts.forEach(q=>b.extend([q[0],q[1]])));if(b.isValid())this.map.fitBounds(b,{padding:[30,30],maxZoom:16});this.seek(this.t0,true)},80);
    this.btn();
  },
  /* position interpolée d'un participant à l'instant t */
  at(p,t){const a=p.pts,n=a.length;
    if(t<=a[0][2])return{i:0,ll:[a[0][0],a[0][1]],d:0,pre:true};
    if(t>=a[n-1][2])return{i:n-1,ll:[a[n-1][0],a[n-1][1]],d:p.cum[n-1],end:true};
    let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(a[m][2]<=t)lo=m;else hi=m}
    const f=(t-a[lo][2])/Math.max(1,a[hi][2]-a[lo][2]);
    return{i:lo,ll:[a[lo][0]+(a[hi][0]-a[lo][0])*f,a[lo][1]+(a[hi][1]-a[lo][1])*f],d:p.cum[lo]+(p.cum[hi]-p.cum[lo])*f}},
  seek(t,full){
    this.t=Math.max(this.t0,Math.min(this.t1,t));
    this.P.forEach(p=>{const r=this.at(p,this.t);
      if(full||r.i<p.i||!p.lls)p.lls=p.pts.slice(0,r.i+1).map(q=>[q[0],q[1]]);
      else for(let k=p.i+1;k<=r.i;k++)p.lls.push([p.pts[k][0],p.pts[k][1]]);
      p.i=r.i;p.cur=r;p.line.setLatLngs(r.pre?[]:p.lls.concat([r.ll]));p.mk.setLatLng(r.ll);p.mk.setOpacity(r.pre?.45:1)});
    $('#rpClock').textContent=new Date(this.t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    $('#rpEl').textContent='+'+fmtTime(this.t-this.t0);
    $('#rpSlider').value=String(Math.round((this.t-this.t0)/1000));
    if(this.follow&&this.follow.cur)this.map.panTo(this.follow.cur.ll,{animate:false});
    this.chips();
  },
  chips(){
    $('#rpChips').innerHTML=this.P.map((p,k)=>`<button type="button" class="chip wchip${this.follow===p?' on':''}" data-rp="${k}" style="--c:${p.col}"><i></i>${esc(p.name)} · ${fmtKm(p.cur?p.cur.d:0)} km${p.cur&&p.cur.end?' · 🏁':''}</button>`).join('');
  },
  setFollow(p){this.follow=this.follow===p?null:p;if(this.follow&&p.cur)this.map.setView(p.cur.ll,Math.max(this.map.getZoom(),15));this.chips()},
  play(){
    if(this.t>=this.t1)this.seek(this.t0,true);
    this.playing=true;this.btn();let last=performance.now();
    const step=now=>{if(!this.playing)return;const dt=Math.min(250,now-last);last=now;this.seek(this.t+dt*this.speed);
      if(this.t>=this.t1){this.playing=false;this.btn();return}this.raf=requestAnimationFrame(step)};
    this.raf=requestAnimationFrame(step);
  },
  stop(){this.playing=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=null;this.btn()},
  btn(){const b=$('#rpPlay');if(b){b.textContent=this.playing?'⏸ Pause':'▶ Lecture';b.setAttribute('aria-pressed',String(this.playing))}}
};
$('#rpPlay').onclick=()=>{if(Replay.playing)Replay.stop();else Replay.play()};
$('#rpSpeed').onchange=e=>{Replay.speed=+e.target.value||60};
$('#rpSlider').addEventListener('input',e=>{Replay.seek(Replay.t0+(+e.target.value)*1000)});
$('#rpChips').addEventListener('click',e=>{const b=e.target.closest('[data-rp]');if(b)Replay.setFollow(Replay.P[+b.dataset.rp])});
$('#rpBack15').onclick=()=>Replay.seek(Replay.t-Math.max(60000,(Replay.t1-Replay.t0)/40),true);
$('#rpFwd15').onclick=()=>Replay.seek(Replay.t+Math.max(60000,(Replay.t1-Replay.t0)/40));

/* données à rejouer */
function thinTrack(tr,max=4000){if(!tr||tr.length<=max)return tr||[];const k=Math.ceil(tr.length/max),o=[];for(let i=0;i<tr.length;i+=k)o.push(tr[i]);if(o[o.length-1]!==tr[tr.length-1])o.push(tr[tr.length-1]);return o}
function rideReplayData(){
  const people=[{name:Ride.name,col:'#00E5FF',pts:thinTrack(Ride.shared.length?Ride.shared:Ride.track)}]
    .concat(Ride.others().map(R=>({name:R.st.name,col:colorOf(R.pid),pts:thinTrack(fullTrackOf(R))})));
  const routes=[Ride.followRoute()].concat(Object.values(Ride.routes)).filter((r,i,a)=>r&&a.indexOf(r)===i);
  return{title:Ride.sname||'Sortie',people,routes};
}
function summaryReplayData(sm){
  const me=sm.seg?decTrack(sm.seg):sm.track?decTrack(sm.track):[];
  const people=[{name:sm.me||'Moi',col:'#00E5FF',pts:me}].concat((sm.others||[]).map(o=>({name:o.n,col:o.c,pts:decTrack(o.t)})));
  return{title:sm.name,people,routes:sm.route?[decRoute(sm.route)]:[]};
}
function watchReplayData(code){
  const S=Watch.src[code];if(!S)return null;
  const people=Object.values(S.riders).filter(R=>R.st).map(R=>({name:R.st.name,col:colorOf(R.pid),pts:thinTrack(fullTrackOf(R))}));
  const routes=Object.values(S.riders).filter(R=>R.st).map(R=>Watch.routeOf(S,R)).filter((r,i,a)=>r&&a.indexOf(r)===i);
  return{title:Watch.srcName(S),people,routes};
}
