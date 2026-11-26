// Native integration (Android via Capacitor). Everything degrades to no-ops in a browser.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { back } from './state.svelte';

interface BackgroundPlugin {
  update(o: { title: string; playing: boolean }): Promise<void>;
  stop(): Promise<void>;
  addListener(ev: 'action', cb: (e: { action: string }) => void): Promise<PluginListenerHandle>;
}

interface DriveAuthPlugin {
  authorize(o: { interactive: boolean }): Promise<{ accessToken: string; email?: string }>;
  signOut(o: { accessToken?: string }): Promise<void>;
  info(): Promise<{ packageName: string; sha1: string }>;
}

const native = Capacitor.isNativePlatform();
const bg = native ? registerPlugin<BackgroundPlugin>('BackgroundAudio') : null;

export const Background = {
  update(o: { title: string; playing: boolean }) {
    bg?.update(o).catch(() => {});
  },
  stop() {
    bg?.stop().catch(() => {});
  },
};

export const DriveAuth = native ? registerPlugin<DriveAuthPlugin>('DriveAuth') : null;

interface FileExportPlugin {
  create(o: { name: string }): Promise<{ handle: string }>;
  write(o: { handle: string; data: string }): Promise<void>;
  close(o: { handle: string }): Promise<void>;
}
const fileExport = native ? registerPlugin<FileExportPlugin>('FileExport') : null;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Save a (large) blob as a file the user picks. Returns false if cancelled. */
export async function saveFile(blob: Blob, name: string, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  if (!fileExport) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  let handle: string;
  try {
    handle = (await fileExport.create({ name })).handle;
  } catch {
    return false;
  }
  const CH = 3 * 1024 * 1024; // multiple of 3: base64 chunks concatenate cleanly
  try {
    for (let o = 0; o < blob.size; o += CH) {
      const part = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer());
      await fileExport.write({ handle, data: toBase64(part) });
      onProgress?.(Math.min(blob.size, o + CH), blob.size);
    }
  } finally {
    await fileExport.close({ handle });
  }
  return true;
}

export function isNative() {
  return native;
}

export async function initNative() {
  if (!native) return;
  App.addListener('backButton', () => {
    if (!back()) App.minimizeApp();
  });
  const { handleRemote } = await import('./playback');
  bg?.addListener('action', (e) => handleRemote(e.action));
  const { initUpdates } = await import('./updates.svelte');
  initUpdates();
  const { syncNow } = await import('./sync.svelte');
  syncNow(false);
  App.addListener('resume', () => syncNow(false));
  // ask the WebView to keep IndexedDB data even under storage pressure
  navigator.storage?.persist?.().catch(() => {});
}
