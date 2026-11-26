// Everything the user has, cut into independent "units" that can be synced or backed up one by one:
//   pack:<id>  an imported library pack, as a normal library zip (spec format, re-importable anywhere)
//   own:<id>   an exercise made in the app (model.json + its files)
//   ovr:<id>   the user's edits of a library model (title, difficulty, added audio)
//   rec:<id>   one recorded attempt
import { db, deletePack, deleteRecording, type Pack, type Recording } from './db';
import { importZip, unzipStream } from './importer';
import { BlobZip } from './zipwriter';
import { OWN_PACK, deleteOwn } from './own';
import type { ModelOverride, StoredModel } from './types';

export type UnitKind = 'pack' | 'own' | 'ovr' | 'rec';
export interface UnitInfo {
  key: string; // kind:id
  kind: UnitKind;
  id: string;
  name: string;
  updatedAt: string;
}

export const unitKey = (kind: UnitKind, id: string) => `${kind}:${id}`;
export function parseKey(key: string): { kind: UnitKind; id: string } {
  const i = key.indexOf(':');
  return { kind: key.slice(0, i) as UnitKind, id: key.slice(i + 1) };
}

export async function listLocalUnits(opts: { recordings: boolean }): Promise<UnitInfo[]> {
  const d = await db();
  const out: UnitInfo[] = [];
  for (const p of await d.getAll('packs')) out.push({ key: unitKey('pack', p.id), kind: 'pack', id: p.id, name: p.name, updatedAt: p.importedAt });
  for (const m of await d.getAll('models'))
    if (m.pack === OWN_PACK) out.push({ key: unitKey('own', m.id), kind: 'own', id: m.id, name: m.title, updatedAt: m.updatedAt ?? '1970-01-01T00:00:00.000Z' });
  for (const o of await d.getAll('overrides'))
    out.push({ key: unitKey('ovr', o.id), kind: 'ovr', id: o.id, name: o.id, updatedAt: o.updatedAt ?? '1970-01-01T00:00:00.000Z' });
  if (opts.recordings)
    for (const r of await d.getAll('recordings')) out.push({ key: unitKey('rec', r.id), kind: 'rec', id: r.id, name: r.modelId, updatedAt: r.at });
  return out;
}

function manifestOf(m: StoredModel): Record<string, unknown> {
  const { dir: _d, pack: _p, ...rest } = m as StoredModel & { pack?: string };
  void _d; void _p;
  return rest;
}

async function userFiles(prefix: string): Promise<[string, Blob][]> {
  const d = await db();
  const keys = await d.getAllKeys('userfiles', IDBKeyRange.bound(prefix, `${prefix}￿`));
  const out: [string, Blob][] = [];
  for (const k of keys) {
    const b = await d.get('userfiles', k);
    if (b) out.push([k, b]);
  }
  return out;
}

export async function exportUnit(key: string): Promise<Blob> {
  const { kind, id } = parseKey(key);
  const d = await db();
  const z = new BlobZip();
  if (kind === 'pack') {
    const pack = await d.get('packs', id);
    if (!pack) throw new Error(`no pack ${id}`);
    await z.add('library.json', JSON.stringify({
      schema: 2, generated_from: 'satzmodelle-app', categories: pack.categories,
      pack: { id: pack.id, name: pack.name, importedAt: pack.importedAt },
    }, null, 1), true);
    for (const m of (await d.getAll('models')).filter((x) => x.pack === id)) {
      const rel = m.dir === id ? '' : m.dir.slice(id.length + 1);
      await z.add(rel ? `${rel}/model.json` : 'model.json', JSON.stringify(manifestOf(m), null, 1), true);
    }
    for (const k of await d.getAllKeys('files', IDBKeyRange.bound(`${id}/`, `${id}/￿`))) {
      const b = await d.get('files', k);
      if (b) await z.add(k.slice(id.length + 1), b);
    }
  } else if (kind === 'own') {
    const m = await d.get('models', id);
    if (!m) throw new Error(`no exercise ${id}`);
    await z.add('model.json', JSON.stringify(manifestOf(m)), true);
    for (const [k, b] of await userFiles(`user/${id}/`)) if (!k.startsWith(`user/${id}/added/`)) await z.add(k, b);
  } else if (kind === 'ovr') {
    const o = await d.get('overrides', id);
    if (!o) throw new Error(`no edits for ${id}`);
    await z.add('override.json', JSON.stringify(o), true);
    for (const [k, b] of await userFiles(`user/${id}/added/`)) await z.add(k, b);
  } else {
    const r = await d.get('recordings', id);
    if (!r) throw new Error(`no recording ${id}`);
    const { blob, ...meta } = r;
    await z.add('recording.json', JSON.stringify(meta), true);
    await z.add('audio', blob);
  }
  return z.finish();
}

async function readAll(blob: Blob): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  for await (const e of unzipStream(blob)) out.set(e.path, e.data);
  return out;
}

/** Install a unit, replacing the local one with the same key. */
export async function importUnit(key: string, blob: Blob): Promise<void> {
  const { kind, id } = parseKey(key);
  const d = await db();
  if (kind === 'pack') {
    // name/date come from library.json inside
    const files = await zipHead(blob);
    await importZip(blob, files.name ?? id, 'add', undefined, { packId: id, importedAt: files.importedAt });
    return;
  }
  const entries = await readAll(blob);
  if (kind === 'own') {
    const m = JSON.parse(await entries.get('model.json')!.text()) as StoredModel;
    await deleteOwn(id);
    for (const [k, b] of entries) if (k.startsWith('user/')) await d.put('userfiles', b, k);
    await d.put('models', { ...m, id, dir: '', pack: OWN_PACK } as StoredModel & { pack: string });
  } else if (kind === 'ovr') {
    const o = JSON.parse(await entries.get('override.json')!.text()) as ModelOverride;
    await d.delete('userfiles', IDBKeyRange.bound(`user/${id}/added/`, `user/${id}/added/￿`));
    for (const [k, b] of entries) if (k.startsWith('user/')) await d.put('userfiles', b, k);
    await d.put('overrides', { ...o, id });
  } else {
    const meta = JSON.parse(await entries.get('recording.json')!.text()) as Omit<Recording, 'blob'>;
    const audio = entries.get('audio')!;
    await d.put('recordings', { ...meta, id, blob: new Blob([audio], { type: meta.mime }) });
  }
}

/** Read name/date of a pack unit from its library.json. */
async function zipHead(blob: Blob): Promise<{ name?: string; importedAt?: string }> {
  for await (const e of unzipStream(blob)) {
    if (e.path === 'library.json' || e.path.endsWith('/library.json')) {
      try {
        const j = JSON.parse(await e.data.text());
        return { name: j.pack?.name, importedAt: j.pack?.importedAt };
      } catch {
        return {};
      }
    }
  }
  return {};
}

export async function deleteLocalUnit(key: string) {
  const { kind, id } = parseKey(key);
  const d = await db();
  if (kind === 'pack') await deletePack(id);
  else if (kind === 'own') await deleteOwn(id);
  else if (kind === 'ovr') {
    await d.delete('overrides', id);
    await d.delete('userfiles', IDBKeyRange.bound(`user/${id}/added/`, `user/${id}/added/￿`));
  } else await deleteRecording(id);
}

export type { Pack };
