// Practice statistics, computed from the progress records. Pure functions, unit-tested.
import { effectiveDifficulty, isPracticable } from './library';
import type { Attempt, Category, Progress, StoredModel } from './types';

export type Level = 'secure' | 'shaky' | 'insecure' | 'new';

const RATING_VALUE = { yes: 1, partly: 0.5, no: 0 } as const;
/** a hint costs a little: a "got it" after the full solution is not the same as without help */
const HINT_COST = 0.06;
/** the last attempts count most */
const RECENCY = [1, 0.6, 0.36, 0.22, 0.13];

export function attemptValue(a: Attempt): number {
  return Math.max(0, Math.min(1, RATING_VALUE[a.rating] - HINT_COST * (a.hintsUsed || 0)));
}

/** 0..1, or null without attempts: weighted mean of the last five attempts, newest first. */
export function confidence(attempts: Attempt[]): number | null {
  if (!attempts.length) return null;
  const recent = [...attempts].sort((x, y) => y.at.localeCompare(x.at)).slice(0, RECENCY.length);
  let sum = 0, w = 0;
  recent.forEach((a, i) => { sum += attemptValue(a) * RECENCY[i]; w += RECENCY[i]; });
  return sum / w;
}

export function level(c: number | null): Level {
  if (c === null) return 'new';
  if (c >= 0.75) return 'secure';
  if (c >= 0.4) return 'shaky';
  return 'insecure';
}

export interface PieceStat {
  id: string;
  title: string;
  composer?: string;
  category: string;
  difficulty: number;
  attempts: number;
  confidence: number | null;
  level: Level;
  avgHints: number | null;
  lastAt?: string;
}

export interface CategoryStat {
  id: string;
  title: string;
  pieces: number;
  practised: number;
  attempts: number;
  /** share of "got it" among all attempts */
  successRate: number | null;
  /** mean confidence of the practised pieces */
  confidence: number | null;
  avgHints: number | null;
  levels: Record<Level, number>;
}

export interface Stats {
  pieces: number;
  practised: number;
  attempts: number;
  ratings: { yes: number; partly: number; no: number };
  successRate: number | null;
  withoutHints: number | null; // share of attempts with no hint
  avgHints: number | null;
  levels: Record<Level, number>;
  /** attempts per number of hints used: index = hints */
  hintHistogram: number[];
  /** last `weeks` weeks, oldest first */
  weeks: { start: string; yes: number; partly: number; no: number }[];
  streakDays: number;
  activeDays: number;
  categories: CategoryStat[];
  perPiece: PieceStat[];
}

const emptyLevels = (): Record<Level, number> => ({ secure: 0, shaky: 0, insecure: 0, new: 0 });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function computeStats(
  models: StoredModel[], cats: Map<string, Category>, progress: Map<string, Progress>, now = new Date(), weeks = 12,
): Stats {
  const practicable = models.filter(isPracticable);
  const perPiece: PieceStat[] = practicable.map((m) => {
    const attempts = progress.get(m.id)?.attempts ?? [];
    const c = confidence(attempts);
    return {
      id: m.id, title: m.title, composer: m.composer, category: m.category,
      difficulty: effectiveDifficulty(m, cats),
      attempts: attempts.length, confidence: c, level: level(c),
      avgHints: mean(attempts.map((a) => a.hintsUsed || 0)),
      lastAt: attempts.map((a) => a.at).sort().at(-1),
    };
  });
  const all = practicable.flatMap((m) => progress.get(m.id)?.attempts ?? []);
  const ratings = { yes: 0, partly: 0, no: 0 };
  for (const a of all) ratings[a.rating]++;
  const levels = emptyLevels();
  for (const p of perPiece) levels[p.level]++;
  const maxHints = Math.max(0, ...all.map((a) => a.hintsUsed || 0));
  const hintHistogram = Array.from({ length: maxHints + 1 }, (_, h) => all.filter((a) => (a.hintsUsed || 0) === h).length);

  // weeks
  const thisMonday = mondayOf(now);
  const weekList = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - 7 * (weeks - 1 - i));
    return { start: dayKey(d), yes: 0, partly: 0, no: 0 };
  });
  for (const a of all) {
    const k = dayKey(mondayOf(new Date(a.at)));
    const w = weekList.find((x) => x.start === k);
    if (w) w[a.rating]++;
  }

  // days
  const days = new Set(all.map((a) => dayKey(new Date(a.at))));
  let streak = 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not practised yet: streak can still continue
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }

  // categories
  const byCat = new Map<string, PieceStat[]>();
  for (const p of perPiece) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
  const categories: CategoryStat[] = [...byCat.entries()].map(([id, ps]) => {
    const att = ps.flatMap((p) => progress.get(p.id)?.attempts ?? []);
    const lv = emptyLevels();
    for (const p of ps) lv[p.level]++;
    return {
      id, title: cats.get(id)?.title ?? id, pieces: ps.length,
      practised: ps.filter((p) => p.attempts > 0).length, attempts: att.length,
      successRate: att.length ? att.filter((a) => a.rating === 'yes').length / att.length : null,
      confidence: mean(ps.filter((p) => p.confidence !== null).map((p) => p.confidence!)),
      avgHints: mean(att.map((a) => a.hintsUsed || 0)),
      levels: lv,
    };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  return {
    pieces: practicable.length,
    practised: perPiece.filter((p) => p.attempts > 0).length,
    attempts: all.length,
    ratings,
    successRate: all.length ? ratings.yes / all.length : null,
    withoutHints: all.length ? all.filter((a) => !a.hintsUsed).length / all.length : null,
    avgHints: mean(all.map((a) => a.hintsUsed || 0)),
    levels,
    hintHistogram,
    weeks: weekList,
    streakDays: streak,
    activeDays: days.size,
    categories,
    perPiece,
  };
}

/** Pieces that most need practice: practised, lowest confidence first. */
export function weakest(s: Stats, n = 10): PieceStat[] {
  return s.perPiece.filter((p) => p.confidence !== null && p.level !== 'secure')
    .sort((a, b) => a.confidence! - b.confidence! || b.attempts - a.attempts).slice(0, n);
}
