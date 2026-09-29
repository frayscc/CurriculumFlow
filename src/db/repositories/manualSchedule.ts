import { calendarStatus } from '../../core/calendar/availability';
import { teachingWeekNumber } from '../../core/calendar/dates';
import type { CalendarDay, PlanVersion, ScheduledLesson, TeachingTask } from '../../types/domain';
import { db as appDb } from '../schema';

export const manualScheduleReason = '手动编排（最终版）';

function datesBetween(startDate: string, endDate: string): string[] {
  if (endDate < startDate) throw new Error('结束日期不能早于开始日期。');
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function manualVersion(projectId: string, database = appDb): Promise<PlanVersion> {
  const existing = await database.planVersions.where('projectId').equals(projectId).filter(row => row.reason === manualScheduleReason).first();
  if (existing) return existing;
  const previous = await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last();
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  const version: PlanVersion = {
    id: crypto.randomUUID(), projectId, version: (previous?.version ?? 0) + 1,
    createdAt: new Date().toISOString(), reason: manualScheduleReason, scheduleSnapshot: [],
    inputFingerprint: 'manual', weekStart: project.weekStart ?? 7, scheduleMode: 'progress',
  };
  await database.planVersions.add(version);
  return version;
}

export async function placeTask(taskId: string, startDate: string, endDate = startDate, database = appDb): Promise<void> {
  await database.transaction('rw', [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons, database.changeLogs], async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task) throw new Error('教学内容不存在。');
    const project = await database.projects.get(task.projectId);
    if (!project) throw new Error('项目不存在。');
    const dates = datesBetween(startDate, endDate);
    if (startDate < project.startDate || endDate > project.endDate) throw new Error('教学安排不能超出学期范围。');
    const calendarDays = await database.calendarDays.bulkGet(dates.map(date => [task.projectId, date] as [string, string]));
    const invalid = dates.find((_, index) => !calendarDays[index] || calendarStatus(calendarDays[index] as CalendarDay) !== 'teaching');
    if (invalid) throw new Error(`${invalid} 是节假日或考试日，不能安排教学内容。`);

    const version = await manualVersion(task.projectId, database);
    const oldLessons = await database.scheduledLessons.where('[projectId+taskId]').equals([task.projectId, task.id]).toArray();
    await database.scheduledLessons.bulkDelete(oldLessons.map(item => item.id));
    const lessons: ScheduledLesson[] = dates.map((date, index) => ({
      id: crypto.randomUUID(), projectId: task.projectId, planVersionId: version.id, taskId: task.id,
      date, weekNumber: teachingWeekNumber(project.startDate, date, project.weekStart ?? 7), period: 1,
      taskPeriodIndex: index + 1, plannedPeriods: dates.length, taskTitle: task.title, taskType: task.type,
    }));
    await database.scheduledLessons.bulkAdd(lessons);
    const next: TeachingTask = { ...task, scheduledStartDate: startDate, scheduledEndDate: endDate, plannedPeriods: dates.length, fixedDate: undefined, fixedWeek: undefined, allowSplit: true, updatedAt: new Date().toISOString() };
    await database.teachingTasks.put(next);
    const allLessons = await database.scheduledLessons.where('planVersionId').equals(version.id).toArray();
    await database.planVersions.update(version.id, { scheduleSnapshot: allLessons, createdAt: next.updatedAt });
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: task.id, action: 'place', before: { startDate: task.scheduledStartDate, endDate: task.scheduledEndDate }, after: { startDate, endDate }, timestamp: next.updatedAt });
  });
}

export async function unplaceTask(taskId: string, database = appDb): Promise<void> {
  await database.transaction('rw', [database.teachingTasks, database.planVersions, database.scheduledLessons], async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task) return;
    const lessons = await database.scheduledLessons.where('[projectId+taskId]').equals([task.projectId, task.id]).toArray();
    await database.scheduledLessons.bulkDelete(lessons.map(item => item.id));
    await database.teachingTasks.update(task.id, { scheduledStartDate: undefined, scheduledEndDate: undefined, plannedPeriods: 1, updatedAt: new Date().toISOString() });
    const version = await database.planVersions.where('projectId').equals(task.projectId).filter(row => row.reason === manualScheduleReason).first();
    if (version) await database.planVersions.update(version.id, { scheduleSnapshot: await database.scheduledLessons.where('planVersionId').equals(version.id).toArray() });
  });
}
