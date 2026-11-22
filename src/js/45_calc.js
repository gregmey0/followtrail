/* ---------------- Calculs course : tronçons, VAM, km-effort, arrivée estimée ----------------
   Trace : points [lat, lon, t (ms), altitude (m) | null].
   km-effort : 1 km de distance + 1 km par 100 m de D+ (repère classique en trail). */
const EFF_D=100;
const effortAt=(r,a)=>a/1000+gainAt(r,a)/EFF_D;

/* tronçons de longueur fixe (1 ou 5 km), le dernier en cours */
function segments(tr,size){
  const out=[];if(!tr||tr.length<2)return out;
  let cum=0,ref=null,seg={i:0,d:0,t0:tr[0][2],t1:tr[0][2],g:0,l:0};
  const feed=e=>{if(e==null)return;if(ref==null){ref=e;return}if(e-ref>=3){seg.g+=e-ref;ref=e}else if(ref-e>=3){seg.l+=ref-e;ref=e}};
  feed(tr[0][3]);
  for(let k=1;k<tr.length;k++){
    const A=tr[k-1],B=tr[k],d=dist(A,B);
    if(!(d>0)){seg.t1=B[2];feed(B[3]);continue}
    let used=0;
    while(cum+(d-used)>=(out.length+1)*size-1e-6){
      const need=(out.length+1)*size-cum,f=Math.min(1,(used+need)/d),t=A[2]+(B[2]-A[2])*f;
      feed(A[3]!=null&&B[3]!=null?A[3]+(B[3]-A[3])*f:null);
      seg.d+=need;seg.t1=t;cum+=need;used+=need;out.push(seg);
      seg={i:out.length,d:0,t0:t,t1:t,g:0,l:0};
    }
    const rest=d-used;seg.d+=rest;cum+=rest;seg.t1=B[2];feed(B[3]);
  }
  if(seg.d>=30){seg.part=true;out.push(seg)}
  return out;
}
/* vitesse sur la dernière minute de trace (plus stable que la vitesse GPS instantanée) */
function recentSpeed(tr,ms=60000,now){
  if(!tr||tr.length<2)return null;const T=tr[tr.length-1][2];
  if(now&&now-T>45000)return 0;
  let d=0,i=tr.length-1;
  while(i>0&&tr[i-1][2]>=T-ms){d+=dist(tr[i-1],tr[i]);i--}
  const dt=(T-tr[i][2])/1000;return dt>=20?d/dt:null;
}
/* VAM : mètres de D+ par heure sur les 10 dernières minutes */
function recentVAM(tr,ms=600000){
  if(!tr||tr.length<2)return null;const T=tr[tr.length-1][2];
  let i=tr.length-1;while(i>0&&tr[i-1][2]>=T-ms)i--;
  const dt=(T-tr[i][2])/3600000;if(dt<2/60)return null;
  let g=0,ref=null;for(let k=i;k<tr.length;k++){const e=tr[k][3];if(e==null)continue;if(ref==null)ref=e;else if(e-ref>=3){g+=e-ref;ref=e}else if(ref-e>=3)ref=e}
  return{vam:g/dt,g};
}
/* allure-effort (secondes par km-effort) : 60 % les 10 derniers km-effort, 40 % depuis le départ.
   hist : [[t, km-effort fait]] relevés toutes les 30 s sur le tracé. */
function effortPace(h){
  if(!h||h.length<2)return null;const[tn,en]=h[h.length-1],[t0,e0]=h[0];
  if(en-e0<2)return null;
  const all=(tn-t0)/1000/(en-e0);
  let j=h.length-1;while(j>0&&en-h[j][1]<10)j--;
  const de=en-h[j][1],rec=de>=3?(tn-h[j][0])/1000/de:null;
  return Math.round(rec!=null&&j>0?0.6*rec+0.4*all:all);
}
/* arrivée et points de passage estimés */
function etaInfo(r,a,pe,tRef){
  if(!r)return null;const eNow=effortAt(r,a),eEnd=effortAt(r,r.L);
  const o={dLeft:Math.max(0,r.L-a),gLeft:r.gain!=null?Math.max(0,r.gain-gainAt(r,a)):null,effLeft:Math.max(0,eEnd-eNow),fin:null,wps:[]};
  if(pe)o.fin=tRef+o.effLeft*pe*1000;
  (r.wpts||[]).forEach(w=>{if(w.a==null||w.a<=a+50||r.L-w.a<80)return;
    o.wps.push({n:w.n,a:w.a,d:w.a-a,t:pe?tRef+(effortAt(r,w.a)-eNow)*pe*1000:null})});
  return o;
}

