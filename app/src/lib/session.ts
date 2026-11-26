// Builds the spaced-repetition plan for the current filter (the filter decides the pool,
// the schedule decides what comes up today).
import { compareModels, effectiveDifficulty, matchesFilter, type Filter } from './library';
import { plan, type SrsPlan } from './srs';
import type { Category, Progress, StoredModel } from './types';

export function srsPlan(
  models: StoredModel[], cats: Map<string, Category>, progress: Map<string, Progress>, filter: Filter, now = new Date(),
): SrsPlan {
  // "nur neue / noch nicht sicher" does not apply: the schedule takes over that job
  const f: Filter = { ...filter, practice: 'all' };
  const pool = models.filter((m) => matchesFilter(m, f, cats, progress.get(m.id))).sort(compareModels);
  return plan(pool.map((m, i) => ({ id: m.id, difficulty: effectiveDifficulty(m, cats), order: i })), progress, now);
}
