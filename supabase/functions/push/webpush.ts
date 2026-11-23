/**
 * Minimal Web Push sender using only WebCrypto (works in Deno, Node 20+, browsers).
 *  - VAPID (RFC 8292): ES256-signed JWT in the Authorization header
 *  - Payload encryption (RFC 8291 / RFC 8188): aes128gcm content encoding
 */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface VapidKeys {
  /** uncompressed P-256 public key, base64url (what the browser needs) */
  publicKey: string;
  /** private key as JWK (kept server-side only) */
  privateJwk: JsonWebKey;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = concat(new Uint8Array([4]), unb64url(jwk.x!), unb64url(jwk.y!));
  return { publicKey: b64url(pub), privateJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d } };
}

async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the raw r||s signature, which is exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Encrypt a payload for one subscription (RFC 8291, single aes128gcm record). */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  testOverrides?: { salt?: Uint8Array; serverKeys?: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  const salt = testOverrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asKeys =
    testOverrides?.serverKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = last (and only) record
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  status: number;
  /** subscription is dead (unsubscribed / expired) and should be deleted */
  gone: boolean;
  body?: string;
}

export async function sendPush(
  sub: PushSubscriptionRow,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<SendResult> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 120),
    Urgency: opts.urgency ?? 'high',
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  const text = res.ok ? undefined : await res.text().catch(() => undefined);
  return { status: res.status, gone: res.status === 404 || res.status === 410, body: text };
}

export const __test = { vapidAuthorization };
