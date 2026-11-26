<script lang="ts">
  import { updates, hasUpdate, whatsNew, install, dismiss } from '../lib/updates.svelte';
  import { t } from '../lib/state.svelte';
  import { formatBytes } from '../lib/i18n';

  let { banner = false }: { banner?: boolean } = $props();
  const news = $derived(whatsNew());
</script>

{#if hasUpdate() && updates.manifest}
  <div class="upd" class:banner>
    <div class="head">
      <span class="two">
        <b>{t('upd.available', { v: updates.manifest.versionName })}</b>
        <span class="muted small">{formatBytes(updates.manifest.size)}</span>
      </span>
      {#if banner}<button class="chip" onclick={dismiss} aria-label={t('common.close')}>✕</button>{/if}
    </div>
    {#if news.length}
      <ul class="news">{#each news.slice(0, banner ? 3 : 10) as n}<li>{n}</li>{/each}</ul>
    {/if}
    {#if updates.phase === 'downloading'}
      <progress max="1" value={updates.progress}></progress>
      <p class="muted small">{t('upd.downloading', { p: Math.round(updates.progress * 100) })}</p>
    {:else if updates.phase === 'needs-permission'}
      <p class="small">{t('upd.permission')}</p>
      <button class="btn primary" onclick={install}>{t('upd.install')}</button>
    {:else}
      <button class="btn primary" onclick={install} disabled={updates.phase === 'installing'}>{t('upd.install')}</button>
    {/if}
    {#if updates.error}<p class="err small">{t('upd.error', { msg: updates.error })}</p>{/if}
  </div>
{/if}

<style>
  .upd { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .banner { background: var(--surface); border: 1px solid var(--accent); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; width: 100%; }
  .two { display: flex; flex-direction: column; gap: 2px; }
  .news { margin: 0; padding-left: 18px; font-size: 14px; color: var(--muted); }
  progress { width: 100%; max-width: 360px; }
  .small { font-size: 13px; margin: 0; }
  .muted { color: var(--muted); }
  .err { color: var(--bad); }
</style>
