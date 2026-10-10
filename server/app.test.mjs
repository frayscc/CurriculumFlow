import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAppServer } from './app.mjs';

test('SQLite API stores snapshots and attachments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'curriculumflow-'));
  const staticDir = join(root, 'dist');
  const dataDir = join(root, 'data');
  await import('node:fs').then(({ mkdirSync }) => mkdirSync(staticDir));
  writeFileSync(join(staticDir, 'index.html'), '<h1>CurriculumFlow</h1>');
  const server = createAppServer({ dataDir, staticDir, setupToken: 'test-setup-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const setup = await globalThis.fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken: 'test-setup-token', username: 'admin', name: '管理员', password: 'test-password-123' }) });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { ...options.headers, Cookie: cookie } });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
    const blob = await fetch(`${base}/api/blobs/file_1`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'answer' });
    assert.equal(blob.status, 200);
    const saved = await fetch(`${base}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: 0, snapshot: { schemaVersion: 1, tables: { projects: [{ id: 'p1', schoolYear: '2026-2027', grade: '九年级', subject: '物理' }] } }, blobIds: ['file_1'] }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.snapshot.tables.projects[0].id, 'p1');
    assert.equal(await (await fetch(`${base}/api/blobs/file_1`)).text(), 'answer');
    const stale = await fetch(`${base}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: 0, snapshot: state.snapshot, blobIds: ['file_1'] }),
    });
    assert.equal(stale.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
