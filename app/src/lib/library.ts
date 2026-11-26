// Pure library logic: no storage, no DOM. Unit-tested in library.test.ts.
import type {
  AudioEntry, Category, ModelManifest, ModelOverride, NotationEntry, Progress, ScoreEntry, StoredModel, Tempo,
} from './types';

export const SUPPORTED_SCHEMA = 2;
export const SCORE_EXT = /\.(musicxml|xml|mxl)$/i;
export const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
export const IMAGE_EXT = /\.(webp|png|jpe?g|gif|svg)$/i;

/* ---------------------------------------------------------------- manifests */

export class ManifestError extends Error {}

/** Validate and normalise a parsed model.json. Throws ManifestError with a short reason. */
export function parseManifest(raw: unknown, dir: string): StoredModel {
  if (!raw || typeof raw !== 'object') throw new ManifestError('not an object');
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : undefined);
  const id = str('id');
  if (!id) throw new ManifestError('missing id');
  if (typeof m.schema === 'number' && m.schema > SUPPORTED_SCHEMA)
    throw new ManifestError(`schema ${m.schema} is newer than supported (${SUPPORTED_SCHEMA})`);
  const arr = (k: string) => (Array.isArray(m[k]) ? (m[k] as unknown[]) : []);
  const audio = arr('audio').filter(isEntry).map((a) => ({ ...a, file: cleanRel(a.file) })) as AudioEntry[];
  const notation = arr('notation').filter(isEntry).map((n) => ({ ...n, file: cleanRel(n.file) })) as NotationEntry[];
  // schema 1 reserved a single "score" object; schema 2 has a "scores" list
  const rawScores = Array.isArray(m.scores) ? m.scores : m.score && typeof m.score === 'object' ? [m.score] : [];
  const scores = rawScores.filter(isEntry).map((x) => ({
    ...(x as unknown as ScoreEntry),
    file: cleanRel(x.file),
    role: (['task', 'skeleton', 'solution', 'reference'].includes(x.role) ? x.role : 'solution') as ScoreEntry['role'],
  }));
  const hasTaskish = audio.some((a) => a.role === 'task' || a.role === 'original') || scores.some((x) => x.role === 'task');
  const difficulty = typeof m.difficulty === 'number' ? clampDifficulty(m.difficulty) : null;
  return {
    schema: typeof m.schema === 'number' ? m.schema : SUPPORTED_SCHEMA,
    id,
    category: str('category') ?? '',
    kind: (['model', 'warmup', 'overview'].includes(str('kind') ?? '') ? str('kind') : 'model') as StoredModel['kind'],
    title: str('title') ?? id,
    composer: str('composer') || undefined,
    key: str('key') || undefined,
    status: (str('status') ?? (hasTaskish ? 'complete' : 'notation-only')) as StoredModel['status'],
    trainable: typeof m.trainable === 'boolean' ? m.trainable && hasTaskish : hasTaskish,
    difficulty,
    tags: arr('tags').filter((t): t is string => typeof t === 'string'),
    audio,
    notation,
    scores,
    extras: arr('extras').filter(isEntry) as unknown as StoredModel['extras'],
    source: str('source'),
    id_inferred: m.id_inferred === true || undefined,
    dir,
  };
}

function isEntry(e: unknown): e is { file: string; role: string } {
  return !!e && typeof e === 'object' && typeof (e as { file?: unknown }).file === 'string';
}

function clampDifficulty(d: number): number {
  return Math.min(5, Math.max(1, Math.round(d)));
}

