import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { findRoot, importZip, zipEntryNames } from './importer';
import { allModels, allPacks, closeDb, deleteAllData, getFile } from './db';

function model(id: string, extra: Record<string, unknown> = {}) {
  return strToU8(JSON.stringify({
    schema: 1, id, category: '90.1', kind: 'model', title: `T ${id}`, status: 'complete', trainable: true,
    difficulty: null, audio: [{ file: 'audio/task.wav', role: 'task' }], notation: [], ...extra,
  }));
}

function zip(files: Record<string, Uint8Array>) {
  return new Blob([zipSync(files) as BlobPart]);
}

beforeEach(async () => {
  await deleteAllData();
});

describe('findRoot', () => {
  it('uses library.json, else common folder of models', () => {
    expect(findRoot(['x/library/library.json', 'x/library/a/m/model.json'])).toBe('x/library');
    expect(findRoot(['lib/a/m1/model.json', 'lib/b/m2/model.json'])).toBe('lib');
    expect(findRoot(['m/model.json'])).toBe('');
  });
});

describe('importZip', () => {
  it('imports models and files under a pack prefix, ignoring junk', async () => {
    const z = zip({
      'library/library.json': strToU8(JSON.stringify({ categories: [{ id: '90.1', title: 'Demo', difficulty_default: 1 }] })),
      'library/90.1_x/A_m/model.json': model('A'),
      'library/90.1_x/A_m/audio/task.wav': new Uint8Array([1, 2, 3]),
      'library/90.1_x/B_m/model.json': model('B'),
      'library/90.1_x/B_m/audio/task.wav': new Uint8Array([4]),
      '__MACOSX/library/._x': new Uint8Array([0]),
      'library/.DS_Store': new Uint8Array([0]),
    });
    expect((await zipEntryNames(z)).length).toBe(7);
    const r = await importZip(z, 'demo', 'replace');
    expect(r.models).toBe(2);
    expect(r.pack.categories).toEqual([{ id: '90.1', title: 'Demo', difficulty_default: 1 }]);
    expect(r.pack.fileCount).toBe(2);
    const ms = await allModels();
    const a = ms.find((m) => m.id === 'A')!;
    expect(a.dir).toBe(`${r.pack.id}/90.1_x/A_m`);
    const f = await getFile(`${a.dir}/audio/task.wav`);
    expect(f?.size).toBe(3);
  });

  it('add mode replaces same ids and garbage-collects empty packs; replace mode drops old packs', async () => {
    const first = await importZip(zip({ 'A/model.json': model('A'), 'A/audio/task.wav': new Uint8Array([1]) }), 'one', 'add');
    const second = await importZip(zip({ 'A/model.json': model('A', { title: 'neu' }), 'B/model.json': model('B') }), 'two', 'add');
    expect(second.replaced).toBe(1);
    const packs = await allPacks();
    expect(packs.map((p) => p.id)).toEqual([second.pack.id]);
    expect(await getFile(`${first.pack.id}/A/audio/task.wav`)).toBeUndefined();
    const third = await importZip(zip({ 'C/model.json': model('C') }), 'three', 'replace');
    expect((await allModels()).map((m) => m.id)).toEqual(['C']);
    expect((await allPacks()).map((p) => p.id)).toEqual([third.pack.id]);
  });

  it('reports bad manifests and fails without models', async () => {
    await expect(importZip(zip({ 'x/model.json': strToU8('{bad') }), 'bad', 'replace')).rejects.toMatchObject({ code: 'noModels' });
    const r = await importZip(zip({ 'a/model.json': model('A'), 'b/model.json': model('A'), 'c/model.json': strToU8('{"title":1}') }), 'w', 'replace');
    expect(r.models).toBe(1);
    expect(r.warnings.length).toBe(2);
  });

  it('rejects non-zip data', async () => {
    await expect(importZip(new Blob([new Uint8Array(100)]), 'x', 'replace')).rejects.toMatchObject({ code: 'notZip' });
    await closeDb();
  });
});
