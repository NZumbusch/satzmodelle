// App-private storage. IndexedDB lives in the WebView's private data directory on Android
// (not visible to the gallery, file managers or other apps; backups are disabled in the manifest).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Category, ModelOverride, Progress, StoredModel } from './types';

export interface Pack {
  id: string; // also the path prefix of its files
  name: string;
  importedAt: string;
  fileCount: number;
  bytes: number;
  categories: Category[];
}

interface Schema extends DBSchema {
  files: { key: string; value: Blob };
  models: { key: string; value: StoredModel & { pack: string } };
  packs: { key: string; value: Pack };
  progress: { key: string; value: Progress };
  overrides: { key: string; value: ModelOverride };
  userfiles: { key: string; value: Blob };
  recordings: { key: string; value: Recording; indexes: { model: string } };
}

export interface Recording {
  id: string;
  modelId: string;
  at: string;
  mime: string;
  duration: number;
  blob: Blob;
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
export const DB_NAME = 'satzmodelle';

export function db() {
  dbp ??= openDB<Schema>(DB_NAME, 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('files');
        d.createObjectStore('models', { keyPath: 'id' });
        d.createObjectStore('packs', { keyPath: 'id' });
        d.createObjectStore('progress', { keyPath: 'id' });
        d.createObjectStore('overrides', { keyPath: 'id' });
        d.createObjectStore('userfiles');
      }
      if (oldVersion < 2) {
        d.createObjectStore('recordings', { keyPath: 'id' }).createIndex('model', 'modelId');
      }
    },
  });
  return dbp;
}

/** For tests. */
export async function closeDb() {
  if (dbp) (await dbp).close();
  dbp = null;
}

export async function getFile(path: string): Promise<Blob | undefined> {
  const d = await db();
  if (path.startsWith('user/')) return d.get('userfiles', path);
  return d.get('files', path);
}

export async function allModels() {
  return (await db()).getAll('models');
}

export async function allPacks() {
  return (await db()).getAll('packs');
}

export async function allProgress() {
  return (await db()).getAll('progress');
}

export async function allOverrides() {
  return (await db()).getAll('overrides');
}

export async function putProgress(p: Progress) {
  await (await db()).put('progress', p);
}

export async function putOverride(o: ModelOverride, keepDate = false) {
  await (await db()).put('overrides', keepDate && o.updatedAt ? o : { ...o, updatedAt: new Date().toISOString() });
}

export async function putUserFile(path: string, blob: Blob) {
  await (await db()).put('userfiles', blob, path);
}

export async function recordingsFor(modelId: string): Promise<Recording[]> {
  const list = await (await db()).getAllFromIndex('recordings', 'model', modelId);
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

export async function putRecording(r: Recording) {
  await (await db()).put('recordings', r);
}

export async function deleteRecording(id: string) {
  await (await db()).delete('recordings', id);
}

/** Delete all files with a given pack prefix. */
export async function deletePackFiles(packId: string) {
  const d = await db();
  const range = IDBKeyRange.bound(`${packId}/`, `${packId}/￿`);
  const tx = d.transaction('files', 'readwrite');
  await tx.store.delete(range);
  await tx.done;
}

export async function deletePack(packId: string) {
  const d = await db();
  await deletePackFiles(packId);
  const tx = d.transaction(['models', 'packs'], 'readwrite');
  for (const m of await tx.objectStore('models').getAll()) if (m.pack === packId) await tx.objectStore('models').delete(m.id);
  await tx.objectStore('packs').delete(packId);
  await tx.done;
}

/** Remove packs whose models have all been superseded by a newer import. */
export async function gcPacks() {
  const d = await db();
  const used = new Set((await d.getAll('models')).map((m) => m.pack));
  for (const p of await d.getAll('packs')) if (!used.has(p.id)) await deletePack(p.id);
}

/** Wipe everything: library, progress, overrides, user files. */
export async function deleteAllData() {
  const d = await db();
  const stores = ['files', 'models', 'packs', 'progress', 'overrides', 'userfiles', 'recordings'] as const;
  const tx = d.transaction([...stores], 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

export async function estimateStorage(): Promise<{ usage?: number; quota?: number }> {
  try {
    return (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    return {};
  }
}
