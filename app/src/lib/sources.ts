// Turn a track source into an AudioBuffer. Scores are synthesised (and cached per transposition).
import { decode } from './player';
import { getFile } from './db';
import { musicXmlText, parseMusicXml, type Score } from './musicxml';
import { renderScore, type Voice } from './synth';

export type TrackSource = { kind: 'file'; path: string } | { kind: 'blob'; blob: Blob } | { kind: 'score'; path: string };
/** id: stable per model (relative file), used to remember markers */
export interface Track { label: string; source: TrackSource; id?: string }

export class MissingFile extends Error {}

const scoreCache = new Map<string, Promise<Score>>();

export function loadScore(path: string): Promise<Score> {
  let p = scoreCache.get(path);
  if (!p) {
    p = getFile(path).then(async (b) => {
      if (!b) throw new MissingFile(path);
      return parseMusicXml(musicXmlText(new Uint8Array(await b.arrayBuffer())));
    });
    scoreCache.set(path, p);
    p.catch(() => scoreCache.delete(path));
  }
  return p;
}

const renderCache = new Map<string, Promise<AudioBuffer>>();

/** Buffer for a source. For scores the transposition is rendered in; for recordings it is not. */
export async function bufferFor(src: TrackSource, semitones: number, voice: Voice): Promise<AudioBuffer> {
  if (src.kind === 'blob') return decode(src.blob);
  if (src.kind === 'file') {
    const b = await getFile(src.path);
    if (!b) throw new MissingFile(src.path);
    return decode(b);
  }
  const key = `${src.path}|${semitones}|${voice}`;
  let p = renderCache.get(key);
  if (!p) {
    p = loadScore(src.path).then((s) => renderScore(s, semitones, voice));
    renderCache.set(key, p);
    if (renderCache.size > 8) renderCache.delete(renderCache.keys().next().value!);
    p.catch(() => renderCache.delete(key));
  }
  return p;
}

export function forgetScores() {
  scoreCache.clear();
  renderCache.clear();
}
