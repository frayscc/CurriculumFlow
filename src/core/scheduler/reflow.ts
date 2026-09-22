import { teachingWeekNumber } from '../calendar/dates';
import { buildScheduledWeeks, schedule, type DraftLesson, type ScheduleResult, type SchedulerInput } from './index';
import type { ActualTeachingRecord, ScheduledLesson } from '../../types/domain';

export function rescheduleAfterPostponement(input: SchedulerInput, current: ScheduledLesson[], actuals: ActualTeachingRecord[]): { result: ScheduleResult; cutoff: string } {
  const postponed = actuals.filter(row => row.status === 'postponed' && current.some(lesson => lesson.id === row.scheduledLessonId));
  if (!postponed.length) throw new Error('当前计划没有延期课次。请先在教学执行中记录延期。');
  const cutoff = postponed.map(row => row.plannedDate).sort()[0];
  const byLesson = new Map(actuals.map(row => [row.scheduledLessonId, row]));
  const keep = current.filter(lesson => {
    const status = byLesson.get(lesson.id)?.status;
    return status === 'completed' || status === 'partially_completed' || (lesson.date <= cutoff && status !== 'postponed' && status !== 'cancelled');
  });
  const excluded = new Set([...keep.map(row => row.id), ...current.filter(row => byLesson.get(row.id)?.status === 'cancelled').map(row => row.id)]);
  const remaining = current.filter(row => !excluded.has(row.id));
  const remainingByTask = new Map<string, number[]>();
  for (const lesson of remaining) remainingByTask.set(lesson.taskId, [...(remainingByTask.get(lesson.taskId) ?? []), lesson.taskPeriodIndex]);
  for (const values of remainingByTask.values()) values.sort((a, b) => a - b);
  const cutoffWeek = teachingWeekNumber(input.project.startDate, cutoff, input.project.weekStart ?? 7);
  const adjusted: SchedulerInput = {
    ...input,
    calendarDays: input.calendarDays.map(day => day.date <= cutoff ? { ...day, dayType: 'unavailable' } : day),
    reservedSlots: keep.filter(row => row.date > cutoff).map(row => ({ date: row.date, period: row.period })),
    tasks: input.tasks.filter(task => remainingByTask.has(task.id)).map(task => ({
      ...task, plannedPeriods: remainingByTask.get(task.id)!.length,
      fixedDate: task.fixedDate && task.fixedDate <= cutoff ? undefined : task.fixedDate,
      fixedWeek: task.fixedWeek && task.fixedWeek <= cutoffWeek ? undefined : task.fixedWeek,
    })),
  };
  const recalculated = schedule(adjusted);
  const assigned = new Map<string, number>();
  const future: DraftLesson[] = recalculated.lessons.map(lesson => {
    const index = assigned.get(lesson.taskId) ?? 0;
    assigned.set(lesson.taskId, index + 1);
    const original = input.tasks.find(task => task.id === lesson.taskId)!;
    return { ...lesson, taskPeriodIndex: remainingByTask.get(lesson.taskId)![index], plannedPeriods: original.plannedPeriods };
  });
  const lessons: DraftLesson[] = [...keep.map(({ taskId, date, weekNumber, period, taskPeriodIndex, plannedPeriods, sharedSlotLabel, sharedOccurrences }) => ({ taskId, date, weekNumber, period, taskPeriodIndex, plannedPeriods, sharedSlotLabel, sharedOccurrences })), ...future]
    .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  return { cutoff, result: { ...recalculated, lessons, weeks: buildScheduledWeeks(input.project, lessons) } };
}
