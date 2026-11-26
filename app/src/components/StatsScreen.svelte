<script lang="ts">
  import { computeStats, weakest, type Level } from '../lib/stats';
  import { lib, settings, t, go } from '../lib/state.svelte';
  import type { I18nKey } from '../lib/i18n';
  import { srsPlan } from '../lib/session';
  import { DEFAULT_FILTER } from '../lib/library';

  const s = $derived(computeStats(lib.models, lib.catMap, lib.progress));
  const weak = $derived(weakest(s, 8));
  const dueToday = $derived(srsPlan(lib.models, lib.catMap, lib.progress, DEFAULT_FILTER).due.length);
  const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);
  const num = (x: number | null, d = 1) => (x === null ? '–' : x.toFixed(d).replace('.', settings.lang === 'de' ? ',' : '.'));
  const LEVELS: Level[] = ['secure', 'shaky', 'insecure', 'new'];
  const levelName = (l: Level) => t(`stats.level.${l}` as I18nKey);

  // categories: better first; never practised last
  const cats = $derived([...s.categories].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1)));
  const weekMax = $derived(Math.max(1, ...s.weeks.map((w) => w.yes + w.partly + w.no)));
  const hintMax = $derived(Math.max(1, ...s.hintHistogram));

  /** tap/hover readout for the bar charts (touch screens have no hover) */
  let tip = $state<{ chart: string; text: string } | null>(null);

  function weekLabel(start: string) {
    const d = new Date(start + 'T00:00:00');
    return d.toLocaleDateString(settings.lang, { day: 'numeric', month: 'numeric' });
  }

  function pieceName(p: { id: string; title: string; composer?: string; category: string }) {
    // blind mode: the statistics must not spoil pieces either
    if (settings.blind) return `${p.id} · ${lib.catMap.get(p.category)?.title ?? p.category}`;
    return `${p.composer ? p.composer + ': ' : ''}${p.title}`;
  }
</script>

