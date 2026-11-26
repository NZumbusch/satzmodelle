import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { BlobZip } from './zipwriter';
import { unzipStream, zipEntryNames } from './importer';

describe('BlobZip', () => {
  it('writes a zip readable by fflate (sync and streaming), with UTF-8 names', async () => {
    const z = new BlobZip();
    await z.add('a.json', '{"x":1}');
    await z.add('Gerüst/ß.bin', new Blob([new Uint8Array(70000).fill(7)]));
    await z.add('empty', new Uint8Array(0));
    const blob = await z.finish();
    const all = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(all['a.json'])).toBe('{"x":1}');
    expect(all['Gerüst/ß.bin'].length).toBe(70000);
    expect(await zipEntryNames(blob)).toEqual(['a.json', 'Gerüst/ß.bin', 'empty']);
    const streamed: [string, number][] = [];
    for await (const e of unzipStream(blob)) streamed.push([e.path, e.data.size]);
    expect(streamed).toEqual([['a.json', 7], ['Gerüst/ß.bin', 70000], ['empty', 0]]);
  });
});
