import { calendarStatus } from '../../core/calendar/availability';
import { teachingWeekNumber } from '../../core/calendar/dates';
import type { CalendarDay, PlanVersion, ScheduledLesson, SemesterProject, TeachingTask } from '../../types/domain';
import { db as appDb, type CurriculumDatabase } from '../schema';

export const manualScheduleReason = '手动编排（最终版）';

function orderedPlacedTasks(tasks: TeachingTask[]): TeachingTask[] {
  return tasks.filter(task => task.scheduledStartDate).sort((left, right) =>
    (left.scheduleOrder ?? Number.MAX_SAFE_INTEGER) - (right.scheduleOrder ?? Number.MAX_SAFE_INTEGER)
    || left.scheduledStartDate!.localeCompare(right.scheduledStartDate!)
    || left.order - right.order,
  );
}

function teachingDates(days: CalendarDay[]): string[] {
  return days.filter(day => calendarStatus(day) === 'teaching').map(day => day.date).sort();
}

function assertTeachingTarget(project: SemesterProject, days: CalendarDay[], date: string): void {
  if (date < project.startDate || date > project.endDate) throw new Error('教学安排不能超出学期范围。');
  const day = days.find(item => item.date === date);
  if (!day || calendarStatus(day) !== 'teaching') throw new Error(`${date} 是节假日或考试日，不能安排教学内容。`);
}

async function manualVersion(projectId: string, database: CurriculumDatabase): Promise<PlanVersion> {
  const existing = await database.planVersions.where('projectId').equals(projectId).filter(row => row.reason === manualScheduleReason).first();
  if (existing) return existing;
  const previous = await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last();
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  const version: PlanVersion = {
    id: crypto.randomUUID(), projectId, version: (previous?.version ?? 0) + 1,
    createdAt: new Date().toISOString(), reason: manualScheduleReason, scheduleSnapshot: [],
    inputFingerprint: 'manual-timeline', weekStart: project.weekStart ?? 7, scheduleMode: 'progress',
  };
  await database.planVersions.add(version);
  return version;
}

async function rebuildTimeline(project: SemesterProject, tasks: TeachingTask[], days: CalendarDay[], anchorDate: string, database: CurriculumDatabase): Promise<void> {
  const version = await manualVersion(project.id, database);
  const slots = teachingDates(days).filter(date => date >= anchorDate);
  const required = tasks.reduce((sum, task) => sum + Math.max(1, task.plannedPeriods), 0);
  if (slots.length < required) throw new Error(`学期剩余上课日不足：还需要 ${required - slots.length} 天。请缩短内容跨度或提前开始。`);

  const timestamp = new Date().toISOString();
  const updatedTasks: TeachingTask[] = [];
  const lessons: ScheduledLesson[] = [];
  let cursor = 0;
  tasks.forEach((task, taskIndex) => {
    const duration = Math.max(1, task.plannedPeriods);
    const taskDates = slots.slice(cursor, cursor + duration);
    updatedTasks.push({ ...task, scheduleOrder: taskIndex + 1, scheduledStartDate: taskDates[0], scheduledEndDate: taskDates.at(-1), plannedPeriods: duration, fixedDate: undefined, fixedWeek: undefined, allowSplit: true, updatedAt: timestamp });
    taskDates.forEach((date, dateIndex) => lessons.push({
      id: crypto.randomUUID(), projectId: project.id, planVersionId: version.id, taskId: task.id,
      date, weekNumber: teachingWeekNumber(project.startDate, date, project.weekStart ?? 7), period: 1,
      taskPeriodIndex: dateIndex + 1, plannedPeriods: duration, taskTitle: task.title, taskType: task.type,
    }));
    cursor += duration;
  });

  const oldLessons = await database.scheduledLessons.where('planVersionId').equals(version.id).toArray();
  await database.scheduledLessons.bulkDelete(oldLessons.map(item => item.id));
  if (updatedTasks.length) await database.teachingTasks.bulkPut(updatedTasks);
  if (lessons.length) await database.scheduledLessons.bulkAdd(lessons);
  await database.planVersions.update(version.id, { scheduleSnapshot: lessons, createdAt: timestamp, inputFingerprint: 'manual-timeline' });
}

async function loadTimeline(taskId: string, database: CurriculumDatabase) {
  const task = await database.teachingTasks.get(taskId);
  if (!task) throw new Error('教学内容不存在。');
  const project = await database.projects.get(task.projectId);
  if (!project) throw new Error('项目不存在。');
  const days = await database.calendarDays.where('projectId').equals(task.projectId).sortBy('date');
  const allTasks = await database.teachingTasks.where('projectId').equals(task.projectId).toArray();
  return { task, project, days, allTasks };
}