/** Normalise a relative path: forward slashes, no leading ./ or /, NFC, no '..'. */
export function cleanRel(p: string): string {
  const parts = p.normalize('NFC').replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function joinPath(dir: string, file: string): string {
  return cleanRel(dir ? `${dir}/${file}` : file);
}

/* ---------------------------------------------------------------- overrides */

export function applyOverride(m: StoredModel, o: ModelOverride | undefined): StoredModel {
  if (!o) return m;
  const audio = [...m.audio, ...(o.addedAudio ?? [])];
  const hasTaskish = audio.some((a) => a.role === 'task' || a.role === 'original') || !!m.scores?.some((x) => x.role === 'task');
  return {
    ...m,
    title: o.title || m.title,
    composer: o.composer ?? m.composer,
    difficulty: o.difficulty !== undefined ? o.difficulty : m.difficulty,
    audio,
    trainable: m.trainable || hasTaskish,
  };
}

export function effectiveDifficulty(m: ModelManifest, cats: Map<string, Category>): number {
  return m.difficulty ?? cats.get(m.category)?.difficulty_default ?? 3;
}

/* ---------------------------------------------------------------- audio */

/** The audio the user hears as the task. Falls back to `original` for original-only models. */
export function taskAudio(m: ModelManifest): AudioEntry[] {
  const tasks = m.audio.filter((a) => a.role === 'task');
  if (tasks.length) return sortAudio(tasks);
  return sortAudio(m.audio.filter((a) => a.role === 'original'));
}

export function taskIsOriginal(m: ModelManifest): boolean {
  return !m.audio.some((a) => a.role === 'task') && !scoresOf(m, 'task').length;
}

export function scoresOf(m: ModelManifest, ...roles: ScoreEntry['role'][]): ScoreEntry[] {
  return (m.scores ?? []).filter((x) => roles.includes(x.role));
}

/** A playable item: a recording or a score synthesised on the fly. */
export type Playable = { kind: 'audio'; entry: AudioEntry } | { kind: 'score'; entry: ScoreEntry };

/**
 * What the user hears as the task. Recordings first, unless the setting prefers generated audio;
 * a score-only exercise always uses the score.
 */
export function taskPlayables(m: ModelManifest, prefer: 'recordings' | 'generated' = 'recordings'): Playable[] {
  const rec: Playable[] = taskAudio(m).map((entry) => ({ kind: 'audio', entry }));
  const gen: Playable[] = scoresOf(m, 'task').map((entry) => ({ kind: 'score', entry }));
  if (!m.audio.some((a) => a.role === 'task') && gen.length) return [...gen, ...rec];
  return prefer === 'generated' ? [...gen, ...rec] : [...rec, ...gen];
}

const TEMPO_ORDER: Record<Tempo, number> = { slow: 0, normal: 1, fast: 2 };

function sortAudio(list: AudioEntry[]): AudioEntry[] {
  return [...list].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      TEMPO_ORDER[a.tempo ?? 'normal'] - TEMPO_ORDER[b.tempo ?? 'normal'] ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  );
}

export function tempoOf(a: AudioEntry): Tempo {
  return a.tempo ?? 'normal';
}

/** Pick the variant to start with: preferred tempo if present, else normal, else the first. */
export function pickVariant(list: AudioEntry[], tempo: Tempo | 'any'): number {
  if (!list.length) return -1;
  if (tempo !== 'any') {
    const i = list.findIndex((a) => tempoOf(a) === tempo);
    if (i >= 0) return i;
  }
  const n = list.findIndex((a) => tempoOf(a) === 'normal' && !a.label);
  return n >= 0 ? n : 0;
}

export function modelTempos(m: ModelManifest): Set<Tempo> {
  const t = new Set(taskAudio(m).map(tempoOf));
  // a score can be played at any tempo
  if (scoresOf(m, 'task').length) for (const x of ['slow', 'normal', 'fast'] as Tempo[]) t.add(x);
  return t;
}

/* ---------------------------------------------------------------- filter */

export interface Filter {
  categories: string[]; // empty = all
  diffMin: number;
  diffMax: number;
  tempo: Tempo | 'any';
  warmups: boolean;
  practice: 'all' | 'new' | 'weak';
  order: 'random' | 'library';
}

export const DEFAULT_FILTER: Filter = {
  categories: [],
  diffMin: 1,
  diffMax: 5,
  tempo: 'any',
  warmups: true,
  practice: 'all',
  order: 'random',
};

export function isPracticable(m: ModelManifest): boolean {
  return m.trainable && m.kind !== 'overview' && (taskAudio(m).length > 0 || scoresOf(m, 'task').length > 0);
}

/** "weak" = never rated "yes" in the last attempt. "new" = no attempts. */
export function matchesFilter(
  m: ModelManifest, f: Filter, cats: Map<string, Category>, progress?: Progress,
): boolean {
  if (!isPracticable(m)) return false;
  if (!f.warmups && m.kind === 'warmup') return false;
  if (f.categories.length && !f.categories.includes(m.category)) return false;
  const d = effectiveDifficulty(m, cats);
  if (d < f.diffMin || d > f.diffMax) return false;
  if (f.tempo !== 'any' && !modelTempos(m).has(f.tempo)) return false;
  const attempts = progress?.attempts ?? [];
  if (f.practice === 'new' && attempts.length) return false;
  if (f.practice === 'weak' && attempts.length && attempts[attempts.length - 1].rating === 'yes') return false;
  return true;
}

