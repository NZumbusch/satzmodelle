<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Engine, fmtTime, peaks } from '../lib/player';
  import { bufferFor, MissingFile, type Track } from '../lib/sources';
  import { settings, saveSettings, t } from '../lib/state.svelte';
  import { transposeKey } from '../lib/keys';
  import { newPlayerId, paused, playing, released } from '../lib/playback';
  import { getMarkers, saveMarkers, sectionAt, nextLabel } from '../lib/markers';
  import type { Marker } from '../lib/types';

  let { tracks, initial = 0, memoryKey = '', compact = false, baseKey, showKey = false, title = '', semitones = $bindable(0) }: {
    tracks: Track[]; initial?: number; memoryKey?: string; compact?: boolean;
    baseKey?: string; showKey?: boolean; title?: string; semitones?: number;
  } = $props();

  const pid = newPlayerId();
  let index = $state(untrack(() => Math.min(initial, Math.max(0, tracks.length - 1))));
  let engine: Engine | null = $state(null);
  let status: 'loading' | 'ready' | 'error' | 'missing' = $state('loading');
  let pos = $state(0);
  let playState = $state<'stopped' | 'counting' | 'playing'>('stopped');
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let speed = $state(1);
  let volume = $state(1);
  let countIn = $state(0);
  /** small options panel (count-in, volume), opened from the sliders icon */
  let optsOpen = $state(false);
  let optsEl: HTMLDivElement | undefined = $state();
  /** markers of the current track; editing = "Marker setzen" toggled */
  let markers = $state<Marker[]>([]);
  let editing = $state(false);
  let sectionLoop = $state(false);
  /** bumped to redraw the waveform, e.g. after a theme change */
  let redraw = $state(0);
  $effect(() => { void settings.theme; requestAnimationFrame(() => redraw++); });
  let wave: Float32Array | null = $state(null);
  let canvas: HTMLCanvasElement | undefined = $state();
  let raf = 0;
  let loadToken = 0;
  /** semitones baked into the current buffer (scores are rendered transposed) */
  let bakedSemis = 0;

  const isScore = $derived(tracks[index]?.source.kind === 'score');
  const keyLabel = $derived(showKey && baseKey ? transposeKey(baseKey, semitones) : null);

  speed = untrack(() => (settings.rememberSpeed && memoryKey && settings.speeds[memoryKey]) || settings.defaultSpeed);

  $effect(() => {
    const track = tracks[index];
    if (track) untrack(() => load(track, false));
  });

  async function load(track: Track, keepPosition: boolean) {
    const token = ++loadToken;
    const prevPos = engine?.position ?? 0;
    const wasPlaying = engine?.state === 'playing';
    engine?.dispose();
    engine = null;
    status = 'loading';
    if (!keepPosition) {
      wave = null;
      loopA = loopB = null;
      pos = 0;
      markers = memoryKey && track.id ? getMarkers(memoryKey, track.id) : [];
    }
    playState = 'stopped';
    try {
      const semis = track.source.kind === 'score' ? semitones : 0;
      const buf = await bufferFor(track.source, semis, settings.synthVoice);
      if (token !== loadToken) return;
      bakedSemis = semis;
      const e = new Engine(buf);
      e.speed = speed;
      e.semitones = semitones - bakedSemis;
      e.volume = volume;
      e.countIn = countIn;
      e.onChange = () => sync(e);
      engine = e;
      wave = peaks(buf, 600);
      status = 'ready';
      if (keepPosition) {
        e.seek(prevPos);
        applySection(prevPos);
        if (wasPlaying) { e.countIn = 0; await e.play(); e.countIn = countIn; }
      }
    } catch (err) {
      if (token === loadToken) status = err instanceof MissingFile ? 'missing' : 'error';
    }
  }

  function sync(e: Engine) {
    if (e !== engine) return;
    pos = e.position;
    const was = playState;
    playState = e.state;
    loopA = e.loopA;
    loopB = e.loopB;
    cancelAnimationFrame(raf);
    if (e.state === 'playing') tick();
    if (was !== playState) {
      const ttl = title || t('app.title');
      if (playState === 'playing') playing({ id: pid, toggle: () => engine?.toggle(), stop: () => engine?.pause() }, ttl);
      else if (playState === 'stopped') paused(pid, ttl);
    }
  }

  function tick() {
    if (!engine) return;
    pos = engine.position;
    raf = requestAnimationFrame(tick);
  }

  onDestroy(() => {
    cancelAnimationFrame(raf);
    engine?.dispose();
    loadToken++;
    released(pid);
  });

  $effect(() => { if (engine) engine.speed = speed; });
  $effect(() => { if (engine) engine.volume = volume; });
  $effect(() => { if (engine) engine.countIn = countIn; });

  // transposition: recordings are pitch-shifted live, scores are re-rendered exactly (debounced)
  let renderTimer: number | undefined;
  $effect(() => {
    const s = semitones;
    untrack(() => {
      if (!engine) return;
      if (isScore) {
        if (s === bakedSemis) return;
        clearTimeout(renderTimer);
        renderTimer = window.setTimeout(() => load(tracks[index], true), 250);
      } else engine.semitones = s;
    });
  });

  function setSpeed(v: number) {
    speed = Math.round(Math.min(1.5, Math.max(0.5, v)) * 100) / 100;
    if (settings.rememberSpeed && memoryKey) {
      settings.speeds[memoryKey] = speed;
      saveSettings();
    }
  }

  function setSemis(v: number) {
    semitones = Math.max(-12, Math.min(12, v));
  }

  /* ---------------------------------------------------------------- markers */

  async function persist() {
    const tr = tracks[index];
    if (memoryKey && tr?.id) await saveMarkers(memoryKey, tr.id, $state.snapshot(markers));
  }

  function addMarker(time: number) {
    if (!engine) return;
    const tt = Math.max(0, Math.min(engine.duration - 0.05, time));
    // no duplicates within 0.3 s
    if (tt < 0.05 || markers.some((m) => Math.abs(m.t - tt) < 0.3)) return;
    markers = [...markers, { t: Math.round(tt * 100) / 100, label: nextLabel(markers) }].sort((x, y) => x.t - y.t);
    persist();
    applySection(engine.position);
  }

  /** while listening you tap a little late: move the marker back by ~0.15 s */
  function addHere() {
    if (!engine) return;
    addMarker(engine.position - (engine.state === 'playing' ? 0.15 * speed : 0));
  }

  function removeMarker(m: Marker) {
    markers = markers.filter((x) => x !== m);
    persist();
    if (engine) applySection(engine.position);
  }

  function renameMarker(m: Marker) {
    const name = prompt(t('marker.rename'), m.label);
    if (name === null) return;
    markers = markers.map((x) => (x === m ? { ...x, label: name.trim() || x.label } : x));
    persist();
  }

  /** Loop the section around time t (if section repeat is on), else no loop. */
  function applySection(time: number) {
    if (!engine) return;
    if (!sectionLoop) { engine.setLoop(null, null); return; }
    const [a, b] = sectionAt(markers, time, engine.duration);
    engine.setLoop(a, b);
  }

  async function jump(time: number, play = true) {
    if (!engine) return;
    engine.seek(time);
    applySection(time);
    if (play && engine.state === 'stopped') await engine.play();
  }

  function toggleSectionLoop() {
    sectionLoop = !sectionLoop;
    if (engine) applySection(engine.position);
  }

  function timeAt(ev: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    return { time: ((ev.clientX - r.left) / r.width) * engine!.duration, x: ev.clientX - r.left, w: r.width };
  }

  /** marker under the pointer (within 14 px) */
  function markerNear(x: number, w: number): Marker | undefined {
    const dur = engine!.duration;
    return markers.find((m) => Math.abs((m.t / dur) * w - x) < 14);
  }

  function onWavePointer(ev: PointerEvent) {
    if (!engine || !canvas) return;
    const { time, x, w } = timeAt(ev);
    const near = markerNear(x, w);
    if (editing) {
      if (!near) addMarker(time);
      return;
    }
    if (near) jump(near.t);
    else { engine.seek(time); applySection(time); }
  }

  function onWaveMove(ev: PointerEvent) {
    if (!ev.buttons || editing || !engine || !canvas) return;
    const { time } = timeAt(ev);
    engine.seek(time);
  }

  $effect(() => {
    const c = canvas;
    const w = wave;
    const p = pos, a = loopA, b = loopB, ms = markers, ed = editing;
    void redraw;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(c);
    const dur = engine?.duration || 1;
    if (a !== null && b !== null) {
      g.fillStyle = css.getPropertyValue('--loop').trim();
      g.fillRect((a / dur) * W, 0, ((b - a) / dur) * W, H);
    }
    if (w) {
      const played = css.getPropertyValue('--accent').trim();
      const rest = css.getPropertyValue('--wave').trim();
      const bw = W / w.length;
      for (let i = 0; i < w.length; i++) {
        const x = i * bw;
        const h = Math.max(1, w[i] * (H - 6));
        g.fillStyle = x / W <= p / dur ? played : rest;
        g.fillRect(x, (H - h) / 2, Math.max(1, bw - 0.5), h);
      }
    }
    g.fillStyle = css.getPropertyValue('--text').trim();
    g.fillRect((p / dur) * W - 1, 0, 2, H);
    const edge = css.getPropertyValue('--loop-edge').trim();
    g.font = '600 11px system-ui';
    for (const m of ms) {
      const x = (m.t / dur) * W;
      g.fillStyle = edge;
      g.fillRect(x - 1, 0, 2, H);
      const label = m.label.length > 10 ? m.label.slice(0, 9) + '…' : m.label;
      const tw = g.measureText(label).width + 8;
      const lx = Math.min(W - tw, x + 1);
      g.fillRect(lx, 0, tw, 15);
      g.fillStyle = css.getPropertyValue('--on-accent').trim() || '#fff';
      g.fillText(label, lx + 4, 11);
    }
    if (ed) {
      g.strokeStyle = edge;
      g.setLineDash([6, 4]);
      g.lineWidth = 2;
      g.strokeRect(1, 1, W - 2, H - 2);
      g.setLineDash([]);
    }
  });

  function onWindowPointer(ev: PointerEvent) {
    if (optsOpen && optsEl && !optsEl.contains(ev.target as Node)) optsOpen = false;
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && optsOpen) { optsOpen = false; return; }
    if (compact) return;
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.code === 'Space') { ev.preventDefault(); engine?.toggle(); }
  }

  const speeds = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
