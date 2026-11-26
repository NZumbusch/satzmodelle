import { describe, expect, it } from 'vitest';
import { mergeFiles, toFile } from './progress';
import { syncProgress, type Fetch } from './drive';
import type { Progress } from './types';

const a = (at: string, rating: 'yes' | 'no' = 'yes') => ({ at, rating, hintsUsed: 0 });

describe('mergeFiles', () => {
  it('unions attempts, is commutative and idempotent, keeps info', () => {
    const x = toFile([{ id: 'S1', attempts: [a('2026-01-01')], info: { title: 'T', category: '01.1' } }]);
    const y = toFile([{ id: 'S1', attempts: [a('2026-01-02', 'no')] }, { id: 'S2', attempts: [a('2026-01-03')] }]);
    const m1 = mergeFiles(x, y), m2 = mergeFiles(y, x);
    expect(m1.entries).toEqual(m2.entries);
    expect(m1.entries.S1.attempts.map((q) => q.at)).toEqual(['2026-01-01', '2026-01-02']);
    expect(m1.entries.S1.info?.title).toBe('T');
    expect(mergeFiles(m1, m1).entries).toEqual(m1.entries);
  });
  it('drops attempts older than a reset', () => {
    const x = toFile([{ id: 'S1', attempts: [a('2026-01-01'), a('2026-03-01')] }]);
    const y = toFile([], '2026-02-01T00:00:00Z');
    expect(mergeFiles(x, y).entries.S1.attempts.map((q) => q.at)).toEqual(['2026-03-01']);
  });
});

describe('syncProgress (mock Drive)', () => {
  function mockDrive() {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const f: Fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url.split('?')[0]}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      if (method === 'GET' && url.includes('/files?')) return new Response(JSON.stringify({ files: [...files.keys()].map((id) => ({ id })) }));
      if (method === 'GET') return new Response(files.get(url.split('/files/')[1].split('?')[0]) ?? '');
      if (method === 'POST') {
        const body = String(init?.body);
        const json = body.split('\r\n\r\n')[2].split('\r\n--')[0];
        files.set('f1', json);
        return new Response(JSON.stringify({ id: 'f1' }));
      }
      if (method === 'PATCH') { files.set(url.split('/files/')[1].split('?')[0], String(init?.body)); return new Response('{}'); }
      return new Response('', { status: 400 });
    };
    return { f, files, calls };
  }

  it('creates the file, then merges a second device without losing anything', async () => {
    const d = mockDrive();
    const dev1: Progress[] = [{ id: 'S1', attempts: [a('2026-01-01')] }];
    const r1 = await syncProgress(d.f, 'tok', dev1);
    expect(r1.uploaded).toBe(true);
    expect(d.calls.some((c) => c.startsWith('POST'))).toBe(true);
    const dev2: Progress[] = [{ id: 'S2', attempts: [a('2026-01-05')] }];
    const r2 = await syncProgress(d.f, 'tok', dev2);
    expect(r2.merged.map((p) => p.id).sort()).toEqual(['S1', 'S2']);
    expect(d.calls.some((c) => c.startsWith('PATCH'))).toBe(true);
    // nothing new: no upload
    const before = d.calls.length;
    const r3 = await syncProgress(d.f, 'tok', r2.merged);
    expect(r3.uploaded).toBe(false);
    expect(d.calls.slice(before).every((c) => c.startsWith('GET'))).toBe(true);
  });
});
