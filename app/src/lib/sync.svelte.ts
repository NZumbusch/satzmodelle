// UI-facing Drive sync: token handling, triggers, status.
import { DriveAuth, isNative } from './native';
import { syncProgress, DriveError } from './drive';
import { allProgress, putProgress } from './db';
import { lib, settings, saveSettings, reloadLibrary, t } from './state.svelte';
import { fullSync, type FullSyncProgress } from './fullsync';
import { forgetUrls } from './media';
import { forgetScores } from './sources';

export const syncUi = $state({
  busy: false, error: '' as string, available: isNative(),
  /** set when Google rejects the app configuration: show what Google Cloud needs */
  configHint: null as { packageName: string; sha1: string } | null,
  full: null as FullSyncProgress | null, note: '' as string,
});

const SYNCED_KEY = 'satzmodelle.synced.v1';
function loadSynced(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '{}'); } catch { return {}; }
}
function saveSynced(s: Record<string, string>) {
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function onCellular(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return c?.type === 'cellular';
}

export function getAccessToken(interactive: boolean) {
  return getToken(interactive);
}

let token: { value: string; until: number } | null = null;

async function getToken(interactive: boolean): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  if (!DriveAuth) throw new Error('not available');
  const r = await DriveAuth.authorize({ interactive });
  token = { value: r.accessToken, until: Date.now() + 45 * 60 * 1000 };
  if (r.email) settings.drive.email = r.email;
  return r.accessToken;
}

/** Turn a plugin/Drive error into something the user can act on. */
async function explain(e: unknown): Promise<string> {
  const code = (e as { code?: string })?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'status_10' || code === 'cancelled' || /DEVELOPER_ERROR|access_denied|403/.test(msg)) {
    syncUi.configHint = (await DriveAuth?.info().catch(() => null)) ?? null;
  }
  if (code === 'status_10') return t('sync.err.config');
  if (code === 'status_7') return t('sync.err.network');
  if (code === 'cancelled') return t('sync.err.cancelled', { msg });
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project/.test(msg)) return t('sync.err.api');
  return msg;
}

export async function connect() {
  syncUi.error = '';
  syncUi.configHint = null;
  try {
    await getToken(true);
    settings.drive.enabled = true;
    saveSettings();
    await syncNow();
  } catch (e) {
    syncUi.error = await explain(e);
  }
}

export async function disconnect() {
  const tk = token?.value;
  saveSynced({});
  token = null;
  settings.drive.enabled = false;
  settings.drive.email = '';
  saveSettings();
  await DriveAuth?.signOut({ accessToken: tk }).catch(() => {});
}

export async function syncNow(interactive = false) {
  if (!settings.drive.enabled || syncUi.busy || !DriveAuth) return;
  syncUi.busy = true;
  syncUi.error = '';
  syncUi.configHint = null;
  try {
    let tk = await getToken(interactive);
    let res;
    try {
      res = await syncProgress(fetch, tk, await allProgress(), settings.drive.resetAt || undefined);
    } catch (e) {
      if (e instanceof DriveError && e.status === 401) {
        token = null;
        tk = await getToken(interactive);
        res = await syncProgress(fetch, tk, await allProgress(), settings.drive.resetAt || undefined);
      } else throw e;
    }
    for (const p of res.merged) {
      const cur = lib.progress.get(p.id);
      if (JSON.stringify(cur?.attempts) !== JSON.stringify(p.attempts) || (!cur?.info && p.info)) {
        const next = { ...p, info: cur?.info ?? p.info };
        await putProgress(next);
        lib.progress.set(p.id, next);
      }
    }
    lib.progress = new Map(lib.progress);
    syncUi.note = '';
    if (settings.drive.full) {
      if (settings.drive.wifiOnly && onCellular()) syncUi.note = 'wifi';
      else {
        const r = await fullSync(fetch, tk, {
          recordings: settings.drive.recordings, synced: loadSynced(),
          onProgress: (p) => (syncUi.full = p),
        });
        saveSynced(r.synced);
        if (r.downloaded || r.deleted) {
          forgetUrls();
          forgetScores();
          await reloadLibrary();
        }
      }
    }
    settings.drive.lastSync = new Date().toISOString();
    if (res.resetAt) settings.drive.resetAt = res.resetAt;
    saveSettings();
  } catch (e) {
    syncUi.error = await explain(e);
  } finally {
    syncUi.busy = false;
    syncUi.full = null;
  }
}

let timer: number | undefined;
/** Debounced sync after a change (e.g. a rating). */
export function scheduleSync() {
  if (!settings.drive.enabled) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => syncNow(false), 4000);
}
