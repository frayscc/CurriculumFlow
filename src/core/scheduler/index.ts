import { buildTeachingSlots, normalizePeriods, type TeachingSlot } from '../calendar/availability';
import { dateFromTimestamp, generateCalendarDays, parseLocalDate, startOfTeachingWeek, teachingWeekNumber, weekdayOf } from '../calendar/dates';
import type { CalendarDay, CourseSchedule, ScheduleOverride, SemesterProject, TeachingTask } from '../../types/domain';

export interface SchedulerInput {
  project: Pick<SemesterProject, 'startDate' | 'endDate' | 'weekStart' | 'sharedCourseSlots'>;
  calendarDays: CalendarDay[];
  courseSchedules: CourseSchedule[];
  scheduleOverrides: ScheduleOverride[];
  tasks: TeachingTask[];
  reservedSlots?: Array<{ date: string; period: number }>;
}
export interface DraftLesson {
  taskId: string; date: string; weekNumber: number; period: number;
  taskPeriodIndex: number; plannedPeriods: number;
  sharedSlotLabel?: string; sharedOccurrences?: Array<{ date: string; period: number }>;
}
export interface ScheduleConflict {
  code: 'INVALID_INPUT' | 'NO_SLOT_ON_FIXED_DATE' | 'FIXED_WEEK_CAPACITY' | 'FIXED_CONFLICT' |
    'FIXED_ORDER' | 'ORDER_BEFORE_FIXED' | 'NON_SPLIT_UNFIT' | 'TERM_CAPACITY_EXCEEDED';
  taskId?: string; date?: string; message: string;
}
export interface UnscheduledTask { taskId: string; remainingPeriods: number; reason: string; }
export interface ScheduledWeek {
  weekNumber: number; startDate: string; endDate: string; taskIds: string[]; lessonCount: number;
}
export interface ScheduleResult {
  slots: TeachingSlot[]; lessons: DraftLesson[]; weeks: ScheduledWeek[];
  unscheduled: UnscheduledTask[]; conflicts: ScheduleConflict[];
}

function invalid(message: string, tasks: TeachingTask[]): ScheduleResult {
  return {
    slots: [], lessons: [], weeks: [],
    unscheduled: tasks.map(task => ({ taskId: task.id, remainingPeriods: task.plannedPeriods, reason: message })),
    conflicts: [{ code: 'INVALID_INPUT', message }],
  };
}

function contiguousRun(slots: TeachingSlot[], candidates: number[], count: number): number[] {
  for (let start = 0; start < candidates.length; start++) {
    const run = [candidates[start]];
    for (let next = start + 1; next < candidates.length && run.length < count; next++) {
      const previousSlot = slots[run[run.length - 1]];
      const nextSlot = slots[candidates[next]];
      if (nextSlot.date !== previousSlot.date || nextSlot.period !== previousSlot.period + 1) break;
      run.push(candidates[next]);
    }
    if (run.length === count) return run;
  }
  return [];
}

function makeLessons(task: TeachingTask, indices: number[], slots: TeachingSlot[]): DraftLesson[] {
  return indices.map((index, position) => {
    const slot = slots[index];
    const fixedOccurrence = task.fixedDate ? slot.occurrences?.find(item => item.date === task.fixedDate) : undefined;
    return {
      taskId: task.id, date: fixedOccurrence?.date ?? slot.date, weekNumber: slot.weekNumber,
      period: fixedOccurrence?.period ?? slot.period, taskPeriodIndex: position + 1, plannedPeriods: task.plannedPeriods,
      sharedSlotLabel: slot.sharedSlotLabel, sharedOccurrences: slot.occurrences,
    };
  });
}

export function buildScheduledWeeks(project: SchedulerInput['project'], lessons: DraftLesson[]): ScheduledWeek[] {
  const start = parseLocalDate(project.startDate);
  const firstWeekStart = startOfTeachingWeek(project.startDate, project.weekStart ?? 7);
  const weekCount = teachingWeekNumber(project.startDate, project.endDate, project.weekStart ?? 7);
  return Array.from({ length: weekCount }, (_, index) => {
    const weekNumber = index + 1;
    const weekStart = firstWeekStart + index * 7 * 86_400_000;
    const weekLessons = lessons.filter(lesson => lesson.weekNumber === weekNumber);
    return {
      weekNumber,
      startDate: dateFromTimestamp(Math.max(start, weekStart)),
      endDate: dateFromTimestamp(Math.min(parseLocalDate(project.endDate), weekStart + 6 * 86_400_000)),
      taskIds: [...new Set(weekLessons.map(lesson => lesson.taskId))],
      lessonCount: weekLessons.length,
    };
  });
}

