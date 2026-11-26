import { describe, expect, it } from 'vitest';
import {
  applyOverride, buildLadder, buildSession, cleanRel, DEFAULT_FILTER, DEFAULT_LADDER, effectiveDifficulty,
  matchesFilter, parseManifest, pickVariant, taskAudio, taskPlayables,
} from './library';
import type { Category } from './types';

const cats = new Map<string, Category>([['02.1', { id: '02.1', title: 'Cat', difficulty_default: 2 }]]);

function manifest(over: Record<string, unknown> = {}) {
  return parseManifest({
    schema: 1, id: 'X1', category: '02.1', kind: 'model', title: 'T', key: 'a-Moll', status: 'complete', trainable: true,
    difficulty: null,
    audio: [
      { file: 'audio/task_fast.mp3', role: 'task', tempo: 'fast' },
      { file: 'audio/task_slow.mp3', role: 'task', tempo: 'slow' },
      { file: 'audio/skel.mp3', role: 'skeleton' },
      { file: 'audio/orig.mp3', role: 'original' },
    ],
    notation: [
      { file: 'notation/degrees_keyed.webp', role: 'degrees_keyed' },
      { file: 'notation/start.webp', role: 'start' },
      { file: 'notation/degrees.webp', role: 'degrees' },
      { file: 'notation/solution.webp', role: 'solution' },
    ],
    ...over,
  }, 'p1/cat/m');
}

describe('parseManifest', () => {
  it('normalises and keeps dir', () => {
    const m = manifest();
    expect(m.dir).toBe('p1/cat/m');
    expect(m.trainable).toBe(true);
    expect(m.audio).toHaveLength(4);
  });
  it('rejects missing id and newer schema', () => {
    expect(() => parseManifest({ title: 'x' }, '')).toThrow();
    expect(() => parseManifest({ id: 'a', schema: 99 }, '')).toThrow(/schema/);
  });
  it('trainable false without task/original audio even if the flag says true', () => {
    expect(manifest({ audio: [{ file: 'a.mp3', role: 'skeleton' }] }).trainable).toBe(false);
  });
});

describe('paths', () => {
  it('cleans', () => {
    expect(cleanRel('./a//b/../c\\d.mp3')).toBe('a/c/d.mp3');
    expect(cleanRel('../../x')).toBe('x');
  });
});

describe('audio', () => {
  it('orders task variants slow -> fast and picks the preferred tempo', () => {
    const m = manifest();
    const t = taskAudio(m);
    expect(t.map((a) => a.tempo)).toEqual(['slow', 'fast']);
    expect(pickVariant(t, 'fast')).toBe(1);
    expect(pickVariant(t, 'normal')).toBe(0);
  });
  it('falls back to original for original-only', () => {
    const m = manifest({ audio: [{ file: 'o.mp3', role: 'original' }] });
    expect(taskAudio(m)[0].role).toBe('original');
  });
});