{#if !s.attempts}
  <section class="card empty">
    <h2>{t('stats.title')}</h2>
    <p class="muted">{t('stats.empty')}</p>
  </section>
{:else}
  <div class="stats">
    <section class="tiles" aria-label={t('stats.overview')}>
      <div class="tile due"><span class="v">{dueToday}</span><span class="k">{t('stats.dueToday')}</span></div>
      <div class="tile"><span class="v">{s.practised}<small> / {s.pieces}</small></span><span class="k">{t('stats.practised')}</span></div>
      <div class="tile"><span class="v">{s.levels.secure}</span><span class="k">{t('stats.secure')}</span></div>
      <div class="tile"><span class="v">{pct(s.successRate)}</span><span class="k">{t('stats.success')}</span></div>
      <div class="tile"><span class="v">{pct(s.withoutHints)}</span><span class="k">{t('stats.noHints')}</span></div>
      <div class="tile"><span class="v">{s.attempts}</span><span class="k">{t('stats.attempts')}</span></div>
      <div class="tile"><span class="v">{s.streakDays}</span><span class="k">{t('stats.streak')}</span></div>
    </section>

    <section class="card wide">
      <h2>{t('stats.howSecure')}</h2>
      <p class="muted small">{t('stats.howSecure.desc')}</p>
      <div class="stack big" role="img" aria-label={LEVELS.map((l) => `${levelName(l)}: ${s.levels[l]}`).join(', ')}>
        {#each LEVELS as l}
          {#if s.levels[l]}<span class="seg {l}" style="flex-grow:{s.levels[l]}"></span>{/if}
        {/each}
      </div>
      <ul class="legend">
        {#each LEVELS as l}<li><span class="sw {l}"></span>{levelName(l)} <b>{s.levels[l]}</b></li>{/each}
      </ul>
    </section>

    <section class="card wide">
      <h2>{t('stats.byModel')}</h2>
      <p class="muted small">{t('stats.byModel.desc')}</p>
      <table class="cats">
        <thead>
          <tr>
            <th>{t('stats.col.model')}</th><th class="barcol">{t('stats.col.levels')}</th>
            <th class="n">{t('stats.col.success')}</th><th class="n">{t('stats.col.hints')}</th><th class="n">{t('stats.col.practised')}</th>
          </tr>
        </thead>
        <tbody>
          {#each cats as c (c.id)}
            <tr>
              <td><span class="cid">{c.id}</span> {c.title}</td>
              <td class="barcol">
                <div class="stack" role="img" aria-label={LEVELS.map((l) => `${levelName(l)}: ${c.levels[l]}`).join(', ')}>
                  {#each LEVELS as l}{#if c.levels[l]}<span class="seg {l}" style="flex-grow:{c.levels[l]}"></span>{/if}{/each}
                </div>
              </td>
              <td class="n">{pct(c.successRate)}</td>
              <td class="n">{num(c.avgHints)}</td>
              <td class="n">{c.practised} / {c.pieces}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <div class="flow">
    <section class="card">
      <h2>{t('stats.hints')}</h2>
      <p class="muted small">{t('stats.hints.desc', { avg: num(s.avgHints) })}</p>
      <div class="cols" role="img" aria-label={s.hintHistogram.map((n, h) => `${h}: ${n}`).join(', ')}>
        {#each s.hintHistogram as n, h}
          <button class="col" onpointerenter={() => (tip = { chart: 'h', text: t('stats.tip.hints', { h, n }) })}
            onclick={() => (tip = { chart: 'h', text: t('stats.tip.hints', { h, n }) })} onpointerleave={() => (tip = null)}>
            <span class="bar accent" style="height:{(n / hintMax) * 100}%"></span>
            <span class="xl">{h}</span>
          </button>
        {/each}
      </div>
      <p class="tip small">{tip?.chart === 'h' ? tip.text : t('stats.hints.axis')}</p>
    </section>

    <section class="card">
      <h2>{t('stats.weeks')}</h2>
      <p class="muted small">{t('stats.weeks.desc', { days: s.activeDays })}</p>
      <div class="cols" role="img" aria-label={s.weeks.map((w) => `${weekLabel(w.start)}: ${w.yes + w.partly + w.no}`).join(', ')}>
        {#each s.weeks as w}
          {@const total = w.yes + w.partly + w.no}
          {@const text = t('stats.tip.week', { d: weekLabel(w.start), n: total, yes: w.yes, partly: w.partly, no: w.no })}
          <button class="col" onpointerenter={() => (tip = { chart: 'w', text })} onclick={() => (tip = { chart: 'w', text })}
            onpointerleave={() => (tip = null)}>
            <span class="vstack" style="height:{(total / weekMax) * 100}%">
              {#if w.no}<span class="seg insecure" style="flex-grow:{w.no}"></span>{/if}
              {#if w.partly}<span class="seg shaky" style="flex-grow:{w.partly}"></span>{/if}
              {#if w.yes}<span class="seg secure" style="flex-grow:{w.yes}"></span>{/if}
            </span>
          </button>
        {/each}
      </div>
      <div class="xaxis"><span>{weekLabel(s.weeks[0].start)}</span><span>{t('stats.thisWeek')}</span></div>
      <ul class="legend">
        <li><span class="sw secure"></span>{t('practice.rate.yes')}</li>
        <li><span class="sw shaky"></span>{t('practice.rate.partly')}</li>
        <li><span class="sw insecure"></span>{t('practice.rate.no')}</li>
      </ul>
      <p class="tip small">{tip?.chart === 'w' ? tip.text : ''}</p>
    </section>

    {#if weak.length}
      <section class="card">
        <h2>{t('stats.practiseNext')}</h2>
        <p class="muted small">{t('stats.practiseNext.desc')}</p>
        <ul class="weak">
          {#each weak as p (p.id)}
            <li>
              <span class="dot2 {p.level}" aria-hidden="true"></span>
              <span class="name">{pieceName(p)}</span>
              <span class="muted small">{levelName(p.level)} · {pct(p.confidence)}</span>
            </li>
          {/each}
        </ul>
        <button class="btn primary" onclick={() => go({ name: 'practice', ids: weak.map((p) => p.id) })}>{t('stats.practiseThese', { n: weak.length })}</button>
      </section>
    {/if}
    </div>
  </div>
{/if}

<style>
  .stats { display: flex; flex-direction: column; gap: 14px; }
  /* the remaining cards flow into balanced columns (one column in portrait) */
  .flow { columns: 2 440px; column-gap: 14px; }
  .flow > section { break-inside: avoid; display: inline-block; width: 100%; margin: 0 0 14px; }
  h2 { margin: 0 0 4px; font-size: 17px; }
  .small { font-size: 13px; margin: 0 0 12px; }
  .muted { color: var(--muted); }
  .empty { max-width: 560px; margin: 40px auto; text-align: center; }

  /* 7 tiles: "due today" spans two cells, so every row is full */
  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .tile.due { grid-column: span 2; grid-row: span 1; border-color: var(--accent); }
  .tile.due .v { color: var(--accent); }
  @media (max-width: 520px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .tile { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
  .tile .v { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .tile .v small { font-size: 15px; color: var(--muted); font-weight: 500; }
  .tile .k { font-size: 13px; color: var(--muted); }

  /* stacked level bar: 2px gaps between segments, rounded ends */
  .stack { display: flex; gap: 2px; height: 12px; border-radius: 4px; overflow: hidden; min-width: 80px; }
  .stack.big { height: 22px; border-radius: 6px; }
  .seg { display: block; min-width: 3px; }
  .secure { background: var(--chart-good); }
  .shaky { background: var(--chart-mid); }
  .insecure { background: var(--chart-bad); }
  .new { background: var(--chart-new); }
  .legend { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; }
  .legend li { display: flex; align-items: center; gap: 6px; }
  .legend b { font-variant-numeric: tabular-nums; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }

  table.cats { width: 100%; border-collapse: collapse; font-size: 14px; }
  .cats th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px; padding: 0 8px 6px; border-bottom: 1px solid var(--line); }
  .cats td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .cats tr:last-child td { border-bottom: 0; }
  .cats .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cats .barcol { width: 30%; }
  .cid { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 4px; }
  @media (max-width: 600px) { .cats .barcol { display: none; } }

  .cols { display: flex; align-items: flex-end; gap: 4px; height: 140px; padding-bottom: 18px; position: relative; }
  .col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
    border: 0; background: none; padding: 0; cursor: pointer; position: relative; min-width: 0; }
  .col:hover .bar, .col:hover .vstack { filter: brightness(1.1); }
  .bar { display: block; width: min(70%, 34px); border-radius: 4px 4px 0 0; min-height: 2px; }
  .accent { background: var(--accent); }
  .vstack { display: flex; flex-direction: column; gap: 2px; width: min(70%, 34px); border-radius: 4px 4px 0 0; overflow: hidden; min-height: 0; }
  .vstack .seg { min-height: 2px; }
  .xl { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-size: 12px; color: var(--muted); }
  .xaxis { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-top: -12px; }
  .tip { min-height: 18px; margin: 8px 0 0; color: var(--text); }

  .weak { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; }
  .weak li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .weak li:last-child { border-bottom: 0; }
  .weak .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot2 { width: 10px; height: 10px; border-radius: 5px; flex: none; }
  .weak .small { margin: 0; white-space: nowrap; }
</style>
