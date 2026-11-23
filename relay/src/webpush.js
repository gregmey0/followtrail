/* Notifications push web : jeton VAPID (RFC 8292) et chiffrement du contenu (RFC 8291, aes128gcm).
   Tout est fait avec WebCrypto, sans dépendance. */
const te = new TextEncoder();
export const b64u = {
  enc(b) { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
};
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/* HKDF en un seul bloc (longueurs ≤ 32 octets) */
const expand = async (prk, info, len) => (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len);

/* clés VAPID du relais : créées une fois, gardées dans le stockage du Durable Object */
export async function newVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u.enc(await crypto.subtle.exportKey('raw', kp.publicKey)) };
}
const jwtCache = new Map();
export async function vapidAuth(vapid, endpoint, contact) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000), c = jwtCache.get(aud);
  if (c && c.exp - now > 3600) return c.h;
  const exp = now + 12 * 3600;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp, sub: contact })));
  if (!vapid.key) vapid.key = await crypto.subtle.importKey('jwk', vapid.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, te.encode(head + '.' + body));
  const h = `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${vapid.pub}`;
  jwtCache.set(aud, { h, exp });
  return h;
}
/* chiffrement pour un abonné (p256dh : clé publique du navigateur, auth : secret partagé) */
export async function encrypt(p256dh, auth, plain) {
  const ua = b64u.dec(p256dh), sec = b64u.dec(auth);
  if (ua.length !== 65 || sec.length !== 16) throw new Error('clés d\'abonnement invalides');
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await expand(await hmac(sec, shared), cat(te.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16)), prk = await hmac(salt, ikm);
  const cek = await expand(prk, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(plain, new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, as, ct);
}
/* envoi : rend le code HTTP du service de notification (201 = accepté, 404/410 = abonnement périmé) */
export async function sendPush(vapid, contact, sub, plain, { ttl = 3600, urgency = 'normal', topic } = {}) {
  const body = await encrypt(sub.k, sub.a, plain);
  const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency, Authorization: await vapidAuth(vapid, sub.e, contact) };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.e, { method: 'POST', headers, body });
  return r.status;
}
