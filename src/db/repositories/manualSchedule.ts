import { calendarStatus } from '../../core/calendar/availability';
import { teachingWeekNumber } from '../../core/calendar/dates';
import type { PlanVersion, ScheduledLesson, TeachingTask } from '../../types/domain';
import { db as appDb, type CurriculumDatabase } from '../schema';

export const manualScheduleReason = '手动编排（最终版）';
export type TimelineEntry = { taskId: string; date: string };
type Entry = TimelineEntry;
export function timelineTables(database: CurriculumDatabase) {
  return [database.projects, database.calendarDays, database.teachingTasks, database.planVersions, database.scheduledLessons, database.changeLogs];
}

async function load(projectId: string, database: CurriculumDatabase) {
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  const days = await database.calendarDays.where('projectId').equals(projectId).sortBy('date');
  const slots = days.filter(day => day.date >= project.startDate && day.date <= project.endDate && calendarStatus(day) === 'teaching').map(day => day.date);
  const tasks = await database.teachingTasks.where('projectId').equals(projectId).sortBy('order');
  const version = await database.planVersions.where('projectId').equals(projectId).filter(row => row.reason === manualScheduleReason).first();
  const previousLessons = version ? await database.scheduledLessons.where('planVersionId').equals(version.id).toArray() : [];
  const entries: Entry[] = tasks.flatMap(task => {
    if (!task.scheduledStartDate) return [];
    // Explicit dates preserve a course split by an inserted exercise or exam.
    const previousDates = previousLessons.filter(lesson => lesson.taskId === task.id).map(lesson => lesson.date).sort();
    const dates = task.scheduledDates ?? (previousDates.length ? previousDates : days.filter(day => day.date >= task.scheduledStartDate! && day.date <= task.scheduledEndDate!).map(day => day.date).slice(0, task.plannedPeriods));
    // Keep the original anchor when calendar edits removed all its old slots.
    return (dates.length ? dates : Array.from({ length: task.plannedPeriods }, () => task.scheduledStartDate!)).map(date => ({ taskId: task.id, date }));
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { project, tasks, slots, entries };
}

async function save(projectId: string, entries: Entry[], database: CurriculumDatabase) {
  const { project, tasks, slots } = await load(projectId, database);
  let cursor = -1;
  const allocated = entries.map(entry => {
    const requested = slots.findIndex(date => date >= entry.date);
    cursor = Math.max(cursor + 1, requested < 0 ? slots.length : requested);
    if (cursor >= slots.length) throw new Error('学期剩余上课日不足，请缩短内容跨度、提前安排或延长学期。');
    return { ...entry, date: slots[cursor] };
  });
  let version = await database.planVersions.where('projectId').equals(projectId).filter(row => row.reason === manualScheduleReason).first();
  if (!version && !entries.length) return;
  const now = new Date().toISOString();
  if (!version) {
    const last = await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last();
    version = { id: crypto.randomUUID(), projectId, version: (last?.version ?? 0) + 1, createdAt: now, reason: manualScheduleReason, scheduleSnapshot: [], inputFingerprint: 'manual-timeline-v2', weekStart: project.weekStart ?? 7, scheduleMode: 'progress' } satisfies PlanVersion;
    await database.planVersions.add(version);
  }
  const old = await database.scheduledLessons.where('planVersionId').equals(version.id).toArray();
  const oldIds = new Map(old.map(row => [`${row.taskId}:${row.taskPeriodIndex}`, row.id]));
  const lessons: ScheduledLesson[] = [];
  const placedIds = [...new Set(allocated.map(entry => entry.taskId))];
  for (const task of tasks) {
    const dates = allocated.filter(entry => entry.taskId === task.id).map(entry => entry.date);
    const next: TeachingTask = { ...task, scheduledDates: dates.length ? dates : undefined, scheduledStartDate: dates[0], scheduledEndDate: dates.at(-1), scheduleOrder: dates.length ? placedIds.indexOf(task.id) + 1 : undefined, plannedPeriods: dates.length || task.plannedPeriods, updatedAt: now };
    await database.teachingTasks.put(next);
    dates.forEach((date, index) => lessons.push({ id: oldIds.get(`${task.id}:${index + 1}`) ?? crypto.randomUUID(), projectId, planVersionId: version!.id, taskId: task.id, date, weekNumber: teachingWeekNumber(project.startDate, date, project.weekStart ?? 7), period: 1, taskPeriodIndex: index + 1, plannedPeriods: dates.length, taskTitle: task.title, taskType: task.type }));
  }
  await database.scheduledLessons.bulkDelete(old.map(row => row.id));
  await database.scheduledLessons.bulkPut(lessons);
  await database.planVersions.update(version.id, { scheduleSnapshot: lessons, createdAt: now, inputFingerprint: 'manual-timeline-v2', weekStart: project.weekStart ?? 7 });
}

function requireTarget(slots: string[], date: string) {
  if (!slots.includes(date)) throw new Error(`${date} 不在学期上课日内，是节假日或考试日时不能安排教学内容。`);
}

function removeAndClose(entries: Entry[], taskId: string, slots: string[]): Entry[] {
  let removed = 0;
  return entries.flatMap(entry => {
    if (entry.taskId === taskId) { removed++; return []; }
    const index = slots.indexOf(entry.date);
    return [{ ...entry, date: slots[Math.max(0, index - removed)] ?? entry.date }];
  });
}

export async function normalizeManualTimeline(projectId: string, database = appDb) {
  await database.transaction('rw', timelineTables(database), async () => {
    const { entries } = await load(projectId, database);
    await save(projectId, entries, database);
  });
}

export async function moveTask(taskId: string, targetDate: string, database = appDb) {
  await database.transaction('rw', timelineTables(database), async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task) throw new Error('教学内容不存在。');
    const { slots, entries } = await load(task.projectId, database);
    await save(task.projectId, previewTaskMove(taskId, targetDate, slots, entries, task.plannedPeriods), database);
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: taskId, action: 'move', before: task, after: { targetDate }, timestamp: new Date().toISOString() });
  });
}

