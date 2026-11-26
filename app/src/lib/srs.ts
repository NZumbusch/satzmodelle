// Spaced repetition (in the spirit of SM-2, as used by Anki). The schedule is derived entirely from the
// existing practice history (ratings + hints), so nothing new has to be stored, synced or backed up.
import type { Attempt, Progress } from './types';

const DAY = 24 * 60 * 60 * 1000;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** new pieces mixed into a repetition session */
export const NEW_PER_SESSION = 5;

export interface Schedule {
  reps: number; // successful reviews in a row
  ease: number;
  intervalDays: number;
  due: Date | null; // null = never practised (new)
  lastAt: Date | null;
}

/** SM-2 quality 0..5 from our rating and the number of hints used. */
export function quality(a: Attempt): number {
  if (a.rating === 'no') return 1;
  if (a.rating === 'partly') return 3;
  const h = a.hintsUsed || 0;
  return h === 0 ? 5 : h <= 2 ? 4 : 3;
}

export function schedule(attempts: Attempt[]): Schedule {
  const list = [...attempts].sort((x, y) => x.at.localeCompare(y.at));
  let reps = 0, ease = START_EASE, interval = 0;
  let last: Date | null = null;
  for (const a of list) {
    const at = new Date(a.at);
    const elapsed = last ? (at.getTime() - last.getTime()) / DAY : Infinity;
    const q = quality(a);
    if (a.rating === 'no') {
      // forgotten: start again tomorrow
      reps = 0;
      interval = 1;
    } else if (a.rating === 'partly') {
      // "hard": stays close to the current interval
      interval = Math.max(1, interval * 1.2);
    } else if (reps > 0 && elapsed < interval * 0.5) {
      // practised again long before it was due (e.g. twice in one session): no extra growth
    } else {
      reps += 1;
      interval = reps === 1 ? 1 : reps === 2 ? 3 : interval * ease * (q === 5 ? 1.15 : q === 3 ? 0.85 : 1);
    }
    ease = Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    last = at;
  }
  if (!last) return { reps: 0, ease: START_EASE, intervalDays: 0, due: null, lastAt: null };
  interval = Math.min(interval, 365);
  return { reps, ease, intervalDays: interval, due: new Date(last.getTime() + interval * DAY), lastAt: last };
}

/** Due when the due date is today or earlier (whole days, so a morning session catches today's reviews). */
export function isDue(s: Schedule, now = new Date()): boolean {
  if (!s.due) return false;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return s.due < endOfToday;
}

function overdueRatio(s: Schedule, now: Date) {
  return (now.getTime() - s.due!.getTime()) / DAY / Math.max(1, s.intervalDays);
}

export interface Item { id: string; difficulty: number; order: number }

export interface SrsPlan {
  due: string[]; // most overdue first
  fresh: string[]; // never practised, easiest first
  practised: string[]; // practised, not due, longest ago first
}

export function plan(items: Item[], progress: Map<string, Progress>, now = new Date()): SrsPlan {
  const withS = items.map((it) => ({ it, s: schedule(progress.get(it.id)?.attempts ?? []) }));
  const due = withS.filter((x) => isDue(x.s, now)).sort((a, b) => overdueRatio(b.s, now) - overdueRatio(a.s, now));
  const fresh = withS.filter((x) => !x.s.due).sort((a, b) => a.it.difficulty - b.it.difficulty || a.it.order - b.it.order);
  const practised = withS.filter((x) => x.s.due && !isDue(x.s, now))
    .sort((a, b) => a.s.lastAt!.getTime() - b.s.lastAt!.getTime());
  return { due: due.map((x) => x.it.id), fresh: fresh.map((x) => x.it.id), practised: practised.map((x) => x.it.id) };
}

/** Spread `b` evenly through `a` (new pieces between the reviews, not as a block at the end). */
export function interleave(a: string[], b: string[]): string[] {
  if (!a.length) return [...b];
  const out: string[] = [];
  const step = (a.length + 1) / (b.length + 1);
  let bi = 0;
  for (let i = 0; i < a.length; i++) {
    while (bi < b.length && (bi + 1) * step <= i + 1) out.push(b[bi++]);
    out.push(a[i]);
  }
  return out.concat(b.slice(bi));
}

/** Today's session: everything due, with up to NEW_PER_SESSION new pieces mixed in. */
export function todaysSession(p: SrsPlan): string[] {
  return interleave(p.due, p.fresh.slice(0, NEW_PER_SESSION));
}

/**
 * "Weiter üben" after today's session: first the remaining new pieces; once everything has been
 * practised, start over with the pieces practised longest ago.
 */
export function continueSession(p: SrsPlan): { kind: 'due' | 'new' | 'oldest'; ids: string[] } {
  if (p.due.length) return { kind: 'due', ids: todaysSession(p) };
  if (p.fresh.length) return { kind: 'new', ids: p.fresh };
  return { kind: 'oldest', ids: p.practised };
}
