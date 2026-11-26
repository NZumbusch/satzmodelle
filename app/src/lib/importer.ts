// Import a library zip (or a picked folder) into app storage.
// Every folder containing a model.json is a model (docs/library-format.md); folder names carry no meaning.
import { Unzip, UnzipInflate } from 'fflate';
import { db, gcPacks, deletePack, allPacks, type Pack } from './db';
import { cleanRel, joinPath, parseManifest, ManifestError } from './library';
import type { Category, StoredModel } from './types';

export interface ImportResult {
  pack: Pack;
  models: number;
  replaced: number;
  warnings: string[];
}

export interface ImportProgress {
  files: number;
  bytes: number;
  total?: number;
  current?: string;
}

/** A source of files: path + a function producing its bytes. */
export interface SourceEntry {
  path: string;
  size: number;
  read: () => Promise<Uint8Array | Blob>;
}

const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|\._[^/]*|Thumbs\.db|desktop\.ini)(\/|$)/;

export function shouldIgnore(path: string): boolean {
  return IGNORE.test(path) || path.endsWith('/');
}

/**
 * Determine the library root: the folder of the shallowest library.json; else the deepest common
 * folder above all model.json files' parent folders (so that "library/" or "x/library/" both work).
 */
export function findRoot(paths: string[]): string {
  const lj = paths.filter((p) => p === 'library.json' || p.endsWith('/library.json'));
  if (lj.length) {
    lj.sort((a, b) => a.split('/').length - b.split('/').length);
    return lj[0].slice(0, -'library.json'.length).replace(/\/$/, '');
  }
  const dirs = paths.filter((p) => p === 'model.json' || p.endsWith('/model.json')).map((p) => p.split('/').slice(0, -2));
  if (!dirs.length) return '';
  let common = dirs[0];
  for (const d of dirs) {
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }
  return common.join('/');
}

export function relativeTo(root: string, path: string): string | null {
  if (!root) return path;
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : null;
}

interface Collected {
  manifests: Map<string, unknown>; // dir -> parsed json
  libraryJson?: unknown;
  files: number;
  bytes: number;
  warnings: string[];
}

function newPackId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Core import: writes files under <packId>/<relpath>, then registers models and the pack.
 * mode 'replace' removes all existing packs (progress and overrides stay; they key on model id).
 */
export async function importEntries(
  entries: AsyncIterable<{ path: string; data: Blob }>,
  root: string,
  opts: ImportOpts & { total?: number },
): Promise<ImportResult> {
  const d = await db();
  const packId = opts.packId ?? newPackId();
  // re-importing a known pack (sync/restore): start from a clean slate for that id
  if (opts.packId) await deletePack(opts.packId);
  const c: Collected = { manifests: new Map(), files: 0, bytes: 0, warnings: [] };
  try {
    for await (const e of entries) {
      const rel = relativeTo(root, cleanRel(e.path));
      if (rel === null || !rel) continue;
      const base = rel.split('/').pop()!;
      if (base === 'model.json' || rel === 'library.json') {
        try {
          const json = JSON.parse(await e.data.text());
          if (rel === 'library.json') c.libraryJson = json;
          else c.manifests.set(rel.slice(0, -'model.json'.length).replace(/\/$/, ''), json);
        } catch {
          c.warnings.push(`${rel}: invalid JSON`);
        }
        continue;
      }
      await d.put('files', e.data, `${packId}/${rel}`);
      c.files++;
      c.bytes += e.data.size;
      opts.onProgress?.({ files: c.files, bytes: c.bytes, total: opts.total, current: rel });
    }
    return await register(packId, c, opts);
  } catch (err) {
    await deletePack(packId).catch(() => {});
    throw err;
  }
}

export interface ImportOpts {
  name: string;
  mode: 'replace' | 'add';
  onProgress?: (p: ImportProgress) => void;
  /** keep a known pack id / date (used by sync and restore) */
  packId?: string;
  importedAt?: string;
}

async function register(packId: string, c: Collected, opts: ImportOpts): Promise<ImportResult> {
  const d = await db();
  const models: StoredModel[] = [];
  const seen = new Set<string>();
  for (const [dir, json] of c.manifests) {
    try {
      const m = parseManifest(json, `${packId}${dir ? '/' + dir : ''}`);
      if (seen.has(m.id)) {
        c.warnings.push(`${dir}: duplicate id ${m.id}, skipped`);
        continue;
      }
      seen.add(m.id);
      models.push(m);
    } catch (err) {
      c.warnings.push(`${dir || '.'}/model.json: ${err instanceof ManifestError ? err.message : String(err)}`);
    }
  }
  if (!models.length) {
    await deletePack(packId);
    throw new ImportError('noModels', c.warnings);
  }
  const categories = parseCategories(c.libraryJson, models);
  const pack: Pack = {
    id: packId, name: opts.name, importedAt: opts.importedAt ?? new Date().toISOString(),
    fileCount: c.files, bytes: c.bytes, categories,
  };
  const old = opts.mode === 'replace' ? await allPacks() : [];
  const tx = d.transaction(['models', 'packs'], 'readwrite');
  let replaced = 0;
  for (const m of models) {
    if (await tx.objectStore('models').get(m.id)) replaced++;
    await tx.objectStore('models').put({ ...m, pack: packId });
  }
  await tx.objectStore('packs').put(pack);
  await tx.done;
  for (const p of old) await deletePack(p.id);
  await gcPacks();
  return { pack, models: models.length, replaced: opts.mode === 'replace' ? 0 : replaced, warnings: c.warnings };
}

