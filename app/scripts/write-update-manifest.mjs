#!/usr/bin/env node
// Usage: node scripts/write-update-manifest.mjs <signed.apk> <outDir>
// Copies the APK to <outDir>/app.apk and writes <outDir>/version.json, which the installed app reads.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appVersion, CODE_OFFSET } from './app-version.mjs';

const [apk, outDir] = process.argv.slice(2);
if (!apk || !outDir) {
  console.error('usage: write-update-manifest.mjs <apk> <outDir>');
  process.exit(2);
}

const git = (a) => execSync(`git ${a}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const bytes = readFileSync(apk);
const v = appVersion();

// "What's new": recent commits with the build number they first shipped in.
const changes = git('log -30 --no-merges --format=%H%x09%s')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, ...rest] = line.split('\t');
    return { versionCode: CODE_OFFSET + Number(git(`rev-list --count ${sha}`)), subject: rest.join('\t') };
  });

mkdirSync(outDir, { recursive: true });
copyFileSync(apk, join(outDir, 'app.apk'));
const manifest = {
  versionCode: v.versionCode,
  versionName: v.versionName,
  apk: 'app.apk',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  publishedAt: new Date().toISOString(),
  commit: git('rev-parse HEAD'),
  changes,
};
writeFileSync(join(outDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`version.json: ${manifest.versionName} (${manifest.versionCode}), ${manifest.size} bytes, sha256 ${manifest.sha256.slice(0, 12)}…`);
