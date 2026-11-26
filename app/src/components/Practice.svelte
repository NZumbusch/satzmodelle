<script lang="ts">
  import { untrack } from 'svelte';
  import Player from './Player.svelte';
  import Notation from './Notation.svelte';
  import ScoreView from './ScoreView.svelte';
  import Recorder from './Recorder.svelte';
  import { buildLadder, buildSession, modelKey, pickVariant, taskIsOriginal, taskPlayables, type LadderStep } from '../lib/library';
  import { lib, settings, t, back, reloadLibrary } from '../lib/state.svelte';
  import { putProgress } from '../lib/db';
  import { tracksFor, filePath, playableTracks, scoreTracks } from '../lib/labels';
  import { pieceInfo } from '../lib/progress';
  import { scheduleSync } from '../lib/sync.svelte';
  import type { I18nKey } from '../lib/i18n';
  import type { Rating } from '../lib/types';
  import { srsPlan } from '../lib/session';
  import { continueSession } from '../lib/srs';

  let { ids: initialIds, srs = false }: { ids: string[]; srs?: boolean } = $props();

  let ids = $state(untrack(() => [...initialIds]));
  let idx = $state(0);
  let revealed = $state(0);
  let results = $state<Record<string, Rating>>({});
  let finished = $state(false);
  let confirming = $state<LadderStep | null>(null);

  const model = $derived(lib.byId.get(ids[idx]));
  const ladder = $derived(model ? buildLadder(model, settings.ladder) : []);
  const playables = $derived(model ? taskPlayables(model, settings.audioSource) : []);
  const tracks = $derived(model ? playableTracks(model, playables) : []);
  const startVariant = $derived.by(() => {
    if (playables[0]?.kind === 'score') return 0;
    const audio = playables.filter((p) => p.kind === 'audio').map((p) => p.entry);
    return pickVariant(audio as never, settings.filter.tempo);
  });
  let semitones = $state(0);
  const keyShown = $derived(ladder.slice(0, revealed).some((s) => s.id === 'key' || s.id === 'reveal'));
  const notifTitle = $derived(t('practice.task', { i: idx + 1, n: ids.length }));
  const category = $derived(model ? lib.catMap.get(model.category) : undefined);
  const nextStep = $derived(ladder[revealed]);
  const allRevealed = $derived(revealed >= ladder.length);
  const showModelName = $derived(!settings.blind || allRevealed);

  function stepName(id: string) {
    return t(`step.${id}` as I18nKey);
  }

  function reveal() {
    const s = nextStep;
    if (!s) return;
    if (settings.confirmReveal && (s.id === 'solution' || s.id === 'reveal') && !confirming) {
      confirming = s;
      return;
    }
    confirming = null;
    revealed++;
    requestAnimationFrame(() => document.getElementById(`step-${revealed - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function rate(r: Rating) {
    if (!model) return;
    const prev = lib.progress.get(model.id);
    const p = {
      id: model.id,
      info: pieceInfo(model, category),
      attempts: [...(prev?.attempts ?? []), { at: new Date().toISOString(), rating: r, hintsUsed: revealed }],
    };
    await putProgress(p);
    lib.progress.set(model.id, p);
    results[model.id] = r;
    scheduleSync();
    next();
  }

  function next() {
    confirming = null;
    revealed = 0;
    semitones = 0;
    if (idx + 1 >= ids.length) finished = true;
    else idx++;
    window.scrollTo({ top: 0 });
  }

  function again() {
    ids = buildSession(ids.map((i) => lib.byId.get(i)!).filter(Boolean), settings.filter.order);
    idx = 0;
    results = {};
    finished = false;
    revealed = 0;
  }

  /** spaced repetition: what "Weiter üben" would bring now (due, then new, then the oldest) */
  const nextSrs = $derived(finished && srs ? continueSession(srsPlan(lib.models, lib.catMap, lib.progress, settings.filter)) : null);

  function continueSrs() {
    if (!nextSrs?.ids.length) return;
    ids = nextSrs.ids;
    idx = 0;
    results = {};
    revealed = 0;
    finished = false;
    window.scrollTo({ top: 0 });
  }

  async function end() {
    await reloadLibrary();
    back();
  }

  const counts = $derived.by(() => {
    const c = { yes: 0, partly: 0, no: 0 };
    for (const r of Object.values(results)) c[r]++;
    return c;
  });
</script>

{#if finished}
  <section class="card center">
    <h2>{srs ? t('srs.doneToday') : t('practice.done')}</h2>
    <p>{t('practice.summary', counts)}</p>
    <div class="row">
      {#if srs}
        {#if nextSrs?.ids.length}
          <button class="btn primary" onclick={continueSrs}>{t(`srs.continue.${nextSrs.kind}`, { n: nextSrs.ids.length })}</button>
        {/if}
      {:else}
        <button class="btn primary" onclick={again}>{t('practice.again')}</button>
      {/if}
      <button class="btn" onclick={end}>{t('practice.end')}</button>
    </div>
  </section>
{:else if model}
  <div class="practice">
    <header class="phead">
      <span class="count">{t('practice.task', { i: idx + 1, n: ids.length })}</span>
      <span class="cat">{showModelName ? (category?.title ?? model.category) : t('practice.hidden')}</span>
    </header>

    {#key model.id}
      <section class="card task">
        <h2>{t('step.task')}</h2>
        <p class="muted small">{t('practice.instructions')}</p>
        {#if taskIsOriginal(model)}<p class="muted small">{t('practice.originalAsTask')}</p>{/if}
        <Player tracks={tracks} initial={Math.max(0, startVariant)} memoryKey={model.id} bind:semitones
          baseKey={modelKey(model)} showKey={keyShown} title={notifTitle} />
      </section>

      {#each ladder.slice(0, revealed) as step, i (step.id)}
        <section class="card step" id={`step-${i}`}>
          <h3><span class="num">{i + 1}</span>{stepName(step.id)}</h3>
          {#if step.id === 'key'}
            <p class="key">{step.key}</p>
          {/if}
          {#each step.scores as sc (sc.entry.file + sc.mode)}
            <div class="note">
              <ScoreView path={filePath(model, sc.entry.file)} measures={sc.mode === 'start' ? (sc.entry.start_measures ?? 2) : 0} {semitones} />
            </div>
          {/each}
          {#if step.scores.some((x) => x.play)}
            <Player tracks={scoreTracks(model, step.scores.filter((x) => x.play).map((x) => x.entry))} bind:semitones compact title={notifTitle} memoryKey={model.id} />
          {/if}
          {#each step.notation as n (n.file)}
            <div class="note">
              {#if step.notation.length > 1}<span class="muted small">{t(`nrole.${n.role}` as I18nKey)}</span>{/if}
              <Notation path={filePath(model, n.file)} alt={t(`nrole.${n.role}` as I18nKey)} />
            </div>
          {/each}
          {#if step.id === 'reveal'}
            <dl class="facts">
              <dt>{t('reveal.model')}</dt><dd>{category?.title ?? model.category}</dd>
              <dt>{t('reveal.piece')}</dt><dd>{model.title}</dd>
              {#if model.composer}<dt>{t('reveal.composer')}</dt><dd>{model.composer}</dd>{/if}
              <dt>{t('reveal.id')}</dt><dd>{model.id}</dd>
            </dl>
          {/if}
          {#if step.audio.length}
            <Player tracks={tracksFor(model, step.audio, { showRole: step.id === 'reveal', showKey: true })} compact={step.id !== 'skeleton'} memoryKey={model.id}
              bind:semitones baseKey={modelKey(model)} showKey={keyShown} title={notifTitle} />
          {/if}
        </section>
      {/each}
      <section class="card">
        <h3>{t('rec.title')}</h3>
        <Recorder modelId={model.id} />
      </section>
    {/key}

    <section class="card actions">
      <!-- one box whose content changes: next hint -> confirmation -> all revealed -->
      {#if confirming}
        <div class="slot confirm" role="alertdialog" aria-label={t('practice.confirmReveal')}>
          <span class="txt">{t('practice.confirmReveal')}</span>
          <span class="cbtns">
            <button class="btn" onclick={() => (confirming = null)}>{t('common.no')}</button>
            <button class="btn primary" onclick={reveal}>{t('common.yes')}</button>
          </span>
        </div>
      {:else if nextStep}
        <button class="slot hint" onclick={reveal}>
          <span class="txt">{t('practice.nextHint', { step: stepName(nextStep.id) })}</span>
          <span class="steps">{revealed}/{ladder.length}</span>
        </button>
      {:else}
        <div class="slot done">
          <span class="txt">✓ {t('practice.noMoreHints')}</span>
          <span class="steps">{ladder.length}/{ladder.length}</span>
        </div>
      {/if}

      <div class="rate" role="group" aria-label={t('practice.rate')}>
        <button class="btn yes" onclick={() => rate('yes')}>{t('practice.rate.yes')}</button>
        <button class="btn partly" onclick={() => rate('partly')}>{t('practice.rate.partly')}</button>
        <button class="btn no" onclick={() => rate('no')}>{t('practice.rate.no')}</button>
        <button class="btn ghost" onclick={next}>{t('practice.skip')}</button>
      </div>
    </section>
  </div>
{/if}

<style>
  .practice { display: flex; flex-direction: column; gap: 14px; }
  .phead { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .count { font-weight: 600; }
  .cat { color: var(--muted); font-size: 14px; }
  h2 { margin: 0 0 4px; font-size: 20px; }
  h3 { margin: 0 0 10px; font-size: 17px; display: flex; align-items: center; gap: 10px; }
  .num { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 13px; background: var(--accent); color: var(--on-accent); font-size: 13px; }
  .key { font-size: 28px; font-weight: 600; margin: 4px 0; }
  .note { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 12px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; font-weight: 500; }
  .actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 14px; align-items: center; padding: 12px 16px; }
  @media (min-height: 700px) and (min-width: 601px) {
    .actions { position: sticky; bottom: 0; z-index: 5; box-shadow: 0 -6px 18px var(--shadow); }
  }
  .slot {
    box-sizing: border-box; width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 4px 6px 4px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-2);
    color: var(--text); font: inherit; font-weight: 500; text-align: left;
  }
  button.slot { cursor: pointer; padding-right: 16px; }
  .slot .txt { min-width: 0; }
  .steps { color: var(--muted); font-size: 13px; font-weight: 400; flex: none; }
  .done { color: var(--muted); padding-right: 16px; }
  .confirm { border-color: var(--accent); background: var(--surface); }
  .cbtns { display: flex; gap: 6px; flex: none; }
  .cbtns .btn { min-height: 38px; padding: 0 16px; }
  .rate { display: flex; gap: 8px; }
  /* narrower screens: hint box on its own row, rating buttons share the full width evenly */
  @media (max-width: 1000px) {
    .actions { grid-template-columns: 1fr; }
    .rate { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .rate .btn { padding: 0 6px; }
  }
  @media (max-width: 480px) {
    .rate { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .center { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .small { font-size: 13px; margin: 0 0 8px; }
  .muted { color: var(--muted); }
</style>
