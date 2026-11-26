// Decide what a full sync has to do. Pure function, unit-tested.
// local: what this device has; remote: what Drive has (deleted = tombstone left by another device);
// synced: the state both sides had after this device's last successful sync.

export interface RemoteUnit { updatedAt: string; deleted: boolean; fileId: string }
export type Action =
  | { type: 'upload'; key: string }
  | { type: 'download'; key: string }
  | { type: 'deleteLocal'; key: string }
  | { type: 'tombstone'; key: string };

export function plan(
  local: Map<string, string>, remote: Map<string, RemoteUnit>, synced: Record<string, string>,
): Action[] {
  const out: Action[] = [];
  const keys = new Set([...local.keys(), ...remote.keys(), ...Object.keys(synced)]);
  for (const key of [...keys].sort()) {
    const L = local.get(key);
    const R = remote.get(key);
    const S = synced[key];
    if (L !== undefined) {
      if (!R) out.push({ type: 'upload', key });
      else if (R.deleted) {
        // deleted elsewhere: follow, unless this device changed it since the last sync
        if (S !== undefined && L <= S) out.push({ type: 'deleteLocal', key });
        else out.push({ type: 'upload', key });
      } else if (L > R.updatedAt) out.push({ type: 'upload', key });
      else if (R.updatedAt > L) out.push({ type: 'download', key });
    } else if (R && !R.deleted) {
      // missing here: deleted on this device (then tell the others) or new from another device
      if (S !== undefined && R.updatedAt <= S) out.push({ type: 'tombstone', key });
      else out.push({ type: 'download', key });
    }
  }
  // downloads first (a replaced library arrives before the old one is removed), deletions last
  const order = { download: 0, upload: 1, tombstone: 2, deleteLocal: 3 } as const;
  return out.sort((a, b) => order[a.type] - order[b.type]);
}
