import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SUPABASE_URL = url ?? '';
export const SUPABASE_KEY = key ?? '';

/** Sync is optional: without these env vars the app runs fully local. */
export const syncConfigured = Boolean(url && key);

let client: Promise<SupabaseClient> | null = null;

/** Loaded lazily so the Supabase SDK never slows down the first paint. */
export function getSupabase(): Promise<SupabaseClient> | null {
  if (!syncConfigured) return null;
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'liftlog-auth' } }),
  );
  return client;
}
