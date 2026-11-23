// LiftLog push notifications.
//   GET                         → { publicKey } VAPID public key for the browser (created on first use)
//   POST {action:"test"}        → sends a test notification to the signed-in user's devices (user JWT)
//   POST {action:"dispatch"}    → delivers due rows from notification_schedule (pg_cron, shared secret)
// Deployed with verify_jwt = false; every path authorizes itself.

import { generateVapidKeys, sendPush, type PushSubscriptionRow, type VapidKeys } from './webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUBJECT = 'https://liftlog-eight-snowy.vercel.app';

function serverKey(): string {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
    if (k) return k;
  } catch {
    /* fall back to legacy key */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const KEY = serverKey();

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`; // legacy JWT key
  return h;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: adminHeaders({ Prefer: 'return=minimal' }) });
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

let cached: { keys: VapidKeys; secret: string } | null = null;

async function config() {
  if (cached) return cached;
  type Row = { vapid_public: string | null; vapid_private_jwk: JsonWebKey | null; dispatch_secret: string };
  let [row] = await rpc<Row[]>('push_config_get');
  if (!row.vapid_public || !row.vapid_private_jwk) {
    const fresh = await generateVapidKeys();
    await rpc<string>('push_config_init_vapid', { p_public: fresh.publicKey, p_private: fresh.privateJwk });
    [row] = await rpc<Row[]>('push_config_get'); // whichever instance won the race
  }
  cached = { keys: { publicKey: row.vapid_public!, privateJwk: row.vapid_private_jwk! }, secret: row.dispatch_secret };
  return cached;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type SubRow = PushSubscriptionRow & { id: string; user_id: string };

async function deliver(subs: SubRow[], payload: Record<string, unknown>, keys: VapidKeys) {
  let sent = 0;
  let removed = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        const r = await sendPush(s, payload, keys, SUBJECT, { ttl: 120, urgency: 'high' });
        if (r.gone) {
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
          removed++;
        } else if (r.status >= 200 && r.status < 300) {
          sent++;
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ last_success_at: new Date().toISOString() }) });
        } else {
          errors.push(`${r.status} ${r.body ?? ''}`.slice(0, 200));
        }
      } catch (e) {
        errors.push(String(e).slice(0, 200));
      }
    }),
  );
  if (errors.length) console.error('push errors', errors);
  return { sent, removed, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const cfg = await config();

    if (req.method === 'GET') return json({ publicKey: cfg.keys.publicKey });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const body = await req.json().catch(() => ({}));

    // ---- cron: deliver everything that's due
    if (body.action === 'dispatch') {
      if (req.headers.get('x-dispatch-secret') !== cfg.secret) return json({ error: 'forbidden' }, 403);
      const due = await rpc<{ user_id: string; kind: string; title: string; body: string | null }[]>('push_claim_due');
      if (!due.length) return json({ due: 0 });
      const ids = [...new Set(due.map((d) => d.user_id))];
      const subs = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${ids.join(',')})`, {
        headers: adminHeaders(),
      }).then((r) => r.json() as Promise<SubRow[]>);
      const results = await Promise.all(
        due.map((n) =>
          deliver(
            subs.filter((s) => s.user_id === n.user_id),
            { title: n.title, body: n.body ?? '', tag: n.kind, url: './#/workout' },
            cfg.keys,
          ),
        ),
      );
      return json({ due: due.length, results });
    }

    // ---- signed-in user: send a test notification to their own devices
    if (body.action === 'test') {
      const auth = req.headers.get('authorization') ?? '';
      const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: auth } });
      if (!user.ok) return json({ error: 'unauthorized' }, 401);
      const { id } = (await user.json()) as { id: string };
      const subs = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=eq.${id}`, {
        headers: adminHeaders(),
      }).then((r) => r.json() as Promise<SubRow[]>);
      const r = await deliver(subs, { title: 'LiftLog', body: 'Timer notifications are on. You’ll get an alert when rest is over.', tag: 'test' }, cfg.keys);
      return json({ devices: subs.length, ...r });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'internal error' }, 500);
  }
});
