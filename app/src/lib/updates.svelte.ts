// Self-update state: check version.json, download + verify, install. Only in the native app.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { apkUrl, changesSince, isNewer, parseUpdateManifest, type UpdateManifest } from './updater';
import { settings, saveSettings } from './state.svelte';

interface AppUpdaterPlugin {
  download(o: { url: string; sha256: string }): Promise<{ bytes: number }>;
  install(): Promise<{ status: 'started' | 'needs-permission' }>;
  installed(): Promise<{ versionCode: number; versionName?: string }>;
  addListener(ev: 'progress', cb: (p: { fraction: number; bytes: number; total: number }) => void): Promise<PluginListenerHandle>;
}

const native = Capacitor.isNativePlatform();
const plugin = native ? registerPlugin<AppUpdaterPlugin>('AppUpdater') : null;
const URL_ = __UPDATE_URL__;
const RECHECK_MS = 4 * 60 * 60 * 1000;

export const updates = $state({
  available: native && !!URL_,
  installedCode: __APP_CODE__ as number,
  manifest: null as UpdateManifest | null,
  checking: false,
  checkedAt: 0,
  /** result of the last manual check, for feedback */
  note: '' as '' | 'uptodate' | 'error' | 'nothing',
  error: '',
  phase: 'idle' as 'idle' | 'downloading' | 'ready' | 'installing' | 'needs-permission',
  progress: 0,
  downloadedCode: 0,
});

export const hasUpdate = () => !!updates.manifest && isNewer(updates.manifest, updates.installedCode);
export const whatsNew = () => (updates.manifest ? changesSince(updates.manifest, updates.installedCode) : []);
export const showBanner = () => hasUpdate() && settings.updates.dismissed !== updates.manifest!.versionCode;

export async function check(manual = false) {
  if (!updates.available || updates.checking) return;
  updates.checking = true;
  if (manual) { updates.note = ''; updates.error = ''; }
  try {
    const r = await fetch(`${URL_}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) {
      if (manual) updates.note = 'nothing';
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = parseUpdateManifest(await r.json());
    if (!m) throw new Error('version.json invalid');
    updates.manifest = m;
    updates.checkedAt = Date.now();
    if (manual && !isNewer(m, updates.installedCode)) updates.note = 'uptodate';
  } catch (e) {
    if (manual) { updates.note = 'error'; updates.error = e instanceof Error ? e.message : String(e); }
  } finally {
    updates.checking = false;
  }
}

export function dismiss() {
  if (updates.manifest) {
    settings.updates.dismissed = updates.manifest.versionCode;
    saveSettings();
  }
}

export async function install() {
  const m = updates.manifest;
  if (!plugin || !m) return;
  updates.error = '';
  try {
    if (updates.downloadedCode !== m.versionCode) {
      const url = apkUrl(URL_, m);
      if (!url) throw new Error('bad APK url');
      updates.phase = 'downloading';
      updates.progress = 0;
      const h = await plugin.addListener('progress', (p) => (updates.progress = p.fraction));
      try {
        await plugin.download({ url, sha256: m.sha256 });
      } finally {
        h.remove();
      }
      updates.downloadedCode = m.versionCode;
    }
    updates.phase = 'installing';
    const r = await plugin.install();
    updates.phase = r.status === 'needs-permission' ? 'needs-permission' : 'ready';
  } catch (e) {
    updates.phase = 'idle';
    updates.error = e instanceof Error ? e.message : String(e);
  }
}

export async function initUpdates() {
  if (!updates.available || !plugin) return;
  try {
    updates.installedCode = (await plugin.installed()).versionCode || updates.installedCode;
  } catch { /* keep build-time code */ }
  if (settings.updates.auto) check(false);
  App.addListener('resume', () => {
    if (settings.updates.auto && Date.now() - updates.checkedAt > RECHECK_MS) check(false);
    // returning from "allow installs" settings: try again automatically
    if (updates.phase === 'needs-permission') install();
  });
}
