var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
import { DurableObject } from "cloudflare:workers";

// src/webpush.js
var te = new TextEncoder();
var b64u = {
  enc(b) {
    let s = "";
    const u = new Uint8Array(b);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const b = atob(s), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
};
var cat = /* @__PURE__ */ __name((...a) => {
  const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n);
  let k = 0;
  for (const x of a) {
    o.set(x, k);
    k += x.length;
  }
  return o;
}, "cat");
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
__name(hmac, "hmac");
var expand = /* @__PURE__ */ __name(async (prk, info, len) => (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len), "expand");
async function newVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { priv: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey)) };
}
__name(newVapid, "newVapid");
var jwtCache = /* @__PURE__ */ new Map();
async function vapidAuth(vapid, endpoint, contact) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1e3), c = jwtCache.get(aud);
  if (c && c.exp - now > 3600) return c.h;
  const exp = now + 12 * 3600;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud, exp, sub: contact })));
  if (!vapid.key) vapid.key = await crypto.subtle.importKey("jwk", vapid.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.key, te.encode(head + "." + body));
  const h = `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${vapid.pub}`;
  jwtCache.set(aud, { h, exp });
  return h;
}
__name(vapidAuth, "vapidAuth");
async function encrypt(p256dh, auth, plain) {
  const ua = b64u.dec(p256dh), sec = b64u.dec(auth);
  if (ua.length !== 65 || sec.length !== 16) throw new Error("cl\xE9s d'abonnement invalides");
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const as = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await expand(await hmac(sec, shared), cat(te.encode("WebPush: info\0"), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16)), prk = await hmac(salt, ikm);
  const cek = await expand(prk, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(prk, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(plain, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  return cat(head, as, ct);
}
__name(encrypt, "encrypt");
async function sendPush(vapid, contact, sub, plain, { ttl = 3600, urgency = "normal", topic } = {}) {
  const body = await encrypt(sub.k, sub.a, plain);
  const headers = { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: urgency, Authorization: await vapidAuth(vapid, sub.e, contact) };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.e, { method: "POST", headers, body });
  return r.status;
}
__name(sendPush, "sendPush");

// src/index.js
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
var MAX_PAYLOAD = 256 * 1024;
var MAX_FILTERS = 80;
var FLUSH_MS = 6e4;
var RET_TTL = 8 * 864e5;
var SUB_TTL = 8 * 864e5;
var PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chrome\.google\.com)$/;
var NS = /^flt\/v1\/[0-9a-z]{4,64}(\/|$)/;
var td = new TextDecoder();
var te2 = new TextEncoder();
var src_default = {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const hub = env.HUB.get(env.HUB.idFromName("hub"));
    if (u.pathname === "/mqtt") {
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("WebSocket attendu", { status: 426 });
      return hub.fetch(req);
    }
    if (u.pathname === "/vapid") {
      const r = await hub.fetch(new Request("https://hub/vapid"));
      return new Response(await r.text(), { status: r.status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
    }
    if (u.pathname === "/" || u.pathname === "/health") return new Response("Relais Follow Trail : OK\n", { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("Introuvable", { status: 404, headers: CORS });
  }
};
function pkt(h, parts) {
  const len = parts.reduce((a, p) => a + p.length, 0), lb = [];
  let x = len;
  do {
    let d = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) d |= 128;
    lb.push(d);
  } while (x > 0);
  const o = new Uint8Array(1 + lb.length + len);
  o[0] = h;
  o.set(lb, 1);
  let k = 1 + lb.length;
  for (const p of parts) {
    o.set(p, k);
    k += p.length;
  }
  return o;
}
__name(pkt, "pkt");
var str = /* @__PURE__ */ __name((s) => {
  const b = te2.encode(s), o = new Uint8Array(2 + b.length);
  o[0] = b.length >> 8;
  o[1] = b.length & 255;
  o.set(b, 2);
  return o;
}, "str");
function validFilter(f) {
  if (!f || f.length > 256 || !NS.test(f)) return false;
  const lv = f.split("/");
  return lv.every((l, i) => l === "#" ? i === lv.length - 1 : l === "+" || !/[+#]/.test(l));
}
__name(validFilter, "validFilter");
var validTopic = /* @__PURE__ */ __name((t) => !!t && t.length <= 256 && !/[+#\0]/.test(t) && (NS.test(t) || /^fltpush\/[0-9a-z]{4,64}\//.test(t)), "validTopic");
function matches(f, t) {
  const a = f.split("/"), b = t.split("/");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "#") return true;
    if (i >= b.length || a[i] !== "+" && a[i] !== b[i]) return false;
  }
  return a.length === b.length;
}
__name(matches, "matches");
var bucket = /* @__PURE__ */ __name((f) => {
  const lv = f.split("/");
  return lv.slice(0, 3).join("/");
}, "bucket");
var staticPrefix = /* @__PURE__ */ __name((f) => {
  const i = f.search(/[+#]/);
  return i < 0 ? f : f.slice(0, i);
}, "staticPrefix");
var Hub = class extends DurableObject {
  static {
    __name(this, "Hub");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ret = /* @__PURE__ */ new Map();
    this.loaded = /* @__PURE__ */ new Set();
    this.index = null;
    this.subsOf = /* @__PURE__ */ new Map();
    this.flushT = null;
    this.rate = /* @__PURE__ */ new Map();
    this.subSeen = /* @__PURE__ */ new Map();
  }
  /* ---------- connexions ---------- */
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/vapid") return Response.json({ key: (await this.vapid()).pub });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ subs: [] });
    this.index = null;
    this.ensureAlarm();
    const proto = (req.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((s) => s.trim());
    return new Response(null, { status: 101, webSocket: client, headers: proto.includes("mqtt") ? { "Sec-WebSocket-Protocol": "mqtt" } : {} });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg === "string") {
      ws.close(1003, "binaire attendu");
      return;
    }
    const b = new Uint8Array(msg);
    let i = 0;
    while (i < b.length) {
      const h = b[i];
      let j = i + 1, mult = 1, rem = 0, c;
      do {
        if (j >= b.length) return this.bad(ws);
        c = b[j++];
        rem += (c & 127) * mult;
        mult *= 128;
      } while (c & 128 && j < i + 5);
      if (j + rem > b.length || rem > MAX_PAYLOAD + 512) return this.bad(ws);
      await this.handle(ws, h, b.subarray(j, j + rem));
      i = j + rem;
    }
  }
  webSocketClose(ws) {
    this.index = null;
    this.subsOf.delete(ws);
  }
  webSocketError(ws) {
    this.index = null;
    this.subsOf.delete(ws);
  }
  bad(ws) {
    try {
      ws.close(1002, "paquet MQTT invalide");
    } catch (e) {
    }
  }
  async handle(ws, h, body) {
    const t = h >> 4;
    if (t === 1) {
      const pl = body[0] << 8 | body[1], name = td.decode(body.subarray(2, 2 + pl)), lvl = body[2 + pl];
      if ((name !== "MQTT" || lvl !== 4) && (name !== "MQIsdp" || lvl !== 3)) {
        ws.send(new Uint8Array([32, 2, 0, 1]));
        ws.close(1002, "protocole");
        return;
      }
      ws.send(new Uint8Array([32, 2, 0, 0]));
      return;
    }
    if (t === 12) {
      ws.send(new Uint8Array([208, 0]));
      return;
    }
    if (t === 14) {
      try {
        ws.close(1e3, "fin");
      } catch (e) {
      }
      return;
    }
    if (t === 8) return this.subscribe(ws, body);
    if (t === 10) return this.unsubscribe(ws, body);
    if (t === 3) {
      const q = h >> 1 & 3, retain = h & 1, tl = body[0] << 8 | body[1];
      const topic = td.decode(body.subarray(2, 2 + tl));
      let k = 2 + tl;
      if (q > 0) {
        ws.send(new Uint8Array([64, 2, body[k], body[k + 1]]));
        k += 2;
      }
      const pl = body.slice(k);
      if (!validTopic(topic) || pl.length > MAX_PAYLOAD) return;
      if (topic.startsWith("fltpush/")) return this.onPush(topic, pl);
      if (retain) await this.retain(topic, pl);
      this.route(topic, pl);
    }
  }
  filters(ws) {
    let f = this.subsOf.get(ws);
    if (!f) {
      const a = ws.deserializeAttachment();
      f = a && a.subs || [];
      this.subsOf.set(ws, f);
    }
    return f;
  }
  async subscribe(ws, body) {
    const id = body.subarray(0, 2), list = [], codes = [];
    let k = 2;
    while (k + 2 <= body.length) {
      const l = body[k] << 8 | body[k + 1], f = td.decode(body.subarray(k + 2, k + 2 + l));
      k += 3 + l;
      const ok = validFilter(f);
      list.push(ok ? f : null);
      codes.push(ok ? 0 : 128);
    }
    const subs = this.filters(ws).slice();
    for (const f of list) if (f && !subs.includes(f) && subs.length < MAX_FILTERS) subs.push(f);
    ws.serializeAttachment({ subs });
    this.subsOf.set(ws, subs);
    this.index = null;
    ws.send(pkt(144, [id, new Uint8Array(codes)]));
    for (const f of list) if (f) await this.sendRetained(ws, f);
  }
  unsubscribe(ws, body) {
    const drop = [];
    let k = 2;
    while (k + 2 <= body.length) {
      const l = body[k] << 8 | body[k + 1];
      drop.push(td.decode(body.subarray(k + 2, k + 2 + l)));
      k += 2 + l;
    }
    const subs = this.filters(ws).filter((f) => !drop.includes(f));
    ws.serializeAttachment({ subs });
    this.subsOf.set(ws, subs);
    this.index = null;
    ws.send(new Uint8Array([176, 2, body[0], body[1]]));
  }
  idx() {
    if (this.index) return this.index;
    const m = /* @__PURE__ */ new Map();
    for (const ws of this.ctx.getWebSockets()) for (const f of this.filters(ws)) {
      const k = bucket(f);
      let s = m.get(k);
      if (!s) m.set(k, s = /* @__PURE__ */ new Set());
      s.add(ws);
    }
    return this.index = m;
  }
  route(topic, pl) {
    const s = this.idx().get(bucket(topic));
    if (!s) return;
    let p = null;
    for (const ws of s) {
      if (!this.filters(ws).some((f) => matches(f, topic))) continue;
      if (!p) p = pkt(48, [str(topic), pl]);
      try {
        ws.send(p);
      } catch (e) {
      }
    }
  }
  /* ---------- messages retenus ---------- */
  async load(prefix) {
    if (this.loaded.has(prefix)) return;
    const m = await this.ctx.storage.list({ prefix: "r:" + prefix });
    for (const [k, v] of m) {
      const t = k.slice(2);
      if (!this.ret.has(t)) this.ret.set(t, { p: v.p, t: v.t, dirty: false });
    }
    this.loaded.add(prefix);
  }
  async retain(topic, pl) {
    const now = Date.now();
    this.ret.set(topic, { p: pl.length ? pl : null, t: now, dirty: true });
    this.schedule();
  }
  async sendRetained(ws, f) {
    await this.load(bucket(f) + "/");
    const pre = staticPrefix(f);
    for (const [t, v] of this.ret) {
      if (!v.p || !t.startsWith(pre) || !matches(f, t)) continue;
      try {
        ws.send(pkt(49, [str(t), v.p]));
      } catch (e) {
        return;
      }
    }
  }
  schedule() {
    if (!this.flushT) this.flushT = setTimeout(() => {
      this.flushT = null;
      this.flush();
    }, FLUSH_MS);
  }
  async flush() {
    const put = {}, del = [];
    for (const [t, v] of this.ret) {
      if (!v.dirty) continue;
      v.dirty = false;
      if (v.p) put["r:" + t] = { p: v.p, t: v.t };
      else {
        del.push("r:" + t);
        this.ret.delete(t);
      }
    }
    const keys = Object.keys(put);
    for (let i = 0; i < keys.length; i += 100) {
      const o = {};
      keys.slice(i, i + 100).forEach((k) => o[k] = put[k]);
      await this.ctx.storage.put(o);
    }
    for (let i = 0; i < del.length; i += 100) await this.ctx.storage.delete(del.slice(i, i + 100));
  }
  async ensureAlarm() {
    if (this.alarmOk) return;
    this.alarmOk = true;
    if (await this.ctx.storage.getAlarm() == null) await this.ctx.storage.setAlarm(Date.now() + 6 * 36e5);
  }
  /* nettoyage quotidien : sorties anciennes et abonnements périmés */
  async alarm() {
    await this.flush();
    const now = Date.now(), old = [];
    for (const [k, v] of await this.ctx.storage.list({ prefix: "r:" })) if (now - (v.t || 0) > RET_TTL) old.push(k);
    for (const [k, v] of await this.ctx.storage.list({ prefix: "ps:" })) if (now - (v.t || 0) > SUB_TTL) old.push(k);
    for (let i = 0; i < old.length; i += 100) await this.ctx.storage.delete(old.slice(i, i + 100));
    for (const k of old) if (k.startsWith("r:")) this.ret.delete(k.slice(2));
    await this.ctx.storage.setAlarm(now + 24 * 36e5);
  }
  /* ---------- notifications push ---------- */
  async vapid() {
    if (this.vap) return this.vap;
    let v = await this.ctx.storage.get("vapid");
    if (!v) {
      v = await newVapid();
      await this.ctx.storage.put("vapid", v);
    }
    return this.vap = v;
  }
  /* fltpush/<canal>/sub/<id>                            abonnement (JSON) ou désabonnement (vide)
     fltpush/<canal>/send/<pid>/<a|r|w>/<n|h>[/<groupe>]  envoi : à tous, aux coureurs ou aux suiveurs ;
                                                          urgence normale ou haute ; groupe = remplace la précédente */
  async onPush(topic, pl) {
    const lv = topic.split("/"), tid = lv[1];
    if (lv[2] === "sub" && lv.length === 4 && /^[0-9a-z_-]{1,40}$/i.test(lv[3])) {
      const key = `ps:${tid}:${lv[3]}`;
      if (!pl.length) {
        this.subSeen.delete(key);
        await this.ctx.storage.delete(key);
        return;
      }
      let o;
      try {
        o = JSON.parse(td.decode(pl));
      } catch (e2) {
        return;
      }
      const s = o && o.sub, e = s && s.endpoint, kk = s && s.keys;
      if (!e || !kk || typeof kk.p256dh !== "string" || typeof kk.auth !== "string" || kk.p256dh.length > 100 || kk.auth.length > 40) return;
      let u;
      try {
        u = new URL(e);
      } catch (x) {
        return;
      }
      if (this.env.ALLOW_ANY_PUSH !== "1" && (u.protocol !== "https:" || !PUSH_HOSTS.test(u.hostname))) return;
      const rec = { e, k: kk.p256dh, a: kk.auth, role: o.role === "r" ? "r" : "w", pid: String(o.pid || "").slice(0, 40) };
      const sig = JSON.stringify(rec), seen = this.subSeen.get(key);
      if (seen && seen.sig === sig && Date.now() - seen.t < 12 * 36e5) return;
      this.subSeen.set(key, { sig, t: Date.now() });
      await this.ctx.storage.put(key, { ...rec, t: Date.now() });
      return;
    }
    if (lv[2] === "send" && lv.length >= 6 && lv.length <= 7) {
      const pid = lv[3], aud = lv[4], urg = lv[5] === "h" ? "high" : "normal", grp = lv[6] && /^[A-Za-z0-9_-]{1,32}$/.test(lv[6]) ? lv[6] : void 0;
      if (!pl.length || pl.length > 3e3 || !/^[arw]$/.test(aud)) return;
      if (!this.allow(tid, pid)) return;
      const subs = await this.ctx.storage.list({ prefix: `ps:${tid}:`, limit: 200 });
      const vap = await this.vapid(), contact = this.env.PUSH_CONTACT || "https://gregmey0.github.io/followtrail/";
      const body = te2.encode(JSON.stringify({ v: 1, tid, d: b64u.enc(pl) }));
      const jobs = [];
      for (const [k, s] of subs) {
        if (s.pid && s.pid === pid) continue;
        if (aud !== "a" && s.role !== aud) continue;
        if (jobs.length >= 40) break;
        jobs.push(sendPush(vap, contact, s, body, { ttl: urg === "high" ? 6 * 3600 : 2 * 3600, urgency: urg, topic: grp }).then((st) => {
          if (st === 404 || st === 410) {
            this.subSeen.delete(k);
            return this.ctx.storage.delete(k);
          }
        }).catch((e) => console.log("push : \xE9chec", e && e.message)));
      }
      this.ctx.waitUntil(Promise.allSettled(jobs));
    }
  }
  /* au plus 40 notifications par sortie et 20 par personne sur 10 minutes */
  allow(tid, pid) {
    const now = Date.now(), win = 6e5;
    const hit = /* @__PURE__ */ __name((k, max) => {
      const a = (this.rate.get(k) || []).filter((t) => now - t < win);
      if (a.length >= max) {
        this.rate.set(k, a);
        return false;
      }
      a.push(now);
      this.rate.set(k, a);
      return true;
    }, "hit");
    if (this.rate.size > 5e3) this.rate.clear();
    return hit("t:" + tid, 40) && hit("p:" + tid + ":" + pid, 20);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Ps4yQO/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Ps4yQO/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Hub,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
