import { CurriculumDatabase, db } from './schema';
import { getAuth } from '../auth';
import { fileContent } from './fileContent';

async function serverFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && getAuth()) {
    window.location.reload();
    throw new Error('登录已过期，请重新登录；本地未同步修改仍保留在本账号缓存中。');
  }
  return response;
}

const syncedTableNames = [
  'projects', 'calendarDays', 'courseSchedules', 'scheduleOverrides', 'teachingTasks',
  'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'weeklyNotes',
  'planAnnotations', 'specialDuties', 'exams', 'examFiles', 'teachers', 'settings',
] as const;

type SyncState = 'local' | 'connecting' | 'synced' | 'syncing' | 'error' | 'conflict';
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
let initializing: Promise<void> | undefined;
let enabled = false;
let initialized = false;
let watching = false;
type Checkpoint = { revision: number; fingerprint: string };
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
  await db.transaction('r', syncedTableNames.map(name => db.table(name)), async () => {
    for (const name of syncedTableNames) tables[name] = stableRows(await db.table(name).toArray());
  });
  return { schemaVersion: 1, tables };
}

async function captureLocalState() {
  return db.transaction('r', [...syncedTableNames.map(name => db.table(name)), db.fileBlobs], async () => {
    const snapshot = await exportSnapshot();
    const blobs = await db.fileBlobs.toArray();
    const fingerprint = JSON.stringify(snapshot);
    return { snapshot, blobs, fingerprint };
  });
}

function serverFingerprint(state: ServerState) {
  const tables: Record<string, unknown[]> = {};
  for (const name of syncedTableNames) tables[name] = stableRows(state.snapshot.tables[name] ?? []);
  return JSON.stringify({ schemaVersion: 1, tables });
}

async function checkpoint(fingerprint: string) {
  lastFingerprint = fingerprint;
  await db.syncMetadata.put({ key: 'checkpoint', value: { revision, fingerprint } satisfies Checkpoint });
}

function conflict() {
  publish('conflict', '服务器与本机都有修改，已停止上传以保护两份数据。请先下载本地副本，再选择读取服务器。');
}

async function importServerState(state: ServerState, expectedFingerprint: string) {
  await db.transaction('rw', db.tables, async () => {
    if ((await captureLocalState()).fingerprint !== expectedFingerprint) throw new Error('读取服务器期间本地发生了修改，已保留本地数据，请重试同步。');
    for (const name of syncedTableNames) {
      const rows = state.snapshot.tables[name] ?? [];
      const table = db.table(name);
      const keyPath = table.schema.primKey.keyPath;
      const key = (row: unknown) => {
        const record = row as Record<string, unknown>;
        return JSON.stringify(Array.isArray(keyPath) ? keyPath.map(part => record[part]) : record[keyPath as string]);
      };
      const keys = new Set(rows.map(key));
      await table.filter(row => !keys.has(key(row))).delete();
      const old = new Map((await table.toArray()).map(row => [key(row), JSON.stringify(row)]));
      const changed = rows.filter(row => old.get(key(row)) !== JSON.stringify(row));
      if (changed.length) await table.bulkPut(changed);
    }
    const ids = new Set(state.blobs.map(item => item.id));
    await db.fileBlobs.filter(item => !ids.has(item.id)).delete();
    revision = state.revision;
    await checkpoint((await captureLocalState()).fingerprint);
  });
  revision = state.revision;
  serverBlobs = new Map(state.blobs.map(item => [item.id, { type: item.type, size: item.size }]));
}

async function uploadCurrentState(force = false) {
  const { snapshot, blobs: localBlobs, fingerprint: completeFingerprint } = await captureLocalState();
  if (!force && completeFingerprint === lastFingerprint) {
    const version = await serverFetch('/api/state/revision', { cache: 'no-store' });
    if (version.ok && (await version.json()).revision === revision) { publish('synced'); return; }
    const latest = await serverFetch('/api/state', { cache: 'no-store' });
    if (!latest.ok) throw new Error('无法读取服务器上的最新数据');
    const state = await latest.json() as ServerState;
    if (state.revision !== revision) await importServerState(state, completeFingerprint);
    publish('synced');
    return;
  }

  publish('syncing');
  for (const item of localBlobs) {
    if (!(snapshot.tables.examFiles as Array<{ blobId: string }>).some(file => file.blobId === item.id)) continue;
    const known = serverBlobs.get(item.id);
    if (known?.size === item.blob.size && known.type === item.blob.type) continue;
    const response = await serverFetch(`/api/blobs/${encodeURIComponent(item.id)}`, {
      method: 'PUT', headers: { 'Content-Type': item.blob.type || 'application/octet-stream' }, body: item.blob,
    });
    if (!response.ok) throw new Error(`附件 ${item.id} 上传失败`);
    serverBlobs.set(item.id, { type: item.blob.type || 'application/octet-stream', size: item.blob.size });
  }

  const response = await serverFetch('/api/state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: revision, snapshot, blobIds: localBlobs.map(item => item.id) }),
  });
  if (response.status === 409) {
    conflict();
    return;
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '同步失败');
  const result = await response.json();
  revision = result.revision;
  await checkpoint(completeFingerprint);
  // The server may have merged another group's changes or assigned a group to
  // a newly created admin project. Refresh only if no edit happened in flight.
  if ((await captureLocalState()).fingerprint === completeFingerprint) {
    const latest = await serverFetch('/api/state', { cache: 'no-store' });
    if (latest.ok) {
      const state = await latest.json() as ServerState;
      if (serverFingerprint(state) !== completeFingerprint) await importServerState(state, completeFingerprint);
    }
  }
  publish('synced');
}

