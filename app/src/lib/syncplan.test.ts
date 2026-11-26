import { describe, expect, it } from 'vitest';
import { plan, type RemoteUnit } from './syncplan';

const R = (updatedAt: string, deleted = false): RemoteUnit => ({ updatedAt, deleted, fileId: 'f' });
const run = (l: Record<string, string>, r: Record<string, RemoteUnit>, s: Record<string, string> = {}) =>
  plan(new Map(Object.entries(l)), new Map(Object.entries(r)), s).map((a) => `${a.type} ${a.key}`);

describe('sync plan', () => {
  it('first sync uploads everything, a new device downloads everything', () => {
    expect(run({ a: '1', b: '1' }, {})).toEqual(['upload a', 'upload b']);
    expect(run({}, { a: R('1'), b: R('1') })).toEqual(['download a', 'download b']);
  });
  it('nothing to do when in step', () => {
    expect(run({ a: '1' }, { a: R('1') }, { a: '1' })).toEqual([]);
  });
  it('newer side wins for edits', () => {
    expect(run({ a: '2' }, { a: R('1') }, { a: '1' })).toEqual(['upload a']);
    expect(run({ a: '1' }, { a: R('2') }, { a: '1' })).toEqual(['download a']);
  });
  it('local deletion becomes a tombstone; remote tombstone deletes locally', () => {
    expect(run({}, { a: R('1') }, { a: '1' })).toEqual(['tombstone a']);
    expect(run({ a: '1' }, { a: R('1', true) }, { a: '1' })).toEqual(['deleteLocal a']);
  });
  it('a local change beats a remote deletion, a remote change beats a local deletion', () => {
    expect(run({ a: '2' }, { a: R('1', true) }, { a: '1' })).toEqual(['upload a']);
    expect(run({}, { a: R('3') }, { a: '1' })).toEqual(['download a']);
  });
  it('replaced library on another device: new pack downloaded before old one removed', () => {
    expect(run({ old: '1' }, { old: R('1', true), neu: R('2') }, { old: '1' })).toEqual(['download neu', 'deleteLocal old']);
  });
  it('tombstones of things never seen are ignored', () => {
    expect(run({}, { a: R('1', true) })).toEqual([]);
  });
});
