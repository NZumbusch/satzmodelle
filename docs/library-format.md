# Library format (schema 2)

The **library** is a folder (or zip) of exercises that the app imports and keeps on the device.
Teaching material usually belongs to someone else: it is never part of this repository or the app
binary. You bring your own library, build one with `tools/build_library.py`, or make exercises in the
app from MusicXML. A synthetic example: `python3 tools/make_demo_library.py demo --zip demo.zip`.

Schema 2 = schema 1 plus the optional `scores` list (MusicXML). Schema 1 manifests stay valid.

```
library/
  library.json                      index (generated, optional - the app can rebuild it by scanning)
  README-PRIVATE.txt                copyright notice (written by build_library.py)
  <cat>_<slug>/                     one folder per category, e.g. 02.1_fauxbourdon/
    <id>_<composer>_<title>/        one folder per model; the name is free, the app reads model.json
      model.json                    manifest (below)
      audio/                        training audio (mp3 / m4a)
      notation/                     WebP images: start, solution, degrees ...
      score/                        MusicXML (.musicxml/.xml/.mxl), optional, schema 2
      extras/                       editable sources (.sib, .docx, .pptx ...) - ignored by the trainer
```

**Rule for the app importer:** every folder that contains a `model.json` is a model. Folder names
carry no meaning. That is what makes "any folder set up in this way" work, including future material.

## model.json

```jsonc
{
  "schema": 2,
  "id": "S020103",              // stable key: progress, favourites and statistics refer to it
  "category": "02.1",           // see library.json -> categories
  "kind": "model",              // model | warmup (Vorübung) | overview (not practised)
  "title": "Beispielstück, T. 1-8",
  "composer": "Beispiel",       // optional
  "key": "C-Dur",               // key of the task audio (shown as hint 1)
  "status": "complete",         // complete | original-only | skeleton-only | notation-only | sources-only
  "trainable": true,            // has task or original audio
  "difficulty": null,           // 1-5, null = inherit difficulty_default of the category
  "tags": [],
  "audio": [
    { "file": "audio/task_C-Dur.mp3", "role": "task", "tempo": "normal", "key": "C-Dur",
      "label": "", "duration_s": 25.8, "src": "<original file name>" }
  ],
  "notation": [ { "file": "notation/start.webp", "role": "start", "src": "..." } ],
  "scores": [ { "file": "score/task.musicxml", "role": "task", "start_measures": 2 } ],   // schema 2, optional
  "extras":   [ { "file": "extras/Partitur.sib", "kind": "sib" } ],
  "source": "<original folder>",
  "id_inferred": true           // only if the id was not in the original folder name
}
```

### Audio roles

| role       | meaning                                                                | shown       |
|------------|------------------------------------------------------------------------|-------------|
| `task`     | the *Diminution*: what you listen to and play by ear (also Vorübung audio and the numbered teaching clips) | from the start |
| `skeleton` | the *Gerüst(satz)*: voice-leading skeleton without diminution          | partial solution |
| `original` | recording excerpt of the real piece                                     | after solution |
| `sample`   | a sample *student solution* ("Mögliche Lösung")                       | after solution |
| `other`    | unclassified - see `_report.md`                                         | after solution |

Extra fields: `tempo` = `slow` \| `normal` \| `fast` (from "langsam"/"schnell"), `key`, `label`
(free variant text such as "Klavier", "Cembalo", "mit Kadenz", "T. 1-4"), `order` + `group: "clips"`
for numbered clip series, `duration_s` (approximate).

### Notation roles (all WebP, trimmed, max 2400 px wide)

| role            | meaning                                                  |
|-----------------|----------------------------------------------------------|
| `start`         | *Anfang*: the first notes - the entry hint               |
| `task_sheet`    | the blank / partly filled worksheet (*Aufgabe*)          |
| `degrees`       | Stufen (roman numerals) of the model - partial solution  |
| `degrees_keyed` | same, with the key named ("Fauxbourdon in g-Moll")       |
| `solution`      | full score / *Lösung*                                    |
| `reference`     | other score or lead sheet for reference                  |

## Default hint ladder

1. **Aufgabe** - task audio only (title, composer, model name hidden in blind mode)
2. **Tonart** - `key`
3. **Anfang** - `start` notation, or `task_sheet`
4. **Stufen** - `degrees` / `degrees_keyed`
5. **Gerüst** - `skeleton` audio
6. **Lösung** - `solution` notation, then `original` / `sample` audio and title, composer, model name

The ladder is configuration in the app, not part of the data.

## Adding new material

1. Make a folder anywhere below the library root, add audio/notation/MusicXML files.
2. Either write a `model.json` by hand, or let `tools/build_library.py` classify the files by name:
   `Gerüst*` = skeleton, `Diminution*` = task, `Original*` = original, `Anfang*` = start,
   `Partitur*`/`Lösung*` = solution, `Aufgabe*` = task sheet, `*langsam`/`*schnell` = tempo,
   `C-Dur`/`fis-Moll` in the name = key.
3. IDs must be unique. Category folders use `NN.N`.

## Scores (MusicXML, schema 2)

`scores` lists MusicXML files (exported e.g. from Dorico, MuseScore or Sibelius). The app renders them
(OpenSheetMusicDisplay, transposable) and synthesises audio from them, so tempo and key can be changed
without any loss.

| role       | used as                                                                      |
|------------|------------------------------------------------------------------------------|
| `task`     | the Diminution: generated task audio; first `start_measures` bars (default 2) are the "Anfang" hint; full score is the solution unless a `solution` score exists |
| `skeleton` | Gerüst: rendered and played in the Gerüst step                               |
| `solution` | rendered in the solution step                                                |
| `reference`| rendered in the solution step                                                |

A model whose only task material is a `task` score is trainable. If both recordings and a task score
exist, the setting "Audioquelle" decides which plays first. Repeats are played as written (not expanded).
Schema 1 reserved a single `"score": {...}` object; the app still accepts it.

Exercises made in the app ("Eigene Übungen", category `U`) use the same structure; they are stored in the
app, not in the library, and are never touched by library imports.

## Privacy

The library lives only in the app's private storage on the device (Android: app-private data
directory, not visible in the gallery or music player, excluded from Android backups). Nothing is sent
anywhere unless the user turns it on: Google Drive sync goes to the hidden app folder of the user's own
Drive ([google-drive.md](google-drive.md)); backups are files the user saves. No analytics.