export function syncNow() {
  if (!enabled || currentStatus.state === 'conflict') return Promise.resolve();
  if (!syncing) {
    syncing = (initialized ? uploadCurrentState() : initializeServerSync()).catch(error => {
      console.error('CurriculumFlow SQLite sync failed', error);
      publish('error', error instanceof Error ? error.message : '同步失败');
    }).finally(() => { syncing = undefined; });
  }
  return syncing;
}

export function initializeServerSync() {
  if (!initializing) initializing = connectServerSync().finally(() => { initializing = undefined; });
  return initializing;
}

async function connectServerSync() {
  if (window.location.protocol === 'file:') return publish('local');
  enabled = true;
  if (!watching) {
    watching = true;
    window.setInterval(() => void syncNow(), 1500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void syncNow(); });
  }
  publish('connecting');
  try {
    const response = await serverFetch('/api/state', { headers: { Accept: 'application/json' } });
    if (response.status === 404 || (response.ok && response.status !== 204 && !response.headers.get('content-type')?.includes('application/json'))) { enabled = false; return publish('local'); }
    const saved = (await db.syncMetadata.get('checkpoint'))?.value as Checkpoint | undefined;
    if (saved) { revision = saved.revision; lastFingerprint = saved.fingerprint.split('\n')[0]; }
    const local = await captureLocalState();
    if (response.status === 204) {
      revision = 0;
      serverBlobs.clear();
      await uploadCurrentState(true);
    } else if (response.ok) {
      const state = await response.json() as ServerState;
      const dirty = saved ? local.fingerprint !== lastFingerprint : local.fingerprint !== serverFingerprint(state) && (local.blobs.length > 0 || Object.values(local.snapshot.tables).some(rows => rows.length > 0));
      if (dirty) {
        if (saved) await uploadCurrentState();
        else conflict();
      } else { await importServerState(state, local.fingerprint); publish('synced'); }
    } else throw new Error(`服务器响应异常（${response.status}）`);
    initialized = true;
  } catch (error) {
    console.error('CurriculumFlow SQLite initialization failed', error);
    publish('error', error instanceof Error ? error.message : '无法连接 SQLite 服务');
  }
}

export async function readServerKeepingLocalCopy() {
  if (getAuth()?.user) {
    for (const file of await db.examFiles.toArray()) await fileContent(file.blobId);
  }
  const local = await captureLocalState();
  await db.syncMetadata.put({ key: `recovery:${new Date().toISOString()}`, value: local });
  const response = await serverFetch('/api/state', { cache: 'no-store' });
  if (!response.ok) throw new Error('读取服务器失败，本地副本已保留。');
  await importServerState(await response.json() as ServerState, local.fingerprint);
  initialized = true;
  publish('synced');
}

export async function buildLocalRecovery(key?: string) {
  const { default: JSZip } = await import('jszip');
  if (!key && getAuth()?.user) {
    for (const file of await db.examFiles.toArray()) await fileContent(file.blobId);
  }
  const local = key ? (await db.syncMetadata.get(key))?.value as Awaited<ReturnType<typeof captureLocalState>> | undefined : await captureLocalState();
  if (!local) throw new Error('本地副本不存在。');
  const zip = new JSZip();
  zip.file('workspace.json', JSON.stringify(local.snapshot));
  for (const item of local.blobs) zip.file(`files/${item.id}.bin`, await item.blob.arrayBuffer());
  const temporary = new CurriculumDatabase(`recovery-export-${crypto.randomUUID()}`);
  try {
    await temporary.transaction('rw', temporary.tables, async () => {
      for (const name of syncedTableNames) await temporary.table(name).bulkAdd(local.snapshot.tables[name] ?? []);
      await temporary.fileBlobs.bulkAdd(local.blobs);
    });
    const { exportProjectBackup } = await import('./repositories/backup');
    const errors: string[] = [];
    for (const project of await temporary.projects.toArray()) {
      try {
        const result = await exportProjectBackup(project.id, temporary);
        zip.file(`projects/${project.id}.zip`, await result.blob.arrayBuffer());
      } catch (caught) { errors.push(`${project.id}: ${caught instanceof Error ? caught.message : '项目备份生成失败'}`); }
    }
    zip.file('README.txt', 'projects 文件夹中的 ZIP 可在应用的完整备份页面逐个恢复。workspace.json 和 files 保存完整原始副本。如存在 project-backup-errors.txt，请保留原始副本以便修复。');
    if (errors.length) zip.file('project-backup-errors.txt', errors.join('\n'));
    return { blob: await zip.generateAsync({ type: 'blob' }), filename: `CurriculumFlow_local_recovery_${Date.now()}.zip` };
  } finally { await temporary.delete(); }
}

export async function downloadLocalRecovery(key?: string) {
  const result = await buildLocalRecovery(key);
  const { browserFileService } = await import('../core/files/browser');
  browserFileService.saveFile(result.blob, result.filename);
}
