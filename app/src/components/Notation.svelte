<script lang="ts">
  import { fileUrl } from '../lib/media';
  import { t } from '../lib/state.svelte';

  let { path, alt }: { path: string; alt: string } = $props();
  let url = $state<string | null | undefined>(undefined);
  let zoom = $state(false);

  $effect(() => {
    let alive = true;
    url = undefined;
    fileUrl(path).then((u) => alive && (url = u));
    return () => (alive = false);
  });
</script>

{#if url === null}
  <p class="muted">{t('player.missing')}</p>
{:else if url}
  <button class="img" onclick={() => (zoom = true)} aria-label={alt}><img src={url} {alt} /></button>
  {#if zoom}
    <div class="zoom" role="dialog" aria-label={alt}>
      <button class="close" onclick={() => (zoom = false)} aria-label={t('common.close')}>✕</button>
      <div class="scroll"><img src={url} {alt} /></div>
    </div>
  {/if}
{/if}

<style>
  .img { display: block; padding: 0; border: 0; background: #fff; border-radius: 8px; overflow: hidden; width: 100%; cursor: zoom-in; }
  .img img { display: block; width: 100%; height: auto; }
  .zoom { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); z-index: 50; display: flex; flex-direction: column; }
  .scroll { flex: 1; overflow: auto; touch-action: pan-x pan-y pinch-zoom; background: #fff; }
  .scroll img { display: block; min-width: 100%; max-width: none; width: 160%; }
  @media (min-width: 900px) { .scroll img { width: 130%; } }
  .close { position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: 12px; z-index: 2; width: 44px; height: 44px;
    border-radius: 22px; border: 0; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 20px; }
  .muted { color: var(--muted); }
</style>
