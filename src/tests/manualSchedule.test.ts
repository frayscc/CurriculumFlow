import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { createTask } from '../db/repositories/tasks';
import { placeTask, unplaceTask } from '../db/repositories/manualSchedule';
import { updateCalendarDay } from '../db/repositories/calendar';
import { CurriculumDatabase } from '../db/schema';

describe('manual calendar scheduling', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`manual-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('uses the calendar span as the final teaching arrangement', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-11' }, database);
    const task = await createTask(project.id, { title: '13.1 分子热运动', type: 'new_lesson' }, database);
    await placeTask(task.id, '2026-09-01', '2026-09-03', database);
    const saved = await database.teachingTasks.get(task.id);
    expect([saved?.scheduledStartDate, saved?.scheduledEndDate, saved?.plannedPeriods]).toEqual(['2026-09-01', '2026-09-03', 3]);
    expect((await database.scheduledLessons.where('[projectId+taskId]').equals([project.id, task.id]).sortBy('date')).map(row => row.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(await database.planVersions.where('projectId').equals(project.id).count()).toBe(1);
    await placeTask(task.id, '2026-09-08', '2026-09-09', database);
    expect(await database.planVersions.where('projectId').equals(project.id).count()).toBe(1);
    expect((await database.scheduledLessons.where('[projectId+taskId]').equals([project.id, task.id]).sortBy('date')).map(row => row.date)).toEqual(['2026-09-08', '2026-09-09']);
    await unplaceTask(task.id, database);
    expect(await database.scheduledLessons.where('[projectId+taskId]').equals([project.id, task.id]).count()).toBe(0);
    expect((await database.teachingTasks.get(task.id))?.scheduledStartDate).toBeUndefined();
  });

  it('rejects holidays and exam dates anywhere in the span', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-11' }, database);
    const task = await createTask(project.id, { title: '单元练习', type: 'exercise' }, database);
    await updateCalendarDay(project.id, '2026-09-03', { dayType: 'exam', title: '月考' }, database);
    await expect(placeTask(task.id, '2026-09-02', '2026-09-04', database)).rejects.toThrow('2026-09-03');
    await expect(placeTask(task.id, '2026-09-05', '2026-09-05', database)).rejects.toThrow('不能安排');
  });
});
