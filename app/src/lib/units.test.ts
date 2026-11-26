import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importZip } from './importer';
import { allModels, allPacks, db, deleteAllData, getFile, putOverride, putRecording, putUserFile } from './db';
import { deleteLocalUnit, exportUnit, importUnit, listLocalUnits } from './units';
import { saveOwn } from './own';

const manifest = (id: string) => strToU8(JSON.stringify({
  schema: 1, id, category: '90.1', kind: 'model', title: `T ${id}`, status: 'complete', trainable: true,
  difficulty: null, audio: [{ file: 'audio/task.wav', role: 'task' }], notation: [],
}));

beforeEach(async () => { await deleteAllData(); });

describe('units round trip', () => {
  it('pack: export as library zip, delete, re-import with the same id and date', async () => {
    const r = await importZip(new Blob([zipSync({
      'library/library.json': strToU8(JSON.stringify({ categories: [{ id: '90.1', title: 'Demo', difficulty_default: 2 }] })),
      'library/c/A/model.json': manifest('A'),
      'library/c/A/audio/task.wav': new Uint8Array([1, 2, 3, 4]),
    }) as BlobPart]), 'Demo-Paket', 'replace');
    const key = `pack:${r.pack.id}`;
    expect((await listLocalUnits({ recordings: false })).map((u) => u.key)).toEqual([key]);
    const blob = await exportUnit(key);
    await deleteLocalUnit(key);
    expect(await allModels()).toEqual([]);
    await importUnit(key, blob);
    const [p] = await allPacks();
    expect(p).toMatchObject({ id: r.pack.id, name: 'Demo-Paket', importedAt: r.pack.importedAt });
    expect(p.categories[0].title).toBe('Demo');
    const [m] = await allModels();
    expect(m.dir).toBe(`${r.pack.id}/c/A`);
    expect((await getFile(`${m.dir}/audio/task.wav`))?.size).toBe(4);
  });

  it('own exercise, edits with added audio, recording', async () => {
    const own = await saveOwn({
      title: 'Meine', composer: '', category: 'U', key: 'C-Dur', difficulty: 2, startMeasures: 2,
      taskAudio: new File([new Uint8Array([9, 9])], 'take.mp3'),
    });
    await putUserFile(`user/${own.id}/added/x.mp3`, new Blob([new Uint8Array([7])]));
    await putOverride({ id: own.id, difficulty: 4, addedAudio: [{ file: `user/${own.id}/added/x.mp3`, role: 'other' }] });
    await putRecording({ id: 'r1', modelId: own.id, at: '2026-11-26T10:00:00Z', mime: 'audio/webm', duration: 2, blob: new Blob([new Uint8Array([5, 5, 5])]) });
    const units = await listLocalUnits({ recordings: true });
    expect(units.map((u) => u.kind).sort()).toEqual(['ovr', 'own', 'rec']);
    const blobs = new Map<string, Blob>();
    for (const u of units) blobs.set(u.key, await exportUnit(u.key));
    await deleteAllData();
    for (const [k, b] of blobs) await importUnit(k, b);
    const d = await db();
    const m = await d.get('models', own.id);
    expect(m).toMatchObject({ title: 'Meine', pack: 'user', dir: '' });
    expect((await getFile(m!.audio[0].file))?.size).toBe(2);
    expect((await d.get('overrides', own.id))?.difficulty).toBe(4);
    expect((await getFile(`user/${own.id}/added/x.mp3`))?.size).toBe(1);
    const rec = await d.get('recordings', 'r1');
    expect(rec?.blob.size).toBe(3);
    expect(rec?.mime).toBe('audio/webm');
  });
});

import { createBackup, restoreBackup } from './backup';
import { allProgress, putProgress } from './db';

describe('backup', () => {
  it('restores library, own exercise, recording and progress on an empty device', async () => {
    await importZip(new Blob([zipSync({ 'A/model.json': manifest('A'), 'A/audio/task.wav': new Uint8Array([1]) }) as BlobPart]), 'P', 'replace');
    const own = await saveOwn({ title: 'Meine', composer: '', category: 'U', key: '', difficulty: null, startMeasures: 2, taskAudio: new File([new Uint8Array([2])], 't.mp3') });
    await putRecording({ id: 'r1', modelId: 'A', at: '2026-11-26T10:00:00Z', mime: 'audio/webm', duration: 1, blob: new Blob([new Uint8Array([3])]) });
    await putProgress({ id: 'A', attempts: [{ at: '2026-11-26T10:01:00Z', rating: 'yes', hintsUsed: 2 }] });
    const b = await createBackup({ lang: 'en', drive: { secret: 1 } }, '0.3.0');
    await deleteAllData();
    const meta = await restoreBackup(b, 'merge');
    expect(meta.settings).toEqual({ lang: 'en' });
    expect((await allModels()).map((m) => m.id).sort()).toEqual(['A', own.id].sort());
    expect(await (await db()).count('recordings')).toBe(1);
    expect((await allProgress())[0].attempts[0].hintsUsed).toBe(2);
    // restoring twice does not duplicate anything
    await restoreBackup(b, 'merge');
    expect(await allModels()).toHaveLength(2);
    expect((await allProgress())[0].attempts).toHaveLength(1);
  });
});
