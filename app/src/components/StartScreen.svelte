<script lang="ts">
  import { buildSession, effectiveDifficulty, isPracticable, matchesFilter } from '../lib/library';
  import { lib, settings, saveSettings, t, go } from '../lib/state.svelte';
  import { runImport } from '../lib/importUi.svelte';
  import UpdateCard from './UpdateCard.svelte';
  import { srsPlan } from '../lib/session';
  import { NEW_PER_SESSION, continueSession, todaysSession } from '../lib/srs';
  import { showBanner } from '../lib/updates.svelte';
  import type { Tempo } from '../lib/types';

  const f = settings.filter;

  const practicable = $derived(lib.models.filter(isPracticable));
  const perCategory = $derived.by(() => {
    const m = new Map<string, number>();
    for (const x of practicable) if (settings.filter.warmups || x.kind !== 'warmup') m.set(x.category, (m.get(x.category) ?? 0) + 1);
    return m;
  });
  const cats = $derived(lib.categories.filter((c) => perCategory.has(c.id)));
  const srs = $derived(settings.filter.order === 'srs');
  const matching = $derived(lib.models.filter((m) =>
    matchesFilter(m, srs ? { ...settings.filter, practice: 'all' } : settings.filter, lib.catMap, lib.progress.get(m.id))));
  const srsP = $derived(srs ? srsPlan(lib.models, lib.catMap, lib.progress, settings.filter) : null);
  const srsNew = $derived(srsP ? Math.min(srsP.fresh.length, NEW_PER_SESSION) : 0);

  function toggleCat(id: string) {
    const all = cats.map((c) => c.id);
    const sel = new Set(all.filter(isOn));
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    f.categories = sel.size === all.length ? [] : sel.size ? [...sel] : ['__none__'];
    saveSettings();
  }
  const isOn = (id: string) => !f.categories.length || f.categories.includes(id);

  function setAll(on: boolean) {
    f.categories = on ? [] : ['__none__'];
    saveSettings();
  }

  function start() {
    if (srsP) {
      // today's reviews with a few new pieces; if nothing is due: continue with new / oldest
      let ids = todaysSession(srsP);
      if (!ids.length) ids = continueSession(srsP).ids;
      if (ids.length) go({ name: 'practice', ids, srs: true });
      return;
    }
    const ids = buildSession(matching, f.order);
    if (ids.length) go({ name: 'practice', ids });
  }

  function upd() { saveSettings(); }

  const tempos: (Tempo | 'any')[] = ['any', 'slow', 'normal', 'fast'];

  function diffRange(catId: string) {
    const ds = practicable.filter((m) => m.category === catId).map((m) => effectiveDifficulty(m, lib.catMap));
    const lo = Math.min(...ds), hi = Math.max(...ds);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }
</script>

{#if showBanner()}<UpdateCard banner />{/if}

{#if lib.loaded && !lib.models.length}
  <section class="card empty">
    <h2>{t('empty.title')}</h2>
    <p class="muted">{t('empty.text')}</p>
    <button class="btn primary" onclick={() => runImport('replace')}>{t('empty.import')}</button>
  </section>
{:else if lib.loaded}
  <div class="grid">
    <section class="card cats">
      <div class="head">
        <h2>{t('filter.categories')}</h2>
        <div class="row">
          <button class="chip" onclick={() => setAll(true)}>{t('filter.all')}</button>
          <button class="chip" onclick={() => setAll(false)}>{t('filter.none')}</button>
        </div>
      </div>
      <ul>
        {#each cats as c (c.id)}
          <li>
            <label class="cat" class:on={isOn(c.id)}>
              <input type="checkbox" checked={isOn(c.id)} onchange={() => toggleCat(c.id)} />
              <span class="cid">{c.id}</span>
              <span class="ctitle">{c.title}</span>
              <span class="cmeta">{perCategory.get(c.id)} · ★{diffRange(c.id)}</span>
            </label>
          </li>
        {/each}
      </ul>
    </section>

    <section class="card opts">
      <h2>{t('filter.title')}</h2>

      <div class="field">
        <span class="lbl">{t('filter.difficulty')}</span>
        <div class="row">
          <span class="muted">{t('filter.from')}</span>
          <select bind:value={f.diffMin} onchange={() => { if (f.diffMax < f.diffMin) f.diffMax = f.diffMin; upd(); }}>
            {#each [1, 2, 3, 4, 5] as d}<option value={d}>{d}</option>{/each}
          </select>
          <span class="muted">{t('filter.to')}</span>
          <select bind:value={f.diffMax} onchange={() => { if (f.diffMin > f.diffMax) f.diffMin = f.diffMax; upd(); }}>
            {#each [1, 2, 3, 4, 5] as d}<option value={d}>{d}</option>{/each}
          </select>
        </div>
      </div>

      <div class="field">
        <span class="lbl">{t('filter.tempo')}</span>
        <div class="row seg">
          {#each tempos as tp}
            <button class="chip" class:on={f.tempo === tp} onclick={() => { f.tempo = tp; upd(); }}>
              {tp === 'any' ? t('filter.tempo.any') : t(`tempo.${tp}`)}
            </button>
          {/each}
        </div>
      </div>

      {#if !srs}
      <div class="field">
        <span class="lbl">{t('filter.practice')}</span>
        <div class="row seg">
          {#each ['all', 'new', 'weak'] as const as p}
            <button class="chip" class:on={f.practice === p} onclick={() => { f.practice = p; upd(); }}>{t(`filter.practice.${p}`)}</button>
          {/each}
        </div>
      </div>
      {/if}

      <div class="field">
        <span class="lbl">{t('filter.order')}</span>
        <div class="row seg">
          {#each ['srs', 'random', 'library'] as const as o}
            <button class="chip" class:on={f.order === o} onclick={() => { f.order = o; upd(); }}>{t(`filter.order.${o}`)}</button>
          {/each}
        </div>
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={f.warmups} onchange={upd} />
        {t('filter.warmups')}
      </label>

      <div class="go">
        {#if srsP}
          <span class="muted">{srsP.due.length || srsNew ? t('filter.srsCount', { due: srsP.due.length, fresh: srsNew }) : t('filter.srsNothing')}</span>
        {:else}
          <span class="muted">{matching.length === 1 ? t('filter.count1') : t('filter.count', { n: matching.length })}</span>
        {/if}
        <button class="btn primary big" disabled={!matching.length} onclick={start}>{t('filter.start')}</button>
      </div>
    </section>
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; align-items: start; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .opts { order: -1; } }
  h2 { margin: 0; font-size: 18px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .cat { display: grid; grid-template-columns: auto auto 1fr auto; gap: 10px; align-items: center; padding: 10px; border-radius: 10px; cursor: pointer; min-height: 44px; }
  @media (hover: hover) { .cat:hover { background: var(--surface-2); } }
  .cat:not(.on) { opacity: 0.55; }
  .cat input { width: 20px; height: 20px; accent-color: var(--accent); }
  .cid { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }
  .ctitle { font-weight: 500; }
  .cmeta { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .opts { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 72px; }
  @media (max-width: 900px) { .opts { position: static; } }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .lbl { font-size: 13px; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .check { display: flex; gap: 10px; align-items: center; min-height: 44px; }
  .check input { width: 20px; height: 20px; accent-color: var(--accent); }
  .go { display: flex; flex-direction: column; gap: 8px; }
  .empty { max-width: 560px; margin: 40px auto; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .muted { color: var(--muted); }
</style>