/** Upgrade an existing independent/overlapping schedule to the magnetic timeline model. */
export async function normalizeManualTimeline(projectId: string, database = appDb): Promise<void> {
  await database.transaction('rw', [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons], async () => {
    const project = await database.projects.get(projectId);
    if (!project) throw new Error('项目不存在。');
    const days = await database.calendarDays.where('projectId').equals(projectId).sortBy('date');
    const tasks = orderedPlacedTasks(await database.teachingTasks.where('projectId').equals(projectId).toArray());
    if (!tasks.length) return;
    await rebuildTimeline(project, tasks, days, tasks[0].scheduledStartDate!, database);
  });
}

/** Insert or move one item on the magnetic timeline. Items at and after the target ripple forward. */
export async function moveTask(taskId: string, targetDate: string, database = appDb): Promise<void> {
  await database.transaction('rw', [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons, database.changeLogs], async () => {
    const { task, project, days, allTasks } = await loadTimeline(taskId, database);
    assertTeachingTarget(project, days, targetDate);
    const before = orderedPlacedTasks(allTasks);
    const remaining = before.filter(item => item.id !== task.id);
    const hasOtherPlacedTasks = remaining.length > 0;
    const insertionIndex = remaining.findIndex(item => targetDate <= item.scheduledEndDate!);
    remaining.splice(insertionIndex < 0 ? remaining.length : insertionIndex, 0, task);
    const oldAnchor = before[0]?.scheduledStartDate;
    const anchor = !hasOtherPlacedTasks || !oldAnchor ? targetDate : targetDate < oldAnchor ? targetDate : oldAnchor;
    await rebuildTimeline(project, remaining, days, anchor, database);
    await database.changeLogs.add({
      id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: task.id,
      action: task.scheduledStartDate ? 'move' : 'insert', before: { startDate: task.scheduledStartDate, endDate: task.scheduledEndDate },
      after: { targetDate }, timestamp: new Date().toISOString(),
    });
  });
}

/** Resize an item in teaching-day units. Closed dates are skipped and following items ripple. */
export async function resizeTask(taskId: string, endDate: string, database = appDb): Promise<void> {
  await database.transaction('rw', [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons, database.changeLogs], async () => {
    const { task, project, days, allTasks } = await loadTimeline(taskId, database);
    if (!task.scheduledStartDate) throw new Error('请先把这项内容拖入月历。');
    assertTeachingTarget(project, days, endDate);
    if (endDate < task.scheduledStartDate) throw new Error('结束日期不能早于开始日期。');
    const duration = teachingDates(days).filter(date => date >= task.scheduledStartDate! && date <= endDate).length;
    const timeline = orderedPlacedTasks(allTasks).map(item => item.id === task.id ? { ...item, plannedPeriods: duration } : item);
    await rebuildTimeline(project, timeline, days, timeline[0].scheduledStartDate!, database);
    await database.changeLogs.add({
      id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: task.id,
      action: 'resize', before: { endDate: task.scheduledEndDate, duration: task.plannedPeriods },
      after: { endDate, duration }, timestamp: new Date().toISOString(),
    });
  });
}

/** Compatibility entry point for older callers. */
export async function placeTask(taskId: string, startDate: string, endDate = startDate, database = appDb): Promise<void> {
  await moveTask(taskId, startDate, database);
  if (endDate !== startDate) await resizeTask(taskId, endDate, database);
}

export async function unplaceTask(taskId: string, database = appDb): Promise<void> {
  await database.transaction('rw', [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons], async () => {
    const { task, project, days, allTasks } = await loadTimeline(taskId, database);
    const before = orderedPlacedTasks(allTasks);
    if (!task.scheduledStartDate) return;
    const anchor = before[0]?.scheduledStartDate ?? task.scheduledStartDate;
    const remaining = before.filter(item => item.id !== task.id);
    await database.teachingTasks.update(task.id, { scheduleOrder: undefined, scheduledStartDate: undefined, scheduledEndDate: undefined, plannedPeriods: 1, updatedAt: new Date().toISOString() });
    if (remaining.length) {
      await rebuildTimeline(project, remaining, days, anchor, database);
    } else {
      const version = await database.planVersions.where('projectId').equals(task.projectId).filter(row => row.reason === manualScheduleReason).first();
      if (version) {
        const lessons = await database.scheduledLessons.where('planVersionId').equals(version.id).toArray();
        await database.scheduledLessons.bulkDelete(lessons.map(item => item.id));
        await database.planVersions.update(version.id, { scheduleSnapshot: [], createdAt: new Date().toISOString() });
      }
    }
  });
}