export function previewTaskMove(taskId: string, targetDate: string, slots: string[], entries: TimelineEntry[], plannedPeriods = 1): TimelineEntry[] {
  requireTarget(slots, targetDate);
  const owned = entries.filter(entry => entry.taskId === taskId);
  // Dropping back on its start must not compact a previously split course.
  if (owned[0]?.date === targetDate) return entries;
  const remaining = removeAndClose(entries, taskId, slots);
  const duration = owned.length || plannedPeriods;
  const targetIndex = slots.indexOf(targetDate);
  if (targetIndex + duration > slots.length) throw new Error('学期剩余上课日不足。');
  const prefix = remaining.filter(entry => entry.date < targetDate);
  const suffix = remaining.filter(entry => entry.date >= targetDate).map(entry => {
    const shifted = slots[slots.indexOf(entry.date) + duration];
    if (!shifted) throw new Error('学期剩余上课日不足。');
    return { ...entry, date: shifted };
  });
  return [...prefix, ...slots.slice(targetIndex, targetIndex + duration).map(date => ({ taskId, date })), ...suffix];
}

// Shared by the live preview and the transactional save. Never writes data.
export function previewTaskResize(taskId: string, endDate: string, slots: string[], entries: TimelineEntry[]): TimelineEntry[] {
  requireTarget(slots, endDate);
  const owned = entries.filter(entry => entry.taskId === taskId);
  if (!owned.length) throw new Error('请先把这项内容拖入月历。');
  if (endDate < owned[0].date) throw new Error('结束日期不能早于开始日期。');
  const oldEnd = owned.at(-1)!.date;
  let next: Entry[];
  if (endDate >= oldEnd) {
    const added = slots.slice(slots.indexOf(oldEnd) + 1, slots.indexOf(endDate) + 1);
    const tail = entries.filter(entry => entry.date > oldEnd).map(entry => {
      const date = slots[slots.indexOf(entry.date) + added.length];
      if (!date) throw new Error('学期剩余上课日不足。');
      return { ...entry, date };
    });
    next = [...entries.filter(entry => entry.date <= oldEnd), ...added.map(date => ({ taskId, date })), ...tail];
  } else {
    let removed = 0;
    next = entries.flatMap(entry => {
      if (entry.taskId === taskId && entry.date > endDate) { removed++; return []; }
      return [{ ...entry, date: slots[slots.indexOf(entry.date) - removed] ?? entry.date }];
    });
    if (!next.some(entry => entry.taskId === taskId && entry.date === endDate)) throw new Error('请选择这项内容已占用的上课日作为缩短后的结束日期。');
  }
  return next;
}

export async function resizeTask(taskId: string, endDate: string, database = appDb) {
  await database.transaction('rw', timelineTables(database), async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task?.scheduledStartDate) throw new Error('请先把这项内容拖入月历。');
    const { slots, entries } = await load(task.projectId, database);
    await save(task.projectId, previewTaskResize(taskId, endDate, slots, entries), database);
  });
}

export async function placeTask(taskId: string, startDate: string, endDate = startDate, database = appDb) {
  await database.transaction('rw', timelineTables(database), async () => {
    await moveTask(taskId, startDate, database);
    if (endDate !== startDate) await resizeTask(taskId, endDate, database);
  });
}

export async function unplaceTask(taskId: string, database = appDb) {
  await database.transaction('rw', timelineTables(database), async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task?.scheduledStartDate) return;
    const { slots, entries } = await load(task.projectId, database);
    await database.teachingTasks.update(taskId, { scheduledDates: undefined, scheduledStartDate: undefined, scheduledEndDate: undefined, scheduleOrder: undefined, plannedPeriods: 1 });
    await save(task.projectId, removeAndClose(entries, taskId, slots), database);
  });
}