</script>

<svelte:window onkeydown={onKey} onpointerdown={onWindowPointer} />

<div class="player" class:compact>
  {#if tracks.length > 1}
    <div class="variants" role="tablist" aria-label={t('player.variant')}>
      {#each tracks as tr, i}
        <button role="tab" class="chip" aria-selected={i === index} class:on={i === index} onclick={() => (index = i)}>{tr.label}</button>
      {/each}
    </div>
  {/if}

  {#if status === 'missing'}
    <p class="muted">{t('player.missing')}</p>
  {:else if status === 'error'}
    <p class="muted">{t('player.error')}</p>
  {:else}
    <div class="transport">
      <button class="icon big" disabled={status !== 'ready'} onclick={() => engine?.toggle()}
        aria-label={playState === 'stopped' ? t('player.play') : t('player.pause')}>
        {#if playState === 'stopped'}
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
        {/if}
      </button>
      <button class="icon" disabled={status !== 'ready'} onclick={() => jump(loopA ?? 0, false)} aria-label={t('player.stop')}>
        <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM9.5 12 19 5v14z" /></svg>
      </button>
      <button class="icon" disabled={status !== 'ready'} onclick={() => engine?.seek(engine.position - 5)} aria-label={t('player.back5')}>
        <svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /><text x="12" y="15.5" font-size="6.5" text-anchor="middle" font-weight="700">5</text></svg>
      </button>
      {#if speed !== 1}
        <span class="badge key">{Math.round(speed * 100)} %</span>
      {/if}
      {#if semitones !== 0}
        <span class="badge key">{keyLabel ?? t('player.semitones', { n: (semitones > 0 ? '+' : '') + semitones })}</span>
      {/if}
      <div class="time" aria-live="off">
        {#if status === 'loading'}{t('player.loading')}{:else}{fmtTime(pos)} / {fmtTime(engine?.duration ?? 0)}{/if}
        {#if playState === 'counting'}<span class="counting">●</span>{/if}
      </div>
        <div class="opts" bind:this={optsEl}>
          <button class="icon optbtn" class:on={optsOpen || speed !== 1 || semitones !== 0 || countIn > 0 || volume !== 1} onclick={() => (optsOpen = !optsOpen)}
            aria-expanded={optsOpen} aria-haspopup="true" aria-label={t('player.options')} title={t('player.options')}>
            <svg viewBox="0 0 24 24"><path d="M4 7h9.2a2.5 2.5 0 0 0 4.6 0H20v-2h-2.2a2.5 2.5 0 0 0-4.6 0H4zm0 12h3.2a2.5 2.5 0 0 0 4.6 0H20v-2h-8.2a2.5 2.5 0 0 0-4.6 0H4zm0-6h9.2a2.5 2.5 0 0 0 4.6 0H20v-2h-2.2a2.5 2.5 0 0 0-4.6 0H4z" /></svg>
          </button>
          {#if optsOpen}
            <div class="panel" role="dialog" aria-label={t('player.options')}>
              <div class="prow">
                <span class="phead">{t('player.speed')}
                  {#if speed !== 1}<button class="linkbtn" onclick={() => setSpeed(1)}>{t('player.reset')}</button>{/if}</span>
                <div class="stepper">
                  <button class="chip" onclick={() => setSpeed(speed - 0.05)} aria-label={t('player.slower')}>−</button>
                  <select value={speeds.includes(speed) ? speed : ''} aria-label={t('player.speed')}
                    onchange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
                    {#if !speeds.includes(speed)}<option value="">{Math.round(speed * 100)} %</option>{/if}
                    {#each speeds as sp}<option value={sp}>{Math.round(sp * 100)} %</option>{/each}
                  </select>
                  <button class="chip" onclick={() => setSpeed(speed + 0.05)} aria-label={t('player.faster')}>+</button>
                </div>
              </div>
              <div class="prow">
                <span class="phead">{t('player.transpose')}
                  {#if semitones !== 0}<button class="linkbtn" onclick={() => setSemis(0)}>{t('player.reset')}</button>{/if}</span>
                <div class="stepper">
                  <button class="chip" onclick={() => setSemis(semitones - 1)} aria-label={t('player.down')}>−</button>
                  <span class="val">{semitones > 0 ? '+' : ''}{semitones}{#if keyLabel}&nbsp;·&nbsp;<span class="kl">{keyLabel}</span>{/if}</span>
                  <button class="chip" onclick={() => setSemis(semitones + 1)} aria-label={t('player.up')}>+</button>
                </div>
              </div>
              <label class="prow">
                <span>{t('player.countIn')}</span>
                <select bind:value={countIn}>
                  <option value={0}>{t('player.countIn.off')}</option>
                  {#each [1, 2, 3, 4] as n}<option value={n}>{n}</option>{/each}
                </select>
              </label>
              <label class="prow">
                <span>{t('player.volume')} <b>{Math.round(volume * 100)} %</b></span>
                <input type="range" min="0" max="1.5" step="0.05" bind:value={volume} />
              </label>
            </div>
          {/if}
        </div>
    </div>

    <canvas bind:this={canvas} class="wave" class:editing onpointerdown={onWavePointer} onpointermove={onWaveMove}></canvas>

    {#if !compact || markers.length}
      <div class="markers">
        {#if !compact}
          <button class="chip" class:on={editing} disabled={status !== 'ready'} onclick={() => (editing = !editing)}
            aria-pressed={editing} title={t('marker.edit.desc')}>✎ {t('marker.edit')}</button>
          {#if editing}
            <button class="chip add" disabled={status !== 'ready'} onclick={addHere}>+ {t('marker.here')}</button>
          {/if}
        {/if}
        {#if markers.length || !compact}
          <button class="chip mk" class:cur={sectionLoop && loopA === 0} onclick={() => jump(0)}>{t('marker.start')}</button>
        {/if}
        {#each markers as m (m.t)}
          <span class="mkwrap">
            <button class="chip mk" class:cur={sectionLoop && loopA !== null && Math.abs(loopA - m.t) < 0.01}
              onclick={() => (editing ? renameMarker(m) : jump(m.t))} title={editing ? t('marker.rename') : t('marker.jump')}>
              {m.label} <span class="mt">{fmtTime(m.t)}</span>
            </button>
            {#if editing}<button class="chip del" onclick={() => removeMarker(m)} aria-label={t('marker.delete')}>✕</button>{/if}
          </span>
        {/each}
        {#if editing}<span class="muted small">{t('marker.edit.hint')}</span>{/if}
        {#if markers.length && !editing}
          <button class="chip loop" class:on={sectionLoop} onclick={toggleSectionLoop} aria-pressed={sectionLoop}
            title={t('marker.section.desc')}>⟲ {t('marker.section')}</button>
        {/if}
      </div>
    {/if}

  {/if}
</div>

<style>
  .player { display: flex; flex-direction: column; gap: 12px; }
  .variants { display: flex; flex-wrap: wrap; gap: 6px; }
  .transport { display: flex; align-items: center; gap: 8px; }
  .time { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 15px; }
  .key { font-size: 13px; color: var(--accent); }
  .counting { color: var(--accent); margin-left: 6px; animation: blink 0.6s infinite; }
  @keyframes blink { 50% { opacity: 0.2; } }
  .wave {
    width: 100%; height: 84px; border-radius: 10px; background: var(--surface-2); touch-action: none; cursor: pointer;
    --wave: var(--wave-color); --loop: var(--loop-color); --loop-edge: var(--accent);
  }
  .compact .wave { height: 56px; }
  .wave.editing { cursor: copy; }
  .markers { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mkwrap { display: inline-flex; gap: 2px; }
  .mk { font-variant-numeric: tabular-nums; }
  .mk.cur { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .mt { color: var(--muted); font-size: 12px; margin-left: 4px; }
  .del { min-width: 32px; padding: 0 8px; }
  .add { border-color: var(--accent); color: var(--accent); }
  .small { font-size: 13px; }
  .muted { color: var(--muted); }
  /* rarely used options (count-in, volume) live in a small panel under the sliders icon */
  .opts { position: relative; }
  .optbtn { background: none; color: var(--muted); }
  .optbtn.on { color: var(--accent); background: var(--surface-2); }
  .panel {
    position: absolute; right: 0; top: calc(100% + 8px); z-index: 30; width: 300px; max-width: calc(100vw - 48px);
    display: flex; flex-direction: column; gap: 14px; padding: 14px 16px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px var(--shadow);
  }
  .prow { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
  .prow b { color: var(--text); font-weight: 600; margin-left: 4px; }
  .prow select { align-self: stretch; }
  .prow input { width: 100%; min-height: 32px; }
  .phead { display: flex; justify-content: space-between; align-items: center; min-height: 24px; }
  .stepper { display: flex; align-items: center; gap: 6px; }
  .stepper select { flex: 1; }
  .val { flex: 1; min-width: 92px; text-align: center; color: var(--text); font-size: 15px; font-variant-numeric: tabular-nums; }
  .kl { color: var(--accent); }
  .linkbtn { border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px; padding: 2px 0; cursor: pointer; }
  .loop { margin-left: auto; }
</style>
