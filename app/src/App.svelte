<script lang="ts">
  import { onMount } from 'svelte';
  import StartScreen from './components/StartScreen.svelte';
  import Practice from './components/Practice.svelte';
  import LibraryBrowser from './components/LibraryBrowser.svelte';
  import ModelDetail from './components/ModelDetail.svelte';
  import Settings from './components/Settings.svelte';
  import ImportOverlay from './components/ImportOverlay.svelte';
  import ExerciseEditor from './components/ExerciseEditor.svelte';
  import BusyOverlay from './components/BusyOverlay.svelte';
  import StatsScreen from './components/StatsScreen.svelte';
  import { nav, back, home, reloadLibrary, settings, t } from './lib/state.svelte';
  import { initNative } from './lib/native';

  const route = $derived(nav.stack[nav.stack.length - 1]);
  const tab = $derived(nav.stack.some((r) => r.name === 'stats') ? 'stats' : nav.stack.some((r) => r.name === 'settings') ? 'settings' : nav.stack.some((r) => r.name === 'library' || r.name === 'model' || r.name === 'editor') && !nav.stack.some((r) => r.name === 'practice') ? 'library' : 'start');

  $effect(() => { document.documentElement.lang = settings.lang; });
  $effect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
    // status bar / browser chrome follow the page background
    requestAnimationFrame(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    });
  });

  onMount(() => {
    reloadLibrary();
    initNative();
    // keep the browser back button in step with the in-app stack
    const onPop = () => { if (!back()) history.pushState(null, ''); };
    history.pushState(null, '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
</script>

<header class="top">
  <div class="left">
    {#if nav.stack.length > 1}
      <button class="icon" onclick={back} aria-label={t('nav.back')}>
        <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" /></svg>
      </button>
    {/if}
    <h1>{t('app.title')}</h1>
  </div>
  <nav>
    <button class="tab" class:on={tab === 'start'} onclick={() => home('start')}>{t('nav.practice')}</button>
    <button class="tab" class:on={tab === 'library'} onclick={() => home('library')}>{t('nav.library')}</button>
    <button class="tab" class:on={tab === 'stats'} onclick={() => home('stats')}>{t('nav.stats')}</button>
    <button class="tab" class:on={tab === 'settings'} onclick={() => home('settings')}>{t('nav.settings')}</button>
  </nav>
</header>

<main>
  {#key nav.stack.length + route.name}
    {#if route.name === 'start'}
      <StartScreen />
    {:else if route.name === 'practice'}
      <Practice ids={route.ids} />
    {:else if route.name === 'library'}
      <LibraryBrowser />
    {:else if route.name === 'model'}
      <ModelDetail id={route.id} />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'stats'}
      <StatsScreen />
    {:else if route.name === 'editor'}
      <ExerciseEditor id={route.id} />
    {/if}
  {/key}
</main>

<ImportOverlay />
<BusyOverlay />

<style>
  .top {
    position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: calc(env(safe-area-inset-top) + 8px) 16px 8px; background: var(--bg); border-bottom: 1px solid var(--line);
  }
  .left { display: flex; align-items: center; gap: 6px; min-width: 0; }
  h1 { font-size: 19px; margin: 0; white-space: nowrap; }
  nav { display: flex; gap: 4px; }
  .tab { border: 0; background: none; color: var(--muted); font: inherit; font-weight: 500; padding: 10px 12px; border-radius: 10px; min-height: 44px; cursor: pointer; }
  .tab.on { color: var(--text); background: var(--surface-2); }
  main { padding: 16px 16px calc(env(safe-area-inset-bottom) + 24px); max-width: 1200px; margin: 0 auto; }
  @media (max-width: 520px) {
    .tab { padding: 8px; font-size: 14px; }
    h1 { display: none; }
  }
</style>
