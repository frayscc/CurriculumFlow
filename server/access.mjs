import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';

const scrypt = promisify(scryptCallback);
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const stateTables = ['projects', 'calendarDays', 'courseSchedules', 'scheduleOverrides', 'teachingTasks', 'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'weeklyNotes', 'planAnnotations', 'specialDuties', 'exams', 'examFiles', 'teachers', 'settings'];
const resourceTables = new Set(['exams', 'examFiles']);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) fail(400, `${label}无效`);
  return value.trim();
}
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400, '密码须为 10～128 个字符');
  const salt = randomBytes(16).toString('hex');
  return `32768:8:3:${salt}:${(await scrypt(password, salt, 64, passwordOptions)).toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts = encoded.split(':');
  const [salt, hash] = parts.slice(-2);
  const options = parts.length === 5 ? { N: Number(parts[0]), r: Number(parts[1]), p: Number(parts[2]), maxmem: 64 * 1024 * 1024 } : {};
  return timingSafeEqual(Buffer.from(hash, 'hex'), await scrypt(password, salt, 64, options));
}

export function createAccess(database, dataDir, setupToken = process.env.SETUP_TOKEN) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, teacher_id TEXT UNIQUE NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS teaching_groups (id TEXT PRIMARY KEY, school_year TEXT NOT NULL, grade TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(school_year, grade, subject));
    CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL REFERENCES users(id), group_id TEXT NOT NULL REFERENCES teaching_groups(id), leader INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, group_id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_views (user_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id, revision));
    CREATE TABLE IF NOT EXISTS sync_payloads (hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staged_blobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL);
  `);
  const tokenPath = join(dataDir, 'setup-token');
  if (!setupToken) {
    if (existsSync(tokenPath)) setupToken = readFileSync(tokenPath, 'utf8').trim();
    else { setupToken = randomBytes(24).toString('hex'); writeFileSync(tokenPath, setupToken, { mode: 0o600, flag: 'wx' }); }
  }
  const attempts = new Map();
  function audit(user, action, target, details = {}) {
    database.prepare('INSERT INTO audit_log(timestamp,actor_id,actor_name,action,target,details) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), user.id, user.name ?? user.username ?? user.id, action, target, JSON.stringify(details));
  }
  const initialized = () => !!database.prepare('SELECT 1 FROM users LIMIT 1').get();
  const userById = id => database.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const groups = () => database.prepare('SELECT id, school_year AS schoolYear, grade, subject FROM teaching_groups ORDER BY school_year DESC, subject, grade').all();
  function publicUser(user) {
    return { id: user.id, username: user.username, name: user.name, role: user.role, teacherId: user.teacher_id, disabled: !!user.disabled,
      memberships: database.prepare('SELECT group_id AS groupId, leader FROM memberships WHERE user_id = ?').all(user.id).map(row => ({ groupId: row.groupId, leader: !!row.leader })) };
  }
  function actor(request) {
    const token = /(?:^|;\s*)cf_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1];
    if (!token) return undefined;
    const row = database.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(digest(token), Date.now());
    const user = row && userById(row.user_id);
    return user && !user.disabled ? publicUser(user) : undefined;
  }
  function session(request, response, userId) {
    const token = randomBytes(32).toString('hex');
    database.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    database.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + 7 * 86400000);
    const secure = request.socket.encrypted || (process.env.COOKIE_SECURE === 'true');
    response.setHeader('Set-Cookie', `cf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`);
  }
  function checkOrigin(request) {
    if (request.headers['sec-fetch-site'] === 'cross-site') fail(403, '禁止跨站请求');
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) fail(403, '请求来源无效');
  }
  const admin = user => { if (user?.role !== 'admin') fail(403, '仅管理员可执行此操作'); };
  const groupFor = project => groups().find(group => group.schoolYear === project.schoolYear && group.grade === project.grade && group.subject === project.subject);
  function canRead(user, project) {
    return user.role === 'admin' || user.memberships.some(member => member.groupId === project.groupId);
  }
  function canEdit(user, project, resource = false) {
    if (project.archived && !resource) return false;
    return user.role === 'admin' || user.memberships.some(member => member.groupId === project.groupId && (member.leader || (!resource && project.ownerId === user.id)));
  }
  function ensureGroup(project) {
    let group = groupFor(project);
    if (!group) {
      const id = randomUUID();
      database.prepare('INSERT INTO teaching_groups VALUES (?, ?, ?, ?)').run(id, text(project.schoolYear, '学年'), text(project.grade, '年级'), text(project.subject, '学科'));
      group = { id, schoolYear: project.schoolYear, grade: project.grade, subject: project.subject };
    }
    return group.id;
  }
  function state() {
    const row = database.prepare('SELECT * FROM app_state WHERE id = 1').get();
    return { revision: row?.revision ?? 0, updatedAt: row?.updated_at, snapshot: row ? JSON.parse(row.payload) : { schemaVersion: 1, tables: {} } };
  }
  function store(snapshot, revision) {
    const now = new Date().toISOString();
    database.prepare('INSERT INTO app_state VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at').run(revision, JSON.stringify(snapshot), now);
    return { revision, updatedAt: now };
  }
  function directory() {
    return database.prepare('SELECT teacher_id AS id, name, id AS userId, disabled FROM users ORDER BY name').all().map(person => ({ ...person, disabled: !!person.disabled }));
  }
  function view(user, current = state()) {
    const projects = (current.snapshot.tables.projects ?? []).filter(project => canRead(user, project));
    const ids = new Set(projects.map(project => project.id));
    const tables = Object.fromEntries(stateTables.map(name => [name, name === 'projects' ? projects : name === 'teachers' ? [...(current.snapshot.tables.teachers ?? []).filter(person => !directory().some(link => link.id === person.id)), ...directory()] : (current.snapshot.tables[name] ?? []).filter(row => name === 'settings' && !row.projectId ? true : ids.has(row.projectId))]));
    return { schemaVersion: 1, tables };
  }
  function remember(user, revision, snapshot) {
    const payload = JSON.stringify(snapshot); const hash = digest(payload);
    database.prepare('INSERT OR IGNORE INTO sync_payloads VALUES (?, ?)').run(hash, payload);
    database.prepare('INSERT OR REPLACE INTO sync_views VALUES (?, ?, ?)').run(user.id, revision, `@${hash}`);
    // Offline edits retain their original baseline even on a busy server.
  }
  function getState(user) {
    const current = state(); const snapshot = view(user, current);
    remember(user, current.revision, snapshot);
    const referenced = new Set(snapshot.tables.examFiles.map(file => file.blobId));
    const blobs = database.prepare('SELECT id, mime_type AS type, size FROM file_blobs').all().filter(blob => referenced.has(blob.id));
    return { ...current, snapshot, blobs };
  }
  function putState(user, body) {
    const incoming = body.snapshot;
    if (incoming?.schemaVersion !== 1 || !incoming.tables || Object.entries(incoming.tables).some(([name, rows]) => !stateTables.includes(name) || !Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object')) || !Number.isInteger(body.baseRevision) || !Array.isArray(body.blobIds)) fail(400, '数据格式无效');
    const current = state();
    const baselineRow = database.prepare('SELECT payload FROM sync_views WHERE user_id = ? AND revision = ?').get(user.id, body.baseRevision);
    if (!baselineRow) fail(409, '同步基线已失效，请重新读取服务器');
    const baseline = JSON.parse(baselineRow.payload.startsWith('@') ? database.prepare('SELECT payload FROM sync_payloads WHERE hash = ?').get(baselineRow.payload.slice(1)).payload : baselineRow.payload);
    const next = structuredClone(current.snapshot);
    for (const name of stateTables) next.tables[name] ??= [];
    const previousProjects = new Map((baseline.tables.projects ?? []).map(project => [project.id, project]));
    const incomingProjects = new Map((incoming.tables.projects ?? []).map(project => [project.id, project]));
    if (incomingProjects.size !== (incoming.tables.projects ?? []).length) fail(400, '项目 ID 重复');
    const allowedProjects = new Map(next.tables.projects.map(project => [project.id, project]));
    const archivedProjects = new Set();
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const id of new Set([...previousProjects.keys(), ...incomingProjects.keys()])) {
        const previous = previousProjects.get(id); let project = incomingProjects.get(id);
        const existing = allowedProjects.get(id);
        if (!previous && existing) fail(403, '无权访问该项目');
        if (same(previous, project)) continue;
        if (previous && !canEdit(user, previous)) fail(403, '仅创建者或备课组长可修改教学计划');
        if (!same(existing, previous)) fail(409, '该项目已被其他老师修改，请重新读取服务器');
        if (project) {
          const group = groupFor(project);
          if (!group && user.role !== 'admin') fail(403, '请联系管理员创建对应学年、年级、学科的备课组');
          const groupId = group?.id ?? ensureGroup(project);
          if (user.role !== 'admin' && !user.memberships.some(member => member.groupId === groupId)) fail(403, '不能创建或移入其他备课组的项目');
          if (previous && (project.ownerId !== previous.ownerId || project.groupId !== previous.groupId || project.archived !== previous.archived)) fail(403, '项目归属和归档状态不能通过同步修改');
          project = { ...project, ownerId: previous?.ownerId ?? user.id, groupId, ...(previous?.archived ? { archived: true } : {}) };
          allowedProjects.set(id, project);
        } else {
          if (next.tables.exams.some(exam => exam.projectId === id) && !canEdit(user, previous, true)) fail(403, '包含试卷资源的项目只能由组长或管理员删除');
          if (next.tables.exams.some(exam => exam.projectId === id)) {
            project = { ...previous, archived: true };
            allowedProjects.set(id, project); archivedProjects.add(id);
          } else allowedProjects.delete(id);
        }
        next.tables.projects = next.tables.projects.filter(row => row.id !== id);
        if (project) next.tables.projects.push(project);
      }
      const scopes = next.tables.projects.filter(project => !project.archived).map(project => JSON.stringify([project.schoolYear, project.grade, project.subject, project.semester]));
      if (new Set(scopes).size !== scopes.length) fail(409, '同一学年、年级、学科和学期的项目已存在，请读取服务器');
      for (const name of stateTables.filter(name => !['projects', 'teachers', 'settings'].includes(name))) {
        const before = baseline.tables[name] ?? []; const after = incoming.tables[name] ?? [];
        const ids = new Set([...before, ...after].map(row => row.projectId));
        for (const id of ids) {
          if (resourceTables.has(name) && archivedProjects.has(id)) continue;
          const oldRows = before.filter(row => row.projectId === id); const rows = after.filter(row => row.projectId === id);
          if (same(oldRows, rows)) continue;
          const project = previousProjects.get(id) ?? allowedProjects.get(id);
          if (!project || !canEdit(user, project, resourceTables.has(name))) fail(403, resourceTables.has(name) ? '仅对应备课组长或管理员可修改试卷资源' : '无权修改该教学计划');
          const live = next.tables[name].filter(row => row.projectId === id);
          let merged = rows;
          if (!same(live, oldRows)) {
            if (!['exams', 'examFiles', 'weeklyNotes', 'planAnnotations', 'specialDuties'].includes(name)) fail(409, '该项目时间轴已被其他老师修改，请重新读取服务器');
            const key = row => row.id ?? JSON.stringify([row.projectId, row.weekNumber]);
            const oldMap = new Map(oldRows.map(row => [key(row), row]));
            const newMap = new Map(rows.map(row => [key(row), row]));
            const liveMap = new Map(live.map(row => [key(row), row]));
            for (const rowId of new Set([...oldMap.keys(), ...newMap.keys()])) {
              if (same(oldMap.get(rowId), newMap.get(rowId))) continue;
              if (!same(oldMap.get(rowId), liveMap.get(rowId))) fail(409, '同一记录已被其他老师修改，请重新读取服务器');
              if (newMap.has(rowId)) liveMap.set(rowId, newMap.get(rowId)); else liveMap.delete(rowId);
            }
            merged = [...liveMap.values()];
          }
          if (!allowedProjects.has(id) && rows.length) fail(400, '删除项目时须同时移除关联记录');
          next.tables[name] = [...next.tables[name].filter(row => row.projectId !== id), ...merged];
        }
        if (next.tables[name].some(row => !allowedProjects.has(row.projectId))) fail(400, '存在不属于任何项目的记录');
        const rowIds = next.tables[name].filter(row => row.id).map(row => row.id);
        if (new Set(rowIds).size !== rowIds.length) fail(400, '记录 ID 重复');
      }
      const oldTeachers = baseline.tables.teachers ?? []; const newTeachers = incoming.tables.teachers ?? [];
      for (const person of newTeachers) {
        if (same(person, oldTeachers.find(row => row.id === person.id))) continue;
        if (directory().some(row => row.id === person.id)) fail(403, '绑定的教师身份只能由管理员修改');
        if (person.userId) fail(403, '不能伪造账号与教师的绑定关系');
        if (oldTeachers.some(row => row.id === person.id) && user.role !== 'admin') fail(403, '只有管理员可修改教师目录');
        if (oldTeachers.some(row => row.id === person.id) && !same(next.tables.teachers.find(row => row.id === person.id), oldTeachers.find(row => row.id === person.id))) fail(409, '教师目录已被其他管理员修改，请重新读取服务器');
        if (!oldTeachers.some(row => row.id === person.id) && next.tables.teachers.some(row => row.id === person.id)) fail(403, '教师 ID 已存在');
        next.tables.teachers = [...next.tables.teachers.filter(row => row.id !== person.id), person];
      }
      if (!same(baseline.tables.settings ?? [], incoming.tables.settings ?? [])) {
        if (user.role !== 'admin') fail(403, '只有管理员可修改共享设置');
        if (!same(current.snapshot.tables.settings ?? [], baseline.tables.settings ?? [])) fail(409, '共享设置已被修改');
        next.tables.settings = incoming.tables.settings ?? [];
      }
      for (const file of next.tables.examFiles) {
        if (!next.tables.exams.some(exam => exam.id === file.examId && exam.projectId === file.projectId)) fail(400, '试卷附件归属无效');
        if (!database.prepare('SELECT 1 FROM file_blobs WHERE id = ?').get(file.blobId)) fail(400, '存在尚未上传的附件');
        const owner = database.prepare('SELECT user_id FROM staged_blobs WHERE id = ?').get(file.blobId);
        if (owner && owner.user_id !== user.id && !current.snapshot.tables.examFiles?.some(row => row.blobId === file.blobId && row.projectId === file.projectId)) fail(403, '附件归属无效');
      }
      for (const exam of next.tables.exams) {
        if (same(exam, (current.snapshot.tables.exams ?? []).find(row => row.id === exam.id))) continue;
        if (![exam.authorIds, exam.reviewerIds, exam.authorNames, exam.reviewerNames].every(Array.isArray)) fail(400, '命题、审题身份无效');
        for (const [ids, names] of [[exam.authorIds, exam.authorNames], [exam.reviewerIds, exam.reviewerNames]]) {
          if (ids.length !== names.length || ids.some((id, index) => ![...next.tables.teachers, ...directory()].some(person => person.id === id && person.name === names[index]))) fail(400, '命题、审题教师身份与姓名不匹配');
        }
      }
      // Retain archived resource blobs; another group's upload must never delete them.
      const result = store(next, current.revision + 1);
      audit(user, 'workspace.save', 'workspace', { revision: result.revision, tables: stateTables.filter(name => !same(baseline.tables[name] ?? [], incoming.tables[name] ?? [])) });
      remember(user, result.revision, view(user, { ...result, snapshot: next }));
      database.exec('COMMIT'); return result;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function blobAllowed(user, id, write = false) {
    const current = state().snapshot.tables;
    const file = (current.examFiles ?? []).find(file => file.blobId === id);
    if (write) {
      if (file) fail(409, '已入库附件不能直接覆盖，请上传新附件并替换关联');
      const staged = database.prepare('SELECT user_id FROM staged_blobs WHERE id = ?').get(id);
      if (staged && staged.user_id !== user.id) fail(403, '无权覆盖其他老师的附件');
      if (user.role !== 'admin' && !user.memberships.some(member => member.leader)) fail(403, '只有备课组长可上传试卷附件');
      database.prepare('INSERT OR IGNORE INTO staged_blobs VALUES (?, ?)').run(id, user.id);
      return true;
    }
    return !!file || database.prepare('SELECT 1 FROM staged_blobs WHERE id = ? AND user_id = ?').get(id, user.id);
  }
  async function handle(request, response, url, body, json) {
    const user = actor(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') checkOrigin(request);
    if (url.pathname === '/api/auth/status' && request.method === 'GET') { json(response, 200, { initialized: initialized(), user, groups: user ? groups().filter(group => user.role === 'admin' || user.memberships.some(member => member.groupId === group.id)) : [] }); return true; }
    if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
      if (initialized()) fail(409, '管理员已初始化');
      const input = await body();
      if (typeof input.setupToken !== 'string' || digest(input.setupToken) !== digest(setupToken)) fail(403, '初始化密钥错误，请读取服务器 data/setup-token');
      const hash = await passwordHash(input.password); const id = randomUUID();
      database.exec('BEGIN IMMEDIATE');
      try {
        if (initialized()) fail(409, '管理员已初始化');
        database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 0)').run(id, text(input.username, '账号'), text(input.name, '姓名'), hash, 'admin', randomUUID());
        const current = state();
        for (const project of current.snapshot.tables.projects ?? []) { project.ownerId = id; project.groupId = ensureGroup(project); }
        if (current.revision) store(current.snapshot, current.revision + 1);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      session(request, response, id); json(response, 201, { user: publicUser(userById(id)) }); return true;
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const input = await body(); const key = `${request.socket.remoteAddress}:${String(input.username).slice(0, 120)}`;
      for (const [id, value] of attempts) if (value.until < Date.now()) attempts.delete(id);
      const attempt = attempts.get(key) ?? { count: 0, until: Date.now() + 900000 };
      if (attempt.count >= 10) fail(429, '尝试次数过多，请 15 分钟后再试');
      const found = typeof input.username === 'string' && database.prepare('SELECT * FROM users WHERE username = ?').get(input.username.trim());
      attempt.count++; attempts.set(key, attempt);
      if (!found || found.disabled || !await verifyPassword(input.password, found.password_hash)) fail(401, '账号或密码错误');
      attempts.delete(key); session(request, response, found.id); json(response, 200, { user: publicUser(found) }); return true;
    }
    if (!user) fail(401, initialized() ? '请先登录' : '请先初始化管理员');
    if (url.pathname === '/api/admin/audit' && request.method === 'GET') { admin(user); json(response, 200, { entries: database.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all() }); return true; }
    if (url.pathname === '/api/admin/backup' && request.method === 'GET') {
      admin(user); audit(user, 'system.backup', 'database');
      const temporary = mkdtempSync(join(tmpdir(), 'curriculumflow-backup-'));
      try {
        const path = join(temporary, 'curriculumflow.db');
        await backup(database, path);
        const copy = new DatabaseSync(path);
        try { copy.exec('DELETE FROM sessions'); } finally { copy.close(); }
        const bytes = readFileSync(path);
        response.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': 'attachment; filename="curriculumflow.db"', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(bytes);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
      return true;
    }
    if (url.pathname === '/api/state/revision' && request.method === 'GET') { json(response, 200, { revision: database.prepare('SELECT revision FROM app_state WHERE id = 1').get()?.revision ?? 0 }); return true; }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = /cf_session=([a-f0-9]{64})/.exec(request.headers.cookie ?? '')?.[1];
      if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
      response.setHeader('Set-Cookie', 'cf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); json(response, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/auth/password' && request.method === 'POST') {
      const input = await body(); const stored = userById(user.id);
      if (!await verifyPassword(input.currentPassword, stored.password_hash)) fail(403, '原密码错误');
      const hash = await passwordHash(input.password);
      database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); audit(user, 'password.change', user.id); session(request, response, user.id); json(response, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/admin' && request.method === 'GET') { admin(user); json(response, 200, { users: database.prepare('SELECT * FROM users').all().map(publicUser), groups: groups(), teachers: state().snapshot.tables.teachers ?? [] }); return true; }
    if (url.pathname === '/api/admin/groups' && request.method === 'POST') {
      admin(user); const input = await body(); const id = randomUUID();
      if (!/^\d{4}-\d{4}$/.test(input.schoolYear)) fail(400, '学年格式应为 2026-2027');
      const year = text(input.schoolYear, '学年'); const grade = text(input.grade, '年级'); const subject = text(input.subject, '学科');
      if (groups().some(group => group.schoolYear === year && group.grade === grade && group.subject === subject)) fail(409, '备课组已存在');
      database.prepare('INSERT INTO teaching_groups VALUES (?, ?, ?, ?)').run(id, year, grade, subject);
      const current = state(); store(current.snapshot, current.revision + 1);
      audit(user, 'group.create', id, { schoolYear: year, grade, subject });
      json(response, 201, { id }); return true;
    }
    const userMatch = url.pathname.match(/^\/api\/admin\/users(?:\/([a-zA-Z0-9-]+))?$/);
    if (userMatch && ['POST', 'PUT'].includes(request.method)) {
      admin(user); const input = await body(); const old = userMatch[1] && userById(userMatch[1]);
      if (userMatch[1] && !old) fail(404, '账号不存在');
      const id = old?.id ?? randomUUID(); const role = input.role ?? old?.role ?? 'teacher';
      if (!['admin', 'teacher'].includes(role)) fail(400, '角色无效');
      if (id === user.id && (role !== 'admin' || input.disabled)) fail(400, '不能停用或降级当前管理员');
      const memberships = input.memberships ?? publicUser(old ?? { id }).memberships;
      if (!Array.isArray(memberships) || memberships.some(member => !groups().some(group => group.id === member.groupId) || typeof member.leader !== 'boolean') || new Set(memberships.map(member => member.groupId)).size !== memberships.length) fail(400, '备课组成员配置无效');
      const hash = input.password ? await passwordHash(input.password) : old?.password_hash;
      if (!hash) fail(400, '新账号必须设置密码');
      const username = text(input.username ?? old?.username, '账号'); const name = text(input.name ?? old?.name, '姓名');
      if (database.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id)) fail(409, '账号已存在');
      const teacherId = input.teacherId || old?.teacher_id || (state().snapshot.tables.teachers ?? []).find(person => person.name === name)?.id || randomUUID();
      if (database.prepare('SELECT id FROM users WHERE name = ? AND id != ?').get(name, id)) fail(409, '同名账号已存在，请使用可区分的教师姓名');
      if (database.prepare('SELECT id FROM users WHERE teacher_id = ? AND id != ?').get(teacherId, id)) fail(409, '该教师身份已绑定其他账号');
      const person = (state().snapshot.tables.teachers ?? []).find(person => person.id === teacherId);
      if (person && person.name !== name) fail(400, '绑定已有教师身份时，账号姓名须与教师姓名一致');
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,password_hash=excluded.password_hash,role=excluded.role,teacher_id=excluded.teacher_id,disabled=excluded.disabled').run(id, username, name, hash, role, teacherId, input.disabled ? 1 : 0);
        database.prepare('DELETE FROM memberships WHERE user_id = ?').run(id);
        for (const member of memberships) database.prepare('INSERT INTO memberships VALUES (?, ?, ?)').run(id, member.groupId, member.leader ? 1 : 0);
        database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        database.prepare('DELETE FROM sync_views WHERE user_id = ?').run(id);
        const current = state(); store(current.snapshot, current.revision + 1);
        audit(user, old ? 'user.update' : 'user.create', id, { username, role, disabled: !!input.disabled, memberships });
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      if (id === user.id) session(request, response, id);
      json(response, 200, { user: publicUser(userById(id)) }); return true;
    }
    if (url.pathname === '/api/library' && request.method === 'GET') {
      const tables = state().snapshot.tables;
      json(response, 200, { projects: (tables.projects ?? []).map(({ id, schoolYear, grade, subject, semester, groupId, archived }) => ({ id, schoolYear, grade, subject, semester, groupId, archived })), exams: tables.exams ?? [], files: tables.examFiles ?? [] }); return true;
    }
    return false;
  }
  return { actor, handle, getState, putState, blobAllowed };
}
