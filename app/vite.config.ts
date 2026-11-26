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

// The update check fetches version.json from another origin: the page's Content-Security-Policy
// (connect-src in index.html) must allow exactly that origin, or the fetch fails.
function allowUpdateOrigin() {
  const url = updateUrl();
  return {
    name: 'allow-update-origin',
    transformIndexHtml(html: string) {
      if (!url) return html;
      const origin = new URL(url).origin;
      return html.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), allowUpdateOrigin()],
  define: {
    __APP_VERSION__: JSON.stringify(version.versionName),
    __APP_CODE__: JSON.stringify(version.versionCode),
    __APP_COMMIT__: JSON.stringify(version.commit),
    __UPDATE_URL__: JSON.stringify(updateUrl()),
  },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
