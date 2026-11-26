# Releases and updates

Every push to `main` builds the app and a signed APK and publishes them on GitHub Pages:

```
https://<owner>.github.io/<repo>/                  download page
https://<owner>.github.io/<repo>/android/app.apk
https://<owner>.github.io/<repo>/android/version.json
```

The installed app reads `version.json` (on start and every few hours, can be turned off), shows
"Update verfügbar" with the changes since the installed build, downloads the APK, checks its SHA-256
and opens Android's installer. No store, no server.

## Versions

`app/scripts/app-version.mjs` is the only rule, used by Vite, Gradle and CI:

- `versionCode` = **100 + number of commits** on the branch (`git rev-list --count HEAD`).
- `versionName` = `1.0.<number of commits>`.

Android installs an update only when its `versionCode` is higher. **Never change this rule** once the
app is installed somewhere. CI needs the full history (`fetch-depth: 0`).

## Signing

Android installs an update only when it is signed with the **same key** as the installed app. If the
key is lost, installed copies can never be updated, only uninstalled (which deletes their data).

- Keep the keystore backed up in two places outside your computer. GitHub secrets cannot be read back.
- The Google Drive OAuth client is tied to the key's SHA-1 as well.
- Local builds: `app/android/keystore.properties` (gitignored) with `storeFile`, `storePassword`,
  `keyAlias`, `keyPassword`. Without it, debug builds use Android's debug key and cannot update a
  release install.

## One-time GitHub setup

1. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
2. *Settings → Secrets and variables → Actions → New repository secret*, four times:
   - `ANDROID_KEYSTORE_BASE64`: `base64 -w0 your.jks` (macOS: `base64 -i your.jks`)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
3. Push to `main` (or run the workflow by hand). The run shows the page URL.

Without the secrets the workflow still runs tests and publishes the page, just without an APK.

## Workflow (`.github/workflows/deploy.yml`)

`build` job: privacy check → `npm ci`, type check, tests, web build → decode the key to `$RUNNER_TEMP`
and verify it → `cap sync` → `gradlew assembleRelease` → `app/scripts/write-update-manifest.mjs` (copies
the APK, writes `version.json` with versionCode, versionName, sha256, size, date, commit and the last
30 commit subjects) → key removed (`if: always()`) → Pages artifact. `deploy` job (separate, to avoid a
race in `deploy-pages`): publish; fail the run if the APK step failed.

## Checklist after a release

- The run is green, `android/version.json` shows the new versionCode.
- An installed older build shows "Update verfügbar", downloads with progress, asks once for
  "install unknown apps", installs over itself and keeps its data.
