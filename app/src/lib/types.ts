// Library format, schema 2 (see docs/library-format.md)

export type AudioRole = 'task' | 'skeleton' | 'original' | 'sample' | 'other';
export type NotationRole = 'start' | 'task_sheet' | 'degrees' | 'degrees_keyed' | 'solution' | 'reference';
export type Tempo = 'slow' | 'normal' | 'fast';
export type Status = 'complete' | 'original-only' | 'skeleton-only' | 'notation-only' | 'sources-only';
export type Kind = 'model' | 'warmup' | 'overview';

export interface AudioEntry {
  file: string; // relative to the model folder
  role: AudioRole;
  tempo?: Tempo;
  key?: string;
  label?: string;
  order?: number;
  group?: string;
  duration_s?: number;
  src?: string;
}

export interface NotationEntry {
  file: string;
  role: NotationRole;
  label?: string;
  src?: string;
}

export type ScoreRole = 'task' | 'skeleton' | 'solution' | 'reference';

/** MusicXML (.musicxml/.xml/.mxl). Rendered as notation and synthesised as audio (schema 2). */
export interface ScoreEntry {
  file: string;
  role: ScoreRole;
  label?: string;
  /** for role task: how many measures the "Anfang" hint shows (default 2) */
  start_measures?: number;
}

export interface ExtraEntry {
  file: string;
  kind: string;
}

export interface ModelManifest {
  schema: number;
  id: string;
  category: string;
  kind: Kind;
  title: string;
  composer?: string;
  key?: string;
  status: Status;
  trainable: boolean;
  difficulty: number | null;
  tags?: string[];
  audio: AudioEntry[];
  notation: NotationEntry[];
  scores?: ScoreEntry[];
  extras?: ExtraEntry[];
  source?: string;
  id_inferred?: boolean;
}

/** A model as stored in the app: manifest + the folder it lives in (inside app storage). */
export interface StoredModel extends ModelManifest {
  dir: string; // path of the model folder inside the stored library, '' = root
  pack?: string; // import pack id; 'user' = made in the app
  updatedAt?: string; // own exercises: last edit (for sync)
}

export interface Category {
  id: string;
  title: string;
  difficulty_default: number | null;
}

export interface LibraryIndex {
  schema: number;
  importedAt: string;
  categories: Category[];
  fileCount: number;
  bytes: number;
}

/** User edits that live outside the imported data and survive re-imports. */
/** A user-placed marker in a recording/score, in seconds of the original (speed 1). */
export interface Marker { t: number; label: string }

export interface ModelOverride {
  id: string;
  updatedAt?: string;
  /** markers per track id (see sources.Track.id) */
  markers?: Record<string, Marker[]>;
  title?: string;
  composer?: string;
  difficulty?: number | null;
  /** audio the user attached in the app, stored under user/<id>/... */
  addedAudio?: AudioEntry[];
}

export type Rating = 'yes' | 'partly' | 'no';

/** Piece details kept with the progress, so pieces removed from the library can be shown as missing. */
export interface PieceInfo {
  title: string;
  composer?: string;
  category: string;
  categoryTitle?: string;
}

export interface Attempt {
  at: string; // ISO date
  rating: Rating;
  hintsUsed: number; // index of the last revealed ladder step
}

export interface Progress {
  id: string;
  attempts: Attempt[];
  info?: PieceInfo;
}
