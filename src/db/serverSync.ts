import { db } from './schema';

const syncedTableNames = [
  'projects', 'calendarDays', 'courseSchedules', 'scheduleOverrides', 'teachingTasks',
  'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'weeklyNotes',
  'planAnnotations', 'specialDuties', 'exams', 'examFiles', 'teachers', 'settings',
] as const;

type SyncState = 'local' | 'connecting' | 'synced' | 'syncing' | 'error';
export type SyncStatus = { state: SyncState; message: string };
type Snapshot = { schemaVersion: 1; tables: Record<string, unknown[]> };
type ServerState = {
  revision: number;
  updatedAt: string;
  snapshot: Snapshot;
  blobs: Array<{ id: string; type: string; size: number }>;
};

export const SYNC_EVENT = 'curriculumflow-sync';
let revision = 0;
let lastFingerprint = '';
let syncing: Promise<void> | undefined;
let enabled = false;
let serverBlobs = new Map<string, { type: string; size: number }>();
let currentStatus: SyncStatus = { state: window.location.protocol === 'file:' ? 'local' : 'connecting', message: '' };

function publish(state: SyncState, message = '') {
  currentStatus = { state, message };
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: currentStatus }));
}

export function getSyncStatus() { return currentStatus; }

function stableRows(rows: unknown[]) {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function exportSnapshot(): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  await Promise.all(syncedTableNames.map(async name => { tables[name] = stableRows(await db.table(name).toArray()); }));
  return { schemaVersion: 1, tables };
}

async function importServerState(state: ServerState) {
  const fileBlobs = await Promise.all(state.blobs.map(async item => {
    const response = await fetch(`/api/blobs/${encodeURIComponent(item.id)}`);
    if (!response.ok) throw new Error(`附件 ${item.id} 下载失败`);
    return { id: item.id, blob: await response.blob() };
  }));
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
    for (const name of syncedTableNames) {
      const rows = state.snapshot.tables[name] ?? [];
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
    if (fileBlobs.length) await db.fileBlobs.bulkAdd(fileBlobs);
  });
  revision = state.revision;
  serverBlobs = new Map(state.blobs.map(item => [item.id, { type: item.type, size: item.size }]));
  lastFingerprint = JSON.stringify(state.snapshot);
}

async function uploadCurrentState(force = false) {
  const snapshot = await exportSnapshot();
  const fingerprint = JSON.stringify(snapshot);
  const localBlobs = await db.fileBlobs.toArray();
  const blobFingerprint = JSON.stringify(localBlobs.map(item => [item.id, item.blob.type, item.blob.size]).sort());
  const completeFingerprint = `${fingerprint}\n${blobFingerprint}`;
  if (!force && completeFingerprint === lastFingerprint) return;

  publish('syncing');
  for (const item of localBlobs) {
    const known = serverBlobs.get(item.id);
    if (known?.size === item.blob.size && known.type === item.blob.type) continue;
    const response = await fetch(`/api/blobs/${encodeURIComponent(item.id)}`, {
      method: 'PUT', headers: { 'Content-Type': item.blob.type || 'application/octet-stream' }, body: item.blob,
    });
    if (!response.ok) throw new Error(`附件 ${item.id} 上传失败`);
    serverBlobs.set(item.id, { type: item.blob.type || 'application/octet-stream', size: item.blob.size });
  }

  let response = await fetch('/api/state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: revision, snapshot, blobIds: localBlobs.map(item => item.id) }),
  });
  if (response.status === 409) {
    const latest = await fetch('/api/state');
    if (!latest.ok) throw new Error('无法读取服务器上的最新数据');
    revision = ((await latest.json()) as ServerState).revision;
    response = await fetch('/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: revision, snapshot, blobIds: localBlobs.map(item => item.id) }),
    });
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '同步失败');
  const result = await response.json();
  revision = result.revision;
  lastFingerprint = completeFingerprint;
  publish('synced');
}

export function syncNow() {
  if (!enabled) return Promise.resolve();
  if (!syncing) {
    syncing = uploadCurrentState().catch(error => {
      console.error('CurriculumFlow SQLite sync failed', error);
      publish('error', error instanceof Error ? error.message : '同步失败');
    }).finally(() => { syncing = undefined; });
  }
  return syncing;
}

export async function initializeServerSync() {
  if (window.location.protocol === 'file:') return publish('local');
  publish('connecting');
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 503) return publish('local');
    if (response.ok && response.status !== 204 && !response.headers.get('content-type')?.includes('application/json')) return publish('local');
    enabled = true;
    if (response.status === 204) {
      await uploadCurrentState(true);
    } else if (response.ok) {
      await importServerState(await response.json() as ServerState);
      const localBlobs = await db.fileBlobs.toArray();
      lastFingerprint = `${lastFingerprint}\n${JSON.stringify(localBlobs.map(item => [item.id, item.blob.type, item.blob.size]).sort())}`;
      publish('synced');
    } else throw new Error(`服务器响应异常（${response.status}）`);
    window.setInterval(() => void syncNow(), 1500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void syncNow(); });
  } catch (error) {
    enabled = false;
    console.error('CurriculumFlow SQLite initialization failed', error);
    publish('error', error instanceof Error ? error.message : '无法连接 SQLite 服务');
  }
}
