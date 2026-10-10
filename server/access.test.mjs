import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createAppServer } from './app.mjs';

async function fixture(t, legacy) {
  const root = mkdtempSync(join(tmpdir(), 'curriculumflow-auth-'));
  const dataDir = join(root, 'data'); mkdirSync(dataDir);
  if (legacy) {
    const database = new DatabaseSync(join(dataDir, 'curriculumflow.db'));
    database.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)');
    database.prepare('INSERT INTO app_state VALUES (1,1,?,?)').run(JSON.stringify(legacy), new Date().toISOString()); database.close();
  }
  const server = createAppServer({ dataDir, setupToken: 'test-bootstrap-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async (path, method = 'GET', body, extra = {}) => {
      const headers = { Cookie: cookie, ...extra };
      if (body !== undefined && typeof body !== 'string') headers['Content-Type'] = 'application/json';
      const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : response.headers.get('content-type') === 'application/vnd.sqlite3' ? Buffer.from(await response.arrayBuffer()) : await response.text();
      return { status: response.status, value, headers: response.headers };
    };
  }
  const admin = client();
  const setup = await admin('/api/auth/setup', 'POST', { setupToken: 'test-bootstrap-token', username: 'admin', name: '管理员', password: 'test-password-123' });
  assert.equal(setup.status, 201);
  async function group(grade) { const result = await admin('/api/admin/groups', 'POST', { schoolYear: '2026-2027', grade, subject: '物理' }); assert.equal(result.status, 201); return result.value.id; }
  async function teacher(username, groupId, leader = false, extra = {}) {
    const result = await admin('/api/admin/users', 'POST', { username, name: username, password: 'test-password-123', memberships: [{ groupId, leader }], ...extra });
    assert.equal(result.status, 200);
    const request = client(); assert.equal((await request('/api/auth/login', 'POST', { username, password: 'test-password-123' })).status, 200);
    return { request, user: result.value.user };
  }
  return { admin, client, group, teacher, setup };
}
async function edit(request, mutate, baseline) {
  const state = baseline ?? (await request('/api/state')).value;
  const snapshot = structuredClone(state.snapshot); mutate(snapshot.tables);
  return request('/api/state', 'PUT', { baseRevision: state.revision, snapshot, blobIds: snapshot.tables.examFiles?.map(file => file.blobId) ?? [] });
}
function addProject(tables, id, grade = '九年级') {
  tables.projects.push({ id, schoolYear: '2026-2027', grade, subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2027-01-30' });
  tables.teachingTasks.push({ id: `task-${id}`, projectId: id, title: '第一课' });
}

test('authentication, bootstrap, origin, logout and password revocation', async t => {
  const { admin, client } = await fixture(t); const anonymous = client();
  assert.equal((await anonymous('/api/state')).status, 401);
  assert.equal((await anonymous('/api/library')).status, 401);
  assert.equal((await anonymous('/api/auth/status')).value.initialized, true);
  assert.equal((await anonymous('/api/auth/setup', 'POST', {})).status, 409);
  assert.equal((await admin('/api/auth/logout', 'POST', {}, { Origin: 'https://evil.invalid' })).status, 403);
  const second = client(); assert.equal((await second('/api/auth/login', 'POST', { username: 'admin', password: 'test-password-123' })).status, 200);
  assert.equal((await admin('/api/auth/password', 'POST', { currentPassword: 'test-password-123', password: 'new-test-password-123' })).status, 200);
  assert.equal((await second('/api/state')).status, 401);
  assert.equal((await admin('/api/state')).status, 200);
  assert.equal((await admin('/api/auth/logout', 'POST', {})).status, 200);
  assert.equal((await admin('/api/state')).status, 401);
});

test('group isolation and creator / leader permissions are enforced by API', async t => {
  const { admin, group, teacher } = await fixture(t);
  const nine = await group('九年级'); const eight = await group('八年级');
  const alice = await teacher('Alice', nine); const bob = await teacher('Bob', nine); const carol = await teacher('Carol', eight);
  assert.equal((await edit(alice.request, tables => addProject(tables, 'p9'))).status, 200);
  assert.equal((await alice.request('/api/state')).value.snapshot.tables.projects[0].ownerId, alice.user.id);
  assert.equal((await carol.request('/api/state')).value.snapshot.tables.projects.length, 0);
  assert.equal((await bob.request('/api/state')).value.snapshot.tables.projects.length, 1);
  assert.equal((await edit(bob.request, tables => { tables.teachingTasks[0].title = '越权修改'; })).status, 403);
  assert.equal((await edit(alice.request, tables => { tables.teachingTasks[0].title = '正常修改'; })).status, 200);
  assert.equal((await alice.request('/api/admin')).status, 403);
  assert.equal((await edit(carol.request, tables => addProject(tables, 'forged', '九年级'))).status, 403);
  assert.equal((await admin('/api/state')).value.snapshot.tables.teachingTasks[0].title, '正常修改');
});

test('independent groups save concurrently without replacing each other', async t => {
  const { admin, group, teacher } = await fixture(t);
  const alice = await teacher('Alice', await group('九年级')); const bob = await teacher('Bob', await group('八年级'));
  const a = (await alice.request('/api/state')).value; const b = (await bob.request('/api/state')).value;
  assert.equal((await edit(alice.request, tables => addProject(tables, 'p9'), a)).status, 200);
  assert.equal((await edit(bob.request, tables => addProject(tables, 'p8', '八年级'), b)).status, 200);
  assert.equal((await admin('/api/state')).value.snapshot.tables.projects.length, 2);
});

test('concurrent creation cannot duplicate a semester scope', async t => {
  const { group, teacher } = await fixture(t); const id = await group('九年级');
  const alice = await teacher('Alice', id); const bob = await teacher('Bob', id);
  const a = (await alice.request('/api/state')).value; const b = (await bob.request('/api/state')).value;
  assert.equal((await edit(alice.request, tables => addProject(tables, 'first'), a)).status, 200);
  assert.equal((await edit(bob.request, tables => addProject(tables, 'second'), b)).status, 409);
});

test('concurrent teacher directory changes cannot overwrite each other', async t => {
  const { admin } = await fixture(t);
  assert.equal((await edit(admin, tables => tables.teachers.push({ id: 'unbound', name: 'Original' }))).status, 200);
  const baseline = (await admin('/api/state')).value;
  assert.equal((await edit(admin, tables => { tables.teachers.find(row => row.id === 'unbound').name = 'First'; }, baseline)).status, 200);
  assert.equal((await edit(admin, tables => { tables.teachers.find(row => row.id === 'unbound').name = 'Second'; }, baseline)).status, 409);
});

test('conflicting changes to same project are rejected without data loss', async t => {
  const { group, teacher } = await fixture(t); const id = await group('九年级');
  const alice = await teacher('Alice', id, true); const bob = await teacher('Bob', id, true);
  assert.equal((await edit(alice.request, tables => addProject(tables, 'p9'))).status, 200);
  const a = (await alice.request('/api/state')).value; const b = (await bob.request('/api/state')).value;
  assert.equal((await edit(alice.request, tables => { tables.teachingTasks[0].title = 'A'; }, a)).status, 200);
  assert.equal((await edit(bob.request, tables => { tables.teachingTasks[0].title = 'B'; }, b)).status, 409);
  assert.equal((await bob.request('/api/state')).value.snapshot.tables.teachingTasks[0].title, 'A');
});

test('independent notes in one project merge but the same note conflicts', async t => {
  const { admin } = await fixture(t);
  await edit(admin, tables => { addProject(tables, 'p9'); tables.weeklyNotes.push({ projectId: 'p9', weekNumber: 1, note: 'one' }, { projectId: 'p9', weekNumber: 2, note: 'two' }); });
  const baseline = (await admin('/api/state')).value;
  assert.equal((await edit(admin, tables => { tables.weeklyNotes[0].note = 'first'; }, baseline)).status, 200);
  assert.equal((await edit(admin, tables => { tables.weeklyNotes[1].note = 'second'; }, baseline)).status, 200);
  assert.deepEqual((await admin('/api/state')).value.snapshot.tables.weeklyNotes.map(row => row.note).sort(), ['first', 'second']);
  assert.equal((await edit(admin, tables => { tables.weeklyNotes[0].note = 'lost'; }, baseline)).status, 409);
});

test('school-wide library downloads, teacher binding and resource edit restrictions', async t => {
  const { admin, group, teacher } = await fixture(t); const nine = await group('九年级'); const eight = await group('八年级');
  const leader = await teacher('组长', nine, true); const ordinary = await teacher('老师', nine); const other = await teacher('八年级老师', eight);
  assert.equal((await edit(leader.request, tables => addProject(tables, 'p9'))).status, 200);
  assert.equal((await ordinary.request('/api/blobs/not_allowed', 'PUT', 'paper')).status, 403);
  assert.equal((await leader.request('/api/blobs/paper1', 'PUT', 'paper', { 'Content-Type': 'application/pdf' })).status, 200);
  assert.equal((await edit(leader.request, tables => {
    tables.exams.push({ id: 'e1', projectId: 'p9', title: '期中试卷', authorIds: [ordinary.user.teacherId], authorNames: ['老师'], reviewerIds: [leader.user.teacherId], reviewerNames: ['组长'] });
    tables.examFiles.push({ id: 'f1', examId: 'e1', projectId: 'p9', blobId: 'paper1', originalFileName: 'paper.pdf' });
  })).status, 200);
  assert.equal((await other.request('/api/state')).value.snapshot.tables.projects.length, 0);
  assert.equal((await other.request('/api/library')).value.exams[0].title, '期中试卷');
  assert.equal((await other.request('/api/blobs/paper1')).value, 'paper');
  assert.equal((await edit(ordinary.request, tables => { tables.exams[0].title = '不允许'; })).status, 403);
  assert.equal((await leader.request('/api/blobs/paper1', 'PUT', 'overwritten')).status, 409);
  assert.equal((await edit(other.request, tables => addProject(tables, 'p8', '八年级'))).status, 200);
  assert.equal((await admin('/api/blobs/paper1')).value, 'paper');
});

test('legacy snapshots migrate to admin and existing teacher identities bind', async t => {
  const legacy = { schemaVersion: 1, tables: { projects: [{ id: 'old', schoolYear: '2025-2026', grade: '九年级', subject: '物理' }], teachers: [{ id: 'old-teacher', name: '张老师' }] } };
  const { admin, setup } = await fixture(t, legacy);
  const state = (await admin('/api/state')).value;
  assert.equal(state.snapshot.tables.projects[0].ownerId, setup.value.user.id);
  const groupId = state.snapshot.tables.projects[0].groupId;
  const result = await admin('/api/admin/users', 'POST', { username: 'zhang', name: '张老师', password: 'test-password-123', memberships: [{ groupId, leader: false }] });
  assert.equal(result.status, 200); assert.equal(result.value.user.teacherId, 'old-teacher');
  const duplicate = await admin('/api/admin/users', 'POST', { username: 'another', name: '张老师', password: 'test-password-123', teacherId: 'old-teacher', memberships: [] });
  assert.equal(duplicate.status, 409);
});

test('disabling account revokes access immediately', async t => {
  const { admin, group, teacher } = await fixture(t);
  const person = await teacher('disabled', await group('九年级'));
  assert.equal((await admin(`/api/admin/users/${person.user.id}`, 'PUT', { disabled: true })).status, 200);
  assert.equal((await person.request('/api/state')).status, 401);
});

test('system backup includes accounts, memberships and resources; only admin can export or audit', async t => {
  const { admin, group, teacher } = await fixture(t);
  const ordinary = await teacher('ordinary', await group('九年级'));
  await edit(admin, tables => addProject(tables, 'p9'));
  await admin('/api/blobs/backup-paper', 'PUT', 'paper bytes');
  await edit(admin, tables => {
    tables.exams.push({ id: 'backup-exam', projectId: 'p9', title: 'Paper', authorIds: [], authorNames: [], reviewerIds: [], reviewerNames: [] });
    tables.examFiles.push({ id: 'backup-file', examId: 'backup-exam', projectId: 'p9', blobId: 'backup-paper' });
  });
  assert.equal((await ordinary.request('/api/admin/backup')).status, 403);
  assert.equal((await ordinary.request('/api/admin/audit')).status, 403);
  const response = await admin('/api/admin/backup'); assert.equal(response.status, 200);
  const root = mkdtempSync(join(tmpdir(), 'curriculumflow-restore-check-'));
  try {
    const path = join(root, 'copy.db'); writeFileSync(path, response.value);
    const copy = new DatabaseSync(path);
    try {
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM memberships').get().n, 1);
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
      assert.equal(Buffer.from(copy.prepare('SELECT data FROM file_blobs WHERE id = ?').get('backup-paper').data).toString(), 'paper bytes');
      assert.equal(JSON.parse(copy.prepare('SELECT payload FROM app_state').get().payload).tables.projects[0].id, 'p9');
    } finally { copy.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
  const audit = (await admin('/api/admin/audit')).value.entries;
  assert.ok(audit.some(row => row.action === 'system.backup'));
  assert.ok(audit.some(row => row.action === 'workspace.save'));
  assert.ok(audit.some(row => row.action === 'user.create'));
  assert.ok(!JSON.stringify(audit).includes('test-password-123'));
});

test('offline baselines survive more than 100 unrelated server saves', async t => {
  const { admin, group, teacher } = await fixture(t);
  const ordinary = await teacher('offline', await group('八年级'));
  const baseline = (await ordinary.request('/api/state')).value;
  await edit(admin, tables => addProject(tables, 'busy'));
  for (let index = 0; index < 102; index++) {
    assert.equal((await edit(admin, tables => { tables.projects.find(project => project.id === 'busy').title = String(index); })).status, 200);
  }
  await ordinary.request('/api/state');
  assert.equal((await edit(ordinary.request, tables => addProject(tables, 'offline-project', '八年级'), baseline)).status, 200);
});

test('deleting a teaching project preserves annual resources and their files', async t => {
  const { admin, group, teacher } = await fixture(t);
  const groupId = await group('九年级'); const leader = await teacher('组长', groupId, true);
  assert.equal((await edit(leader.request, tables => addProject(tables, 'p9'))).status, 200);
  assert.equal((await leader.request('/api/blobs/archive-paper', 'PUT', 'annual paper')).status, 200);
  assert.equal((await edit(leader.request, tables => {
    tables.exams.push({ id: 'e1', projectId: 'p9', title: '年度资源', authorIds: [], authorNames: [], reviewerIds: [], reviewerNames: [] });
    tables.examFiles.push({ id: 'f1', projectId: 'p9', examId: 'e1', blobId: 'archive-paper' });
  })).status, 200);
  assert.equal((await edit(leader.request, tables => { tables.projects = []; tables.teachingTasks = []; tables.exams = []; tables.examFiles = []; })).status, 200);
  const state = (await leader.request('/api/state')).value;
  assert.equal(state.snapshot.tables.projects[0].archived, true);
  assert.equal(state.snapshot.tables.teachingTasks.length, 0);
  assert.equal((await admin('/api/library')).value.exams[0].title, '年度资源');
  assert.equal((await admin('/api/blobs/archive-paper')).value, 'annual paper');
  assert.equal((await edit(leader.request, tables => { tables.exams[0].title = '归档后仍可维护'; })).status, 200);
});
