<script lang="ts">
  // Renders a MusicXML score with OpenSheetMusicDisplay (loaded lazily). Title/composer are never drawn:
  // they would spoil the exercise.
  import { getFile } from '../lib/db';
  import { musicXmlText } from '../lib/musicxml';
  import { t } from '../lib/state.svelte';

  let { path, measures = 0, semitones = 0 }: { path: string; measures?: number; semitones?: number } = $props();

  let host: HTMLDivElement | undefined = $state();
  let zoomHost: HTMLDivElement | undefined = $state();
  let status = $state<'loading' | 'ready' | 'error' | 'missing'>('loading');
  let zoom = $state(false);
  let xml: string | null = null;

  async function draw(el: HTMLDivElement, semis: number, zoomed: boolean) {
    const { OpenSheetMusicDisplay, TransposeCalculator } = await import('opensheetmusicdisplay');
    if (xml === null) {
      const b = await getFile(path);
      if (!b) { status = 'missing'; return; }
      xml = musicXmlText(new Uint8Array(await b.arrayBuffer()));
    }
    el.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(el, {
      autoResize: !zoomed, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false,
      drawLyricist: false, drawCredits: false, drawPartNames: false, drawPartAbbreviations: false,
      drawMeasureNumbers: true, drawingParameters: measures ? 'compacttight' : 'default',
      ...(measures ? { drawFromMeasureNumber: 1, drawUpToMeasureNumber: measures } : {}),
    });
    osmd.TransposeCalculator = new TransposeCalculator();
    await osmd.load(xml);
    osmd.Sheet.Transpose = semis;
    if (zoomed) osmd.Zoom = 1.4;
    osmd.updateGraphic();
    osmd.render();
  }

  $effect(() => {
    const el = host;
    const s = semitones;
    void path; void measures;
    if (!el) return;
    status = 'loading';
    draw(el, s, false).then(() => { if (status === 'loading') status = 'ready'; }).catch(() => (status = 'error'));
  });

  $effect(() => {
    if (zoom && zoomHost) draw(zoomHost, semitones, true).catch(() => {});
  });
</script>

{#if status === 'missing'}
  <p class="muted">{t('player.missing')}</p>
{:else if status === 'error'}
  <p class="muted">{t('score.error')}</p>
{/if}
<button class="score" class:hidden={status !== 'ready'} onclick={() => (zoom = true)} aria-label={t('score.zoom')}>
  <div bind:this={host}></div>
</button>
{#if status === 'loading'}<p class="muted small">{t('player.loading')}</p>{/if}
{#if zoom}
  <div class="zoom" role="dialog" aria-label={t('score.zoom')}>
    <button class="close" onclick={() => (zoom = false)} aria-label={t('common.close')}>✕</button>
    <div class="scroll"><div bind:this={zoomHost}></div></div>
  </div>
{/if}

<style>
  .score { display: block; width: 100%; padding: 0; border: 0; background: #fff; color: #000; border-radius: 8px; overflow: hidden; cursor: zoom-in; text-align: left; }
  .score.hidden { position: absolute; visibility: hidden; width: 100%; }
  .zoom { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); z-index: 50; display: flex; flex-direction: column; }
  .scroll { flex: 1; overflow: auto; background: #fff; touch-action: pan-x pan-y pinch-zoom; }
  .scroll > div { min-width: 1100px; }
  .close { position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: 12px; z-index: 2; width: 44px; height: 44px;
    border-radius: 22px; border: 0; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 20px; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
</style>
