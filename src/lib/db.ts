/**
 * The single source of truth for the app: an in-memory copy of every table,
 * persisted to IndexedDB on every change and queued for background sync.
 *
 * UI code reads with `useDb()` and writes with `insert / update / remove`.
 * Writes are synchronous for the UI (instant), durable a few ms later.
 */
import { useSyncExternalStore } from 'react';
import {
  TABLES,
  type BaseRow,
  type Profile,
  type TableName,
  type TableState,
  type Tables,
  type WorkoutUiState,
} from '../types/models';
import { openStorage, type Storage } from './storage';

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

export interface AppState {
  ready: boolean;
  tables: TableState;
  profile: Profile;
  workoutUi: WorkoutUiState | null;
  storageKind: Storage['kind'] | null;
  sync: { status: SyncStatus; lastSyncedAt: string | null; error: string | null; email: string | null };
  /** number of local changes not yet confirmed by the server */
  pending: number;
}

const DEFAULT_PROFILE: Profile = {
  id: 'me',
  updated_at: new Date(0).toISOString(),
  weight_unit: 'lb',
  default_rest_seconds: 120,
  active_routine_id: null,
};

function emptyTables(): TableState {
  const t = {} as TableState;
  for (const name of TABLES) (t as Record<string, unknown>)[name] = {};
  return t;
}

let storage: Storage | null = null;
let state: AppState = {
  ready: false,
  tables: emptyTables(),
  profile: DEFAULT_PROFILE,
  workoutUi: null,
  storageKind: null,
  sync: { status: 'local', lastSyncedAt: null, error: null, email: null },
  pending: 0,
};

const listeners = new Set<() => void>();
const outbox = new Set<string>(); // "table:id" | "profile"
const changeListeners = new Set<() => void>();
let persistChain: Promise<void> = Promise.resolve();
let metaCache: Record<string, unknown> = {};
let notifyQueued = false;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((l) => l());
  });
}

function persist(task: () => Promise<void>) {
  persistChain = persistChain.then(task).catch((err) => {
    console.error('[liftlog] local save failed', err);
  });
}

