<script lang="ts">
  // File picker with localised text (the native <input type=file> shows "Choose File" in the system language).
  import { t } from '../lib/state.svelte';

  let { accept, onpick, name = null, id }: {
    accept: string; onpick: (ev: Event) => void; name?: string | null; id?: string;
  } = $props();
  let input: HTMLInputElement | undefined = $state();
</script>

<span class="pick">
  <input bind:this={input} {id} type="file" {accept} onchange={onpick} hidden />
  <button type="button" class="btn" onclick={() => input?.click()}>{t('editor.choose')}</button>
  {#if name}<span class="name" title={name}>{name}</span>{/if}
</span>

<style>
  .pick { display: inline-flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; }
  .btn { flex: none; min-height: 40px; }
  .name { color: var(--muted); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
