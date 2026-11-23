/* ---------------- Messages : filtre, blocage, signalement ----------------
   Discret : on touche un message pour bloquer son auteur ou le signaler ; la liste des personnes
   bloquées est en bas des Réglages. Le coureur (ou l'organisateur) qui bloque quelqu'un masque
   ses messages chez tous les participants (liste « blk » de la fiche de la sortie). */
const CONTACT='';   /* adresse de contact pour les signalements ; vide : page « Issues » du dépôt GitHub */
const CONTACT_URL='https://github.com/gregmey0/followtrail/issues';
/* mots masqués (filtre simple, français et anglais) */
const BAD=['connard','connarde','connasse','salope','salaud','pute','enculé','encule','enculée','enculer','batard','bâtard','pd','pédé','tapette','nique ta','ntm','fdp','ta gueule','gros porc','grosse vache','pétasse','pouffiasse','négro','bougnoule','youpin','fuck','fucking','motherfucker','bitch','asshole','cunt','slut','whore','nigger','nigga','faggot'];
/* pas de « lookbehind » : non reconnu par les iPhone sous iOS 15 */
const badRe=new RegExp('(^|[^\\p{L}\\p{N}])('+BAD.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?![\\p{L}\\p{N}])','giu');
const Moder={
  clean(t){return String(t||'').replace(badRe,(all,pre,w)=>pre+w[0]+'•'.repeat(Math.max(1,w.length-1)))},
  /* à voix haute, les mots masqués sont simplement sautés */
  speech(t){return String(t||'').replace(badRe,(all,pre)=>pre).replace(/\s+([,.!?])/g,'$1').replace(/\s+/g,' ').trim()},
  blocked(){return Array.isArray(settings.blocked)?settings.blocked:[]},
  /* message masqué : auteur bloqué sur ce téléphone, ou par l'organisateur (blk) */
  hidden(m,blk){return!!m&&!m.sys&&(this.blocked().some(b=>b.pid===m.pid)||(Array.isArray(blk)&&blk.includes(m.pid)))},
  async open(m,ctx){
    if(!m||m.sys)return;
    const v=await modal({title:'Message de '+m.name,
      body:`<p>« ${esc(this.clean(m.text))} »</p><p class="hint">${ctx&&ctx.org?'Bloquer masque ses messages chez toi et chez tous les participants.':'Bloquer masque ses messages sur ce téléphone.'}</p>`,
      buttons:[{label:'🚫 Bloquer '+m.name,value:'block',danger:true},{label:'⚑ Signaler ce message',value:'report'},{label:'Annuler',value:false,primary:true}]});
    if(v==='block'){this.block(m);if(ctx&&ctx.org&&ctx.orgBlock)ctx.orgBlock(m.pid);toast(m.name+' est bloqué')}
    if(v==='report')this.report(m);
    return v;
  },
  block(m){const l=this.blocked().filter(b=>b.pid!==m.pid);l.push({pid:m.pid,name:String(m.name||'?').slice(0,30)});settings.blocked=l.slice(-200);saveSettings();Push.syncBlocked()},
  unblock(pid){settings.blocked=this.blocked().filter(b=>b.pid!==pid);saveSettings();Push.syncBlocked();if(Ride.on&&Ride.isOrg)Ride.unblockForAll(pid)},
  report(m){
    const body=`Message signalé dans Follow Trail\nAuteur : ${m.name}\nHeure : ${new Date(m.t).toLocaleString('fr-FR')}\nTexte : ${m.text}\n`;
    const url=CONTACT?`mailto:${CONTACT}?subject=${encodeURIComponent('Signalement Follow Trail')}&body=${encodeURIComponent(body)}`
      :`${CONTACT_URL}/new?title=${encodeURIComponent('Signalement d\'un message')}&body=${encodeURIComponent(body)}`;
    try{window.open(url,'_blank')}catch(e){location.href=url}
  },
  renderSettings(){
    const el=$('#sBlocked');if(!el)return;const l=this.blocked();
    el.innerHTML=l.length?`<ul class="rlist">${l.map(b=>`<li><span><b>${esc(b.name)}</b></span><button type="button" class="mini" data-unblock="${esc(b.pid)}">Débloquer</button></li>`).join('')}</ul>`
      :'<p class="hint">Personne. Pour bloquer quelqu\'un ou signaler un message, touche son message.</p>';
  }
};
$('#sBlocked').addEventListener('click',e=>{const b=e.target.closest('[data-unblock]');if(!b)return;Moder.unblock(b.dataset.unblock);Moder.renderSettings();toast('Débloqué');if(Ride.on)Chat.render(true);if(Watch.on)Watch.renderChat(true)});
