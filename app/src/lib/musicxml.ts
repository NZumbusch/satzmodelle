// Minimal MusicXML reader: notes with onset/duration in quarter beats, tempo map, measures, metadata.
// Repeats/jumps are played as written (not expanded). Grace and cue notes are skipped.
import { unzipSync, strFromU8 } from 'fflate';
import { keyFromFifths } from './keys';

export interface NoteEvent { start: number; dur: number; midi: number; part: number }
export interface Score {
  title?: string;
  composer?: string;
  key?: string;
  parts: string[];
  notes: NoteEvent[];
  tempo: { beat: number; bpm: number }[]; // quarter notes per minute from beat on
  measures: { number: string; start: number }[];
  beats: number;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Accept .musicxml/.xml text or a compressed .mxl. */
export function musicXmlText(data: Uint8Array): string {
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = unzipSync(data);
    const container = files['META-INF/container.xml'];
    let root: string | undefined;
    if (container) root = strFromU8(container).match(/full-path="([^"]+)"/)?.[1];
    root ??= Object.keys(files).find((f) => !f.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(f));
    if (!root || !files[root]) throw new Error('mxl: no score inside');
    return strFromU8(files[root]);
  }
  return new TextDecoder().decode(data);
}

const kids = (el: Element, name?: string) => [...el.children].filter((c) => !name || c.tagName === name);
const kid = (el: Element | null | undefined, name: string) => (el ? kids(el, name)[0] : undefined);
const txt = (el: Element | null | undefined, name: string) => kid(el, name)?.textContent?.trim();

export function parseMusicXml(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.tagName === 'parsererror' || doc.getElementsByTagName('parsererror').length)
    throw new Error('not valid XML');
  if (root.tagName === 'score-timewise') throw new Error('timewise MusicXML is not supported; export partwise');
  if (root.tagName !== 'score-partwise') throw new Error('not a MusicXML score');

  const title = txt(kid(root, 'work'), 'work-title') || txt(root, 'movement-title') || undefined;
  const composer = [...root.getElementsByTagName('creator')].find((c) => c.getAttribute('type') === 'composer')?.textContent?.trim() || undefined;
  const partNames = new Map<string, string>();
  for (const sp of root.getElementsByTagName('score-part')) partNames.set(sp.getAttribute('id') ?? '', txt(sp, 'part-name') ?? '');

  const notes: NoteEvent[] = [];
  const tempo: { beat: number; bpm: number }[] = [];
  const measures: { number: string; start: number }[] = [];
  let key: string | undefined;
  let beats = 0;
  const parts = kids(root, 'part');

  parts.forEach((part, pi) => {
    let divisions = 1;
    let transpose = 0;
    let cursor = 0; // quarter beats
    let lastStart = 0;
    const open = new Map<number, NoteEvent>(); // tied notes by midi
    for (const measure of kids(part, 'measure')) {
      if (pi === 0) measures.push({ number: measure.getAttribute('number') ?? String(measures.length + 1), start: cursor });
      const mStart = cursor;
      let mEnd = cursor;
      for (const el of kids(measure)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = Number(txt(el, 'divisions'));
            if (d > 0) divisions = d;
            const tr = kid(el, 'transpose');
            if (tr) transpose = Number(txt(tr, 'chromatic') ?? 0) + 12 * Number(txt(tr, 'octave-change') ?? 0);
            const k = kid(el, 'key');
            if (k && key === undefined && txt(k, 'fifths') !== undefined) key = keyFromFifths(Number(txt(k, 'fifths')), txt(k, 'mode') ?? null);
            break;
          }
          case 'sound':
          case 'direction': {
            const s = el.tagName === 'sound' ? el : kid(el, 'sound');
            const bpm = Number(s?.getAttribute('tempo'));
            if (bpm > 0) tempo.push({ beat: cursor, bpm });
            else if (el.tagName === 'direction' && !tempo.some((t) => t.beat === cursor)) {
              // a metronome mark without <sound tempo>
              const met = el.getElementsByTagName('metronome')[0];
              const pm = Number(met ? txt(met, 'per-minute') : NaN);
              if (pm > 0) {
                const unit = txt(met, 'beat-unit') ?? 'quarter';
                const factor = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit] ?? 1;
                tempo.push({ beat: cursor, bpm: pm * factor * (kid(met, 'beat-unit-dot') ? 1.5 : 1) });
              }
            }
            break;
          }
          case 'backup':
            cursor -= Number(txt(el, 'duration') ?? 0) / divisions;
            break;
          case 'forward':
            cursor += Number(txt(el, 'duration') ?? 0) / divisions;
            mEnd = Math.max(mEnd, cursor);
            break;
          case 'note': {
            if (kid(el, 'grace') || kid(el, 'cue')) break;
            const dur = Number(txt(el, 'duration') ?? 0) / divisions;
            const isChord = !!kid(el, 'chord');
            const start = isChord ? lastStart : cursor;
            const pitch = kid(el, 'pitch');
            if (pitch) {
              const midi = 12 * (Number(txt(pitch, 'octave')) + 1) + STEP[txt(pitch, 'step') ?? 'C'] + Number(txt(pitch, 'alter') ?? 0) + transpose;
              const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
              const prev = open.get(midi);
              if (ties.includes('stop') && prev && Math.abs(prev.start + prev.dur - start) < 1e-6) {
                prev.dur += dur;
                if (!ties.includes('start')) open.delete(midi);
              } else {
                const n = { start, dur, midi: Math.round(midi), part: pi };
                notes.push(n);
                if (ties.includes('start')) open.set(midi, n);
              }
            }
            if (!isChord) {
              lastStart = cursor;
              cursor += dur;
            }
            mEnd = Math.max(mEnd, cursor);
            break;
          }
        }
      }
      cursor = Math.max(mEnd, mStart);
    }
    beats = Math.max(beats, cursor);
  });

  tempo.sort((a, b) => a.beat - b.beat);
  if (!tempo.length || tempo[0].beat > 0) tempo.unshift({ beat: 0, bpm: tempo[0]?.bpm ?? 80 });
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { title, composer, key, parts: parts.map((p) => partNames.get(p.getAttribute('id') ?? '') ?? ''), notes, tempo, measures, beats };
}

/** Beat -> seconds using the tempo map. */
export function beatToSeconds(score: Pick<Score, 'tempo'>, beat: number): number {
  let s = 0;
  for (let i = 0; i < score.tempo.length; i++) {
    const t = score.tempo[i];
    const next = score.tempo[i + 1]?.beat ?? Infinity;
    if (beat <= t.beat) break;
    s += ((Math.min(beat, next) - t.beat) * 60) / t.bpm;
  }
  return s;
}
