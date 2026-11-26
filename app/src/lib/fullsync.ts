// Full sync: library packs, own exercises, edits (and optionally recordings) as units in the Drive app folder.
// One file per unit: "unit-<key>.zip" with appProperties {key, kind, updatedAt, deleted}.
import { deleteFile, downloadBlob, listFiles, uploadBlob, type Fetch } from './drive';
import { plan, type RemoteUnit } from './syncplan';
import { deleteLocalUnit, exportUnit, importUnit, listLocalUnits, parseKey } from './units';

export interface FullSyncProgress { done: number; total: number; current: string; bytes: number }

export interface FullSyncResult { uploaded: number; downloaded: number; deleted: number; synced: Record<string, string> }

export async function fullSync(
  f: Fetch, token: string, opts: { recordings: boolean; synced: Record<string, string>; onProgress?: (p: FullSyncProgress) => void },
): Promise<FullSyncResult> {
  const include = (key: string) => opts.recordings || parseKey(key).kind !== 'rec';
  const localList = await listLocalUnits({ recordings: opts.recordings });
  const local = new Map(localList.map((u) => [u.key, u.updatedAt]));
  const names = new Map(localList.map((u) => [u.key, u.name]));
  const remote = new Map<string, RemoteUnit>();
  const dupes: string[] = [];
  for (const file of await listFiles(f, token, "trashed=false and name contains 'unit-'")) {
    const p = file.appProperties ?? {};
    if (!p.key || !include(p.key)) continue;
    const prev = remote.get(p.key);
    if (prev) { dupes.push(prev.updatedAt > (p.updatedAt ?? '') ? file.id : prev.fileId); if (prev.updatedAt > (p.updatedAt ?? '')) continue; }
    remote.set(p.key, { updatedAt: p.updatedAt ?? '', deleted: p.deleted === '1', fileId: file.id });
  }
  const synced = Object.fromEntries(Object.entries(opts.synced).filter(([k]) => include(k)));
  const actions = plan(local, remote, synced);
  const res: FullSyncResult = { uploaded: 0, downloaded: 0, deleted: 0, synced: { ...opts.synced } };
  let bytes = 0;
  for (const [i, a] of actions.entries()) {
    opts.onProgress?.({ done: i, total: actions.length, current: a.key, bytes });
    const r = remote.get(a.key);
    const kind = parseKey(a.key).kind;
    if (a.type === 'upload') {
      const blob = await exportUnit(a.key);
      const updatedAt = local.get(a.key)!;
      await uploadBlob(f, token, {
        id: r?.fileId, name: `unit-${a.key}.zip`, blob,
        appProperties: { key: a.key, kind, updatedAt, deleted: '0', name: (names.get(a.key) ?? '').slice(0, 60) },
        onProgress: (sent) => opts.onProgress?.({ done: i, total: actions.length, current: a.key, bytes: bytes + sent }),
      });
      bytes += blob.size;
      res.synced[a.key] = updatedAt;
      res.uploaded++;
    } else if (a.type === 'download') {
      const blob = await downloadBlob(f, token, r!.fileId);
      bytes += blob.size;
      await importUnit(a.key, blob);
      res.synced[a.key] = r!.updatedAt;
      res.downloaded++;
    } else if (a.type === 'tombstone') {
      const now = new Date().toISOString();
      await uploadBlob(f, token, { id: r!.fileId, name: `unit-${a.key}.zip`, blob: new Blob([]), appProperties: { key: a.key, kind, updatedAt: now, deleted: '1' } });
      delete res.synced[a.key];
      res.deleted++;
    } else {
      await deleteLocalUnit(a.key);
      delete res.synced[a.key];
      res.deleted++;
    }
  }
  // forget keys that no longer exist anywhere
  for (const k of Object.keys(res.synced)) if (include(k) && !local.has(k) && !remote.has(k) && !actions.some((a) => a.key === k)) delete res.synced[k];
  for (const id of dupes) await deleteFile(f, token, id).catch(() => {});
  opts.onProgress?.({ done: actions.length, total: actions.length, current: '', bytes });
  return res;
}
