import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, deleteProject, updateProject } from '../db/repositories/projects';
import { CurriculumDatabase } from '../db/schema';

const initial = {
  schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
  startDate: '2026-09-01', endDate: '2026-09-05',
};

describe('project repository', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`test-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('creates a project and every calendar day in one operation', async () => {
    const project = await createProject(initial, database);
    expect(await database.projects.get(project.id)).toEqual(project);
    expect(await database.calendarDays.where('projectId').equals(project.id).count()).toBe(5);
    await expect(createProject(initial, database)).rejects.toThrow('已存在');
    expect(await database.projects.count()).toBe(1);
  });

  it('keeps existing special days when editing the date range and removes obsolete days', async () => {
    const project = await createProject(initial, database);
    await database.calendarDays.update([project.id, '2026-09-02'], { dayType: 'holiday', title: '校庆' });
    await updateProject(project.id, { ...initial, startDate: '2026-09-02', endDate: '2026-09-06' }, database);
    expect(await database.calendarDays.get([project.id, '2026-09-02'])).toMatchObject({ dayType: 'holiday', title: '校庆' });
    expect(await database.calendarDays.get([project.id, '2026-09-01'])).toBeUndefined();
    expect(await database.calendarDays.get([project.id, '2026-09-06'])).toMatchObject({ weekday: 7, dayType: 'normal' });
  });

  it('deletes project-owned records without deleting shared teachers', async () => {
    const project = await createProject(initial, database);
    await database.teachers.add({ id: 'teacher', name: '张老师' });
    await database.settings.add({ key: 'project-setting', projectId: project.id, value: 'x' });
    await deleteProject(project.id, database);
    expect(await database.projects.count()).toBe(0);
    expect(await database.calendarDays.count()).toBe(0);
    expect(await database.settings.count()).toBe(0);
    expect(await database.teachers.count()).toBe(1);
  });
});
