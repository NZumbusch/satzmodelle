// Markers are stored with the user's edits of a model (overrides), so backup and Drive sync include them.
import { putOverride } from './db';
import { lib } from './state.svelte';
import { scheduleSync } from './sync.svelte';
import type { Marker } from './types';

export function getMarkers(modelId: string, trackId: string): Marker[] {
  return [...(lib.overrides.get(modelId)?.markers?.[trackId] ?? [])].sort((a, b) => a.t - b.t);
}

export async function saveMarkers(modelId: string, trackId: string, list: Marker[]) {
  const prev = lib.overrides.get(modelId) ?? { id: modelId };
  const markers = { ...(prev.markers ?? {}) };
  if (list.length) markers[trackId] = [...list].sort((a, b) => a.t - b.t);
  else delete markers[trackId];
  const next = { ...prev, markers };
  await putOverride(next);
  lib.overrides.set(modelId, next);
  scheduleSync();
}

/** Section boundaries [start, end) around time t, given sorted markers. */
export function sectionAt(markers: Marker[], t: number, duration: number): [number, number] {
  const starts = [0, ...markers.map((m) => m.t).filter((x) => x > 0.05 && x < duration - 0.05)];
  let i = 0;
  for (let k = 0; k < starts.length; k++) if (starts[k] <= t + 0.02) i = k;
  return [starts[i], starts[i + 1] ?? duration];
}

/** Next default label: 1, 2, 3 … (first free number). */
export function nextLabel(markers: Marker[]): string {
  const used = new Set(markers.map((m) => m.label));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
