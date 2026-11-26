<script lang="ts">
  // Record your attempt with the microphone; takes are stored per model on the device only.
  import { onDestroy } from 'svelte';
  import Player from './Player.svelte';
  import { deleteRecording, putRecording, recordingsFor, type Recording } from '../lib/db';
  import { t } from '../lib/state.svelte';
  import { fmtTime } from '../lib/player';
  import { scheduleSync } from '../lib/sync.svelte';

  let { modelId }: { modelId: string } = $props();

  let takes = $state<Recording[]>([]);
  let recState = $state<'idle' | 'recording' | 'denied' | 'unsupported'>('idle');
  let elapsed = $state(0);
  let open = $state<string | null>(null);
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timer: number | undefined;
  let started = 0;

  $effect(() => {
    void modelId;
    recordingsFor(modelId).then((r) => (takes = r));
  });

  function pickMime() {
    for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'])
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
    return '';
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { recState = 'unsupported'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      recState = 'denied';
      return;
    }
    const mime = pickMime();
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: rec?.mimeType || mime || 'audio/webm' });
      const r: Recording = {
        id: `${modelId}-${Date.now()}`, modelId, at: new Date().toISOString(), mime: blob.type,
        duration: (Date.now() - started) / 1000, blob,
      };
      await putRecording(r);
      takes = [r, ...takes];
      open = r.id;
      cleanup();
      scheduleSync();
    };
    started = Date.now();
    elapsed = 0;
    rec.start(1000);
    recState = 'recording';
    timer = window.setInterval(() => (elapsed = (Date.now() - started) / 1000), 250);
  }

  function stop() {
    clearInterval(timer);
    if (rec && rec.state !== 'inactive') rec.stop();
    recState = 'idle';
  }

  function cleanup() {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    rec = null;
  }

  async function remove(id: string) {
    if (!confirm(t('rec.delete.confirm'))) return;
    await deleteRecording(id);
    takes = takes.filter((x) => x.id !== id);
    scheduleSync();
  }

  onDestroy(() => { if (recState === 'recording') stop(); else cleanup(); clearInterval(timer); });
</script>

<div class="rec">
  <div class="row">
    {#if recState === 'recording'}
      <button class="btn bad" onclick={stop}><span class="dot rec-dot"></span>{t('rec.stop')} · {fmtTime(elapsed)}</button>
    {:else}
      <button class="btn" onclick={start}><span class="dot recd"></span>{t('rec.start')}</button>
    {/if}
    {#if recState === 'denied'}<span class="muted small">{t('rec.denied')}</span>{/if}
    {#if recState === 'unsupported'}<span class="muted small">{t('rec.unsupported')}</span>{/if}
  </div>
  {#if takes.length}
    <ul>
      {#each takes as r, i (r.id)}
        <li>
          <div class="take">
            <button class="chip" class:on={open === r.id} onclick={() => (open = open === r.id ? null : r.id)}>
              {t('rec.take', { n: takes.length - i })} · {new Date(r.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {fmtTime(r.duration)}
            </button>
            <button class="chip" onclick={() => remove(r.id)} aria-label={t('rec.delete')}>✕</button>
          </div>
          {#if open === r.id}
            <Player tracks={[{ label: t('rec.take', { n: takes.length - i }), source: { kind: 'blob', blob: r.blob } }]} compact />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .rec { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .take { display: flex; gap: 6px; flex-wrap: wrap; }
  .recd { background: var(--bad); }
  .rec-dot { background: var(--bad); animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: 0.2; } }
  .small { font-size: 13px; }
  .muted { color: var(--muted); }
</style>
