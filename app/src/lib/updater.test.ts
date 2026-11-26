import { describe, expect, it } from 'vitest';
import { apkUrl, changesSince, isNewer, parseUpdateManifest } from './updater';

const good = {
  versionCode: 112, versionName: '1.0.12', apk: 'app.apk', sha256: 'A'.repeat(64), size: 5, publishedAt: '2026-11-27T10:00:00Z',
  changes: [{ versionCode: 112, subject: 'Marker' }, { versionCode: 111, subject: 'Layout' }, { versionCode: 105, subject: 'Alt' }],
};

describe('update manifest', () => {
  it('accepts a valid manifest and normalises the hash', () => {
    const m = parseUpdateManifest(good)!;
    expect(m.sha256).toBe('a'.repeat(64));
    expect(m.changes).toHaveLength(3);
  });
  it('rejects broken manifests without throwing', () => {
    for (const bad of [null, 'x', {}, { ...good, versionCode: 0 }, { ...good, versionCode: 1.5 }, { ...good, sha256: 'abc' }, { ...good, apk: '' }])
      expect(parseUpdateManifest(bad)).toBeNull();
  });
  it('compares versions and lists what is new', () => {
    const m = parseUpdateManifest(good)!;
    expect(isNewer(m, 111)).toBe(true);
    expect(isNewer(m, 112)).toBe(false);
    expect(changesSince(m, 110)).toEqual(['Marker', 'Layout']);
  });
  it('resolves the APK next to version.json, https only', () => {
    const m = parseUpdateManifest(good)!;
    expect(apkUrl('https://x.github.io/r/android/version.json?t=1', m)).toBe('https://x.github.io/r/android/app.apk');
    expect(apkUrl('http://x/android/version.json', m)).toBeNull();
  });
});