/* ---------- affichage commun (coureur et suiveurs) ---------- */
/* tuiles : o = {dist, mov, el (durée depuis le départ), gain, loss, alt, spd (m/s), vam} */
function statTiles(o){
  const avg=o.mov>0?o.dist/(o.mov/1000):null,glob=o.el>0&&o.dist>50?o.dist/(o.el/1000):null;
  return`<div class="tiles">
    ${tile('Distance',fmtKm(o.dist),'km','big')}${tile('Allure actuelle',pace(o.spd),'/km','big')}
    ${tile('Temps de course',fmtTime(o.el||0),'')}${tile('Allure moyenne',pace(glob),'/km')}
    ${tile('Dénivelé',o.gain!=null?'+'+Math.round(o.gain||0)+' / −'+Math.round(o.loss||0):'—','m')}${tile('VAM (10 min)',o.vam&&o.vam.g>=5?Math.round(o.vam.vam):'—','m/h')}
    ${tile('Vitesse moyenne',kmh(glob),'km/h')}${tile('En mouvement',pace(avg),'/km')}
    ${tile('km-effort',dec((o.dist||0)/1000+(o.gain||0)/EFF_D,1),'')}${tile('Altitude',o.alt!=null?'≈ '+Math.round(o.alt):'—','m')}
  </div>`;
}
/* tableau des tronçons */
function segTable(tr,size,tag){
  const sg=segments(tr,size);
  const sw=`<div class="segsw" role="group" aria-label="Taille des tronçons"><button type="button" data-seg="1000" aria-pressed="${size===1000}">1 km</button><button type="button" data-seg="5000" aria-pressed="${size===5000}">5 km</button></div>`;
  if(!sg.length)return`<div class="seghead"><h2>Tronçons</h2>${sw}</div><p class="hint">Le tableau se remplit dès les premiers mètres de course.</p>`;
  const durs=sg.filter(s=>!s.part).map(s=>(s.t1-s.t0)/s.d);const best=durs.length>1?Math.min(...durs):null,worst=durs.length>1?Math.max(...durs):null;
  let tt=0,tg=0,tl=0,td=0;
  const rows=sg.map(s=>{const dur=s.t1-s.t0,ps=dur/1000/(s.d/1000),v=s.d/(dur/1000),vam=s.g>=15&&dur>0?Math.round(s.g/(dur/3600000)):null;tt+=dur;tg+=s.g;tl+=s.l;td+=s.d;
    const k=dur/s.d,cls=s.part?'part':best!=null&&k===best?'best':worst!=null&&k===worst?'worst':'';
    const from=s.i*size/1000,to=from+s.d/1000;
    return`<tr class="${cls}"><th scope="row">${s.part?dec(from,0)+'–'+dec(to,1).replace(',0',''):dec(to,0)}${s.part?' <small>en cours</small>':''}</th><td>${fmtTime(dur)}</td><td><b>${fmtPaceS(ps)}</b><small>${kmh(v)} km/h</small></td><td>+${Math.round(s.g)}<small>−${Math.round(s.l)}</small></td><td>${vam!=null?vam:'—'}</td></tr>`}).join('');
  return`<div class="seghead"><h2>Tronçons</h2>${sw}</div>
    <div class="segwrap"><table class="seg"${tag?` data-tag="${esc(tag)}"`:''}><thead><tr><th scope="col">km</th><th scope="col">Temps</th><th scope="col">Allure<small>vitesse</small></th><th scope="col">D+<small>D−</small></th><th scope="col">VAM<small>m/h</small></th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th><td>${fmtTime(tt)}</td><td><b>${fmtPaceS(tt/1000/(td/1000))}</b><small>${kmh(td/(tt/1000))} km/h</small></td><td>+${Math.round(tg)}<small>−${Math.round(tl)}</small></td><td>${tg>=15?Math.round(tg/(tt/3600000)):'—'}</td></tr></tfoot></table></div>
    <p class="hint">Vert : tronçon le plus rapide, rouge : le plus lent. VAM = mètres de dénivelé positif par heure, affichée dès 15 m de D+ sur le tronçon.</p>`;
}
/* profil d'un tracé : positions (dots : [{a, col, me, title}]) et points de passage */
function profileSVG(r,dots){
  if(!r||!r.hasEle||r.L<100)return'';
  const W=600,H=160,top=14,bot=22,p=r.pts;let mn=Infinity,mx=-Infinity;p.forEach(q=>{if(q[2]!=null){mn=Math.min(mn,q[2]);mx=Math.max(mx,q[2])}});
  if(mx-mn<20){const c=(mx+mn)/2;mn=c-10;mx=c+10}
  const X=d=>d/r.L*W,Y=e=>top+(1-(e-mn)/(mx-mn))*(H-top-bot);
  const step=Math.max(1,Math.floor(p.length/400));let d='M0,'+(H-bot);
  for(let i=0;i<p.length;i+=step)if(p[i][2]!=null)d+=` L${X(r.cum[i]).toFixed(1)},${Y(p[i][2]).toFixed(1)}`;
  d+=` L${W},${Y(p[p.length-1][2]??mn).toFixed(1)} L${W},${H-bot} Z`;
  const at=a=>eleAt(r,a)??mn;
  const wp=(r.wpts||[]).filter(w=>w.a!=null).map(w=>`<g><line x1="${X(w.a).toFixed(1)}" x2="${X(w.a).toFixed(1)}" y1="${top}" y2="${H-bot}" class="wl"/><title>${esc(w.n)} · km ${fmtKm(w.a)}</title></g>`).join('');
  const dots2=(dots||[]).map(o=>`<g><circle cx="${X(o.a).toFixed(1)}" cy="${Y(at(o.a)).toFixed(1)}" r="${o.me?9:7}" fill="${o.col}" stroke="${o.me?'#000':'#fff'}" stroke-width="${o.me?3:2}"/><title>${esc(o.title||'')}</title></g>`).join('');
  return`<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil du tracé : de ${Math.round(mn)} à ${Math.round(mx)} m d'altitude">
    <path d="${d}" fill="rgba(255,138,31,.22)" stroke="#FF8A1F" stroke-width="2.5"/>${wp}
    <text x="4" y="${top+10}" class="pt">${Math.round(mx)} m</text><text x="4" y="${H-bot-4}" class="pt">${Math.round(mn)} m</text>
    <text x="${W-4}" y="${H-5}" text-anchor="end" class="pt">${fmtKm(r.L)} km</text><text x="4" y="${H-5}" class="pt">0</text>${dots2}</svg>`;
}
/* bloc « tracé suivi » : avancement, arrivée estimée, points de passage, profil.
   o = {r, a (distance le long du tracé), off, wait, pe (s par km-effort), tRef, dots, fin (course terminée), t0 (départ), passed ({n° du point : heure})} */
