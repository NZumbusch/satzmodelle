<script lang="ts">
  import { ALL_STEPS, type StepId } from '../lib/library';
  import { lib, settings, saveSettings, t, reloadLibrary } from '../lib/state.svelte';
  import { runImport } from '../lib/importUi.svelte';
  import { db, deleteAllData, deletePack, estimateStorage } from '../lib/db';
  import { formatBytes, type I18nKey } from '../lib/i18n';
  import { forgetUrls } from '../lib/media';
  import { syncUi, connect, disconnect, syncNow } from '../lib/sync.svelte';
  import { backupToFile, backupToDrive, driveBackups, restoreFromFile, restoreFromDrive } from '../lib/backupUi.svelte';
  import type { DriveFile } from '../lib/drive';
  import UpdateCard from './UpdateCard.svelte';
  import { updates, check } from '../lib/updates.svelte';

  let restoreMode = $state<'merge' | 'replace'>('merge');
  let remoteBackups = $state<DriveFile[] | null>(null);
  async function showDriveBackups() {
    try { remoteBackups = await driveBackups(); } catch (e) { syncUi.error = e instanceof Error ? e.message : String(e); }
  }
  function confirmRestore(): boolean {
    return restoreMode === 'merge' || confirm(t('backup.replace.confirm'));
  }
  function toggleFull() {
    if (!settings.drive.full && !confirm(t('sync.full.confirm'))) return;
    settings.drive.full = !settings.drive.full;
    saveSettings();
    if (settings.drive.full) syncNow(false);
  }

  let usage = $state<number | undefined>();
  $effect(() => {
    void lib.packs.length;
    estimateStorage().then((e) => (usage = e.usage));
  });

  const order: StepId[] = $derived(settings.ladder.order.filter((s) => s !== 'reveal'));

  function move(id: StepId, dir: -1 | 1) {
    const o = [...order];
    const i = o.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    settings.ladder.order = [...o, 'reveal'];
    saveSettings();
  }

  async function removePack(id: string) {
    if (!confirm(t('set.deletePack.confirm'))) return;
    await deletePack(id);
    forgetUrls();
    await reloadLibrary();
    syncNow(false);
  }

  async function wipe() {
    if (!confirm(t('set.deleteAll.confirm'))) return;
    await deleteAllData();
    forgetUrls();
    await reloadLibrary();
  }

  async function resetProgress() {
    if (!confirm(t('set.resetProgress.confirm'))) return;
    await (await db()).clear('progress');
    // so the synced copy drops the old attempts too
    settings.drive.resetAt = new Date().toISOString();
    saveSettings();
    await reloadLibrary();
    syncNow(false);
  }

  const hasFolderPicker = 'webkitdirectory' in document.createElement('input') && !/Android/i.test(navigator.userAgent);
  void ALL_STEPS;
</script>

