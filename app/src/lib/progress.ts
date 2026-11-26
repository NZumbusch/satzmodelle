// Progress records and the merge rule used for syncing (union of attempts; newest info wins).
import type { Category, PieceInfo, Progress, StoredModel } from './types';

export function pieceInfo(m: StoredModel, cat?: Category): PieceInfo {
  return { title: m.title, composer: m.composer, category: m.category, categoryTitle: cat?.title };
}

export interface ProgressFile {
  schema: 1;
  updatedAt: string;
  /** attempts at or before this moment were deleted ("reset progress") on some device */
  resetAt?: string;
  entries: Record<string, { info?: PieceInfo; attempts: Progress['attempts'] }>;
}

export function toFile(list: Progress[], resetAt?: string): ProgressFile {
  const entries: ProgressFile['entries'] = {};
  for (const p of list) entries[p.id] = { info: p.info, attempts: p.attempts };
  return { schema: 1, updatedAt: new Date().toISOString(), resetAt, entries };
}

/** Merge two progress files. Commutative and idempotent, so syncing in any order converges. */
export function mergeFiles(a: ProgressFile, b: ProgressFile): ProgressFile {
  const resetAt = [a.resetAt, b.resetAt].filter(Boolean).sort().pop();
  const entries: ProgressFile['entries'] = {};
  for (const id of new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])) {
    const ea = a.entries[id], eb = b.entries[id];
    const byKey = new Map<string, Progress['attempts'][number]>();
    for (const at of [...(ea?.attempts ?? []), ...(eb?.attempts ?? [])]) {
      if (resetAt && at.at <= resetAt) continue;
      byKey.set(`${at.at}|${at.rating}`, at);
    }
    const attempts = [...byKey.values()].sort((x, y) => x.at.localeCompare(y.at));
    // info: prefer the side whose latest attempt is newer, else whichever exists
    const lastA = ea?.attempts.at(-1)?.at ?? '', lastB = eb?.attempts.at(-1)?.at ?? '';
    const info = (lastB > lastA ? eb?.info ?? ea?.info : ea?.info ?? eb?.info);
    if (attempts.length || info) entries[id] = { info, attempts };
  }
  return { schema: 1, updatedAt: [a.updatedAt, b.updatedAt].sort().pop()!, resetAt, entries };
}

export function fromFile(f: ProgressFile): Progress[] {
  return Object.entries(f.entries).map(([id, e]) => ({ id, info: e.info, attempts: e.attempts }));
}

export function summary(p?: Progress) {
  const a = p?.attempts ?? [];
  return { count: a.length, last: a.at(-1)?.rating, best: a.some((x) => x.rating === 'yes') ? 'yes' : a.some((x) => x.rating === 'partly') ? 'partly' : a.length ? 'no' : undefined };
}
