// Follow Trail – service worker : l'appli s'ouvre hors connexion une fois chargée.
const CACHE = 'followtrail-v1.2.0';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Notifications push : le relais réveille le téléphone ; le contenu, chiffré avec la clé de la sortie,
   est déchiffré ici avec la clé gardée par l'appli (IndexedDB « flt-push »). */
const pushDb = () => new Promise((res, rej) => { const r = indexedDB.open('flt-push', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pushGet = async k => { try { const db = await pushDb(); return await new Promise(res => { const q = db.transaction('keys').objectStore('keys').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } };
const b64d = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const APPLE = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && !/Chrome|Android|Firefox/.test(navigator.userAgent);
async function pushNote(o) {
  const rec = o && o.tid ? await pushGet(o.tid) : null;
  if (!rec) return null;
  const b = b64d(o.d), pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, rec.key, b.slice(12));
  const n = JSON.parse(new TextDecoder().decode(pt));
  n.tap = Object.assign({}, n.tap || {}, { tid: o.tid, code: rec.code, role: rec.role });
  const blocked = (await pushGet('_blocked')) || [];
  if (n.tap.pid && blocked.includes(n.tap.pid)) n.blocked = true;
  return n;
}
async function onPush(data, test) {
  let n = null; try { n = await pushNote(data); } catch (e) {}
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (n && n.blocked && !APPLE) return;
  /* l'appli est à l'écran : elle affiche déjà le message */
  if (!APPLE && !test && wins.some(c => c.visibilityState === 'visible')) return;
  if (!n || n.blocked) n = { title: 'Follow Trail', body: 'Nouvelle activité sur une course que tu suis.', key: 'flt' };
  /* la page ouverte en arrière-plan a pu afficher la même notification : pas de deuxième sonnerie */
  const old = n.key ? await self.registration.getNotifications({ tag: n.key }) : [];
  const dup = old.some(x => x.title === n.title && x.data && Date.now() - x.data.ts < 20000);
  if (dup && !APPLE) return;
  await self.registration.showNotification(n.title, { body: n.body || '', tag: n.key || undefined, renotify: !!n.key && !dup, icon: 'icon-192.png', badge: 'icon-192.png',
    requireInteraction: !!n.sos, data: Object.assign({ ts: Date.now() }, n.tap || {}), vibrate: n.sos ? [600, 200, 600, 200, 900] : [80, 60, 80] });
}
self.addEventListener('push', e => { let d = null; try { d = e.data ? e.data.json() : null; } catch (x) {} e.waitUntil(onPush(d)); });
/* tests automatiques : même chemin qu'une vraie notification push */
self.addEventListener('message', e => { if (e.data && e.data.flt === 'testpush') e.waitUntil(onPush(e.data.data, true)); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tap = e.notification.data || null;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs[0];
    if (c) { c.postMessage({ flt: 'tap', tap }); return c.focus(); }
    /* appli fermée : on la rouvre sur le suivi concerné */
    return self.clients.openWindow(tap && tap.code && tap.role === 'w' ? './#live-' + tap.code : './');
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // fonds de carte, relais : réseau direct
  if (req.mode === 'navigate') { // page : la dernière version si le réseau répond vite, sinon celle gardée hors ligne
    e.respondWith(caches.open(CACHE).then(async c => {
      try {
        const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('lent')), 4000))]);
        if (r && r.ok) c.put('./index.html', r.clone());
        return r;
      } catch (err) { return (await c.match('./index.html')) || (await c.match(req, { ignoreSearch: true })) || Response.error(); }
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
