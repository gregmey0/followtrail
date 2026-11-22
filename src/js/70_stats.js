/* ---------------- Écran statistiques ---------------- */
const Stats={
  render(){
    if(!Ride.on)return;
    /* tronçons et VAM calculés sur la trace partagée : exactement ce que voient les suiveurs */
    const s=Ride.stats,now=Date.now(),tr=Ride.shared,live=Ride.mode==='live',t0=Ride.runStart||Ride.start;
    let h=`<section class="card"><h2>${live?'Ma course':'Moi'}</h2>
      ${statTiles({dist:s.dist,mov:s.mov,el:Ride.runStart?(Ride.finT||now)-t0:0,gain:s.gain,loss:s.loss,alt:s.alt,spd:s.spd,vam:recentVAM(tr)})}
      <p class="hint">${Ride.followRoute()?'Altitude et dénivelé : ceux du GPX quand tu es sur le tracé, ceux du GPS (recalés) ailleurs.':'Altitude et dénivelé viennent du GPS du téléphone : ce sont des estimations (± 10 à 20 m). Avec un GPX suivi, ils sont tirés du tracé.'}</p>
      <button type="button" id="stReset">↺ Remettre les compteurs à zéro (au départ)</button></section>`;
    if(live){const w=Ride.watching();
      h+=`<section class="card"><h2>👀 Ils te suivent</h2>${w.length?`<p><b>${w.map(x=>esc(x.name)).join(', ')}</b></p>`:'<p class="hint">Personne pour l\'instant.</p>'}<button type="button" id="stInvite">🔗 Envoyer le lien de suivi</button></section>`}
    const fr=Ride.followRoute(),pr=Ride.prog;
    if(fr){
      const ok=pr&&pr.rid===fr.id,dots=[];
      Ride.others().forEach(R=>{const st=R.st;if(st.status!=='on'||!st.pr||!st.f||st.pr.w)return;
        if(st.f.k==='org'&&Ride.follow&&Ride.follow.k==='org'&&st.f.id===Ride.follow.id)dots.push({a:st.pr.a,col:colorOf(R.pid),title:st.name})});
      if(ok&&!pr.wait)dots.push({a:pr.along,col:'#00E5FF',me:true,title:'Moi'});
      h+=routeBlock({r:fr,a:ok&&!pr.wait?pr.along:null,off:ok?pr.off:null,wait:ok?pr.wait:false,pe:Ride.pe,tRef:GPS.last?GPS.last.t:now,fin:Ride.finT,t0:Ride.runStart,passed:Ride.passed,dots});
    }else h+=`<section class="card"><h2>🧭 Parcours</h2><p class="hint">Importe le GPX du parcours (☰ Menu › Tracé GPX) : avancement, dénivelé restant${live?', arrivée estimée pour ceux qui te suivent':' et arrivée estimée'}.</p></section>`;
    h+=`<section class="card">${segTable(tr,settings.seg)}</section>`;
    if(!live)h+=`<section class="card"><h2>Le groupe</h2><ul class="group">${this.groupRows()}</ul></section>`;
    $('#statsBody').innerHTML=h;
  },
  groupRows(){
    const now=Date.now(),me=GPS.last,mine=Ride.prog,myId=Ride.follow&&Ride.follow.k==='org'?Ride.follow.id:null;
    const rows=[];
    const s=Ride.stats;
    const avgP=(d,t0,t1)=>t0&&t1>t0&&d>50?pace(d/((t1-t0)/1000)):'—';
    rows.push(`<li class="me"><span class="dot" style="background:#00E5FF;color:#000">${esc(initials(Ride.name))}</span><span class="gn"><b>${esc(Ride.name)} (moi)</b><small>${fmtKm(s.dist)} km · ${avgP(s.dist,Ride.runStart,Ride.finT||now)} /km · D+ ${Math.round(s.gain||0)} m</small></span></li>`);
    const arr=Ride.others().sort((a,b)=>(a.st.status==='on'?0:1)-(b.st.status==='on'?0:1)||a.st.name.localeCompare(b.st.name,'fr'));
    arr.forEach(R=>{
      const st=R.st,ss=st.s||{},left=st.status==='left',age=st.pos?now-st.pos.t:null,sos=st.sos&&now-st.sos<SOS_MS;
      let rel='';
      if(!left&&st.pos&&me)rel='à '+fmtDist(dist(me,st.pos));
      if(!left&&myId&&st.f&&st.f.k==='org'&&st.f.id===myId&&st.pr&&!st.pr.w&&mine&&mine.rid===myId&&!mine.wait){const dd=st.pr.a-mine.along;rel=Math.abs(dd)<100?'avec toi':(dd>0?fmtDist(dd)+' devant':fmtDist(-dd)+' derrière')+' sur le tracé'}
      rows.push(`<li class="${left?'left':''}${sos?' sos':''}"><button type="button" data-rider="${R.pid}">
        <span class="dot" style="background:${colorOf(R.pid)}">${esc(initials(st.name))}</span>
        <span class="gn"><b>${esc(st.name)}${st.org?' <span class="tag">orga</span>':''}${sos?' 🆘':''}</b>
        <small>${fmtKm(ss.dist)} km · ${avgP(ss.dist||0,st.t0,st.fin||(st.pos?st.pos.t:now))} /km · D+ ${Math.round(ss.gain||0)} m</small>
        ${progressLine(st,false)}</span>
        <span class="gr">${left?'a quitté':esc(rel)}<small>${left?'':age!=null?(age>STALE_MS?'⚠ ':'')+fmtAgo(age):'pas de GPS'}${st.bat!=null?' · 🔋'+st.bat+'%':''}</small></span></button></li>`);
    });
    if(!arr.length)rows.push(`<li class="hint">Personne d'autre pour l'instant. Invite le groupe : ☰ Menu › Inviter.</li>`);
    return rows.join('');
  }
};
$('#statsBody').addEventListener('pointerdown',()=>{Stats.busy=true;clearTimeout(Stats.bt)});
['pointerup','pointercancel'].forEach(ev=>$('#statsBody').addEventListener(ev,()=>{clearTimeout(Stats.bt);Stats.bt=setTimeout(()=>Stats.busy=false,400)}));
$('#statsBody').addEventListener('click',e=>{const b=e.target.closest('[data-rider]');if(b)RiderInfo.open(b.dataset.rider);
  if(e.target.closest('#stReset'))Ride.resetStats();if(e.target.closest('#stInvite'))Invite.open()});
/* taille des tronçons (1 ou 5 km) : mémorisée, appliquée partout */
document.addEventListener('click',e=>{const b=e.target.closest('[data-seg]');if(!b)return;settings.seg=+b.dataset.seg===5000?5000:1000;saveSettings();
  if(RiderInfo.pid&&Sheet.open)RiderInfo.render();if(Summary.cur&&Sheet.open)Summary.open(Summary.cur,true);if(Ride.on&&Ride.tab==='stats')Stats.render();if(typeof Watch!=='undefined'&&Watch.on)Watch.render(true)});
