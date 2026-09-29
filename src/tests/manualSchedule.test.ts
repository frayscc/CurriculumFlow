import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { createTask } from '../db/repositories/tasks';
import { moveTask, normalizeManualTimeline, resizeTask, unplaceTask } from '../db/repositories/manualSchedule';
import { updateCalendarDay } from '../db/repositories/calendar';
import { CurriculumDatabase } from '../db/schema';

describe('magnetic teaching timeline', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`manual-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  async function fixture() {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-18' }, database);
    const first = await createTask(project.id, { title: '第一课', type: 'new_lesson' }, database);
    const second = await createTask(project.id, { title: '第二课', type: 'new_lesson' }, database);
    const inserted = await createTask(project.id, { title: '插入练习', type: 'exercise' }, database);
    return { project, first, second, inserted };
  }

  async function taskDates(projectId: string, taskId: string) {
    return (await database.scheduledLessons.where('[projectId+taskId]').equals([projectId, taskId]).sortBy('date')).map(row => row.date);
  }

  it('inserts at the target and shifts every following item', async () => {
    const { project, first, second, inserted } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await moveTask(second.id, '2026-09-02', database);
    await moveTask(inserted.id, '2026-09-01', database);

    expect(await taskDates(project.id, inserted.id)).toEqual(['2026-09-01']);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-02']);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-03']);
    const lessons = await database.scheduledLessons.where('projectId').equals(project.id).toArray();
    expect(new Set(lessons.map(row => row.date)).size).toBe(lessons.length);
  });

  it('resizes in teaching-day units and ripples later items', async () => {
    const { project, first, second } = await fixture();
    await moveTask(first.id, '2026-09-03', database);
    await moveTask(second.id, '2026-09-07', database);
    await resizeTask(first.id, '2026-09-07', database);

    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-03', '2026-09-04', '2026-09-07']);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-08']);
    expect((await database.teachingTasks.get(first.id))?.plannedPeriods).toBe(3);
  });

  it('skips holidays and exams while keeping one arrangement per day', async () => {
    const { project, first, second } = await fixture();
    await updateCalendarDay(project.id, '2026-09-03', { dayType: 'exam', title: '月考' }, database);
    await moveTask(first.id, '2026-09-02', database);
    await resizeTask(first.id, '2026-09-04', database);
    await moveTask(second.id, '2026-09-07', database);

    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-02', '2026-09-04']);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-07']);
    await expect(moveTask(second.id, '2026-09-03', database)).rejects.toThrow('不能安排');
    await expect(resizeTask(first.id, '2026-09-05', database)).rejects.toThrow('不能安排');
  });

  it('closes the gap when an item is removed from the timeline', async () => {
    const { project, first, second } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await resizeTask(first.id, '2026-09-02', database);
    await moveTask(second.id, '2026-09-03', database);
    await unplaceTask(first.id, database);

    expect(await taskDates(project.id, first.id)).toEqual([]);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-01']);
    expect((await database.teachingTasks.get(first.id))?.scheduledStartDate).toBeUndefined();
  });

  it('moves an existing item by removing it first and reinserting it', async () => {
    const { project, first, second, inserted } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await moveTask(second.id, '2026-09-02', database);
    await moveTask(inserted.id, '2026-09-03', database);
    await moveTask(first.id, '2026-09-03', database);

    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-01']);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-02']);
    expect(await taskDates(project.id, inserted.id)).toEqual(['2026-09-03']);
  });

  it('normalizes overlapping records created by the old independent-span model', async () => {
    const { project, first, second } = await fixture();
    await database.teachingTasks.bulkPut([
      { ...first, scheduledStartDate: '2026-09-01', scheduledEndDate: '2026-09-01' },
      { ...second, scheduledStartDate: '2026-09-01', scheduledEndDate: '2026-09-01' },
    ]);
    await normalizeManualTimeline(project.id, database);

    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-01']);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-02']);
    expect((await database.teachingTasks.get(second.id))?.scheduleOrder).toBe(2);
  });
});
