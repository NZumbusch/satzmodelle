import { getFile } from './db';

const urls = new Map<string, Promise<string | null>>();

/** Object URL for a stored file (cached for the session). null if the file is missing. */
export function fileUrl(path: string): Promise<string | null> {
  let p = urls.get(path);
  if (!p) {
    p = getFile(path).then((b) => (b ? URL.createObjectURL(b) : null));
    urls.set(path, p);
  }
  return p;
}

export function forgetUrls() {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  urls.clear();
}
