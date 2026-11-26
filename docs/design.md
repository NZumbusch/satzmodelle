# Design decisions

The app is built for one way of practising: **hear, play back, and only then look**. These decisions
follow from that and from feedback while using it on a tablet.

## Practising

- **The answer stays hidden.** The practice screen shows "Aufgabe 3 von 12" and the player; the piece,
  composer and (in blind mode, the default) the model name appear only in the last hint step. Choosing
  categories in the filter is a deliberate spoiler; the piece is not.
- **Hints in a fixed, configurable order**: key, opening, degrees, skeleton, score, original. This is the
  usual way of working through a play-back dictation: form, model, opening notes, skeleton, diminution,
  comparison with the score. The solution step asks for confirmation.
- **Self-rating instead of scoring.** "Geschafft / Teilweise / Noch nicht" is honest and fast; the
  "not yet secure" filter brings weak pieces back.
- **Spaced repetition is one option of the order, not a separate mode.** The filter chooses the pool;
  "Wiederholung" chooses what comes up today: all due pieces with up to five new ones mixed in. After
  that, "Weiter üben" brings the remaining new pieces, and once everything has been practised, the
  pieces practised longest ago. The schedule (SM-2 style: 1 day, 3 days, then × ease; "Noch nicht"
  resets, "Teilweise" barely grows, hints shrink the step) is computed from the rating history, so
  nothing extra is stored or synced.
- **Statistics stay simple and honest.** A piece is *sicher / wackelig / unsicher / neu* from its last
  five attempts (newest weigh most, every hint used costs a little). In blind mode the statistics show
  ids and models, not piece names. Chart colours are validated for colour-vision deficiency and always
  come with labels.

## Player

- **Markers instead of an A–B loop.** You listen, tap where sections start, name them, and practise
  section by section. "Abschnitt wiederholen" loops the current section until you pause.
- **No repeat counts, no automatic key cycling.** Both were tried and removed: pressing play again is
  simpler, and transposing by hand is enough.
- **A minimal player.** Visible are only transport, waveform and markers. Tempo, transposition, count-in
  and volume live in one options panel (sliders icon next to the time); while something differs from the
  default the icon is highlighted and small badges show tempo and key.
- **The hint bar never changes shape.** "Next hint", the confirmation before the solution and "all
  revealed" are the same box with different content; the rating buttons share the width evenly.
- **Speed keeps the pitch, transposition keeps the speed.** For MusicXML the app re-renders in the new
  key (exact); recordings are pitch-shifted.

## Material and privacy

- **No material in the app or the repository.** Teaching material usually belongs to its author. The
  app imports a library at runtime into private storage; CI blocks media and score files in git.
- **Folder names mean nothing; `model.json` is the truth.** Model ids are the stable keys for progress,
  edits and markers, so libraries can be rebuilt, renamed and extended.
- **Own exercises come from MusicXML** (Dorico, MuseScore, Sibelius export). A note-entry editor may follow.
- **Everything online is opt-in and private**: Drive sync uses the hidden app folder of the user's own
  Drive; the update check only fetches a small version file.

## Platform

- **Svelte + Capacitor**: one small web code base, native where it matters (background audio, file
  saving, Google sign-in, installing updates). iOS stays possible.
- **Tablet first** (landscape and portrait, 8–13"), phone layout works. German UI, English optional.
