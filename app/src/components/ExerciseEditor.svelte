<script lang="ts">
  // Make your own exercise from a MusicXML export (Dorico, MuseScore, Sibelius ...), optionally with recordings.
  import ScoreView from './ScoreView.svelte';
  import FilePick from './FilePick.svelte';
  import Player from './Player.svelte';
  import { lib, t, back, replace, reloadLibrary } from '../lib/state.svelte';
  import { musicXmlText, parseMusicXml, beatToSeconds, type Score } from '../lib/musicxml';
  import { saveOwn, deleteOwn, OWN_CATEGORY, type OwnDraft } from '../lib/own';
  import { forgetScores } from '../lib/sources';
  import { fmtTime } from '../lib/player';
  import { putUserFile, db } from '../lib/db';
  import { onDestroy } from 'svelte';
  import { scheduleSync } from '../lib/sync.svelte';

  let { id }: { id?: string } = $props();

  const existing = $derived(id ? lib.byId.get(id) : undefined);

  let title = $state('');
  let composer = $state('');
  let category = $state(OWN_CATEGORY);
  let key = $state('');
  let difficulty = $state<string>('');
  let startMeasures = $state(2);
  let files = $state<Partial<Record<'taskScore' | 'skeletonScore' | 'solutionScore' | 'taskAudio' | 'skeletonAudio' | 'degreesImage', File | null>>>({});
  let info = $state<Score | null>(null);
  let error = $state('');
  let saving = $state(false);
  let previewPath = $state<string | null>(null);

  $effect(() => {
    const m = existing;
    if (!m) return;
    title = m.title; composer = m.composer ?? ''; category = m.category; key = m.key ?? '';
    difficulty = m.difficulty == null ? '' : String(m.difficulty);
    startMeasures = m.scores?.find((x) => x.role === 'task')?.start_measures ?? 2;
  });

  const has = (role: string, kind: 'score' | 'audio' | 'image') => {
    const m = existing;
    if (!m) return false;
    if (kind === 'score') return !!m.scores?.some((x) => x.role === role);
    if (kind === 'audio') return m.audio.some((x) => x.role === role);
    return m.notation.some((x) => x.role === role);
  };

  async function readScore(f: File): Promise<Score> {
    return parseMusicXml(musicXmlText(new Uint8Array(await f.arrayBuffer())));
  }

  async function pickScore(slot: 'taskScore' | 'skeletonScore' | 'solutionScore', ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    error = '';
    try {
      const s = await readScore(f);
      files[slot] = f;
      if (slot === 'taskScore') {
        info = s;
        if (!title && s.title) title = s.title;
        if (!composer && s.composer) composer = s.composer;
        if (!key && s.key) key = s.key;
        // preview: store temporarily under a scratch path
        const p = `user/_preview/${Date.now()}`;
        await putUserFile(p, f);
        forgetScores();
        previewPath = p;
      }
    } catch (e) {
      error = t('editor.badScore', { msg: e instanceof Error ? e.message : String(e) });
      (ev.target as HTMLInputElement).value = '';
    }
  }

  function pickFile(slot: 'taskAudio' | 'skeletonAudio' | 'degreesImage', ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) files[slot] = f;
  }

  const canSave = $derived(!!(files.taskScore || files.taskAudio || has('task', 'score') || has('task', 'audio')));

  async function save() {
    if (!canSave) return;
    saving = true;
    try {
      const draft: OwnDraft = {
        title, composer, category, key, difficulty: difficulty === '' ? null : Number(difficulty), startMeasures,
        ...$state.snapshot(files) as Partial<OwnDraft>,
      };
      // File objects do not survive $state.snapshot as Files in every engine: take them directly
      for (const k of Object.keys(files) as (keyof typeof files)[]) (draft as unknown as Record<string, unknown>)[k] = files[k];
      const m = await saveOwn(draft, existing);
      forgetScores();
      await reloadLibrary();
      scheduleSync();
      replace({ name: 'model', id: m.id });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onDestroy(async () => {
    (await db()).delete('userfiles', IDBKeyRange.bound('user/_preview/', 'user/_preview/\uffff')).catch(() => {});
  });

  async function remove() {
    if (!existing || !confirm(t('editor.delete.confirm'))) return;
    await deleteOwn(existing.id);
    await reloadLibrary();
    scheduleSync();
    back();
    back();
  }

  const cats = $derived([{ id: OWN_CATEGORY, title: t('own.category') }, ...lib.categories.filter((c) => c.id !== OWN_CATEGORY)]);
</script>

<form class="editor" onsubmit={(e) => { e.preventDefault(); save(); }}>
  <section class="card">
    <h2>{existing ? t('editor.editTitle') : t('editor.newTitle')}</h2>
    <p class="muted small">{t('editor.intro')}</p>

    <div class="file main">
      <span class="two"><b>{t('editor.taskScore')}</b><span class="muted small">{t('editor.taskScore.desc')}</span></span>
      <span class="pickcell">
        <FilePick accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
          onpick={(e) => pickScore('taskScore', e)} name={files.taskScore?.name ?? null} />
        {#if has('task', 'score') && !files.taskScore}<span class="badge">{t('editor.present')}</span>{/if}
      </span>
    </div>
    {#if info}
      <p class="muted small">{t('editor.scoreInfo', { measures: info.measures.length, parts: info.parts.length, notes: info.notes.length, time: fmtTime(beatToSeconds(info, info.beats)) })}</p>
    {/if}
    {#if error}<p class="err">{error}</p>{/if}
  </section>

  {#if previewPath}
    <section class="card">
      <h3>{t('editor.preview')}</h3>
      <ScoreView path={previewPath} />
      <Player tracks={[{ label: t('player.generated'), source: { kind: 'score', path: previewPath } }]} compact />
    </section>
  {/if}

  <section class="card grid">
    <label>{t('lib.title.field')}<input bind:value={title} required /></label>
    <label>{t('lib.composer.field')}<input bind:value={composer} /></label>
    <label>{t('editor.category')}
      <select bind:value={category}>
        {#each cats as c (c.id)}<option value={c.id}>{c.id === OWN_CATEGORY ? c.title : `${c.id} ${c.title}`}</option>{/each}
      </select>
    </label>
    <label>{t('step.key')}<input bind:value={key} placeholder="a-Moll" /></label>
    <label>{t('lib.difficulty')}
      <select bind:value={difficulty}>
        <option value="">–</option>
        {#each [1, 2, 3, 4, 5] as d}<option value={String(d)}>{d}</option>{/each}
      </select>
    </label>
    <label>{t('editor.startMeasures')}
      <select bind:value={startMeasures}>{#each [1, 2, 3, 4] as n}<option value={n}>{n}</option>{/each}</select>
    </label>
  </section>

  <section class="card">
    <h3>{t('editor.optional')}</h3>
    <p class="muted small">{t('editor.optional.desc')}</p>
    {#each [
      ['skeletonScore', 'editor.skeletonScore', '.musicxml,.xml,.mxl', 'skeleton', 'score'],
      ['solutionScore', 'editor.solutionScore', '.musicxml,.xml,.mxl', 'solution', 'score'],
      ['taskAudio', 'editor.taskAudio', 'audio/*', 'task', 'audio'],
      ['skeletonAudio', 'editor.skeletonAudio', 'audio/*', 'skeleton', 'audio'],
      ['degreesImage', 'editor.degreesImage', 'image/*', 'degrees', 'image'],
    ] as const as [slot, label, accept, role, kind]}
      <div class="file">
        <span>{t(label)}</span>
        <span class="pickcell">
          <FilePick {accept} name={files[slot]?.name ?? null}
            onpick={(e) => (kind === 'score' ? pickScore(slot as 'skeletonScore', e) : pickFile(slot as 'taskAudio', e))} />
          {#if has(role, kind) && files[slot] === undefined}
            <span class="badge">{t('editor.present')}</span>
            <button type="button" class="chip" onclick={() => (files[slot] = null)}>{t('editor.remove')}</button>
          {:else if files[slot] === null}
            <span class="badge warn">{t('editor.removed')}</span>
          {/if}
        </span>
      </div>
    {/each}
  </section>

  <div class="row">
    <button class="btn primary big" type="submit" disabled={!canSave || saving}>{t('lib.save')}</button>
    <button class="btn" type="button" onclick={back}>{t('lib.cancel')}</button>
    {#if existing}<button class="btn bad" type="button" onclick={remove}>{t('editor.delete')}</button>{/if}
  </div>
</form>

<style>
  .editor { display: flex; flex-direction: column; gap: 14px; max-width: 900px; }
  h2 { margin: 0 0 4px; font-size: 20px; }
  h3 { margin: 0 0 10px; font-size: 17px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  .file { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); align-items: center; gap: 8px 16px;
    padding: 10px 0; border-bottom: 1px solid var(--line); color: var(--text); font-size: 15px; }
  .file:last-child { border-bottom: 0; }
  .file.main { border: 0; padding-top: 4px; }
  .pickcell { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .two { display: flex; flex-direction: column; gap: 2px; }
  @media (max-width: 640px) { .file { grid-template-columns: 1fr; } }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .err { color: var(--bad); }
  .small { font-size: 13px; }
  .muted { color: var(--muted); }
</style>
