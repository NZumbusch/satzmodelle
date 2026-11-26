import { describe, expect, it } from 'vitest';
import { continueSession, interleave, isDue, plan, quality, schedule, todaysSession } from './srs';
import type { Attempt, Progress } from './types';

const D = (d: number) => new Date(2026, 0, 1 + d, 10).toISOString();
const att = (d: number, rating: Attempt['rating'], hintsUsed = 0): Attempt => ({ at: D(d), rating, hintsUsed });

describe('schedule', () => {
  it('maps ratings and hints to quality', () => {
    expect([quality(att(0, 'yes')), quality(att(0, 'yes', 2)), quality(att(0, 'yes', 4)), quality(att(0, 'partly')), quality(att(0, 'no'))])
      .toEqual([5, 4, 3, 3, 1]);
  });
  it('grows the interval with each success: 1, 3, then ×ease', () => {
    expect(schedule([att(0, 'yes')]).intervalDays).toBe(1);
    expect(schedule([att(0, 'yes'), att(1, 'yes')]).intervalDays).toBe(3);
    const s = schedule([att(0, 'yes'), att(1, 'yes'), att(4, 'yes')]);
    expect(s.intervalDays).toBeGreaterThan(8);
    expect(s.due!.getTime()).toBeGreaterThan(new Date(D(12)).getTime());
  });
  it('a miss resets to tomorrow and lowers the ease', () => {
    const s = schedule([att(0, 'yes'), att(1, 'yes'), att(4, 'no')]);
    expect(s.reps).toBe(0);
    expect(s.intervalDays).toBe(1);
    expect(s.ease).toBeLessThan(2.5);
  });
  it('practising again the same day does not inflate the interval', () => {
    const a = schedule([att(0, 'yes'), att(1, 'yes'), att(4, 'yes')]).intervalDays;
    const b = schedule([att(0, 'yes'), att(1, 'yes'), att(4, 'yes'), att(4.1, 'yes')]).intervalDays;
    expect(b).toBeCloseTo(a);
  });
  it('due today counts the whole day; new pieces are never due', () => {
    const s = schedule([att(0, 'yes')]); // due day 1 at 10:00
    expect(isDue(s, new Date(2026, 0, 2, 7))).toBe(true);
    expect(isDue(s, new Date(2026, 0, 1, 20))).toBe(false);
    expect(isDue(schedule([]), new Date())).toBe(false);
  });
});

describe('sessions', () => {
  const items = ['A', 'B', 'C', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6'].map((id, i) => ({ id, difficulty: id === 'N1' ? 3 : 1, order: i }));
  const now = new Date(2026, 0, 20, 9);
  const progress = new Map<string, Progress>([
    ['A', { id: 'A', attempts: [att(0, 'yes')] }],                     // long overdue
    ['B', { id: 'B', attempts: [att(17, 'no')] }],                     // due tomorrow after day 17 -> overdue
    ['C', { id: 'C', attempts: [att(18, 'yes'), att(19, 'yes')] }],    // due in 3 days
  ]);
  const p = plan(items, progress, now);

  it('splits the pool into due, new (easiest first) and practised', () => {
    expect(p.due.sort()).toEqual(['A', 'B']);
    expect(p.fresh).toEqual(['N2', 'N3', 'N4', 'N5', 'N6', 'N1']);
    expect(p.practised).toEqual(['C']);
  });
  it("today's session mixes due with up to 5 new pieces", () => {
    const s = todaysSession(p);
    expect(s).toHaveLength(7);
    expect(s.filter((x) => x.startsWith('N'))).toHaveLength(5);
    expect(s.slice(0, 3).some((x) => x.startsWith('N'))).toBe(true); // mixed, not appended
  });
  it('continue: new pieces, then the ones practised longest ago', () => {
    expect(continueSession({ due: [], fresh: ['N6'], practised: ['C'] })).toEqual({ kind: 'new', ids: ['N6'] });
    expect(continueSession({ due: [], fresh: [], practised: ['C', 'A'] })).toEqual({ kind: 'oldest', ids: ['C', 'A'] });
  });
  it('interleave spreads evenly', () => {
    expect(interleave(['a', 'b', 'c', 'd'], ['X', 'Y'])).toEqual(['a', 'X', 'b', 'c', 'Y', 'd']);
    expect(interleave([], ['X'])).toEqual(['X']);
  });
});