export function compareModels(a: ModelManifest, b: ModelManifest): number {
  return a.category.localeCompare(b.category, 'en', { numeric: true }) || a.id.localeCompare(b.id, 'en', { numeric: true });
}

export function buildSession(models: ModelManifest[], order: Filter['order'], rnd = Math.random): string[] {
  const ids = [...models].sort(compareModels).map((m) => m.id);
  if (order === 'random') {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return ids;
}

/* ---------------------------------------------------------------- hint ladder */

export type StepId = 'key' | 'start' | 'degrees' | 'skeleton' | 'solution' | 'reveal';
export const ALL_STEPS: StepId[] = ['key', 'start', 'degrees', 'skeleton', 'solution', 'reveal'];

export interface LadderConfig {
  order: StepId[];
  enabled: Record<StepId, boolean>;
}

export const DEFAULT_LADDER: LadderConfig = {
  order: [...ALL_STEPS],
  enabled: { key: true, start: true, degrees: true, skeleton: true, solution: true, reveal: true },
};

export interface LadderStep {
  id: StepId;
  notation: NotationEntry[];
  audio: AudioEntry[];
  /** scores to render; 'start' shows only the first measures */
  scores: { entry: ScoreEntry; mode: 'start' | 'full'; play: boolean }[];
  key?: string;
}

export function modelKey(m: ModelManifest): string | undefined {
  return m.key ?? m.audio.find((a) => a.role === 'task' && a.key)?.key;
}

/** Steps that apply to this model, in configured order. 'reveal' is always last-available. */
export function buildLadder(m: ModelManifest, cfg: LadderConfig): LadderStep[] {
  const notes = (...roles: string[]) => m.notation.filter((n) => roles.includes(n.role));
  const audio = (...roles: string[]) => sortAudio(m.audio.filter((a) => roles.includes(a.role)));
  const steps: LadderStep[] = [];
  const order = [...cfg.order.filter((s) => ALL_STEPS.includes(s)), ...ALL_STEPS.filter((s) => !cfg.order.includes(s))];
  for (const id of order) {
    if (!cfg.enabled[id] && id !== 'reveal') continue;
    let step: LadderStep | null = null;
    switch (id) {
      case 'key': {
        const key = modelKey(m);
        if (key) step = { id, notation: [], audio: [], scores: [], key };
        break;
      }
      case 'start': {
        const n = notes('start');
        const sheet = notes('task_sheet');
        const sc = n.length ? [] : scoresOf(m, 'task').slice(0, 1).map((entry) => ({ entry, mode: 'start' as const, play: false }));
        if (n.length || sheet.length || sc.length) step = { id, notation: [...n, ...sheet], audio: [], scores: sc };
        break;
      }
      case 'degrees': {
        const n = notes('degrees', 'degrees_keyed');
        // unkeyed first: the keyed variant gives the key away
        n.sort((a, b) => (a.role === 'degrees_keyed' ? 1 : 0) - (b.role === 'degrees_keyed' ? 1 : 0));
        if (n.length) step = { id, notation: n, audio: [], scores: [] };
        break;
      }
      case 'skeleton': {
        const a = audio('skeleton');
        const sc = scoresOf(m, 'skeleton').map((entry) => ({ entry, mode: 'full' as const, play: true }));
        if (a.length || sc.length) step = { id, notation: [], audio: a, scores: sc };
        break;
      }
      case 'solution': {
        const n = notes('solution', 'reference');
        let sc = scoresOf(m, 'solution', 'reference');
        if (!sc.length) sc = scoresOf(m, 'task');
        const scs = sc.map((entry) => ({ entry, mode: 'full' as const, play: entry.role !== 'task' }));
        if (n.length || scs.length) step = { id, notation: n, audio: [], scores: scs };
        break;
      }
      case 'reveal': {
        const extra = taskIsOriginal(m) ? audio('sample', 'other') : audio('original', 'sample', 'other');
        step = { id, notation: [], audio: extra, scores: [] };
        break;
      }
    }
    if (step) steps.push(step);
  }
  // reveal always closes the ladder
  const r = steps.findIndex((s) => s.id === 'reveal');
  if (r >= 0 && r !== steps.length - 1) steps.push(...steps.splice(r, 1));
  return steps;
}

/* ---------------------------------------------------------------- stats */

export function lastRating(p?: Progress) {
  return p?.attempts.length ? p.attempts[p.attempts.length - 1].rating : undefined;
}
