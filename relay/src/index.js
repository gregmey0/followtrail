/* Relais Follow Trail sur Cloudflare.
   - /mqtt : courtier MQTT 3.1.1 minimal sur WebSocket (QoS 0, messages retenus, jokers + et #),
     tenu par un seul Durable Object (« hub ») qui peut se mettre en veille entre deux messages.
     Le relais ne voit que des canaux opaques et des contenus chiffrés par l'appli (AES-GCM, clé tirée du code).
   - /vapid : clé publique des notifications push.
   - canaux « fltpush/… » : abonnements push et envois. Le contenu des notifications reste chiffré
     de bout en bout : c'est le téléphone du destinataire qui le déchiffre avec le code du partage.
   Les messages retenus sont gardés en mémoire et écrits au plus toutes les minutes par canal
   (limite d'écritures de l'offre gratuite), puis effacés au bout de 8 jours. */
import { DurableObject } from 'cloudflare:workers';
import { newVapid, sendPush, b64u } from './webpush.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };
const MAX_PAYLOAD = 256 * 1024, MAX_FILTERS = 80, FLUSH_MS = 60000, RET_TTL = 8 * 864e5, SUB_TTL = 8 * 864e5;
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chrome\.google\.com)$/;
const NS = /^flt\/v1\/[0-9a-z]{4,64}(\/|$)/;   // espace des canaux de l'appli : flt/v1/<canal de la sortie>/…
const td = new TextDecoder(), te = new TextEncoder();

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const hub = env.HUB.get(env.HUB.idFromName('hub'));
    if (u.pathname === '/mqtt') {
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
      return hub.fetch(req);
    }
    if (u.pathname === '/vapid') {
      const r = await hub.fetch(new Request('https://hub/vapid'));
      return new Response(await r.text(), { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (u.pathname === '/' || u.pathname === '/health') return new Response('Relais Follow Trail : OK\n', { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response('Introuvable', { status: 404, headers: CORS });
  }
};

/* ---------- outils MQTT ---------- */
function pkt(h, parts) {
  const len = parts.reduce((a, p) => a + p.length, 0), lb = []; let x = len;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; lb.push(d); } while (x > 0);
  const o = new Uint8Array(1 + lb.length + len); o[0] = h; o.set(lb, 1); let k = 1 + lb.length;
  for (const p of parts) { o.set(p, k); k += p.length; }
  return o;
}
const str = s => { const b = te.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
function validFilter(f) {
  if (!f || f.length > 256 || !NS.test(f)) return false;
  const lv = f.split('/');
  return lv.every((l, i) => (l === '#' ? i === lv.length - 1 : l === '+' || !/[+#]/.test(l)));
}
const validTopic = t => !!t && t.length <= 256 && !/[+#\0]/.test(t) && (NS.test(t) || /^fltpush\/[0-9a-z]{4,64}\//.test(t));
function matches(f, t) {
  const a = f.split('/'), b = t.split('/');
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '#') return true;
    if (i >= b.length || (a[i] !== '+' && a[i] !== b[i])) return false;
  }
  return a.length === b.length;
}
/* « flt/v1/<canal> » : sert d'index pour ne parcourir que les clients d'une même sortie */
const bucket = f => { const lv = f.split('/'); return lv.slice(0, 3).join('/'); };
const staticPrefix = f => { const i = f.search(/[+#]/); return i < 0 ? f : f.slice(0, i); };

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ret = new Map();      // canal -> {p: Uint8Array | null (effacé), t, dirty}
    this.loaded = new Set();   // préfixes « flt/v1/<canal>/ » déjà lus depuis le stockage
    this.index = null;         // « flt/v1/<canal> » -> Set(WebSocket)
    this.subsOf = new Map();   // WebSocket -> filtres
    this.flushT = null;
    this.rate = new Map();     // limites d'envoi des notifications
    this.subSeen = new Map();  // abonnements push déjà enregistrés récemment
  }

  /* ---------- connexions ---------- */
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/vapid') return Response.json({ key: (await this.vapid()).pub });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ subs: [] });
    this.index = null;
    this.ensureAlarm();
    const proto = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
    return new Response(null, { status: 101, webSocket: client, headers: proto.includes('mqtt') ? { 'Sec-WebSocket-Protocol': 'mqtt' } : {} });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg === 'string') { ws.close(1003, 'binaire attendu'); return; }
    const b = new Uint8Array(msg);
    let i = 0;
    while (i < b.length) {
      const h = b[i]; let j = i + 1, mult = 1, rem = 0, c;
      do { if (j >= b.length) return this.bad(ws); c = b[j++]; rem += (c & 127) * mult; mult *= 128; } while ((c & 128) && j < i + 5);
      if (j + rem > b.length || rem > MAX_PAYLOAD + 512) return this.bad(ws);
      await this.handle(ws, h, b.subarray(j, j + rem));
      i = j + rem;
    }
  }
  webSocketClose(ws) { this.index = null; this.subsOf.delete(ws); }
  webSocketError(ws) { this.index = null; this.subsOf.delete(ws); }
  bad(ws) { try { ws.close(1002, 'paquet MQTT invalide'); } catch (e) {} }

  async handle(ws, h, body) {
    const t = h >> 4;
    if (t === 1) { // CONNECT
      const pl = (body[0] << 8) | body[1], name = td.decode(body.subarray(2, 2 + pl)), lvl = body[2 + pl];
      if ((name !== 'MQTT' || lvl !== 4) && (name !== 'MQIsdp' || lvl !== 3)) { ws.send(new Uint8Array([0x20, 2, 0, 1])); ws.close(1002, 'protocole'); return; }
      ws.send(new Uint8Array([0x20, 2, 0, 0]));
      return;
    }
    if (t === 12) { ws.send(new Uint8Array([0xD0, 0])); return; }                  // PINGREQ
    if (t === 14) { try { ws.close(1000, 'fin'); } catch (e) {} return; }           // DISCONNECT
    if (t === 8) return this.subscribe(ws, body);
    if (t === 10) return this.unsubscribe(ws, body);
    if (t === 3) {                                                                  // PUBLISH
      const q = (h >> 1) & 3, retain = h & 1, tl = (body[0] << 8) | body[1];
      const topic = td.decode(body.subarray(2, 2 + tl)); let k = 2 + tl;
      if (q > 0) { ws.send(new Uint8Array([0x40, 2, body[k], body[k + 1]])); k += 2; }  // PUBACK (QoS 1 servi comme 0)
      const pl = body.slice(k);
      if (!validTopic(topic) || pl.length > MAX_PAYLOAD) return;
      if (topic.startsWith('fltpush/')) return this.onPush(topic, pl);
      if (retain) await this.retain(topic, pl);
      this.route(topic, pl);
    }
  }

  filters(ws) {
    let f = this.subsOf.get(ws);
    if (!f) { const a = ws.deserializeAttachment(); f = (a && a.subs) || []; this.subsOf.set(ws, f); }
    return f;
  }
  async subscribe(ws, body) {
    const id = body.subarray(0, 2), list = [], codes = [];
    let k = 2;
    while (k + 2 <= body.length) {
      const l = (body[k] << 8) | body[k + 1], f = td.decode(body.subarray(k + 2, k + 2 + l)); k += 3 + l;
      const ok = validFilter(f); list.push(ok ? f : null); codes.push(ok ? 0 : 0x80);
    }
    const subs = this.filters(ws).slice();
    for (const f of list) if (f && !subs.includes(f) && subs.length < MAX_FILTERS) subs.push(f);
    ws.serializeAttachment({ subs }); this.subsOf.set(ws, subs); this.index = null;
    ws.send(pkt(0x90, [id, new Uint8Array(codes)]));
    for (const f of list) if (f) await this.sendRetained(ws, f);
  }
  unsubscribe(ws, body) {
    const drop = []; let k = 2;
    while (k + 2 <= body.length) { const l = (body[k] << 8) | body[k + 1]; drop.push(td.decode(body.subarray(k + 2, k + 2 + l))); k += 2 + l; }
    const subs = this.filters(ws).filter(f => !drop.includes(f));
    ws.serializeAttachment({ subs }); this.subsOf.set(ws, subs); this.index = null;
    ws.send(new Uint8Array([0xB0, 2, body[0], body[1]]));
  }
  idx() {
    if (this.index) return this.index;
    const m = new Map();
    for (const ws of this.ctx.getWebSockets()) for (const f of this.filters(ws)) {
      const k = bucket(f); let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(ws);
    }
    return (this.index = m);
  }
  route(topic, pl) {
    const s = this.idx().get(bucket(topic)); if (!s) return;
    let p = null;
    for (const ws of s) {
      if (!this.filters(ws).some(f => matches(f, topic))) continue;
      if (!p) p = pkt(0x30, [str(topic), pl]);
      try { ws.send(p); } catch (e) {}
    }
  }

  /* ---------- messages retenus ---------- */
  async load(prefix) {
    if (this.loaded.has(prefix)) return;
    const m = await this.ctx.storage.list({ prefix: 'r:' + prefix });
    for (const [k, v] of m) { const t = k.slice(2); if (!this.ret.has(t)) this.ret.set(t, { p: v.p, t: v.t, dirty: false }); }
    this.loaded.add(prefix);
  }
  async retain(topic, pl) {
    const now = Date.now();
    this.ret.set(topic, { p: pl.length ? pl : null, t: now, dirty: true });
    this.schedule();
  }
  async sendRetained(ws, f) {
    await this.load(bucket(f) + '/');
    const pre = staticPrefix(f);
    for (const [t, v] of this.ret) {
      if (!v.p || !t.startsWith(pre) || !matches(f, t)) continue;
      try { ws.send(pkt(0x31, [str(t), v.p])); } catch (e) { return; }
    }
  }
  schedule() { if (!this.flushT) this.flushT = setTimeout(() => { this.flushT = null; this.flush(); }, FLUSH_MS); }
  async flush() {
    const put = {}, del = [];
    for (const [t, v] of this.ret) {
      if (!v.dirty) continue; v.dirty = false;
      if (v.p) put['r:' + t] = { p: v.p, t: v.t }; else { del.push('r:' + t); this.ret.delete(t); }
    }
    const keys = Object.keys(put);
    for (let i = 0; i < keys.length; i += 100) { const o = {}; keys.slice(i, i + 100).forEach(k => (o[k] = put[k])); await this.ctx.storage.put(o); }
    for (let i = 0; i < del.length; i += 100) await this.ctx.storage.delete(del.slice(i, i + 100));
  }
  async ensureAlarm() {
    if (this.alarmOk) return; this.alarmOk = true;
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 6 * 3600e3);
  }
  /* nettoyage quotidien : sorties anciennes et abonnements périmés */
  async alarm() {
    await this.flush();
    const now = Date.now(), old = [];
    for (const [k, v] of await this.ctx.storage.list({ prefix: 'r:' })) if (now - (v.t || 0) > RET_TTL) old.push(k);
    for (const [k, v] of await this.ctx.storage.list({ prefix: 'ps:' })) if (now - (v.t || 0) > SUB_TTL) old.push(k);
    for (let i = 0; i < old.length; i += 100) await this.ctx.storage.delete(old.slice(i, i + 100));
    for (const k of old) if (k.startsWith('r:')) this.ret.delete(k.slice(2));
    await this.ctx.storage.setAlarm(now + 24 * 3600e3);
  }

  /* ---------- notifications push ---------- */
  async vapid() {
    if (this.vap) return this.vap;
    let v = await this.ctx.storage.get('vapid');
    if (!v) { v = await newVapid(); await this.ctx.storage.put('vapid', v); }
    return (this.vap = v);
  }
  /* fltpush/<canal>/sub/<id>                            abonnement (JSON) ou désabonnement (vide)
     fltpush/<canal>/send/<pid>/<a|r|w>/<n|h>[/<groupe>]  envoi : à tous, aux coureurs ou aux suiveurs ;
                                                          urgence normale ou haute ; groupe = remplace la précédente */
  async onPush(topic, pl) {
    const lv = topic.split('/'), tid = lv[1];
    if (lv[2] === 'sub' && lv.length === 4 && /^[0-9a-z_-]{1,40}$/i.test(lv[3])) {
      const key = `ps:${tid}:${lv[3]}`;
      if (!pl.length) { this.subSeen.delete(key); await this.ctx.storage.delete(key); return; }
      let o; try { o = JSON.parse(td.decode(pl)); } catch (e) { return; }
      const s = o && o.sub, e = s && s.endpoint, kk = s && s.keys;
      if (!e || !kk || typeof kk.p256dh !== 'string' || typeof kk.auth !== 'string' || kk.p256dh.length > 100 || kk.auth.length > 40) return;
      let u; try { u = new URL(e); } catch (x) { return; }
      if (this.env.ALLOW_ANY_PUSH !== '1' && (u.protocol !== 'https:' || !PUSH_HOSTS.test(u.hostname))) return;
      const rec = { e, k: kk.p256dh, a: kk.auth, role: o.role === 'r' ? 'r' : 'w', pid: String(o.pid || '').slice(0, 40) };
      const sig = JSON.stringify(rec), seen = this.subSeen.get(key);
      if (seen && seen.sig === sig && Date.now() - seen.t < 12 * 3600e3) return;   // déjà enregistré : pas d'écriture
      this.subSeen.set(key, { sig, t: Date.now() });
      await this.ctx.storage.put(key, { ...rec, t: Date.now() });
      return;
    }
    if (lv[2] === 'send' && lv.length >= 6 && lv.length <= 7) {
      const pid = lv[3], aud = lv[4], urg = lv[5] === 'h' ? 'high' : 'normal', grp = lv[6] && /^[A-Za-z0-9_-]{1,32}$/.test(lv[6]) ? lv[6] : undefined;
      if (!pl.length || pl.length > 3000 || !/^[arw]$/.test(aud)) return;
      if (!this.allow(tid, pid)) return;
      const subs = await this.ctx.storage.list({ prefix: `ps:${tid}:`, limit: 200 });
      const vap = await this.vapid(), contact = this.env.PUSH_CONTACT || 'https://gregmey0.github.io/followtrail/';
      const body = te.encode(JSON.stringify({ v: 1, tid, d: b64u.enc(pl) }));
      const jobs = [];
      for (const [k, s] of subs) {
        if (s.pid && s.pid === pid) continue;
        if (aud !== 'a' && s.role !== aud) continue;
        if (jobs.length >= 40) break;
        jobs.push(sendPush(vap, contact, s, body, { ttl: urg === 'high' ? 6 * 3600 : 2 * 3600, urgency: urg, topic: grp })
          .then(st => { if (st === 404 || st === 410) { this.subSeen.delete(k); return this.ctx.storage.delete(k); } })
          .catch(e => console.log('push : échec', e && e.message)));
      }
      this.ctx.waitUntil(Promise.allSettled(jobs));
    }
  }
  /* au plus 40 notifications par sortie et 20 par personne sur 10 minutes */
  allow(tid, pid) {
    const now = Date.now(), win = 600e3;
    const hit = (k, max) => { const a = (this.rate.get(k) || []).filter(t => now - t < win); if (a.length >= max) { this.rate.set(k, a); return false; } a.push(now); this.rate.set(k, a); return true; };
    if (this.rate.size > 5000) this.rate.clear();
    return hit('t:' + tid, 40) && hit('p:' + tid + ':' + pid, 20);
  }
}
