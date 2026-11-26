// A backup of everything in one zip:
//   backup.json            meta, settings, progress
//   units/<key>.zip        every unit (library packs, own exercises, edits, recordings), see units.ts
// Library packs inside are normal library zips, so the material can also be re-imported on its own.
import { BlobZip } from './zipwriter';
import { unzipStream } from './importer';
import { allProgress, deleteAllData, putProgress } from './db';
import { exportUnit, importUnit, listLocalUnits } from './units';
import { fromFile, mergeFiles, toFile, type ProgressFile } from './progress';

export interface BackupMeta {
  schema: 1;
  app: 'satzmodelle';
  version: string;
  createdAt: string;
  units: { key: string; name: string; updatedAt: string }[];
  progress: ProgressFile;
  settings: Record<string, unknown>;
}

export interface BackupProgress { done: number; total: number; current: string }

const unitPath = (key: string) => `units/${encodeURIComponent(key)}.zip`;

export async function createBackup(settings: Record<string, unknown>, version: string, onProgress?: (p: BackupProgress) => void): Promise<Blob> {
  const units = await listLocalUnits({ recordings: true });
  const progress = toFile(await allProgress());
  const { drive: _drive, ...portable } = settings;
  void _drive;
  const meta: BackupMeta = {
    schema: 1, app: 'satzmodelle', version, createdAt: new Date().toISOString(),
    units: units.map((u) => ({ key: u.key, name: u.name, updatedAt: u.updatedAt })), progress, settings: portable,
  };
  const z = new BlobZip();
  await z.add('backup.json', JSON.stringify(meta), true);
  for (const [i, u] of units.entries()) {
    onProgress?.({ done: i, total: units.length, current: u.name });
    await z.add(unitPath(u.key), await exportUnit(u.key));
  }
  onProgress?.({ done: units.length, total: units.length, current: '' });
  return z.finish();
}

/**
 * Restore a backup. 'merge' keeps what is on the device (units in the backup replace the same ones,
 * progress is merged); 'replace' deletes everything first. Returns the backup's settings.
 */
export async function restoreBackup(blob: Blob, mode: 'merge' | 'replace', onProgress?: (p: BackupProgress) => void): Promise<BackupMeta> {
  if (mode === 'replace') await deleteAllData();
  let meta: BackupMeta | null = null;
  let done = 0;
  for await (const e of unzipStream(blob)) {
    if (e.path === 'backup.json') {
      meta = JSON.parse(await e.data.text()) as BackupMeta;
      if (meta.app !== 'satzmodelle' || meta.schema !== 1) throw new Error('not a Satzmodelle backup');
      continue;
    }
    const m = e.path.match(/^units\/(.+)\.zip$/);
    if (!m) continue;
    const key = decodeURIComponent(m[1]);
    onProgress?.({ done, total: meta?.units.length ?? 0, current: meta?.units.find((u) => u.key === key)?.name ?? key });
    await importUnit(key, e.data);
    done++;
  }
  if (!meta) throw new Error('not a Satzmodelle backup');
  const merged = mergeFiles(toFile(await allProgress()), meta.progress);
  for (const p of fromFile(merged)) await putProgress(p);
  onProgress?.({ done, total: done, current: '' });
  return meta;
}

export function backupFileName(d = new Date()) {
  return `satzmodelle-sicherung-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
}
