<script lang="ts">
  import { busy } from '../lib/backupUi.svelte';
  import { t } from '../lib/state.svelte';
</script>

{#if busy.open}
  <div class="backdrop" role="dialog" aria-modal="true">
    <div class="card box">
      {#if busy.running}
        <div class="spinner" aria-hidden="true"></div>
        <p>{busy.label}</p>
        {#if busy.total}<progress max={busy.total} value={busy.done}></progress>{/if}
      {:else}
        {#if busy.error}<p class="err">{busy.error}</p>{:else}<p>{busy.message}</p>{/if}
        <button class="btn primary" onclick={() => (busy.open = false)}>{t('import.ok')}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: grid; place-items: center; z-index: 100; padding: 16px; }
  .box { max-width: 460px; width: 100%; display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center; }
  progress { width: 100%; }
  .err { color: var(--bad); }
  .spinner { width: 32px; height: 32px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
