import { describe, expect, it } from 'vitest';
import { attemptValue, computeStats, confidence, level, weakest } from './stats';
import { parseManifest } from './library';
import type { Attempt, Category, Progress } from './types';

const model = (id: string, category: string) => parseManifest({
  schema: 1, id, category, kind: 'model', title: `T ${id}`, status: 'complete', trainable: true, difficulty: null,
  audio: [{ file: 'a.mp3', role: 'task' }], notation: [],
}, '');
const att = (at: string, rating: Attempt['rating'], hintsUsed = 0): Attempt => ({ at, rating, hintsUsed });

describe('confidence', () => {
  it('weights recent attempts and charges for hints', () => {
    expect(attemptValue(att('x', 'yes'))).toBe(1);
    expect(attemptValue(att('x', 'yes', 5))).toBeCloseTo(0.7);
    expect(attemptValue(att('x', 'no', 3))).toBe(0);
    expect(confidence([])).toBeNull();
    // newest "no" after old "yes" -> low
    const c = confidence([att('2026-01-01', 'yes'), att('2026-01-02', 'yes'), att('2026-01-03', 'no')])!;
    expect(c).toBeLessThan(0.5);
    expect(level(c)).toBe('shaky');
    expect(level(confidence([att('2026-01-01', 'yes')]))).toBe('secure');
    expect(level(confidence([att('2026-01-01', 'no')]))).toBe('insecure');
  });
});

describe('computeStats', () => {
  const models = [model('A', '01.1'), model('B', '01.1'), model('C', '02.1'), model('D', '02.1')];
  const cats = new Map<string, Category>([['01.1', { id: '01.1', title: 'Eins', difficulty_default: 1 }], ['02.1', { id: '02.1', title: 'Zwei', difficulty_default: 3 }]]);
  const now = new Date(2026, 10, 26, 12);  // Thu 26 Nov 2026
  const progress = new Map<string, Progress>([
    ['A', { id: 'A', attempts: [att(new Date(2026, 10, 24, 10).toISOString(), 'yes'), att(new Date(2026, 10, 25, 10).toISOString(), 'yes', 1)] }],
    ['C', { id: 'C', attempts: [att(new Date(2026, 10, 26, 9).toISOString(), 'no', 4)] }],
    ['X', { id: 'X', attempts: [att(new Date(2026, 10, 26, 9).toISOString(), 'yes')] }], // not in the library: ignored here
  ]);
  const s = computeStats(models, cats, progress, now);

  it('counts pieces, attempts, ratings and levels', () => {
    expect([s.pieces, s.practised, s.attempts]).toEqual([4, 2, 3]);
    expect(s.ratings).toEqual({ yes: 2, partly: 0, no: 1 });
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.levels).toEqual({ secure: 1, shaky: 0, insecure: 1, new: 2 });
    expect(s.withoutHints).toBeCloseTo(1 / 3);
    expect(s.hintHistogram).toEqual([1, 1, 0, 0, 1]);
  });
  it('per category: better and worse', () => {
    const [one, two] = s.categories;
    expect(one).toMatchObject({ id: '01.1', title: 'Eins', pieces: 2, practised: 1, successRate: 1 });
    expect(two).toMatchObject({ id: '02.1', practised: 1, successRate: 0 });
    expect(one.confidence!).toBeGreaterThan(two.confidence!);
  });
  it('weeks, active days and streak', () => {
    expect(s.weeks).toHaveLength(12);
    expect(s.weeks.at(-1)).toMatchObject({ start: '2026-11-23', yes: 2, no: 1 });
    expect(s.activeDays).toBe(3);
    expect(s.streakDays).toBe(3);
  });
  it('weakest pieces first', () => {
    expect(weakest(s).map((p) => p.id)).toEqual(['C']);
  });
});