export function flushLocal(): Promise<void> {
  return persistChain;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called after any local change (used by sync to schedule a push). */
export function onLocalChange(fn: () => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function getState() {
  return state;
}

export function useDb(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export const nowIso = () => new Date().toISOString();

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

export async function initDb() {
  storage = await openStorage();
  const { tables: raw, meta } = await storage.loadAll();
  metaCache = meta;
  const tables = emptyTables();
  for (const t of TABLES) {
    const map: Record<string, unknown> = {};
    for (const r of raw[t] || []) map[r.id] = r;
    (tables as Record<string, unknown>)[t] = map;
  }
  const savedOutbox = (meta.outbox as string[] | undefined) ?? [];
  savedOutbox.forEach((k) => outbox.add(k));
  state = {
    ...state,
    ready: true,
    tables,
    profile: { ...DEFAULT_PROFILE, ...((meta.profile as Partial<Profile>) ?? {}) },
    workoutUi: (meta.workoutUi as WorkoutUiState | undefined) ?? null,
    storageKind: storage.kind,
    sync: { ...state.sync, lastSyncedAt: (meta.lastSyncedAt as string) ?? null },
    pending: outbox.size,
  };
  notify();
  // Ask the browser not to evict our data under storage pressure.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

let batchDepth = 0;
let batchRows: Map<TableName, Map<string, unknown>> = new Map();

function stage(table: TableName, row: BaseRow, markDirty = true) {
  const current = state.tables[table] as Record<string, BaseRow>;
  state = {
    ...state,
    tables: { ...state.tables, [table]: { ...current, [row.id]: row } },
  };
  if (markDirty) outbox.add(`${table}:${row.id}`);
  if (!batchRows.has(table)) batchRows.set(table, new Map());
  batchRows.get(table)!.set(row.id, row);
  if (batchDepth === 0) commit(markDirty);
}

function commit(changed = true) {
  const rows = batchRows;
  batchRows = new Map();
  state = { ...state, pending: outbox.size };
  const snapshot = [...outbox];
  persist(async () => {
    if (!storage) return;
    for (const [table, map] of rows) await storage.putRows(table, [...map.values()] as { id: string }[]);
    await storage.putMeta('outbox', snapshot);
  });
  notify();
  if (changed) changeListeners.forEach((l) => l());
}

/** Group several writes into one render + one IndexedDB transaction per table. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) commit();
  }
}

type NewRow<T> = Omit<T, keyof BaseRow> & Partial<Pick<BaseRow, 'id' | 'created_at'>>;

export function insert<K extends TableName>(table: K, data: NewRow<Tables[K]>): Tables[K] {
  const ts = nowIso();
  const row = {
    ...data,
    id: data.id ?? uuid(),
    created_at: data.created_at ?? ts,
    updated_at: ts,
    deleted_at: null,
  } as unknown as Tables[K];
  stage(table, row as BaseRow);
  return row;
}

export function update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>): Tables[K] | null {
  const existing = state.tables[table][id] as Tables[K] | undefined;
  if (!existing) return null;
  const row = { ...existing, ...patch, updated_at: nowIso() } as Tables[K];
  stage(table, row as BaseRow);
  return row;
}

/** Soft delete (tombstone) so the deletion also syncs. */
export function remove(table: TableName, id: string) {
  update(table, id, { deleted_at: nowIso() } as Partial<Tables[typeof table]>);
}

export function setProfile(patch: Partial<Profile>) {
  state = { ...state, profile: { ...state.profile, ...patch, updated_at: nowIso() } };
  outbox.add('profile');
  const p = state.profile;
  const snapshot = [...outbox];
  state = { ...state, pending: outbox.size };
  persist(async () => {
    await storage?.putMeta('profile', p);
    await storage?.putMeta('outbox', snapshot);
  });
  notify();
  changeListeners.forEach((l) => l());
}

export function setWorkoutUi(ui: WorkoutUiState | null) {
  state = { ...state, workoutUi: ui };
  persist(async () => {
    await storage?.putMeta('workoutUi', ui ?? undefined);
  });
  notify();
}

/* ------------------------------------------------------------------ */
/* Sync helpers (used by lib/sync.ts only)                             */
/* ------------------------------------------------------------------ */

export function getOutbox() {
  return [...outbox];
}

/** Remove keys from the outbox, but only if the row hasn't changed since it was pushed. */
export function markClean(pushed: { key: string; updated_at: string }[]) {
  for (const { key, updated_at } of pushed) {
    const current = key === 'profile' ? state.profile.updated_at : rowForKey(key)?.updated_at;
    if (current === updated_at) outbox.delete(key);
  }
  state = { ...state, pending: outbox.size };
  const snapshot = [...outbox];
  persist(async () => {
    await storage?.putMeta('outbox', snapshot);
  });
  notify();
}

export function rowForKey(key: string): BaseRow | undefined {
  const [table, id] = key.split(':') as [TableName, string];
  return state.tables[table]?.[id] as BaseRow | undefined;
}

/** Merge rows from the server. Last write wins on updated_at; never overwrites newer local edits. */
export function applyRemote(table: TableName, rows: BaseRow[]) {
  let changed = false;
  batchDepth++;
  try {
    for (const r of rows) {
      const local = state.tables[table][r.id] as BaseRow | undefined;
      if (local && local.updated_at >= r.updated_at) continue;
      stage(table, r, false);
      outbox.delete(`${table}:${r.id}`);
      changed = true;
    }
  } finally {
    batchDepth--;
  }
  if (changed) commit(false);
  else batchRows = new Map();
  return changed;
}

export function applyRemoteProfile(p: Partial<Profile> & { updated_at: string }) {
  if (p.updated_at <= state.profile.updated_at) return;
  state = { ...state, profile: { ...state.profile, ...p, id: 'me' } };
  const prof = state.profile;
  persist(async () => {
    await storage?.putMeta('profile', prof);
  });
  notify();
}

export function setSyncState(patch: Partial<AppState['sync']>) {
  state = { ...state, sync: { ...state.sync, ...patch } };
  if (patch.lastSyncedAt) {
    const v = patch.lastSyncedAt;
    persist(async () => {
      await storage?.putMeta('lastSyncedAt', v);
    });
  }
  notify();
}

export function getMeta<T>(key: string): T | undefined {
  return metaCache[key] as T | undefined;
}

export function putMeta(key: string, value: unknown) {
  metaCache[key] = value;
  persist(async () => {
    await storage?.putMeta(key, value);
  });
}

/** Wipe everything on this device. */
export async function resetLocal() {
  await persistChain;
  await storage?.clear();
  outbox.clear();
  metaCache = {};
  state = {
    ...state,
    tables: emptyTables(),
    profile: { ...DEFAULT_PROFILE },
    workoutUi: null,
    pending: 0,
    sync: { ...state.sync, lastSyncedAt: null },
  };
  notify();
}

/** Mark every local row dirty (used after first sign-in so existing data is uploaded). */
export function markAllDirty() {
  for (const t of TABLES) for (const id of Object.keys(state.tables[t])) outbox.add(`${t}:${id}`);
  outbox.add('profile');
  state = { ...state, pending: outbox.size };
  const snapshot = [...outbox];
  persist(async () => {
    await storage?.putMeta('outbox', snapshot);
  });
  notify();
}