function routeBlock(o){
  const r=o.r;if(!r)return'';
  const ok=o.a!=null&&!o.wait,pct=ok&&r.L?Math.min(100,Math.round(o.a/r.L*100)):0,offLim=settings.offDist||50;
  let h=`<section class="card"><h2>🧭 ${esc(r.name)}</h2>
    <p><b>${ok?fmtKm(o.a):'—'} / ${fmtKm(r.L)} km</b>${r.gain!=null?` · D+ ${r.gain} m`:''}${ok?` · ${pct} %`:o.wait?` · pas encore sur le tracé${o.off!=null?' (à '+fmtDist(o.off)+')':''}`:' · en attente du GPS'}</p>
    ${ok&&o.off>offLim?`<p class="warnbox">⚠ Hors tracé : ${fmtDist(o.off)}</p>`:''}
    <div class="pbar"><i style="width:${pct}%"></i></div>`;
  const plan=hasPlan(r),passed=o.passed||{},clk=sec=>o.t0?fmtClock(o.t0+sec*1000):fmtHM(sec);
  if(o.fin)h+=`<p class="finbox">🏁 Arrivée à ${fmtClock(o.fin)}${o.t0?' · '+fmtTime(o.fin-o.t0):''}${plan&&r.pf&&o.t0?' · '+fmtDelta(r.pf-(o.fin-o.t0)/1000):''}</p>`;
  if(plan&&ok&&!o.fin&&o.t0){const d=planDelta(r,o.a,o.t0,o.tRef);if(d!=null)h+=`<p class="plandelta ${d>=60?'ahead':d<=-60?'late':''}">⏱ Plan de course : <b>${fmtDelta(d)}</b></p>`}
  else if(plan&&!o.t0&&r.pf)h+=`<p class="hint">⏱ Plan de course : arrivée prévue en ${fmtHM(r.pf)}</p>`;
  if(ok&&!o.fin){
    const e=etaInfo(r,o.a,o.pe,o.tRef);
    h+=`<div class="eta"><div><span>Reste</span><b>${fmtKm(e.dLeft)} km</b><small>${e.gLeft!=null?'D+ '+Math.round(e.gLeft)+' m · ':''}${dec(e.effLeft,1)} km-effort</small></div>
      <div class="fin"><span>🏁 Arrivée estimée</span>${e.fin?`<b>${fmtClock(e.fin)}</b><small>dans ${fmtDur(Math.max(0,e.fin-Date.now()))}${plan&&r.pf?' · prévue '+clk(r.pf):''}</small>`:`<b>…</b><small>calculée après 2 km-effort sur le tracé${plan&&r.pf?' · prévue '+clk(r.pf):''}</small>`}</div></div>`;
    if(plan){
      /* avec un plan : tous les points, passés (heure réelle) et à venir (estimée et prévue) */
      const up=new Map(e.wps.map(w=>[w.a,w]));
      const rows=(r.wpts||[]).map((w,i)=>{if(w.a==null)return'';const pt=passed[i],u=up.get(w.a),pl=w.p>0?w.p:null;
        if(pt)return`<li class="done"><span><b>✓ ${esc(w.n)}</b><small>km ${fmtKm(w.a)}${pl?' · prévu '+clk(pl):''}</small></span><span class="wt">${hhmm(pt)}${pl&&o.t0?`<small>${fmtDelta(pl-(pt-o.t0)/1000)}</small>`:''}</span></li>`;
        if(!u)return'';
        return`<li><span><b>${esc(w.n)}</b><small>km ${fmtKm(w.a)} · dans ${fmtDist(u.d)}${pl?' · prévu '+clk(pl):''}</small></span><span class="wt">${u.t?fmtClock(u.t):'…'}${pl&&o.t0&&u.t?`<small>${fmtDelta(pl-(u.t-o.t0)/1000)}</small>`:''}</span></li>`}).join('');
      if(rows)h+=`<ul class="wps">${rows}</ul>`;
    }else if(e.wps.length)h+=`<ul class="wps">${e.wps.slice(0,6).map(w=>`<li><span><b>${esc(w.n)}</b><small>km ${fmtKm(w.a)} · dans ${fmtDist(w.d)}</small></span><span class="wt">${w.t?fmtClock(w.t):'…'}</span></li>`).join('')}</ul>`;
    if(o.pe)h+=`<p class="hint">Estimation à ${fmtPaceS(o.pe)} par km-effort (allure récente et depuis le départ, pauses comprises).</p>`;
  }
  return h+profileSVG(r,o.dots)+'</section>';
}

