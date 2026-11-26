<script lang="ts">
  import { compareModels, effectiveDifficulty, isPracticable } from '../lib/library';
  import { lib, t, go } from '../lib/state.svelte';
  import type { I18nKey } from '../lib/i18n';

  let unlocked = $state(sessionStorageGet());
  let q = $state('');
  let show = $state<'all' | 'trainable' | 'stubs'>('all');

  function sessionStorageGet() {
    try { return sessionStorage.getItem('lib.unlocked') === '1'; } catch { return false; }
  }
  function unlock() {
    unlocked = true;
    try { sessionStorage.setItem('lib.unlocked', '1'); } catch { /* ignore */ }
  }

  const missing = $derived([...lib.progress.values()].filter((p) => !lib.byId.has(p.id) && p.attempts.length)
    .sort((a, b) => a.id.localeCompare(b.id)));

  const groups = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = [...lib.models].sort(compareModels).filter((m) => {
      if (show === 'trainable' && !isPracticable(m)) return false;
      if (show === 'stubs' && m.status === 'complete') return false;
      if (!needle) return true;
      return [m.id, m.title, m.composer ?? '', m.key ?? ''].some((s) => s.toLowerCase().includes(needle));
    });
    const out = new Map<string, typeof list>();
    for (const m of list) out.set(m.category, [...(out.get(m.category) ?? []), m]);
    return [...out.entries()];
  });
</script>

{#if !unlocked}
  <section class="card gate">
    <p>{t('lib.spoilerWarning')}</p>
    <button class="btn primary" onclick={unlock}>{t('lib.showAnyway')}</button>
  </section>
{:else}
  <div class="bar">
    <button class="btn primary" onclick={() => go({ name: 'editor' })}>{t('own.new')}</button>
    <input type="search" placeholder={t('lib.search')} bind:value={q} />
    <div class="row">
      {#each [['all', 'lib.filterAll'], ['trainable', 'lib.filterTrainable'], ['stubs', 'lib.filterStubs']] as const as [k, label]}
        <button class="chip" class:on={show === k} onclick={() => (show = k)}>{t(label)}</button>
      {/each}
    </div>
  </div>
  {#each groups as [cat, models] (cat)}
    <section class="card">
      <h2><span class="muted">{cat}</span> {lib.catMap.get(cat)?.title ?? ''}</h2>
      <ul>
        {#each models as m (m.id)}
          {@const p = lib.progress.get(m.id)}
          <li>
            <button class="item" onclick={() => go({ name: 'model', id: m.id })}>
              <span class="id">{m.id}</span>
              <span class="title">{m.composer ? `${m.composer}: ` : ''}{m.title}</span>
              <span class="badges">
                {#if m.kind !== 'model'}<span class="badge">{t(`lib.kind.${m.kind}` as I18nKey)}</span>{/if}
                {#if m.status !== 'complete'}<span class="badge warn">{t(`lib.status.${m.status}` as I18nKey)}</span>{/if}
                {#if !isPracticable(m)}<span class="badge off">{t('lib.notTrainable')}</span>{/if}
                <span class="badge">★{effectiveDifficulty(m, lib.catMap)}</span>
                {#if p?.attempts.length}
                  <span class="dot {p.attempts[p.attempts.length - 1].rating}" title={t('lib.attempts', { n: p.attempts.length })}></span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
  {#if missing.length}
    <section class="card">
      <h2>{t('lib.missing')}</h2>
      <p class="muted small">{t('lib.missing.desc')}</p>
      <ul>
        {#each missing as p (p.id)}
          <li class="item static">
            <span class="id">{p.id}</span>
            <span class="title">{p.info ? `${p.info.composer ? p.info.composer + ': ' : ''}${p.info.title}` : '?'}
              {#if p.info?.categoryTitle}<span class="muted small"> · {p.info.category} {p.info.categoryTitle}</span>{/if}</span>
            <span class="badges"><span class="badge warn">{t('lib.missing.badge')}</span>
              <span class="dot {p.attempts.at(-1)?.rating ?? ''}" title={t('lib.attempts', { n: p.attempts.length })}></span></span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .gate { max-width: 520px; margin: 40px auto; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; align-items: center; }
  .bar input { flex: 1 1 200px; min-width: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  section { margin-bottom: 14px; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .item { width: 100%; display: grid; grid-template-columns: 7.2em minmax(0, 1fr) auto; gap: 10px; align-items: center; text-align: left;
    padding: 10px 8px; border: 0; background: none; color: inherit; border-radius: 8px; min-height: 44px; font: inherit; cursor: pointer; }
  @media (hover: hover) { .item:hover { background: var(--surface-2); } }
  .id { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; white-space: nowrap; }
  .badges { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  @media (max-width: 600px) {
    .item { grid-template-columns: 1fr; gap: 4px; }
    .badges { justify-content: flex-start; }
  }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .static { cursor: default; }
</style>