<div class="settings">
  <section class="card">
    <h2>{t('set.language')}</h2>
    <div class="row">
      {#each [['de', 'Deutsch'], ['en', 'English']] as const as [code, name]}
        <button class="chip" class:on={settings.lang === code} onclick={() => { settings.lang = code; saveSettings(); }}>{name}</button>
      {/each}
    </div>
    <h2 class="sub">{t('set.theme')}</h2>
    <div class="row">
      {#each ['system', 'light', 'dark'] as const as th}
        <button class="chip" class:on={settings.theme === th} onclick={() => { settings.theme = th; saveSettings(); }}>{t(`set.theme.${th}`)}</button>
      {/each}
    </div>
  </section>

  <section class="card">
    <h2>{t('set.ladder')}</h2>
    <p class="muted small">{t('set.ladder.desc')}</p>
    <ol class="ladder">
      {#each order as id, i (id)}
        <li>
          <label class="check">
            <input type="checkbox" bind:checked={settings.ladder.enabled[id]} onchange={saveSettings} />
            <span class="two"><b>{t(`step.${id}` as I18nKey)}</b><span class="muted small">{t(`step.desc.${id}` as I18nKey)}</span></span>
          </label>
          <span class="row">
            <button class="chip" disabled={i === 0} onclick={() => move(id, -1)} aria-label={t('set.up')}>↑</button>
            <button class="chip" disabled={i === order.length - 1} onclick={() => move(id, 1)} aria-label={t('set.down')}>↓</button>
          </span>
        </li>
      {/each}
      <li class="fixed"><span class="two"><b>{t('step.reveal')}</b><span class="muted small">{t('step.desc.reveal')}</span></span></li>
    </ol>
    <label class="check"><input type="checkbox" bind:checked={settings.blind} onchange={saveSettings} />
      <span class="two">{t('set.blind')}<span class="muted small">{t('set.blind.desc')}</span></span></label>
    <label class="check"><input type="checkbox" bind:checked={settings.confirmReveal} onchange={saveSettings} />{t('set.confirmReveal')}</label>
  </section>

  <section class="card">
    <h2>{t('player.speed')}</h2>
    <div class="row">
      <span class="muted">{t('set.defaultSpeed')}</span>
      <select bind:value={settings.defaultSpeed} onchange={saveSettings}>
        {#each [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1] as s}<option value={s}>{Math.round(s * 100)} %</option>{/each}
      </select>
    </div>
    <label class="check"><input type="checkbox" bind:checked={settings.rememberSpeed} onchange={saveSettings} />{t('set.rememberSpeed')}</label>
    <h2 class="sub">{t('set.voice')}</h2>
    <div class="row">
      {#each ['piano', 'harpsichord', 'organ'] as const as v}
        <button class="chip" class:on={settings.synthVoice === v} onclick={() => { settings.synthVoice = v; saveSettings(); }}>{t(`set.voice.${v}`)}</button>
      {/each}
    </div>
    <h2 class="sub">{t('set.audioSource')}</h2>
    <label class="check"><input type="radio" name="src" value="recordings" bind:group={settings.audioSource} onchange={saveSettings} />{t('set.audioSource.recordings')}</label>
    <label class="check"><input type="radio" name="src" value="generated" bind:group={settings.audioSource} onchange={saveSettings} /><span class="two">{t('set.audioSource.generated')}<span class="muted small">{t('set.audioSource.generated.desc')}</span></span></label>
  </section>

  <section class="card">
    <h2>{t('set.library')}</h2>
    <p class="muted small">{t('set.storage', { used: formatBytes(usage ?? 0) })}</p>
    {#if lib.packs.length}
      <h3 class="muted small">{t('set.packs')}</h3>
      <ul class="packs">
        {#each lib.packs as p (p.id)}
          <li>
            <span><b>{p.name}</b> <span class="muted small">{new Date(p.importedAt).toLocaleDateString()} · {lib.raw.filter((m) => (m as { pack?: string }).pack === p.id).length} · {formatBytes(p.bytes)}</span></span>
            <button class="chip" onclick={() => removePack(p.id)}>{t('set.deletePack')}</button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="row">
      <button class="btn" onclick={() => runImport('replace')}>{t('set.import.replace')}</button>
      <button class="btn" onclick={() => runImport('add')}>{t('set.import.add')}</button>
      {#if hasFolderPicker}<button class="btn" onclick={() => runImport('add', 'folder')}>{t('set.import.folder')}</button>{/if}
    </div>
    <div class="row danger">
      <button class="btn" onclick={resetProgress}>{t('set.resetProgress')}</button>
      <button class="btn bad" onclick={wipe}>{t('set.deleteAll')}</button>
    </div>
  </section>

  <section class="card">
    <h2>{t('sync.title')}</h2>
    <p class="muted small">{t('sync.desc')}</p>
    {#if !syncUi.available}
      <p class="muted small">{t('sync.onlyAndroid')}</p>
    {:else if settings.drive.enabled}
      <p class="small">{t('sync.connected', { email: settings.drive.email || 'Google' })}</p>
      <p class="muted small">{settings.drive.lastSync ? t('sync.last', { when: new Date(settings.drive.lastSync).toLocaleString() }) : t('sync.never')}</p>
      <label class="check"><input type="checkbox" checked={settings.drive.full} onchange={toggleFull} />
        <span class="two">{t('sync.full')}<span class="muted small">{t('sync.full.desc')}</span></span></label>
      {#if settings.drive.full}
        <label class="check"><input type="checkbox" bind:checked={settings.drive.recordings} onchange={saveSettings} />{t('sync.recordings')}</label>
        <label class="check"><input type="checkbox" bind:checked={settings.drive.wifiOnly} onchange={saveSettings} />{t('sync.wifiOnly')}</label>
      {/if}
      {#if syncUi.full}
        <p class="muted small">{t('sync.fullProgress', { done: syncUi.full.done, total: syncUi.full.total, mb: (syncUi.full.bytes / 1048576).toFixed(1) })}</p>
        <progress max={syncUi.full.total || 1} value={syncUi.full.done}></progress>
      {/if}
      {#if syncUi.note === 'wifi'}<p class="muted small">{t('sync.waitingWifi')}</p>{/if}
      <div class="row">
        <button class="btn" disabled={syncUi.busy} onclick={() => syncNow(true)}>{syncUi.busy ? t('sync.busy') : t('sync.now')}</button>
        <button class="btn" onclick={disconnect}>{t('sync.disconnect')}</button>
      </div>
    {:else}
      <button class="btn primary" onclick={connect}>{t('sync.connect')}</button>
    {/if}
    {#if syncUi.error}<p class="err small">{t('sync.error', { msg: syncUi.error })}</p>{/if}
    {#if syncUi.configHint}
      <div class="hint small">
        <p>{t('sync.hint.intro')}</p>
        <dl>
          <dt>{t('sync.hint.package')}</dt><dd><code>{syncUi.configHint.packageName}</code></dd>
          <dt>SHA-1</dt><dd><code>{syncUi.configHint.sha1}</code></dd>
        </dl>
        <p class="muted">{t('sync.hint.steps')}</p>
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>{t('backup.title')}</h2>
    <p class="muted small">{t('backup.desc')}</p>
    <div class="row">
      <button class="btn" onclick={backupToFile}>{t('backup.toFile')}</button>
      {#if syncUi.available && settings.drive.enabled}
        <button class="btn" onclick={backupToDrive}>{t('backup.toDrive')}</button>
      {/if}
    </div>
    <h3 class="muted small">{t('backup.restore')}</h3>
    <div class="row">
      {#each ['merge', 'replace'] as const as m}
        <button class="chip" class:on={restoreMode === m} onclick={() => (restoreMode = m)}>{t(`backup.mode.${m}`)}</button>
      {/each}
    </div>
    <div class="row">
      <button class="btn" onclick={() => confirmRestore() && restoreFromFile(restoreMode)}>{t('backup.fromFile')}</button>
      {#if syncUi.available && settings.drive.enabled}
        <button class="btn" onclick={showDriveBackups}>{t('backup.fromDrive')}</button>
      {/if}
    </div>
    {#if remoteBackups}
      {#if !remoteBackups.length}<p class="muted small">{t('backup.noneDrive')}</p>{/if}
      <ul class="packs">
        {#each remoteBackups as b (b.id)}
          <li>
            <span>{new Date(b.appProperties?.createdAt ?? b.modifiedTime ?? '').toLocaleString()} <span class="muted small">{formatBytes(Number(b.size ?? 0))}</span></span>
            <button class="chip" onclick={() => confirmRestore() && restoreFromDrive(b.id, restoreMode)}>{t('backup.restoreThis')}</button>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="muted small">{t('backup.private')}</p>
  </section>

  <section class="card">
    <h2>{t('set.about')}</h2>
    <p class="small">{t('upd.version', { v: __APP_VERSION__, c: __APP_COMMIT__ })}</p>
    {#if updates.available}
      <label class="check"><input type="checkbox" bind:checked={settings.updates.auto} onchange={saveSettings} />
        <span class="two">{t('upd.auto')}<span class="muted small">{t('upd.auto.desc')}</span></span></label>
      <UpdateCard />
      <div class="row">
        <button class="btn" disabled={updates.checking} onclick={() => check(true)}>{updates.checking ? t('upd.checking') : t('upd.check')}</button>
      </div>
      {#if updates.note === 'uptodate'}<p class="muted small">{t('upd.uptodate')}</p>{/if}
      {#if updates.note === 'nothing'}<p class="muted small">{t('upd.nothing')}</p>{/if}
      {#if updates.note === 'error'}<p class="err small">{t('upd.error', { msg: updates.error })}</p>{/if}
    {/if}
    <p class="muted small">{t('set.about.text')}</p>
  </section>
</div>

<style>
  /* masonry-like columns: cards of different heights stack without gaps */
  .settings { columns: 400px 3; column-gap: 14px; }
  .settings > section { break-inside: avoid; margin: 0 0 14px; display: inline-block; width: 100%; }
  h2 { margin: 0 0 10px; font-size: 17px; }
  .sub { margin-top: 16px; }
  h3 { margin: 12px 0 4px; font-weight: 500; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
  .check { display: flex; gap: 12px; align-items: center; min-height: 44px; padding: 4px 0; }
  .two { display: flex; flex-direction: column; gap: 1px; line-height: 1.3; }
  .check input { width: 20px; height: 20px; accent-color: var(--accent); flex: none; }
  .ladder { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 2px; }
  .ladder li { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); }
  .ladder .row { flex-wrap: nowrap; flex: none; }
  .ladder .fixed { min-height: 52px; opacity: 0.7; padding-left: 32px; }
  .packs { list-style: none; padding: 0; margin: 0 0 8px; }
  .packs li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; }
  .danger { margin-top: 16px; }
  .small { font-size: 13px; }
  .err { color: var(--bad); }
  .hint { background: var(--surface-2); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
  .hint p { margin: 0 0 6px; }
  .hint dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 0 0 6px; }
  .hint dd { margin: 0; overflow-wrap: anywhere; }
  .hint code { user-select: all; font-size: 12px; }
  .muted { color: var(--muted); }
</style>