export function parseCategories(libraryJson: unknown, models: StoredModel[]): Category[] {
  const out = new Map<string, Category>();
  const cats = (libraryJson as { categories?: unknown })?.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) {
      if (c && typeof c.id === 'string')
        out.set(c.id, {
          id: c.id,
          title: typeof c.title === 'string' ? c.title : c.id,
          difficulty_default: typeof c.difficulty_default === 'number' ? c.difficulty_default : null,
        });
    }
  }
  for (const m of models) if (m.category && !out.has(m.category)) out.set(m.category, { id: m.category, title: m.category, difficulty_default: null });
  return [...out.values()];
}

export class ImportError extends Error {
  constructor(public code: 'noModels' | 'notZip', public warnings: string[] = []) {
    super(code);
  }
}

/* ---------------------------------------------------------------- zip */

/** Read a zip's central directory to learn its entry names without decompressing anything. */
export async function zipEntryNames(blob: Blob): Promise<string[]> {
  const tailLen = Math.min(blob.size, 65536 + 22);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ImportError('notZip');
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) {
    // zip64 end of central directory locator
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(dv.getBigUint64(loc + 8, true));
      const z = new DataView(await blob.slice(z64off, z64off + 56).arrayBuffer());
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOff = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer);
  const names: string[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cdv.getUint32(p, true) !== 0x02014b50) break;
    const flags = cdv.getUint16(p + 8, true);
    const nl = cdv.getUint16(p + 28, true), el = cdv.getUint16(p + 30, true), cl = cdv.getUint16(p + 32, true);
    const raw = cd.subarray(p + 46, p + 46 + nl);
    names.push(new TextDecoder(flags & 0x800 ? 'utf-8' : 'utf-8').decode(raw));
    p += 46 + nl + el + cl;
  }
  return names;
}

/** Stream-decompress a zip blob, yielding one entry at a time (memory ~ one file). */
export async function* unzipStream(blob: Blob): AsyncGenerator<{ path: string; data: Blob }> {
  const queue: { path: string; data: Blob }[] = [];
  let error: unknown = null;
  const un = new Unzip((file) => {
    if (shouldIgnore(file.name)) return;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) { error = err; return; }
      chunks.push(chunk);
      if (final) queue.push({ path: file.name.normalize('NFC'), data: new Blob(chunks as BlobPart[]) });
    };
    file.start();
  });
  un.register(UnzipInflate);
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { un.push(new Uint8Array(0), true); }
    else {
      // push in slices so that a single huge chunk does not delay yielding
      for (let o = 0; o < value.length; o += 1 << 20) un.push(value.subarray(o, o + (1 << 20)));
    }
    if (error) throw error;
    while (queue.length) yield queue.shift()!;
    if (done) break;
  }
}

export async function importZip(
  file: Blob, name: string, mode: 'replace' | 'add', onProgress?: (p: ImportProgress) => void,
  extra: { packId?: string; importedAt?: string } = {},
) {
  const names = (await zipEntryNames(file)).map((n) => cleanRel(n)).filter((n) => !shouldIgnore(n));
  const root = findRoot(names);
  return importEntries(unzipStream(file), root, { name, mode, onProgress, total: names.length, ...extra });
}

/** True if the zip is a full backup made by this app (see backup.ts). */
export async function isBackupZip(file: Blob): Promise<boolean> {
  try {
    return (await zipEntryNames(file)).includes('backup.json');
  } catch {
    return false;
  }
}

/** Folder picked with <input webkitdirectory> (desktop browsers). */
export async function importFolder(files: File[], mode: 'replace' | 'add', onProgress?: (p: ImportProgress) => void) {
  const list = files
    .map((f) => ({ f, path: cleanRel((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name) }))
    .filter((x) => !shouldIgnore(x.path));
  const root = findRoot(list.map((x) => x.path));
  async function* gen() {
    for (const x of list) yield { path: x.path, data: x.f as Blob };
  }
  const name = list[0]?.path.split('/')[0] ?? 'Ordner';
  return importEntries(gen(), root, { name, mode, onProgress, total: list.length });
}

export { joinPath };
