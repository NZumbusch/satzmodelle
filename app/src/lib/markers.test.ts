import { describe, expect, it } from 'vitest';
import { nextLabel, sectionAt } from './markers';

describe('markers', () => {
  const ms = [{ t: 4, label: '1' }, { t: 9, label: 'Kadenz' }];
  it('finds the section around a time', () => {
    expect(sectionAt(ms, 0, 12)).toEqual([0, 4]);
    expect(sectionAt(ms, 4, 12)).toEqual([4, 9]);
    expect(sectionAt(ms, 3.99, 12)).toEqual([4, 9]); // just before a marker counts as that marker (tap tolerance)
    expect(sectionAt(ms, 10, 12)).toEqual([9, 12]);
    expect(sectionAt([], 5, 12)).toEqual([0, 12]);
  });
  it('labels markers with the first free number', () => {
    expect(nextLabel(ms)).toBe('2');
    expect(nextLabel([])).toBe('1');
  });
});