export function schedule(input: SchedulerInput): ScheduleResult {
  const { project, calendarDays, courseSchedules, scheduleOverrides } = input;
  const tasks = [...input.tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  try {
    const expectedDays = generateCalendarDays('validation', project.startDate, project.endDate);
    const dates = new Set(calendarDays.map(day => day.date));
    if (dates.size !== expectedDays.length || calendarDays.length !== expectedDays.length || expectedDays.some(day => !dates.has(day.date)) ||
      calendarDays.some(day => day.weekday !== weekdayOf(day.date))) {
      return invalid('校历缺少日期或存在重复日期。', tasks);
    }
    if (new Set(tasks.map(task => task.id)).size !== tasks.length || new Set(tasks.map(task => task.order)).size !== tasks.length) {
      return invalid('教学任务 ID 或顺序重复。', tasks);
    }
    const maxWeek = teachingWeekNumber(project.startDate, project.endDate, project.weekStart ?? 7);
    for (const task of tasks) {
      if (!Number.isInteger(task.plannedPeriods) || task.plannedPeriods < 1 || (task.fixedDate && task.fixedWeek) ||
        (task.fixedDate && (task.fixedDate < project.startDate || task.fixedDate > project.endDate)) ||
        (task.fixedWeek && (!Number.isInteger(task.fixedWeek) || task.fixedWeek < 1 || task.fixedWeek > maxWeek))) {
        return invalid(`任务“${task.title}”的课时或固定节点无效。`, tasks);
      }
    }
    if (new Set(courseSchedules.map(row => row.weekday)).size !== courseSchedules.length || new Set(scheduleOverrides.map(row => row.date)).size !== scheduleOverrides.length) {
      return invalid('周课表或日期覆盖存在重复记录。', tasks);
    }
    for (const row of courseSchedules) normalizePeriods(row.periods);
    const sharedIds = new Set<string>(); const sharedMembers = new Set<string>();
    for (const group of project.sharedCourseSlots ?? []) {
      if (!group.id || sharedIds.has(group.id) || !group.label.trim() || group.members.length < 2) return invalid('共享课位配置无效。', tasks);
      sharedIds.add(group.id);
      for (const member of group.members) {
        const key = `${member.weekday}:${member.period}`;
        if (sharedMembers.has(key) || !courseSchedules.some(row => row.weekday === member.weekday && row.periods.includes(member.period))) return invalid('共享课位必须关联课表中存在且不重复的节次。', tasks);
        sharedMembers.add(key);
      }
    }
    for (const row of scheduleOverrides) {
      if (!dates.has(row.date)) return invalid('日期覆盖超出学期范围。', tasks);
      normalizePeriods(row.actualPeriods);
    }
  } catch (error) { return invalid(error instanceof Error ? error.message : '排课输入无效。', tasks); }

  let slots: TeachingSlot[];
  try {
    const reserved = new Set(input.reservedSlots?.map(slot => `${slot.date}:${slot.period}`) ?? []);
    slots = buildTeachingSlots(project.startDate, calendarDays, courseSchedules, scheduleOverrides, {
      weekStart: project.weekStart ?? 7, sharedCourseSlots: project.sharedCourseSlots ?? [],
    })
      .filter(slot => !reserved.has(`${slot.date}:${slot.period}`));
  }
  catch (error) { return invalid(error instanceof Error ? error.message : '无法生成课时槽。', tasks); }

  const conflicts: ScheduleConflict[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const occupied = new Set<number>();
  const reservations = new Map<string, number[]>();
  const assignments = new Map<string, number[]>();

  // Fixed tasks reserve their constrained slots before ordinary tasks can use them.
  for (const task of tasks.filter(item => item.fixedDate || item.fixedWeek)) {
    const allMatching = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) =>
      task.fixedDate ? slot.date === task.fixedDate || !!slot.occurrences?.some(item => item.date === task.fixedDate) : slot.weekNumber === task.fixedWeek,
    ).map(item => item.index);
    const candidates = slots.map((slot, index) => ({ slot, index })).filter(({ slot, index }) =>
      !occupied.has(index) && (task.fixedDate ? slot.date === task.fixedDate || !!slot.occurrences?.some(item => item.date === task.fixedDate) : slot.weekNumber === task.fixedWeek),
    ).map(item => item.index);
    const selected = task.allowSplit ? candidates.slice(0, task.plannedPeriods) : contiguousRun(slots, candidates, task.plannedPeriods);
    selected.forEach(index => occupied.add(index));
    reservations.set(task.id, selected);
    assignments.set(task.id, selected);
    if (selected.length < task.plannedPeriods) {
      const code: ScheduleConflict['code'] = allMatching.length >= task.plannedPeriods && candidates.length < task.plannedPeriods
        ? 'FIXED_CONFLICT' : task.fixedDate ? 'NO_SLOT_ON_FIXED_DATE' : 'FIXED_WEEK_CAPACITY';
      const message = task.fixedDate ? `固定日期 ${task.fixedDate} 的可用课时不足。` : `第 ${task.fixedWeek} 周的可用课时不足。`;
      conflicts.push({ code, taskId: task.id, date: task.fixedDate, message });
      unscheduled.push({ taskId: task.id, remainingPeriods: task.plannedPeriods - selected.length, reason: message });
    }
  }

  let cursor = 0;
  for (let position = 0; position < tasks.length; position++) {
    const task = tasks[position];
    if (task.fixedDate || task.fixedWeek) {
      const fixed = reservations.get(task.id) ?? [];
      if (fixed.length && fixed[0] < cursor) conflicts.push({ code: 'FIXED_ORDER', taskId: task.id, message: `固定任务“${task.title}”早于前置任务的完成位置。` });
      if (fixed.length) cursor = Math.max(cursor, fixed[fixed.length - 1] + 1);
      continue;
    }
    const nextFixed = tasks.slice(position + 1).find(item => (item.fixedDate || item.fixedWeek) && (reservations.get(item.id)?.length ?? 0) > 0);
    const upperBound = nextFixed ? reservations.get(nextFixed.id)![0] : slots.length;
    const candidates = slots.map((_, index) => index).filter(index => index >= cursor && index < upperBound && !occupied.has(index));
    const selected = task.allowSplit ? candidates.slice(0, task.plannedPeriods) : contiguousRun(slots, candidates, task.plannedPeriods);
    assignments.set(task.id, selected);
    selected.forEach(index => occupied.add(index));
    if (selected.length) cursor = selected[selected.length - 1] + 1;
    if (selected.length < task.plannedPeriods) {
      const reason = nextFixed ? `固定任务“${nextFixed.title}”之前的课时不足。` :
        task.allowSplit ? '学期剩余可用课时不足。' : '找不到同一天连续的足够课时。';
      if (nextFixed) conflicts.push({ code: 'ORDER_BEFORE_FIXED', taskId: task.id, message: reason });
      else if (!task.allowSplit) conflicts.push({ code: 'NON_SPLIT_UNFIT', taskId: task.id, message: reason });
      unscheduled.push({ taskId: task.id, remainingPeriods: task.plannedPeriods - selected.length, reason });
    }
  }

  const totalPeriods = tasks.reduce((sum, task) => sum + task.plannedPeriods, 0);
  if (totalPeriods > slots.length) {
    const excess = totalPeriods - slots.length;
    conflicts.push({ code: 'TERM_CAPACITY_EXCEEDED', message: `教学任务超出当前学期可用课时 ${excess} 课时。` });
  }
  const lessons = tasks.flatMap(task => makeLessons(task, assignments.get(task.id) ?? [], slots));
  lessons.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period || a.taskId.localeCompare(b.taskId));
  return { slots, lessons, weeks: buildScheduledWeeks(project, lessons), unscheduled, conflicts };
}
