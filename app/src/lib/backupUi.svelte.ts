// Backup / restore actions for the settings screen.
import { backupFileName, createBackup, restoreBackup, type BackupMeta } from './backup';
import { saveFile } from './native';
import { reloadLibrary, settings, saveSettings, t } from './state.svelte';
import { forgetUrls } from './media';
import { forgetScores } from './sources';
import { deleteFile, downloadBlob, listFiles, uploadBlob, type DriveFile } from './drive';
import { getAccessToken, scheduleSync } from './sync.svelte';
import { isBackupZip } from './importer';

export const busy = $state({ open: false, running: false, label: '', done: 0, total: 0, message: '', error: '' });
const KEEP_DRIVE_BACKUPS = 3;

function start(label: string) {
  Object.assign(busy, { open: true, running: true, label, done: 0, total: 0, message: '', error: '' });
}
function fail(e: unknown) {
  busy.error = e instanceof Error ? e.message : String(e);
}

async function make(): Promise<Blob> {
  return createBackup($state.snapshot(settings) as unknown as Record<string, unknown>, __APP_VERSION__, (p) => {
    busy.done = p.done;
    busy.total = p.total;
  });
}

export async function backupToFile() {
  start(t('backup.creating'));
  try {
    const blob = await make();
    busy.label = t('backup.saving');
    const ok = await saveFile(blob, backupFileName(), (d, tot) => { busy.done = d; busy.total = tot; });
    busy.message = ok ? t('backup.saved', { size: (blob.size / 1048576).toFixed(1) }) : t('backup.cancelled');
  } catch (e) { fail(e); } finally { busy.running = false; }
}

export async function backupToDrive() {
  start(t('backup.creating'));
  try {
    const blob = await make();
    const tk = await getAccessToken(true);
    busy.label = t('backup.uploading');
    const createdAt = new Date().toISOString();
    await uploadBlob(fetch, tk, {
      name: `backup-${createdAt}.zip`, blob, appProperties: { type: 'backup', createdAt },
      onProgress: (s, tot) => { busy.done = s; busy.total = tot; },
    });
    const all = await driveBackups();
    for (const old of all.slice(KEEP_DRIVE_BACKUPS)) await deleteFile(fetch, tk, old.id).catch(() => {});
    busy.message = t('backup.savedDrive', { size: (blob.size / 1048576).toFixed(1) });
  } catch (e) { fail(e); } finally { busy.running = false; }
}

export async function driveBackups(): Promise<DriveFile[]> {
  const tk = await getAccessToken(false);
  const list = await listFiles(fetch, tk, "trashed=false and name contains 'backup-'");
  return list.filter((f) => f.appProperties?.type === 'backup')
    .sort((a, b) => (b.appProperties?.createdAt ?? '').localeCompare(a.appProperties?.createdAt ?? ''));
}

async function apply(blob: Blob, mode: 'merge' | 'replace') {
  busy.label = t('backup.restoring');
  const meta: BackupMeta = await restoreBackup(blob, mode, (p) => { busy.done = p.done; busy.total = p.total; });
  const { drive: _d, speeds, ...rest } = meta.settings as Record<string, unknown> & { speeds?: Record<string, number> };
  void _d;
  Object.assign(settings, rest);
  if (speeds) settings.speeds = { ...speeds, ...settings.speeds };
  saveSettings();
  forgetUrls();
  forgetScores();
  await reloadLibrary();
  scheduleSync();
  busy.message = t('backup.restored', { n: meta.units.length, date: new Date(meta.createdAt).toLocaleString() });
}

export async function restoreFromFile(mode: 'merge' | 'replace', file?: File) {
  if (!file) {
    file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,application/zip';
      input.onchange = () => resolve(input.files?.[0]);
      input.oncancel = () => resolve(undefined);
      input.click();
    });
  }
  if (!file) return;
  start(t('backup.restoring'));
  try {
    if (!(await isBackupZip(file))) throw new Error(t('backup.notBackup'));
    await apply(file, mode);
  } catch (e) { fail(e); } finally { busy.running = false; }
}

export async function restoreFromDrive(id: string, mode: 'merge' | 'replace') {
  start(t('backup.downloading'));
  try {
    const tk = await getAccessToken(true);
    const blob = await downloadBlob(fetch, tk, id);
    await apply(blob, mode);
  } catch (e) { fail(e); } finally { busy.running = false; }
}
