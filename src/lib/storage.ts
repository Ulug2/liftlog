/**
 * Minimal IndexedDB wrapper (no library). One object store per table plus a
 * key/value "meta" store. Falls back to localStorage if IndexedDB is unavailable
 * (e.g. some private-browsing modes), and to memory as a last resort.
 */
import { TABLES, type TableName } from '../types/models';

const DB_NAME = 'liftlog';
const DB_VERSION = 1;
const META = 'meta';

type AnyRow = { id: string };

export interface Storage {
  kind: 'indexeddb' | 'localstorage' | 'memory';
  loadAll(): Promise<{ tables: Record<TableName, AnyRow[]>; meta: Record<string, unknown> }>;
  putRows(table: TableName, rows: AnyRow[]): Promise<void>;
  putMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openIdb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('no indexeddb');
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('blocked'));
  });
}

function idbStorage(db: IDBDatabase): Storage {
  return {
    kind: 'indexeddb',
    async loadAll() {
      const tx = db.transaction([...TABLES, META], 'readonly');
      const tables = {} as Record<TableName, AnyRow[]>;
      await Promise.all(
        TABLES.map(async (t) => {
          tables[t] = (await req(tx.objectStore(t).getAll())) as AnyRow[];
        }),
      );
      const metaStore = tx.objectStore(META);
      const keys = (await req(metaStore.getAllKeys())) as string[];
      const vals = await req(metaStore.getAll());
      const meta: Record<string, unknown> = {};
      keys.forEach((k, i) => (meta[k] = vals[i]));
      return { tables, meta };
    },
    async putRows(table, rows) {
      const tx = db.transaction(table, 'readwrite');
      const s = tx.objectStore(table);
      for (const r of rows) s.put(r);
      await txDone(tx);
    },
    async putMeta(key, value) {
      const tx = db.transaction(META, 'readwrite');
      if (value === undefined) tx.objectStore(META).delete(key);
      else tx.objectStore(META).put(value, key);
      await txDone(tx);
    },
    async clear() {
      const tx = db.transaction([...TABLES, META], 'readwrite');
      for (const t of [...TABLES, META]) tx.objectStore(t).clear();
      await txDone(tx);
    },
  };
}

function lsStorage(): Storage {
  const KEY = 'liftlog:v1';
  const read = (): { tables: Record<string, Record<string, AnyRow>>; meta: Record<string, unknown> } => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '') || { tables: {}, meta: {} };
    } catch {
      return { tables: {}, meta: {} };
    }
  };
  const write = (d: ReturnType<typeof read>) => localStorage.setItem(KEY, JSON.stringify(d));
  return {
    kind: 'localstorage',
    async loadAll() {
      const d = read();
      const tables = {} as Record<TableName, AnyRow[]>;
      for (const t of TABLES) tables[t] = Object.values(d.tables[t] || {});
      return { tables, meta: d.meta };
    },
    async putRows(table, rows) {
      const d = read();
      d.tables[table] = d.tables[table] || {};
      for (const r of rows) d.tables[table][r.id] = r;
      write(d);
    },
    async putMeta(key, value) {
      const d = read();
      if (value === undefined) delete d.meta[key];
      else d.meta[key] = value;
      write(d);
    },
    async clear() {
      localStorage.removeItem(KEY);
    },
  };
}

function memoryStorage(): Storage {
  return {
    kind: 'memory',
    async loadAll() {
      const tables = {} as Record<TableName, AnyRow[]>;
      for (const t of TABLES) tables[t] = [];
      return { tables, meta: {} };
    },
    async putRows() {},
    async putMeta() {},
    async clear() {},
  };
}

export async function openStorage(): Promise<Storage> {
  try {
    return idbStorage(await openIdb());
  } catch {
    try {
      localStorage.setItem('liftlog:probe', '1');
      localStorage.removeItem('liftlog:probe');
      return lsStorage();
    } catch {
      return memoryStorage();
    }
  }
}
