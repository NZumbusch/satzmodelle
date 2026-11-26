// Exercises made in the app ("Eigene Übungen"). Stored like imported models but with pack 'user';
// their files live in the userfiles store under user/<id>/. Library imports never touch them.
import { db, putUserFile } from './db';
import type { AudioEntry, NotationEntry, ScoreEntry, StoredModel } from './types';

export const OWN_PACK = 'user';
export const OWN_CATEGORY = 'U';

export function newOwnId(now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `U${d}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface OwnDraft {
  id?: string;
  title: string;
  composer: string;
  category: string;
  key: string;
  difficulty: number | null;
  startMeasures: number;
  /** new files to store; undefined = keep the existing one, null = remove */
  taskScore?: File | null;
  skeletonScore?: File | null;
  solutionScore?: File | null;
  taskAudio?: File | null;
  skeletonAudio?: File | null;
  degreesImage?: File | null;
}

function safeName(name: string) {
  return name.normalize('NFC').replace(/[^\w.\-äöüÄÖÜß]+/g, '_').slice(-80);
}

export async function saveOwn(d: OwnDraft, existing?: StoredModel): Promise<StoredModel> {
  const id = existing?.id ?? d.id ?? newOwnId();
  const base = `user/${id}`;
  let scores: ScoreEntry[] = [...(existing?.scores ?? [])];
  let audio: AudioEntry[] = [...(existing?.audio ?? [])];
  let notation: NotationEntry[] = [...(existing?.notation ?? [])];

  async function store(f: File, prefix: string) {
    const path = `${base}/${prefix}_${Date.now()}_${safeName(f.name)}`;
    await putUserFile(path, f);
    return path;
  }
  async function setScore(role: ScoreEntry['role'], f: File | null | undefined) {
    if (f === undefined) return;
    scores = scores.filter((x) => x.role !== role);
    if (f) scores.push({ file: await store(f, role), role });
  }
  async function setAudio(role: AudioEntry['role'], f: File | null | undefined) {
    if (f === undefined) return;
    audio = audio.filter((x) => x.role !== role);
    if (f) audio.push({ file: await store(f, role), role, tempo: 'normal', key: d.key || undefined, src: f.name });
  }
  await setScore('task', d.taskScore);
  await setScore('skeleton', d.skeletonScore);
  await setScore('solution', d.solutionScore);
  await setAudio('task', d.taskAudio);
  await setAudio('skeleton', d.skeletonAudio);
  if (d.degreesImage !== undefined) {
    notation = notation.filter((x) => x.role !== 'degrees');
    if (d.degreesImage) notation.push({ file: await store(d.degreesImage, 'degrees'), role: 'degrees', src: d.degreesImage.name });
  }
  scores = scores.map((x) => (x.role === 'task' ? { ...x, start_measures: d.startMeasures } : x));

  const hasTask = scores.some((x) => x.role === 'task') || audio.some((a) => a.role === 'task');
  const m: StoredModel = {
    schema: 2, id, category: d.category || OWN_CATEGORY, kind: 'model',
    title: d.title.trim() || id, composer: d.composer.trim() || undefined, key: d.key.trim() || undefined,
    status: hasTask ? 'complete' : 'notation-only', trainable: hasTask, difficulty: d.difficulty,
    tags: ['own'], audio, notation, scores, extras: [], source: 'app', dir: '', pack: OWN_PACK,
    updatedAt: new Date().toISOString(),
  };
  await (await db()).put('models', m as StoredModel & { pack: string });
  // drop files that are no longer referenced
  const used = new Set([...scores, ...audio, ...notation].map((x) => x.file));
  const d2 = await db();
  for (const k of await d2.getAllKeys('userfiles', IDBKeyRange.bound(`${base}/`, `${base}/￿`)))
    if (!used.has(k) && !k.startsWith(`${base}/added/`)) await d2.delete('userfiles', k);
  return m;
}

export async function deleteOwn(id: string) {
  const d = await db();
  await d.delete('models', id);
  // keep user/<id>/added/ (belongs to the edits unit, not to the exercise)
  for (const k of await d.getAllKeys('userfiles', IDBKeyRange.bound(`user/${id}/`, `user/${id}/\uffff`)))
    if (!k.startsWith(`user/${id}/added/`)) await d.delete('userfiles', k);
}
