// Minimal zip writer (entries stored, sizes and CRC in the local headers, no data descriptors), so that
// streaming readers can unpack it entry by entry. Media is already compressed; the parts are referenced,
// not copied, so even a large library costs little memory. Limits: < 4 GiB per file and in total.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Update(crc: number, data: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function crcOf(b: Blob): Promise<number> {
  let crc = 0;
  const reader = b.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return crc;
    crc = crc32Update(crc, value);
  }
}

function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class BlobZip {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;
  private stamp = dosTime(new Date());

  async add(name: string, data: Blob | Uint8Array | string, _compress = false) {
    void _compress;
    const blob = typeof data === 'string' ? new Blob([new TextEncoder().encode(data)])
      : data instanceof Uint8Array ? new Blob([data as BlobPart]) : data;
    const crc = await crcOf(blob);
    const size = blob.size;
    if (size >= 0xffffffff || this.offset + size >= 0xffffffff) throw new Error('zip too large');
    const fname = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + fname.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, this.stamp.time, true);
    lv.setUint16(12, this.stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, fname.length, true);
    local.set(fname, 30);
    const cen = new Uint8Array(46 + fname.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, this.stamp.time, true);
    cv.setUint16(14, this.stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, fname.length, true);
    cv.setUint32(42, this.offset, true);
    cen.set(fname, 46);
    this.parts.push(local, blob);
    this.central.push(cen);
    this.offset += local.length + size;
    this.count++;
  }

  async finish(): Promise<Blob> {
    const cdSize = this.central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.count, true);
    ev.setUint16(10, this.count, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...(this.central as BlobPart[]), end], { type: 'application/zip' });
  }
}