/* ---------- plan de course ----------
   Temps prévus depuis le départ (secondes) aux points du GPX (w.p) et à l'arrivée (r.pf).
   Entre deux points du plan, le temps prévu est réparti au prorata des km-effort. */
function planPoints(r){if(!r)return[];const p=[[0,0]];(r.wpts||[]).forEach(w=>{if(w.a!=null&&w.p>0)p.push([w.a,w.p])});if(r.pf>0)p.push([r.L,r.pf]);p.sort((x,y)=>x[0]-y[0]);return p.length>1?p:[]}
const hasPlan=r=>planPoints(r).length>1;
function planAt(r,a){const p=planPoints(r);if(p.length<2||a==null)return null;
  for(let i=1;i<p.length;i++)if(a<=p[i][0]+1){const e0=effortAt(r,p[i-1][0]),e1=effortAt(r,p[i][0]),e=effortAt(r,Math.max(p[i-1][0],a));return p[i-1][1]+(e1>e0?Math.min(1,(e-e0)/(e1-e0)):0)*(p[i][1]-p[i-1][1])}
  return null}
/* répartir un temps total sur les points, au prorata des km-effort (allure régulière) */
function planSpread(r,total){const E=effortAt(r,r.L)||1;(r.wpts||[]).forEach(w=>{if(w.a!=null)w.p=Math.round(total*effortAt(r,w.a)/E)});r.pf=Math.round(total)}
/* « 3:45 », « 3h45 », « 3.45 », « 26:10 » ; un nombre seul = des minutes */
function parseHM(s){s=String(s||'').trim().toLowerCase().replace(/\s/g,'');if(!s)return null;
  let m=/^(\d{1,3})[h:.,](\d{1,2})?(?:[:.,](\d{1,2}))?$/.exec(s);if(m)return(+m[1])*3600+(+(m[2]||0))*60+(+(m[3]||0));
  m=/^(\d{1,4})$/.exec(s);return m?(+m[1])*60:NaN}
const fmtHM=sec=>{sec=Math.round(sec/60);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
/* écart au plan (s) : positif = en avance */
function planDelta(r,a,t0,tRef){const p=planAt(r,a);return p==null||!t0?null:p-(tRef-t0)/1000}
function fmtDelta(d,short){if(d==null)return'';const m=Math.round(Math.abs(d)/60);
  if(m<1)return short?'⏱ =':'dans les temps';return short?(d>0?'⏱ +':'⏱ −')+m+' min':m+' min '+(d>0?'d\'avance':'de retard')}
