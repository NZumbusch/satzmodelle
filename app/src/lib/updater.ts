// Pure helpers for the self-update manifest (version.json published by CI). Never throw.

export interface UpdateChange { versionCode: number; subject: string }
export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  apk: string; // relative to version.json
  sha256: string;
  size: number;
  publishedAt: string;
  changes: UpdateChange[];
}

export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const code = m.versionCode;
  if (typeof code !== 'number' || !Number.isInteger(code) || code <= 0) return null;
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256)) return null;
  if (typeof m.apk !== 'string' || !m.apk.trim()) return null;
  const changes = Array.isArray(m.changes)
    ? m.changes
        .filter((c): c is UpdateChange => !!c && typeof c === 'object' && typeof (c as UpdateChange).subject === 'string')
        .map((c) => ({ versionCode: Number(c.versionCode) || 0, subject: c.subject }))
    : [];
  return {
    versionCode: code,
    versionName: typeof m.versionName === 'string' ? m.versionName : String(code),
    apk: m.apk,
    sha256: m.sha256.toLowerCase(),
    size: typeof m.size === 'number' ? m.size : 0,
    publishedAt: typeof m.publishedAt === 'string' ? m.publishedAt : '',
    changes,
  };
}

export function isNewer(m: UpdateManifest, installedCode: number): boolean {
  return m.versionCode > installedCode;
}

/** Changes that are not in the installed build yet, newest first, without duplicates. */
export function changesSince(m: UpdateManifest, installedCode: number): string[] {
  const seen = new Set<string>();
  return m.changes
    .filter((c) => c.versionCode > installedCode)
    .map((c) => c.subject)
    .filter((s) => !seen.has(s) && seen.add(s));
}

/** Absolute APK URL from the manifest URL. Only https is accepted. */
export function apkUrl(manifestUrl: string, m: UpdateManifest): string | null {
  try {
    const u = new URL(m.apk, manifestUrl);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
