import { joinPath, tempoOf, type Playable } from './library';
import { t } from './state.svelte';
import type { AudioEntry, ScoreEntry, StoredModel } from './types';
import type { I18nKey } from './i18n';
import type { Track } from './sources';

/** Label for an audio variant. Never contains the key unless showKey (the key is a hint). */
export function audioLabel(a: AudioEntry, opts: { showRole?: boolean; showKey?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.showRole) parts.push(t(`role.${a.role}` as I18nKey));
  const tempo = tempoOf(a);
  if (tempo !== 'normal' || (!a.label && !opts.showRole)) parts.push(t(`tempo.${tempo}` as I18nKey));
  if (a.label) parts.push(a.label);
  if (a.group === 'clips' && a.order !== undefined) parts.push(`#${a.order}`);
  if (opts.showKey && a.key) parts.push(a.key);
  return parts.join(' · ');
}

export function scoreLabel(x: ScoreEntry, opts: { showRole?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.showRole) parts.push(t(`role.${x.role === 'solution' || x.role === 'reference' ? 'other' : x.role}` as I18nKey));
  parts.push(t('player.generated'));
  if (x.label) parts.push(x.label);
  return parts.join(' · ');
}

export function filePath(m: StoredModel, file: string) {
  return file.startsWith('user/') ? file : joinPath(m.dir, file);
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Map<string, number>();
  return tracks.map((tr) => {
    const n = (seen.get(tr.label) ?? 0) + 1;
    seen.set(tr.label, n);
    return n > 1 ? { ...tr, label: `${tr.label} (${n})` } : tr;
  });
}

export function tracksFor(m: StoredModel, list: AudioEntry[], opts: { showRole?: boolean; showKey?: boolean } = {}): Track[] {
  return dedupe(list.map((a) => ({ id: `a:${a.file}`, label: audioLabel(a, opts), source: { kind: 'file', path: filePath(m, a.file) } })));
}

export function playableTracks(m: StoredModel, list: Playable[], opts: { showRole?: boolean; showKey?: boolean } = {}): Track[] {
  return dedupe(list.map((p) => p.kind === 'audio'
    ? { id: `a:${p.entry.file}`, label: audioLabel(p.entry, opts), source: { kind: 'file', path: filePath(m, p.entry.file) } }
    : { id: `s:${p.entry.file}`, label: scoreLabel(p.entry, opts), source: { kind: 'score', path: filePath(m, p.entry.file) } }));
}

export function scoreTracks(m: StoredModel, list: ScoreEntry[], opts: { showRole?: boolean } = {}): Track[] {
  return dedupe(list.map((x) => ({ id: `s:${x.file}`, label: scoreLabel(x, opts), source: { kind: 'score', path: filePath(m, x.file) } })));
}
