# Architecture

```
app/
├── src/
│   ├── App.svelte              shell: header, tabs, routing (a small stack in state.svelte.ts)
│   ├── components/             screens and widgets
│   │   ├── StartScreen         filter -> session
│   │   ├── Practice            task player, hint ladder, recorder, rating
│   │   ├── Player              waveform, markers, speed, transposition (one per track list)
│   │   ├── ScoreView           MusicXML via OpenSheetMusicDisplay (lazy-loaded)
│   │   ├── StatsScreen         statistics page (CSS/SVG-free bar charts, tap readouts)
│   │   ├── LibraryBrowser, ModelDetail, ExerciseEditor, Settings, UpdateCard, …
│   └── lib/                    logic, mostly framework-free and unit-tested
└── android/                    Capacitor project; native plugins in app/src/main/java/…
```

## Data

Everything lives in **IndexedDB** in the WebView's private storage (`lib/db.ts`):

| store | content |
|---|---|
| `files` | library files, keyed `<packId>/<path>` |
| `models` | parsed `model.json` per id, with the pack it came from (`user` = own exercises) |
| `packs` | one entry per import (name, date, categories) |
| `progress` | attempts per model id, plus piece details so removed pieces can still be named |
| `overrides` | the user's edits of a model: title, difficulty, added audio, **markers** |
| `userfiles` | files the user added (own exercises, added audio) |
| `recordings` | recorded attempts |

Settings are small and live in `localStorage` (`lib/state.svelte.ts`).

## Main modules (`app/src/lib`)

| module | does |
|---|---|
| `library.ts` | manifest parsing, filter, hint ladder, task/score selection (pure, tested) |
| `importer.ts` | streaming zip import (fflate), folder import, packs; finds the library root by `library.json` / `model.json` |
| `player.ts` | audio engine: decoded buffer → SoundTouch (tempo, pitch) → gain; seek, section loop, count-in |
| `sources.ts` | track sources: file, blob (recording) or score (synthesised and cached per transposition) |
| `musicxml.ts`, `synth.ts` | MusicXML parser (partwise, ties, chords, backup/forward, tempo map) and offline synthesiser |
| `markers.ts` | markers per track, sections between markers |
| `own.ts` | exercises made in the app |
| `progress.ts`, `drive.ts`, `sync.svelte.ts` | progress merge (conflict-free), Drive REST, sync triggers |
| `units.ts`, `syncplan.ts`, `fullsync.ts` | full sync: packs, own exercises, edits, recordings as zip units; plan with tombstones |
| `backup.ts`, `zipwriter.ts` | backup of everything; a stored-zip writer that streaming readers can unpack |
| `updater.ts`, `updates.svelte.ts` | self-update: manifest check, download with SHA-256, install |
| `stats.ts` | statistics: confidence per piece (recent attempts weighted, hints cost a little), per-model summaries, hint histogram, weeks, streak (pure, tested) |
| `i18n.ts` | all UI strings, German and English |

## Native plugins (Java, `android/app/src/main/java/…`)

| plugin | does |
|---|---|
| `BackgroundAudioPlugin` + `PlaybackService` | media foreground service: playback continues in the background, notification and lock-screen controls |
| `DriveAuthPlugin` | Google authorization for the Drive app folder only (`drive.appdata`) |
| `FileExportPlugin` | save a large file (backup) where the user picks, via the Storage Access Framework |
| `AppUpdaterPlugin` | download an APK over https with SHA-256 check, open Android's installer |

## Audio

Recordings are decoded once and played through SoundTouch in a ScriptProcessor, which gives speed
without pitch change and pitch shifting in one place. Scores are rendered to an AudioBuffer with an
OfflineAudioContext; a transposition re-renders them exactly instead of pitch-shifting. Positions are
kept in seconds of the original, so markers stay valid at any speed.

## Tests

`vitest` runs the logic tests in Node (fake IndexedDB, happy-dom for the XML parser). Python tests cover
the library tools with synthetic data. See [development.md](development.md).
