<script lang="ts">
  import Player from './Player.svelte';
  import Notation from './Notation.svelte';
  import { effectiveDifficulty, isPracticable } from '../lib/library';
  import { lib, t, go, reloadLibrary } from '../lib/state.svelte';
  import { putOverride, putUserFile } from '../lib/db';
  import { tracksFor, filePath, scoreTracks } from '../lib/labels';
  import ScoreView from './ScoreView.svelte';
  import Recorder from './Recorder.svelte';
  import { modelKey } from '../lib/library';
  import { scheduleSync } from '../lib/sync.svelte';
  import type { I18nKey } from '../lib/i18n';
  import type { AudioRole } from '../lib/types';

  let { id }: { id: string } = $props();

  const m = $derived(lib.byId.get(id));
  const raw = $derived(lib.raw.find((x) => x.id === id));
  const cat = $derived(m ? lib.catMap.get(m.category) : undefined);
  const progress = $derived(lib.progress.get(id));

  let editing = $state(false);
  let title = $state('');
  let composer = $state('');
  let difficulty = $state<string>('');
  let addRole = $state<AudioRole>('task');
  let semitones = $state(0);

  function edit() {
    if (!m) return;
    const o = lib.overrides.get(id);
    title = o?.title ?? m.title;
    composer = o?.composer ?? m.composer ?? '';
    difficulty = o?.difficulty != null ? String(o.difficulty) : raw?.difficulty != null ? String(raw.difficulty) : '';
    editing = true;
  }

  async function save() {
    const o = { ...(lib.overrides.get(id) ?? { id }) };
    o.title = title.trim() && title.trim() !== raw?.title ? title.trim() : undefined;
    o.composer = composer.trim() !== (raw?.composer ?? '') ? composer.trim() : undefined;
    o.difficulty = difficulty === '' ? (raw?.difficulty != null ? null : undefined) : Number(difficulty);
    await putOverride($state.snapshot(o));
    await reloadLibrary();
    scheduleSync();
    editing = false;
  }

  async function addAudio() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const path = `user/${id}/added/${Date.now()}_${f.name}`;
      await putUserFile(path, f);
      const o = { ...(lib.overrides.get(id) ?? { id }) };
      o.addedAudio = [...(o.addedAudio ?? []), { file: path, role: addRole, tempo: 'normal', label: f.name.replace(/\.[^.]+$/, ''), src: f.name }];
      await putOverride($state.snapshot(o));
      await reloadLibrary();
      scheduleSync();
    };
    input.click();
  }
</script>

{#if m}
  <article class="detail">
    <section class="card">
      <div class="head">
        <div>
          <p class="muted small">{m.id} · {m.category} {cat?.title ?? ''}</p>
          <h2>{m.composer ? `${m.composer}: ` : ''}{m.title}</h2>
          <p class="muted small">
            {t(`lib.status.${m.status}` as I18nKey)}
            {#if m.key} · {m.key}{/if}
            · {t('lib.difficulty')} ★{effectiveDifficulty(m, lib.catMap)}
            · {progress?.attempts.length ? t('lib.attempts', { n: progress.attempts.length }) : t('lib.never')}
          </p>
        </div>
        <div class="row">
          {#if isPracticable(m)}
            <button class="btn primary" onclick={() => go({ name: 'practice', ids: [m.id] })}>{t('lib.practiceThis')}</button>
          {/if}
          {#if m.pack === 'user'}
            <button class="btn" onclick={() => go({ name: 'editor', id: m.id })}>{t('lib.edit')}</button>
          {:else}
            <button class="btn" onclick={edit}>{t('lib.edit')}</button>
          {/if}
        </div>
      </div>

      {#if editing}
        <form class="edit" onsubmit={(e) => { e.preventDefault(); save(); }}>
          <label>{t('lib.title.field')}<input bind:value={title} /></label>
          <label>{t('lib.composer.field')}<input bind:value={composer} /></label>
          <label>{t('lib.difficulty')}
            <select bind:value={difficulty}>
              <option value="">{t('lib.difficulty.inherit', { n: cat?.difficulty_default ?? 3 })}</option>
              {#each [1, 2, 3, 4, 5] as d}<option value={String(d)}>{d}</option>{/each}
            </select>
          </label>
          <div class="row">
            <button class="btn primary" type="submit">{t('lib.save')}</button>
            <button class="btn" type="button" onclick={() => (editing = false)}>{t('lib.cancel')}</button>
          </div>
        </form>
      {/if}
    </section>

    <section class="card">
      <div class="head">
        <h3>{t('lib.audio')}</h3>
        <div class="row">
          <select bind:value={addRole} aria-label={t('lib.addAudio.role')}>
            {#each ['task', 'skeleton', 'original', 'sample', 'other'] as const as r}<option value={r}>{t(`role.${r}`)}</option>{/each}
          </select>
          <button class="btn" onclick={addAudio}>{t('lib.addAudio')}</button>
        </div>
      </div>
      {#if m.audio.length || m.scores?.length}
        <Player tracks={[...tracksFor(m, m.audio, { showRole: true, showKey: true }), ...scoreTracks(m, m.scores ?? [], { showRole: true })]}
          bind:semitones baseKey={modelKey(m)} showKey title={m.title} memoryKey={m.id} />
      {/if}
    </section>

    {#each m.scores ?? [] as sc (sc.file)}
      <section class="card">
        <h3>{t(`role.${sc.role === 'task' || sc.role === 'skeleton' ? sc.role : 'other'}` as I18nKey)} · MusicXML</h3>
        <ScoreView path={filePath(m, sc.file)} {semitones} />
      </section>
    {/each}

    <section class="card">
      <h3>{t('rec.title')}</h3>
      <Recorder modelId={m.id} />
    </section>

    {#if m.notation.length}
      <section class="card">
        <h3>{t('lib.notation')}</h3>
        <div class="notes">
          {#each m.notation as n (n.file)}
            <figure>
              <figcaption class="muted small">{t(`nrole.${n.role}` as I18nKey)}{n.label ? ` · ${n.label}` : ''}</figcaption>
              <Notation path={filePath(m, n.file)} alt={t(`nrole.${n.role}` as I18nKey)} />
            </figure>
          {/each}
        </div>
      </section>
    {/if}

    {#if m.extras?.length}
      <section class="card">
        <h3>{t('lib.extras')}</h3>
        <ul class="muted small">{#each m.extras as x}<li>{x.file.split('/').pop()}</li>{/each}</ul>
      </section>
    {/if}

    {#if progress?.attempts.length}
      <section class="card">
        <h3>{t('lib.history')}</h3>
        <ul class="hist">
          {#each [...progress.attempts].reverse().slice(0, 20) as a}
            <li><span class="dot {a.rating}"></span> {new Date(a.at).toLocaleString()} · {t(`practice.rate.${a.rating}`)} · {a.hintsUsed}</li>
          {/each}
        </ul>
      </section>
    {/if}
  </article>
{/if}

<style>
  .detail { display: flex; flex-direction: column; gap: 14px; }
  .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 8px; }
  h2 { margin: 2px 0; font-size: 20px; }
  h3 { margin: 0; font-size: 17px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .edit { display: grid; gap: 10px; max-width: 480px; margin-top: 10px; }
  .edit label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  .notes { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; margin-top: 8px; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .hist { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
  .small { font-size: 13px; margin: 0; }
  .muted { color: var(--muted); }
</style>
