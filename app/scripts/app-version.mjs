#!/usr/bin/env node
// The one place that defines the app version (used by Vite, Gradle and CI).
//   versionCode = 100 + number of commits   (only ever grows; Android installs only a higher code)
//   versionName = 1.0.<number of commits>
// Never change this rule once the app is installed somewhere. The offset keeps the code above the
// builds that existed before this repository.
import { execSync } from 'node:child_process';

export const CODE_OFFSET = 100;

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export function appVersion() {
  const count = Number(git('rev-list --count HEAD')) || 0;
  return {
    versionCode: CODE_OFFSET + count,
    versionName: `1.0.${count}`,
    commit: git('rev-parse --short HEAD') || 'dev',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = appVersion();
  const arg = process.argv[2];
  if (arg === '--code') console.log(v.versionCode);
  else if (arg === '--name') console.log(v.versionName);
  else console.log(JSON.stringify(v));
}
