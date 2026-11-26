# Development

## App

```bash
cd app
npm ci
npm run dev          # http://localhost:5173 (works in a desktop browser; native features are no-ops)
npm run check        # svelte-check + tsc
npm test             # vitest
npm run apk          # debug APK (needs Android SDK + JDK 21), signed with keystore.properties if present
```

Try it with the synthetic demo library (no real material needed):

```bash
python3 tools/make_demo_library.py /tmp/demo --zip /tmp/demo.zip --format mp3
```

Then *Bibliothek importieren* and pick `/tmp/demo.zip`.

## Tools (`tools/`)

| tool | does |
|---|---|
| `make_demo_library.py` | synthetic library: generated tones, drawn notation, MusicXML, all status types |
| `validate_library.py` | checks a library folder against the [format](library-format.md) |
| `build_library.py` | raw archive (zip or folder) → library; rules below |
| `test_build_library.py` | tests for the build rules on a synthetic archive |
| `privacy_check.py` | fails if git tracks media, scores, archives, keys or a library folder |
| `layout_screenshots.cjs` | screenshots of every screen at eight tablet sizes (demo library only) |

### Building a library from a raw archive

```bash
python3 -I tools/build_library.py archive.zip library    # needs ImageMagick, poppler-utils, Pillow
```

It never modifies the input and refuses to write into a non-empty folder. It keeps short training audio
(drops full recordings, video, DAW projects), converts notation to trimmed WebP, keeps editable sources
in `extras/`, and classifies files by name. The rules are broad on purpose: German and English names,
typos in role words, performer-named recordings, copy suffixes ("Kopie", "copy", "(1)"), scans and
screenshots, paged exports, malformed model numbers. Whatever it cannot place is listed in
`_report.md`. Check that report after every build.

## Rules for contributions

- **Never commit teaching material**: no audio, scores, notation images, PDFs, Sibelius files, zips, and
  no `library/` folder. Tests and screenshots use the synthetic demo library only. CI runs
  `tools/privacy_check.py` on every push.
- No signing keys, `keystore.properties`, `local.properties` or tokens.
- UI strings go through `app/src/lib/i18n.ts` (German first, English second).
- Library format changes update [library-format.md](library-format.md) and the `schema` number.
- Model ids are stable keys; never derive meaning from folder names.
