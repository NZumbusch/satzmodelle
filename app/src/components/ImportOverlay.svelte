<script lang="ts">
  import { importUi } from '../lib/importUi.svelte';
  import { t } from '../lib/state.svelte';
  import { formatBytes, type I18nKey } from '../lib/i18n';
</script>

{#if importUi.open}
  <div class="backdrop" role="dialog" aria-modal="true">
    <div class="card box">
      {#if importUi.running}
        <div class="spinner" aria-hidden="true"></div>
        <p>{t('import.running', { files: importUi.progress?.files ?? 0, size: formatBytes(importUi.progress?.bytes ?? 0) })}</p>
        {#if importUi.progress?.total}
          <progress max={importUi.progress.total} value={importUi.progress.files}></progress>
        {/if}
      {:else if importUi.error}
        <p>{importUi.error.code === 'generic' ? t('import.error.generic', { msg: importUi.error.msg ?? '' }) : t(`import.error.${importUi.error.code}` as I18nKey)}</p>
        {#if importUi.error.warnings?.length}
          <details><summary>{t('import.warnings')}</summary><ul>{#each importUi.error.warnings as w}<li>{w}</li>{/each}</ul></details>
        {/if}
        <button class="btn primary" onclick={() => (importUi.open = false)}>{t('import.ok')}</button>
      {:else if importUi.result}
        <p>{t('import.done', { n: importUi.result.models })}
          {#if importUi.result.replaced}{t('import.replaced', { n: importUi.result.replaced })}{/if}</p>
        {#if importUi.result.warnings.length}
          <details><summary>{t('import.warnings')} ({importUi.result.warnings.length})</summary>
            <ul>{#each importUi.result.warnings as w}<li>{w}</li>{/each}</ul></details>
        {/if}
        <button class="btn primary" onclick={() => (importUi.open = false)}>{t('import.ok')}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: grid; place-items: center; z-index: 100; padding: 16px; }
  .box { max-width: 460px; width: 100%; display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center; }
  progress { width: 100%; }
  details { text-align: left; width: 100%; font-size: 13px; max-height: 40vh; overflow: auto; }
  .spinner { width: 32px; height: 32px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
