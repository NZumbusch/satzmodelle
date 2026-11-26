// Progress sync with the hidden Google Drive app folder (scope drive.appdata: the app cannot see any
// other file in the user's Drive, and the user does not see this file in the Drive UI).
// Only progress and piece details are synced - never library content.
import { mergeFiles, toFile, fromFile, type ProgressFile } from './progress';
import type { Progress } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FILE_NAME = 'progress.json';

export type Fetch = typeof fetch;

export class DriveError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function call(f: Fetch, token: string, url: string, init: RequestInit = {}) {
  const r = await f(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new DriveError(r.status, `${r.status} ${await r.text().catch(() => '')}`.slice(0, 200));
  return r;
}

export async function findFile(f: Fetch, token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await call(f, token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const j = (await r.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

export async function download(f: Fetch, token: string, id: string): Promise<ProgressFile | null> {
  const r = await call(f, token, `${API}/files/${id}?alt=media`);
  try {
    const j = await r.json();
    return j && j.schema === 1 && typeof j.entries === 'object' ? (j as ProgressFile) : null;
  } catch {
    return null;
  }
}

export async function upload(f: Fetch, token: string, id: string | null, data: ProgressFile): Promise<string> {
  const body = JSON.stringify(data);
  if (id) {
    await call(f, token, `${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return id;
  }
  const boundary = 'sm' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await call(f, token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
  return ((await r.json()) as { id: string }).id;
}

/** One sync round: download, merge with local, upload if anything changed. Returns the merged progress. */
export async function syncProgress(f: Fetch, token: string, local: Progress[], resetAt?: string): Promise<{ merged: Progress[]; uploaded: boolean; resetAt?: string }> {
  const id = await findFile(f, token);
  const remote = id ? await download(f, token, id) : null;
  const mine = toFile(local, resetAt);
  const merged = remote ? mergeFiles(mine, remote) : mine;
  const same = remote && JSON.stringify(remote.entries) === JSON.stringify(merged.entries) && remote.resetAt === merged.resetAt;
  if (!same) await upload(f, token, id, merged);
  return { merged: fromFile(merged), uploaded: !same, resetAt: merged.resetAt };
}

/* ---------------------------------------------------------------- generic app-folder files */

export interface DriveFile { id: string; name: string; size?: string; appProperties?: Record<string, string>; modifiedTime?: string }

export async function listFiles(f: Fetch, token: string, query = 'trashed=false'): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const url = `${API}/files?spaces=appDataFolder&pageSize=1000&q=${encodeURIComponent(query)}` +
      `&fields=nextPageToken,files(id,name,size,appProperties,modifiedTime)${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = (await (await call(f, token, url)).json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(j.files ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function downloadBlob(f: Fetch, token: string, id: string): Promise<Blob> {
  return (await call(f, token, `${API}/files/${id}?alt=media`)).blob();
}

export async function deleteFile(f: Fetch, token: string, id: string) {
  await call(f, token, `${API}/files/${id}`, { method: 'DELETE' });
}

const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB, as Drive requires

/** Resumable upload in chunks (works for hundreds of MB, reports progress). Creates or replaces. */
export async function uploadBlob(
  f: Fetch, token: string,
  o: { id?: string; name: string; appProperties: Record<string, string>; blob: Blob; mime?: string; onProgress?: (sent: number, total: number) => void },
): Promise<string> {
  const mime = o.mime ?? 'application/zip';
  const meta = o.id ? { appProperties: o.appProperties } : { name: o.name, parents: ['appDataFolder'], mimeType: mime, appProperties: o.appProperties };
  const start = await call(f, token, o.id ? `${UPLOAD}/files/${o.id}?uploadType=resumable&fields=id` : `${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: o.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(o.blob.size) },
    body: JSON.stringify(meta),
  });
  const session = start.headers.get('Location');
  if (!session) throw new DriveError(0, 'no upload session');
  const total = o.blob.size;
  if (total === 0) {
    const r = await f(session, { method: 'PUT', headers: { 'Content-Range': 'bytes */0' }, body: new Blob([]) });
    if (!r.ok) throw new DriveError(r.status, 'upload failed');
    return ((await r.json()) as { id: string }).id;
  }
  let sent = 0;
  for (;;) {
    const end = Math.min(total, sent + CHUNK);
    const r = await f(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${total}` }, body: o.blob.slice(sent, end) });
    if (r.status === 308) {
      const range = r.headers.get('Range'); // "bytes=0-1234"
      sent = range ? Number(range.split('-')[1]) + 1 : end;
      o.onProgress?.(sent, total);
      continue;
    }
    if (!r.ok) throw new DriveError(r.status, `upload failed ${r.status}`);
    o.onProgress?.(total, total);
    return ((await r.json()) as { id: string }).id;
  }
}
