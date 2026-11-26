import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { appVersion } from './scripts/app-version.mjs';

const version = appVersion();
// Where the installed app looks for updates. CI derives it from the repository (GitHub Pages);
// UPDATE_URL overrides it; empty = no update check (local builds).
function updateUrl(): string {
  if (process.env.UPDATE_URL !== undefined) return process.env.UPDATE_URL;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return '';
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/android/version.json`;
}

export default defineConfig({
  base: './',
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(version.versionName),
    __APP_CODE__: JSON.stringify(version.versionCode),
    __APP_COMMIT__: JSON.stringify(version.commit),
    __UPDATE_URL__: JSON.stringify(updateUrl()),
  },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
