# Working agreement for AI-assisted changes

Start with `README.md`, then `docs/architecture.md` and `docs/design.md`.

## Hard rules

* **This repository is public. Never commit teaching material**: no audio, scores, notation images, PDFs,
  `.sib`/MusicXML files from a real library, zips, or a `library/` folder. Never quote content from a
  real library in code, tests, docs, commit messages or screenshots. Tests, fixtures and screenshots use
  only the synthetic demo library (`tools/make_demo_library.py`). `tools/privacy_check.py` must pass.
* If the owner provides a real library in a session, use it only to test locally; do not copy any of it
  anywhere and do not send it to any service.
* No signing keys, `keystore.properties`, tokens or personal data in git.
* Do not change the versionCode rule or the signing key (see `docs/releases.md`).
* `tools/build_library.py` must never modify its input.
* Decisions in `docs/design.md` are the owner's; do not reopen them. When something is the owner's
  decision, ask instead of guessing.

## Conventions

* Model ids (`S010101`) are the stable keys; never derive meaning from folder names.
* UI text in German first, English second, via `app/src/lib/i18n.ts`. No hard-coded strings.
* Library format changes update `docs/library-format.md` and the `schema` number.
* The owner writes in English; content and UI are German. Answer in English unless asked otherwise.
