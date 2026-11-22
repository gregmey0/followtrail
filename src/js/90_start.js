/* ---------------- Démarrage ---------------- */
applySimUI();Home.render();
if(!Compass.needsPerm)Compass.enable();
try{history.replaceState({s:'home'},'')}catch(e){}
if(!NATIVE&&'serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
/* liens : #join-CODE (rejoindre une sortie Group Run), #live-CODE (suivre une course) */
const linkHash=()=>{const m=/^#(join|live)-([0-9-]+)/.exec(location.hash);if(!m)return null;try{history.replaceState({s:'home'},'',location.pathname+location.search)}catch(e){}return{k:m[1],c:m[2]}};
const openLink=l=>{if(!l)return;if(l.k==='live')Watch.add(l.c);else Join.open(l.c)};
window.addEventListener('hashchange',()=>openLink(linkHash()));
/* application (Android, iPhone) ouverte par un lien followtrail://join-CODE ou followtrail://live-CODE */
const linkCode=u=>{const c=normCode(u||'');return validCode(c)?{k:/live-/i.test(u)?'live':'join',c}:null};
if(NATIVE&&P.app){try{P.app.addListener('appUrlOpen',e=>openLink(linkCode(e&&e.url)))}catch(e){}}
$('#compassBtn').onclick=async()=>{const ok=await Compass.enable();toast(ok?'Boussole activée':'Boussole refusée ou indisponible',!ok)};
$('#compassBtn').hidden=!Compass.needsPerm;
(async()=>{
  const l=linkHash(),w=store.get(K.watch,null);
  /* un suiveur qui ouvre un lien de suivi n'a besoin que du suivi */
  if(l&&l.k==='live'){if(w&&w.codes&&w.codes.length)Watch.restore(false);if(store.get(K.active,null))await Ride.resume();openLink(l);return}
  if(store.get(K.active,null)){await Ride.resume();if(l&&Ride.on&&normCode(l.c)!==Ride.code)toast('Tu es déjà dans une sortie : quitte-la d\'abord pour en rejoindre une autre.',true);if(w&&w.codes&&w.codes.length)Watch.restore(false);return}
  if(w&&w.codes&&w.codes.length)Watch.restore(!!w.open&&!l);
  if(l){openLink(l);return}
  if(NATIVE&&P.app){try{const r=await P.app.getLaunchUrl();const lc=r&&linkCode(r.url);if(lc){openLink(lc);return}}catch(e){}}
})();
window.FollowTrail={GPS,Ride,RideMap,Stats,Chat,Routes,Join,Create,LiveCreate,Watch,WAdd,SessionLink,Mqtt,deriveKey,seal,unseal,newCode,normCode,validCode,fmtCode,parseRouteGPX,makeRoute,routeLocate,encRoute,decRoute,encTrack,decTrack,segments,effortPace,etaInfo,fullTrackOf,effortAt,recentVAM,Voice,settings:()=>settings,store,K,BROKERS};
