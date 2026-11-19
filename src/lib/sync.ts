/**
 * Lightweight background sync.
 *
 *  1. Every local write lands in IndexedDB first and its key goes into an outbox.
 *  2. When online + signed in, outbox rows are upserted to Supabase (parents first).
 *     Client-generated UUIDs make this idempotent → no duplicate sessions on retry.
 *  3. Then we pull rows changed on the server since our last cursor (server-side `synced_at`).
 *  4. Conflicts: newest `updated_at` wins, on both sides. A database trigger refuses
 *     to overwrite a newer server row with a stale one, and the client refuses to
 *     overwrite a newer local row with a stale server one.
 *  5. Failures leave the outbox intact; we just try again later.
 */
import type { Session } from '@supabase/supabase-js';
import { TABLES, type BaseRow, type TableName } from '../types/models';
import {
  applyRemote,
  applyRemoteProfile,
  getMeta,
  getOutbox,
  getState,
  markAllDirty,
  markClean,
  nowIso,
  onLocalChange,
  putMeta,
  resetLocal,
  rowForKey,
  setSyncState,
} from './db';
import { getSupabase, syncConfigured } from './supabase';

let userId: string | null = null;
let running = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function schedule(delay: number) {
  if (!userId) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export async function startSync() {
  if (started) return;
  started = true;
  if (!syncConfigured) {
    setSyncState({ status: 'local', authChecked: true });
    return;
  }
  const sb = await getSupabase()!;
  // Reads the saved login from this device (no network needed), so the app opens offline too.
  let session: Session | null = null;
  try {
    session = (await sb.auth.getSession()).data.session;
  } catch {
    session = null;
  }
  await handleSession(session);
  setSyncState({ authChecked: true });
  sb.auth.onAuthStateChange((event, s) => {
    // Token refreshes keep the same user; only a real sign-out clears it.
    if (event === 'SIGNED_OUT' || s) void handleSession(s);
  });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => setSyncState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300);
  });
  onLocalChange(() => schedule(1500));
  setInterval(() => schedule(0), 60_000);
}

async function handleSession(session: Session | null) {
  const id = session?.user.id ?? null;
  if (id === userId) return;
  userId = id;
  setSyncState({ email: session?.user.email ?? null, userId: id });
  if (!id) {
    setSyncState({ status: 'local' });
    return;
  }
  const previous = getMeta<string>('syncUser');
  if (previous && previous !== id) {
    // A different account signed in on this device: start clean so data never mixes.
    await resetLocal();
  }
  if (previous !== id) {
    // First sync for this account on this device: upload anything logged before signing in.
    markAllDirty();
    putMeta('syncUser', id);
    putMeta('cursors', {});
  }
  schedule(0);
}

export function syncSoon() {
  schedule(0);
}

export async function syncNow() {
  if (!userId) return;
  if (running) {
    rerun = true;
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSyncState({ status: 'offline' });
    return;
  }
  running = true;
  setSyncState({ status: 'syncing', error: null });
  try {
    await push();
    await pull();
    setSyncState({ status: 'idle', lastSyncedAt: nowIso(), error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[liftlog] sync failed', err);
    setSyncState({ status: navigator.onLine ? 'error' : 'offline', error: message });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      schedule(500);
    }
  }
}

async function push() {
  const sb = await getSupabase()!;
  const keys = getOutbox();
  if (keys.includes('profile')) {
    const p = getState().profile;
    const { error } = await sb.from('profiles').upsert({
      id: userId,
      weight_unit: p.weight_unit,
      default_rest_seconds: p.default_rest_seconds,
      active_routine_id: p.active_routine_id,
      updated_at: p.updated_at,
    });
    if (error) throw error;
    markClean([{ key: 'profile', updated_at: p.updated_at }]);
  }
  for (const table of TABLES) {
    const tableKeys = keys.filter((k) => k.startsWith(`${table}:`));
    for (let i = 0; i < tableKeys.length; i += 200) {
      const chunk = tableKeys.slice(i, i + 200);
      const rows = chunk.map((k) => [k, rowForKey(k)] as const).filter((x): x is [string, BaseRow] => !!x[1]);
      if (!rows.length) continue;
      const { error } = await sb.from(table).upsert(
        rows.map(([, r]) => ({ ...r, user_id: userId })),
        { onConflict: 'id' },
      );
      if (error) throw error;
      markClean(rows.map(([key, r]) => ({ key, updated_at: r.updated_at })));
    }
  }
}

async function pull() {
  const sb = await getSupabase()!;
  const cursors = { ...(getMeta<Record<string, string>>('cursors') ?? {}) };
  for (const table of TABLES) {
    for (;;) {
      const since = cursors[table] ?? '1970-01-01T00:00:00Z';
      const { data, error } = await sb.from(table).select('*').gt('synced_at', since).order('synced_at').limit(1000);
      if (error) throw error;
      if (!data?.length) break;
      const rows = data.map(({ user_id: _u, synced_at: _s, ...rest }) => rest as BaseRow);
      applyRemote(table as TableName, rows);
      cursors[table] = data[data.length - 1].synced_at as string;
      if (data.length < 1000) break;
    }
  }
  putMeta('cursors', cursors);
  const { data: prof, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (prof) {
    applyRemoteProfile({
      weight_unit: prof.weight_unit,
      default_rest_seconds: prof.default_rest_seconds,
      active_routine_id: prof.active_routine_id,
      updated_at: prof.updated_at,
    });
  }
}

/* ---------------------------------- Auth ---------------------------------- */

export async function signIn(email: string, password: string) {
  const sb = await getSupabase();
  if (!sb) throw new Error('Sync is not configured');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const sb = await getSupabase();
  if (!sb) throw new Error('Sync is not configured');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  const sb = await getSupabase();
  await sb?.auth.signOut();
}
