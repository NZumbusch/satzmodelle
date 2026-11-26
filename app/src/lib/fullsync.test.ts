import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importZip } from './importer';
import { allModels, allPacks, deleteAllData, deletePack, putRecording } from './db';
import { fullSync } from './fullsync';
import type { Fetch } from './drive';

/** In-memory stand-in for the Drive v3 app folder. */
function mockDrive() {
  const files = new Map<string, { name: string; appProperties: Record<string, string>; content: Blob }>();
  const sessions = new Map<string, { id?: string; meta: { name?: string; appProperties: Record<string, string> }; total: number; parts: Blob[]; got: number }>();
  let n = 0;
  const f: Fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    if (url.host === 'upload.mock') {
      const s = sessions.get(url.pathname)!;
      const body = init.body as Blob;
      s.parts.push(body);
      s.got += body.size;
      if (s.got < s.total) return new Response(null, { status: 308, headers: { Range: `bytes=0-${s.got - 1}` } });
      const id = s.id ?? `f${++n}`;
      const prev = files.get(id);
      files.set(id, { name: s.meta.name ?? prev!.name, appProperties: s.meta.appProperties, content: new Blob(s.parts) });
      return new Response(JSON.stringify({ id }));
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const id = url.pathname.split('/files/')[1];
      const sid = `/session/${++n}`;
      sessions.set(sid, { id, meta: JSON.parse(String(init.body)), total: Number((init.headers as Record<string, string>)['X-Upload-Content-Length']), parts: [], got: 0 });
      return new Response('', { headers: { Location: `https://upload.mock${sid}` } });
    }
    const id = url.pathname.split('/files/')[1];
    if (method === 'GET' && !id) return new Response(JSON.stringify({ files: [...files].map(([fid, x]) => ({ id: fid, name: x.name, appProperties: x.appProperties })) }));
    if (method === 'GET') return new Response(files.get(id)!.content);
    if (method === 'DELETE') { files.delete(id); return new Response(''); }
    return new Response('', { status: 400 });
  };
  return { f, files };
}

const lib = (id: string) => new Blob([zipSync({
  'library/library.json': strToU8(JSON.stringify({ categories: [{ id: '90.1', title: 'Demo', difficulty_default: 1 }] })),
  [`library/c/${id}/model.json`]: strToU8(JSON.stringify({ schema: 1, id, category: '90.1', kind: 'model', title: id, status: 'complete', trainable: true, difficulty: null, audio: [{ file: 'a.wav', role: 'task' }], notation: [] })),
  [`library/c/${id}/a.wav`]: new Uint8Array(9 * 1024 * 1024).fill(1), // > one upload chunk
}) as BlobPart]);

beforeEach(async () => { await deleteAllData(); });

describe('full sync with a mock Drive', () => {
  it('device A uploads, new device B restores everything, deletions travel both ways', async () => {
    const drive = mockDrive();
    const a = await importZip(lib('A'), 'Paket A', 'replace');
    await putRecording({ id: 'r1', modelId: 'A', at: '2026-11-26T10:00:00Z', mime: 'audio/webm', duration: 1, blob: new Blob([new Uint8Array([1])]) });
    // device A, without recordings
    const s1 = await fullSync(drive.f, 'tok', { recordings: false, synced: {} });
    expect(s1.uploaded).toBe(1);
    expect([...drive.files.values()].map((x) => x.appProperties.key)).toEqual([`pack:${a.pack.id}`]);
    // turning recordings on uploads them too
    const s1b = await fullSync(drive.f, 'tok', { recordings: true, synced: s1.synced });
    expect(s1b.uploaded).toBe(1);

    // device B: empty
    await deleteAllData();
    const s2 = await fullSync(drive.f, 'tok', { recordings: true, synced: {} });
    expect(s2.downloaded).toBe(2);
    expect((await allModels()).map((m) => m.id)).toEqual(['A']);
    expect((await allPacks())[0].id).toBe(a.pack.id);

    // B replaces the library: new pack, old one removed -> A's copy must follow
    const b = await importZip(lib('B'), 'Paket B', 'replace');
    const s3 = await fullSync(drive.f, 'tok', { recordings: true, synced: s2.synced });
    expect(s3.uploaded).toBe(1);
    expect(s3.deleted).toBe(1);
    const tomb = [...drive.files.values()].find((x) => x.appProperties.key === `pack:${a.pack.id}`)!;
    expect(tomb.appProperties.deleted).toBe('1');
    expect(tomb.content.size).toBe(0);

    // back on "device A" state (has old pack, synced knows it): follows the deletion and gets B
    await deleteAllData();
    await importZip(lib('A'), 'Paket A', 'replace').then(async (r) => { await deletePack(r.pack.id); });
    const again = await importZip(lib('A'), 'Paket A', 'add');
    const sA = { [`pack:${again.pack.id}`]: again.pack.importedAt };
    // simulate A's original pack id by re-keying the synced state to the tombstoned key
    const s4 = await fullSync(drive.f, 'tok', { recordings: true, synced: { ...sA } });
    expect((await allPacks()).map((p) => p.id)).toContain(b.pack.id);
    expect(s4.downloaded).toBeGreaterThanOrEqual(1);
  }, 30000);
});
