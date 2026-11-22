/* ---------------- Plan de course (facultatif) ----------------
   Temps prévus depuis le départ aux points du GPX et à l'arrivée. « Répartir » place les temps
   au prorata des km-effort à partir d'un objectif total ; chaque temps reste modifiable.
   Le plan voyage avec le tracé : ceux qui suivent voient l'heure prévue à chaque point et l'avance ou le retard. */
const PlanEdit={r:null,onSave:null,
  open(r,onSave){
    if(!r){toast('Choisis d\'abord le GPX du parcours.',true);return}
    this.r=r;this.onSave=onSave;
    const wps=(r.wpts||[]).map((w,i)=>({w,i})).filter(x=>x.w.a!=null);
    const box=document.createElement('div');box.className='planbox';
    box.innerHTML=`<p class="hint">Temps prévus <b>depuis le départ</b>, en heures et minutes (par ex. 3:45 ou 3.45). Ceux qui te suivent voient l'heure prévue à chaque point et ton avance ou ton retard.</p>
      <div class="pltot"><label>Objectif d'arrivée (temps total)<input type="text" id="plTot" inputmode="decimal" autocomplete="off" placeholder="ex. 18:30" value="${r.pf?fmtHM(r.pf):''}"></label><button type="button" id="plSpread">↧ Répartir</button></div>
      <p class="hint">« Répartir » calcule les temps des points au prorata des km-effort (1 km + 100 m de D+), à effort régulier. Tu peux ensuite corriger chaque point, par exemple pour tenir compte de la fatigue ou des arrêts au ravito.</p>
      <div class="segwrap"><table class="seg plantab"><thead><tr><th scope="col">Point</th><th scope="col">km</th><th scope="col">D+</th><th scope="col">Prévu</th></tr></thead><tbody>
      ${wps.map(({w,i})=>`<tr><th scope="row">${esc(w.n)}</th><td>${fmtKm(w.a)}</td><td>${Math.round(gainAt(r,w.a))}</td><td><input type="text" data-pi="${i}" inputmode="decimal" autocomplete="off" value="${w.p>0?fmtHM(w.p):''}" placeholder="h:mm" aria-label="Temps prévu à ${esc(w.n)}"></td></tr>`).join('')}
      <tr class="fin"><th scope="row">🏁 Arrivée</th><td>${fmtKm(r.L)}</td><td>${r.gain!=null?r.gain:'—'}</td><td><input type="text" id="plFin" inputmode="decimal" autocomplete="off" value="${r.pf?fmtHM(r.pf):''}" placeholder="h:mm" aria-label="Temps prévu à l'arrivée"></td></tr></tbody></table></div>
      ${wps.length?'':'<p class="hint">Ce GPX n\'a pas de points de passage : seul le temps d\'arrivée compte, réparti en continu le long du tracé.</p>'}
      <div class="row"><button type="button" class="primary" id="plSave">✔ Enregistrer le plan</button>${hasPlan(r)?'<button type="button" class="danger" id="plDel">Retirer le plan</button>':''}</div>`;
    Sheet.show('⏱ Plan de course',box);
    $('#plSpread').onclick=()=>{
      const tot=parseHM($('#plTot').value);if(!(tot>0)){toast('Indique l\'objectif total, par ex. 18:30',true);$('#plTot').focus();return}
      const E=effortAt(r,r.L)||1;
      $$('#sheet [data-pi]').forEach(inp=>{const w=r.wpts[+inp.dataset.pi];inp.value=fmtHM(tot*effortAt(r,w.a)/E)});$('#plFin').value=fmtHM(tot);
    };
    $('#plTot').addEventListener('keydown',e=>{if(e.key==='Enter')$('#plSpread').click()});
    $('#plSave').onclick=()=>{
      const vals=[];let bad=null;
      $$('#sheet [data-pi]').forEach(inp=>{const v=parseHM(inp.value);if(Number.isNaN(v))bad=inp;vals.push([+inp.dataset.pi,v])});
      const fin=parseHM($('#plFin').value);if(Number.isNaN(fin))bad=$('#plFin');
      if(bad){toast('Format non reconnu : écris par ex. 3:45',true);bad.focus();return}
      /* les temps doivent augmenter le long du tracé */
      const seq=vals.filter(x=>x[1]>0).map(x=>[r.wpts[x[0]].a,x[1]]).concat(fin>0?[[r.L,fin]]:[]).sort((a,b)=>a[0]-b[0]);
      for(let k=1;k<seq.length;k++)if(seq[k][1]<=seq[k-1][1]){toast('Les temps prévus doivent augmenter d\'un point au suivant.',true);return}
      if(!seq.length){toast('Plan vide : indique au moins le temps d\'arrivée.',true);return}
      vals.forEach(([i,v])=>{if(v>0)r.wpts[i].p=v;else delete r.wpts[i].p});if(fin>0)r.pf=fin;else delete r.pf;
      Sheet.hide();toast('Plan de course enregistré');if(this.onSave)this.onSave(r);
    };
    const del=$('#plDel');if(del)del.onclick=()=>{(r.wpts||[]).forEach(w=>delete w.p);delete r.pf;Sheet.hide();toast('Plan retiré');if(this.onSave)this.onSave(r)};
  }
};
