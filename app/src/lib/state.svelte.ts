// Reactive app state (Svelte 5 runes).
import { translate, type I18nKey, type Lang } from './i18n';
import { DEFAULT_FILTER, DEFAULT_LADDER, applyOverride, type Filter, type LadderConfig } from './library';
import { allModels, allOverrides, allPacks, allProgress, putProgress, type Pack } from './db';
import { pieceInfo } from './progress';
import type { Category, ModelOverride, Progress, StoredModel } from './types';

export interface Settings {
  lang: Lang;
  theme: 'system' | 'light' | 'dark';
  blind: boolean;
  confirmReveal: boolean;
  ladder: LadderConfig;
  defaultSpeed: number;
  rememberSpeed: boolean;
  audioSource: 'recordings' | 'generated';
  synthVoice: 'piano' | 'harpsichord' | 'organ';
  filter: Filter;
  speeds: Record<string, number>; // per model id, if rememberSpeed
  updates: { auto: boolean; dismissed: number };
  drive: { enabled: boolean; email: string; lastSync: string; resetAt: string; full: boolean; recordings: boolean; wifiOnly: boolean };
}

const DEFAULTS: Settings = {
  lang: 'de',
  theme: 'system',
  blind: true,
  confirmReveal: true,
  ladder: DEFAULT_LADDER,
  defaultSpeed: 1,
  rememberSpeed: true,
  audioSource: 'recordings',
  synthVoice: 'piano',
  filter: DEFAULT_FILTER,
  speeds: {},
  updates: { auto: true, dismissed: 0 },
  drive: { enabled: false, email: '', lastSync: '', resetAt: '', full: false, recordings: false, wifiOnly: true },
};

const KEY = 'satzmodelle.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        ...DEFAULTS, ...s,
        ladder: { ...DEFAULT_LADDER, ...s.ladder, enabled: { ...DEFAULT_LADDER.enabled, ...s.ladder?.enabled } },
        filter: { ...DEFAULT_FILTER, ...s.filter },
        drive: { ...DEFAULTS.drive, ...s.drive },
        updates: { ...DEFAULTS.updates, ...s.updates },
      };
    }
  } catch {
    /* storage unavailable: defaults */
  }
  return structuredClone(DEFAULTS);
}

export const settings = $state<Settings>(load());

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(settings)));
  } catch {
    /* ignore */
  }
}

export function t(key: I18nKey, vars?: Record<string, string | number>) {
  return translate(settings.lang, key, vars);
}

/* ---------------------------------------------------------------- library */

export const lib = $state({
  loaded: false,
  raw: [] as StoredModel[],
  models: [] as StoredModel[],
  byId: new Map<string, StoredModel>(),
  categories: [] as Category[],
  catMap: new Map<string, Category>(),
  packs: [] as Pack[],
  progress: new Map<string, Progress>(),
  overrides: new Map<string, ModelOverride>(),
});

export async function reloadLibrary() {
  const [raw, packs, progress, overrides] = await Promise.all([allModels(), allPacks(), allProgress(), allOverrides()]);
  const ov = new Map(overrides.map((o) => [o.id, o]));
  const models = raw.map((m) => applyOverride(m, ov.get(m.id)));
  const cats = new Map<string, Category>();
  for (const p of [...packs].sort((a, b) => a.importedAt.localeCompare(b.importedAt)))
    for (const c of p.categories) cats.set(c.id, c);
  for (const m of models)
    if (m.category && !cats.has(m.category))
      cats.set(m.category, { id: m.category, title: m.category === 'U' ? translate(settings.lang, 'own.category') : m.category, difficulty_default: null });
  lib.raw = raw;
  lib.models = models;
  lib.byId = new Map(models.map((m) => [m.id, m]));
  lib.categories = [...cats.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  lib.catMap = cats;
  lib.packs = packs;
  // keep piece details with the progress, so removed pieces can still be named
  for (const p of progress) {
    const m = lib.byId.get(p.id);
    if (!m) continue;
    const info = pieceInfo(m, cats.get(m.category));
    if (JSON.stringify(info) !== JSON.stringify(p.info)) {
      p.info = info;
      putProgress(p).catch(() => {});
    }
  }
  lib.progress = new Map(progress.map((p) => [p.id, p]));
  lib.overrides = ov;
  lib.loaded = true;
}

/* ---------------------------------------------------------------- navigation */

export type Route =
  | { name: 'start' }
  | { name: 'practice'; ids: string[] }
  | { name: 'library' }
  | { name: 'model'; id: string }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'editor'; id?: string };

export const nav = $state({ stack: [{ name: 'start' }] as Route[] });

export function go(r: Route) {
  nav.stack.push(r);
}
export function replace(r: Route) {
  nav.stack[nav.stack.length - 1] = r;
}
export function home(name: 'start' | 'library' | 'stats' | 'settings' = 'start') {
  nav.stack = [{ name: 'start' }];
  if (name !== 'start') nav.stack.push({ name });
}
export function back(): boolean {
  if (nav.stack.length > 1) {
    nav.stack.pop();
    return true;
  }
  return false;
}
