import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CurriculumDatabase } from '../db/schema';
import { createProject } from '../db/repositories/projects';
import { createTask, deleteTask, reorderTasks, restoreDeletedTask, updateTask } from '../db/repositories/tasks';

const projectInput = {
  schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
  startDate: '2026-09-01', endDate: '2027-01-23',
};
const taskInput = { title: '13.1 分子热运动', type: 'new_lesson' as const, plannedPeriods: 1, allowSplit: true };

describe('teaching task repository', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`tasks-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('adds, edits, reorders, and logs changes without losing task IDs', async () => {
    const project = await createProject(projectInput, database);
    const first = await createTask(project.id, taskInput, database);
    const second = await createTask(project.id, { ...taskInput, title: '13.2 内能', plannedPeriods: 2, fixedWeek: 3 }, database);
    expect([first.order, second.order]).toEqual([1, 2]);
    const edited = await updateTask(first.id, { ...taskInput, plannedPeriods: 2 }, database);
    expect(edited.id).toBe(first.id);
    expect(edited.plannedPeriods).toBe(2);
    await reorderTasks(project.id, [second.id, first.id], database);
    expect((await database.teachingTasks.where('projectId').equals(project.id).sortBy('order')).map(task => task.id)).toEqual([second.id, first.id]);
    expect((await database.changeLogs.where('projectId').equals(project.id).toArray()).map(log => log.action)).toEqual(['update', 'reorder']);
  });

  it('rejects invalid fixed nodes and linked-task deletion', async () => {
    const project = await createProject(projectInput, database);
    await expect(createTask(project.id, { ...taskInput, fixedDate: '2026-09-10', fixedWeek: 2 }, database)).rejects.toThrow('只能选择一种');
    const task = await createTask(project.id, taskInput, database);
    await database.teachingTasks.update(task.id, { examId: 'linked-exam' });
    await expect(deleteTask(task.id, database)).rejects.toThrow('关联');
    expect(await database.teachingTasks.get(task.id)).toBeDefined();
  });

  it('renumbers tasks after a confirmed deletion', async () => {
    const project = await createProject(projectInput, database);
    const first = await createTask(project.id, taskInput, database);
    const second = await createTask(project.id, { ...taskInput, title: '13.2 内能' }, database);
    await deleteTask(first.id, database);
    expect((await database.teachingTasks.get(second.id))?.order).toBe(1);
    expect((await database.changeLogs.where('projectId').equals(project.id).first())?.action).toBe('delete');
    await restoreDeletedTask(first, database);
    expect((await database.teachingTasks.where('projectId').equals(project.id).sortBy('order')).map(task => task.id)).toEqual([first.id, second.id]);
  });
});
