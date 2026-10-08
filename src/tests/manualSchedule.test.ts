import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, updateProject } from '../db/repositories/projects';
import { createTask, deleteTask, updateTask } from '../db/repositories/tasks';
import { moveTask, normalizeManualTimeline, placeTask, resizeTask, unplaceTask } from '../db/repositories/manualSchedule';
import { updateCalendarDay } from '../db/repositories/calendar';
import { copyHistoricalProject } from '../db/repositories/history';
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
    await moveTask(second.id, '2026-09-04', database);
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
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-03']);
    expect(await taskDates(project.id, inserted.id)).toEqual(['2026-09-02']);
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

  it('honors an exact drop date on a later empty day', async () => {
    const { project, first, second } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await moveTask(second.id, '2026-09-10', database);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-10']);
  });

  it('splits a course at insertion while preserving its earlier days', async () => {
    const { project, first, inserted } = await fixture();
    await placeTask(first.id, '2026-09-01', '2026-09-03', database);
    await moveTask(inserted.id, '2026-09-02', database);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-01', '2026-09-03', '2026-09-04']);
    expect(await taskDates(project.id, inserted.id)).toEqual(['2026-09-02']);
    await normalizeManualTimeline(project.id, database);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-01', '2026-09-03', '2026-09-04']);
  });

  it('reflows courses when an occupied day becomes an exam', async () => {
    const { project, first, second } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await moveTask(second.id, '2026-09-02', database);
    await updateCalendarDay(project.id, '2026-09-01', { dayType: 'exam' }, database);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-02']);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-03']);
  });

  it('closes the gap through the content-management delete operation', async () => {
    const { project, first, second } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    await moveTask(second.id, '2026-09-02', database);
    await deleteTask(first.id, database);
    expect(await taskDates(project.id, second.id)).toEqual(['2026-09-01']);
  });

  it('copies historical content without old dates or timeline order', async () => {
    const { project, first } = await fixture();
    await moveTask(first.id, '2026-09-01', database);
    const copy = await copyHistoricalProject(project.id, { ...project, schoolYear: '2027-2028', startDate: '2027-09-01', endDate: '2027-09-18' }, undefined, database);
    const tasks = await database.teachingTasks.where('projectId').equals(copy.id).toArray();
    expect(tasks.every(task => !task.scheduledStartDate && !task.scheduleOrder && !task.scheduledDates)).toBe(true);
  });

  it('rolls back both calendar and schedule when a closed day exceeds capacity', async () => {
    const { project, first } = await fixture();
    await moveTask(first.id, '2026-09-18', database);
    await expect(updateCalendarDay(project.id, '2026-09-18', { dayType: 'exam' }, database)).rejects.toThrow('不足');
    expect((await database.calendarDays.get([project.id, '2026-09-18']))?.dayType).toBe('normal');
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-18']);
  });

  it('rolls back shortening a semester that would discard placed content', async () => {
    const { project, first } = await fixture();
    await moveTask(first.id, '2026-09-18', database);
    await expect(updateProject(project.id, { ...project, endDate: '2026-09-11' }, database)).rejects.toThrow('不足');
    expect((await database.projects.get(project.id))?.endDate).toBe('2026-09-18');
  });

  it('rolls back a combined placement if the resize endpoint is invalid', async () => {
    const { first } = await fixture();
    await expect(placeTask(first.id, '2026-09-01', '2026-09-05', database)).rejects.toThrow('不能安排');
    expect((await database.teachingTasks.get(first.id))?.scheduledStartDate).toBeUndefined();
  });

  it('preserves legacy duration when a calendar edit removes a day in its span', async () => {
    const { project, first } = await fixture();
    await placeTask(first.id, '2026-09-01', '2026-09-03', database);
    await database.teachingTasks.update(first.id, { scheduledDates: undefined });
    await updateCalendarDay(project.id, '2026-09-02', { dayType: 'exam' }, database);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-01', '2026-09-03', '2026-09-04']);
    expect((await database.teachingTasks.get(first.id))?.plannedPeriods).toBe(3);
  });

  it('preserves placed duration when editing course metadata', async () => {
    const { project, first } = await fixture();
    await placeTask(first.id, '2026-09-01', '2026-09-03', database);
    const updated = await updateTask(first.id, { title: '重命名课程', type: 'exercise' }, database);
    expect(updated.plannedPeriods).toBe(3);
    expect(await taskDates(project.id, first.id)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    const lessons = await database.scheduledLessons.where('[projectId+taskId]').equals([project.id, first.id]).toArray();
    expect(lessons.every(row => row.taskTitle === '重命名课程' && row.taskType === 'exercise')).toBe(true);
  });
});
