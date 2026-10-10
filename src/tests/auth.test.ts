import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { canEditProject, projectOwnership, setAuth, type Account } from '../auth';
import { CurriculumDatabase, db, selectAccountDatabase } from '../db/schema';
import type { SemesterProject } from '../types/domain';

const project: SemesterProject = { id: 'p', ownerId: 'alice', groupId: 'g9', schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2027-01-30', createdAt: '', updatedAt: '' };
function account(id: string, leader = false): Account { return { id, username: id, name: id, role: 'teacher', teacherId: `teacher-${id}`, disabled: false, memberships: [{ groupId: 'g9', leader }] }; }
const groups = [{ id: 'g9', schoolYear: project.schoolYear, grade: project.grade, subject: project.subject }];
const createdNames: string[] = [];
afterEach(async () => {
  setAuth(undefined); db.close();
  for (const name of createdNames.splice(0)) { const temporary = new CurriculumDatabase(name); await temporary.delete(); }
});

it('distinguishes project authorship from resource leadership', () => {
  setAuth({ initialized: true, user: account('alice'), groups });
  expect(canEditProject(project)).toBe(true);
  expect(canEditProject(project, true)).toBe(false);
  setAuth({ initialized: true, user: account('bob'), groups });
  expect(canEditProject(project)).toBe(false);
  setAuth({ initialized: true, user: account('bob', true), groups });
  expect(canEditProject(project, true)).toBe(true);
  expect(canEditProject({ ...project, groupId: 'g8' }, true)).toBe(false);
});

it('assigns ownership only to a matching authorized group', () => {
  setAuth({ initialized: true, user: account('alice'), groups });
  expect(projectOwnership(project)).toEqual({ ownerId: 'alice', groupId: 'g9' });
  expect(() => projectOwnership({ ...project, grade: '八年级' })).toThrow('备课组');
});

it('keeps browser projects and sync checkpoints separate across account switches', async () => {
  const prefix = crypto.randomUUID();
  for (const suffix of ['alice', 'bob']) createdNames.push(`CurriculumFlow-account-${prefix}-${suffix}`);
  selectAccountDatabase(`${prefix}-alice`);
  await db.projects.put(project);
  await db.syncMetadata.put({ key: 'checkpoint', value: { revision: 10 } });
  selectAccountDatabase(`${prefix}-bob`);
  expect(await db.projects.count()).toBe(0);
  expect(await db.syncMetadata.get('checkpoint')).toBeUndefined();
  await db.projects.put({ ...project, id: 'bob-project' });
  selectAccountDatabase(`${prefix}-alice`);
  expect(await db.projects.toArray()).toEqual([project]);
  expect((await db.syncMetadata.get('checkpoint'))?.value).toEqual({ revision: 10 });
});
