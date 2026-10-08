import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let database: typeof import('../db/schema').db;
let client: typeof import('../db/serverSync');
let revision: number;
let tables: Record<string, unknown[]>;
let offline: boolean;
let writes: number;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', { location: { protocol: 'http:' }, dispatchEvent: vi.fn(), setInterval: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn() });
  revision = 1; tables = { projects: [{ id: 'p1', subject: '物理' }] }; offline = false; writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (offline) throw new Error('offline');
    if (options?.method === 'PUT') {
      const body = JSON.parse(options.body as string);
      writes++;
      if (body.baseRevision !== revision) return new Response('{}', { status: 409 });
      tables = body.snapshot.tables;
      return new Response(JSON.stringify({ revision: ++revision }));
    }
    return new Response(JSON.stringify({ revision, snapshot: { schemaVersion: 1, tables }, blobs: [] }), { headers: { 'Content-Type': 'application/json' } });
  }));
  database = (await import('../db/schema')).db;
  client = await import('../db/serverSync');
});
afterEach(async () => { await database.delete(); vi.unstubAllGlobals(); });

it('shares one initialization request across concurrent startup callers', async () => {
  await Promise.all([client.initializeServerSync(), client.initializeServerSync(), client.syncNow()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(client.getSyncStatus().state).toBe('synced');
});

it('stops on conflict without overwriting either browser changes', async () => {
  await client.initializeServerSync();
  tables.projects.push({ id: 'p2' }); revision++;
  await database.projects.update('p1', { subject: '本地修改' });
  await client.syncNow();
  expect(client.getSyncStatus().state).toBe('conflict');
  expect(tables.projects).toHaveLength(2);
  expect((await database.projects.get('p1'))?.subject).toBe('本地修改');
  await client.syncNow();
  expect(writes).toBe(1);
});

it('upgrades matching legacy local data without an unnecessary conflict', async () => {
  await database.projects.put({ id: 'p1', subject: '物理' } as never);
  await client.initializeServerSync();
  expect(client.getSyncStatus().state).toBe('synced');
  expect(await database.syncMetadata.get('checkpoint')).toBeDefined();
  expect(writes).toBe(0);
});
it('uploads pending local changes when reopening against the same server revision', async () => {
  await client.initializeServerSync();
  await database.projects.update('p1', { subject: '未同步修改' });
  await client.initializeServerSync();
  expect((tables.projects[0] as { subject: string }).subject).toBe('未同步修改');
  expect(client.getSyncStatus().state).toBe('synced');
});
it('preserves pending edits when reopening against a changed server', async () => {
  await client.initializeServerSync();
  await database.projects.update('p1', { subject: '本地修改' });
  tables.projects.push({ id: 'p2' }); revision++;
  await client.initializeServerSync();
  expect(client.getSyncStatus().state).toBe('conflict');
  expect((await database.projects.get('p1'))?.subject).toBe('本地修改');
  expect(writes).toBe(0);
});
it('pulls remote edits when the local snapshot is clean', async () => {
  await client.initializeServerSync();
  tables.projects.push({ id: 'p2' }); revision++;
  await client.syncNow();
  expect(await database.projects.get('p2')).toBeDefined();
  expect(writes).toBe(0);
});
it('retries after connection failure and preserves untracked local edits', async () => {
  offline = true;
  await client.initializeServerSync();
  await database.projects.put({ id: 'local' } as never);
  offline = false;
  await client.syncNow();
  expect(client.getSyncStatus().state).toBe('conflict');
  expect(await database.projects.get('local')).toBeDefined();
});
it('keeps a durable recovery copy before resolving a conflict', async () => {
  await client.initializeServerSync();
  await database.projects.update('p1', { subject: '本地修改' });
  tables.projects.push({ id: 'p2' }); revision++;
  await client.syncNow();
  await client.readServerKeepingLocalCopy();
  const recovery = await database.syncMetadata.filter(row => row.key.startsWith('recovery:')).first();
  expect(recovery).toBeDefined();
  expect(JSON.stringify(recovery?.value)).toContain('本地修改');
  expect(await database.projects.get('p2')).toBeDefined();
  expect(client.getSyncStatus().state).toBe('synced');
});

it('downloads stored recovery as importable project backups without altering live data', async () => {
  await client.initializeServerSync();
  const { createProject } = await import('../db/repositories/projects');
  const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-18' });
  tables.projects.push({ id: 'remote' }); revision++;
  await client.syncNow();
  await client.readServerKeepingLocalCopy();
  const recovery = await database.syncMetadata.filter(row => row.key.startsWith('recovery:')).first();
  const result = await client.buildLocalRecovery(recovery!.key);
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const nested = zip.file(`projects/${project.id}.zip`);
  expect(nested).not.toBeNull();
  const projectZip = await JSZip.loadAsync(await nested!.async('uint8array'));
  const manifest = JSON.parse(await projectZip.file('project.json')!.async('string'));
  expect(manifest.data.project.id).toBe(project.id);
  expect(await database.projects.get(project.id)).toBeUndefined();
});
