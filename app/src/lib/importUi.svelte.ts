import { importFolder, importZip, isBackupZip, ImportError, type ImportProgress, type ImportResult } from './importer';
import { reloadLibrary } from './state.svelte';
import { forgetUrls } from './media';
import { scheduleSync } from './sync.svelte';

export const importUi = $state({
  open: false,
  running: false,
  progress: null as ImportProgress | null,
  result: null as ImportResult | null,
  error: null as { code: string; msg?: string; warnings?: string[] } | null,
});

function pick(accept: string, directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (directory) {
      input.setAttribute('webkitdirectory', '');
      input.multiple = true;
    }
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function runImport(mode: 'replace' | 'add', source: 'zip' | 'folder' = 'zip') {
  const files = source === 'zip' ? await pick('.zip,application/zip,application/x-zip-compressed') : await pick('', true);
  if (!files.length) return;
  if (source === 'zip' && (await isBackupZip(files[0]))) {
    const { restoreFromFile } = await import('./backupUi.svelte');
    return restoreFromFile('merge', files[0]);
  }
  Object.assign(importUi, { open: true, running: true, progress: null, result: null, error: null });
  try {
    const onProgress = (p: ImportProgress) => (importUi.progress = p);
    importUi.result = source === 'zip'
      ? await importZip(files[0], files[0].name.replace(/\.zip$/i, ''), mode, onProgress)
      : await importFolder(files, mode, onProgress);
    forgetUrls();
    await reloadLibrary();
    scheduleSync();
  } catch (e) {
    importUi.error = e instanceof ImportError
      ? { code: e.code, warnings: e.warnings }
      : { code: 'generic', msg: e instanceof Error ? e.message : String(e) };
  } finally {
    importUi.running = false;
  }
}