describe('filter', () => {
  it('difficulty inherits the category default', () => {
    const m = manifest();
    expect(effectiveDifficulty(m, cats)).toBe(2);
    expect(matchesFilter(m, { ...DEFAULT_FILTER, diffMin: 3 }, cats)).toBe(false);
    expect(matchesFilter(m, { ...DEFAULT_FILTER, diffMax: 2 }, cats)).toBe(true);
  });
  it('tempo is strict', () => {
    const m = manifest();
    expect(matchesFilter(m, { ...DEFAULT_FILTER, tempo: 'normal' }, cats)).toBe(false);
    expect(matchesFilter(m, { ...DEFAULT_FILTER, tempo: 'slow' }, cats)).toBe(true);
  });
  it('categories, warmups, practice state', () => {
    const m = manifest();
    expect(matchesFilter(m, { ...DEFAULT_FILTER, categories: ['03.1'] }, cats)).toBe(false);
    expect(matchesFilter({ ...m, kind: 'warmup' }, { ...DEFAULT_FILTER, warmups: false }, cats)).toBe(false);
    const p = { id: 'X1', attempts: [{ at: '', rating: 'yes' as const, hintsUsed: 0 }] };
    expect(matchesFilter(m, { ...DEFAULT_FILTER, practice: 'new' }, cats, p)).toBe(false);
    expect(matchesFilter(m, { ...DEFAULT_FILTER, practice: 'weak' }, cats, p)).toBe(false);
  });
  it('never includes overviews or untrainable models', () => {
    expect(matchesFilter(manifest({ kind: 'overview' }), DEFAULT_FILTER, cats)).toBe(false);
    expect(matchesFilter(manifest({ audio: [] }), DEFAULT_FILTER, cats)).toBe(false);
  });
  it('session shuffles deterministically with a given rng', () => {
    const ms = ['A', 'B', 'C'].map((id) => manifest({ id }));
    expect(buildSession(ms, 'library')).toEqual(['A', 'B', 'C']);
    expect(buildSession(ms, 'random', () => 0).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('hint ladder', () => {
  it('follows the default order and puts unkeyed degrees first', () => {
    const l = buildLadder(manifest(), DEFAULT_LADDER);
    expect(l.map((s) => s.id)).toEqual(['key', 'start', 'degrees', 'skeleton', 'solution', 'reveal']);
    expect(l[2].notation.map((n) => n.role)).toEqual(['degrees', 'degrees_keyed']);
    expect(l[5].audio.map((a) => a.role)).toEqual(['original']);
  });
  it('skips missing steps and disabled ones; reveal stays last', () => {
    const m = manifest({ notation: [], audio: [{ file: 't.mp3', role: 'task' }], key: undefined });
    expect(buildLadder(m, DEFAULT_LADDER).map((s) => s.id)).toEqual(['reveal']);
    const cfg = { order: ['reveal', 'solution', 'key'] as const, enabled: { ...DEFAULT_LADDER.enabled, key: false } };
    const l = buildLadder(manifest(), { order: [...cfg.order], enabled: cfg.enabled });
    expect(l.map((s) => s.id)).toEqual(['solution', 'start', 'degrees', 'skeleton', 'reveal']);
  });
  it('uses the task key if the model has none', () => {
    const m = manifest({ key: undefined, audio: [{ file: 't.mp3', role: 'task', key: 'G-Dur' }] });
    expect(buildLadder(m, DEFAULT_LADDER)[0]).toMatchObject({ id: 'key', key: 'G-Dur' });
  });
});

describe('overrides', () => {
  it('title, difficulty, added audio makes a stub trainable', () => {
    const stub = manifest({ audio: [], status: 'notation-only', trainable: false });
    const o = applyOverride(stub, { id: 'X1', title: 'Neu', difficulty: 5, addedAudio: [{ file: 'user/X1/a.mp3', role: 'task' }] });
    expect(o.title).toBe('Neu');
    expect(o.difficulty).toBe(5);
    expect(o.trainable).toBe(true);
    expect(matchesFilter(o, DEFAULT_FILTER, cats)).toBe(true);
  });
});

describe('scores (schema 2)', () => {
  const scored = () => manifest({
    schema: 2, audio: [], notation: [], trainable: true,
    scores: [{ file: 'score/task.musicxml', role: 'task', start_measures: 1 }, { file: 'score/skel.musicxml', role: 'skeleton' }],
  });
  it('a score-only exercise is practicable at any tempo and plays the score', () => {
    const m = scored();
    expect(m.trainable).toBe(true);
    expect(matchesFilter(m, { ...DEFAULT_FILTER, tempo: 'slow' }, cats)).toBe(true);
    expect(taskPlayables(m)[0].kind).toBe('score');
  });
  it('ladder: opening from the task score, skeleton playable, solution falls back to the task score', () => {
    const l = buildLadder(scored(), DEFAULT_LADDER);
    expect(l.map((s) => s.id)).toEqual(['key', 'start', 'skeleton', 'solution', 'reveal']);
    expect(l[1].scores[0]).toMatchObject({ mode: 'start', play: false });
    expect(l[2].scores[0]).toMatchObject({ mode: 'full', play: true });
    expect(l[3].scores[0].entry.role).toBe('task');
  });
  it('recordings come first unless generated audio is preferred; legacy single "score" is accepted', () => {
    const m = manifest({ scores: [{ file: 's.musicxml', role: 'task' }] });
    expect(taskPlayables(m, 'recordings')[0].kind).toBe('audio');
    expect(taskPlayables(m, 'generated')[0].kind).toBe('score');
    expect(manifest({ score: { file: 's.mxl', role: 'solution' } }).scores).toHaveLength(1);
  });
});
