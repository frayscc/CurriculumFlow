import { describe, expect, it } from 'vitest';
import { generateCalendarDays } from '../core/calendar/dates';
import { schedule, type SchedulerInput } from '../core/scheduler';
import type { TeachingTask } from '../types/domain';

const task = (id: string, order: number, plannedPeriods = 1, extra: Partial<TeachingTask> = {}): TeachingTask => ({
  id, projectId: 'p', order, title: id, type: 'new_lesson', plannedPeriods,
  allowSplit: true, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...extra,
});
const input = (startDate = '2026-09-14', endDate = '2026-09-20'): SchedulerInput => ({
  project: { startDate, endDate },
  calendarDays: generateCalendarDays('p', startDate, endDate),
  courseSchedules: [1, 2, 3, 4, 5].map(weekday => ({ projectId: 'p', weekday: weekday as 1 | 2 | 3 | 4 | 5, periods: [3] })),
  scheduleOverrides: [], tasks: [],
});

describe('deterministic scheduler', () => {
  it('fills a normal five-day school week in order and aggregates by teaching week', () => {
    const data = input(); data.tasks = [task('13.1', 1, 2), task('13.2', 2, 3)];
    const result = schedule(data);
    expect(result.lessons.map(lesson => [lesson.taskId, lesson.date])).toEqual([
      ['13.1', '2026-09-14'], ['13.1', '2026-09-15'], ['13.2', '2026-09-16'],
      ['13.2', '2026-09-17'], ['13.2', '2026-09-18'],
    ]);
    expect(result.weeks[0].taskIds).toEqual(['13.1', '13.2']);
    expect(result.conflicts).toEqual([]);
    expect(schedule(data)).toEqual(result);
  });

  it('skips a full holiday week and shifts later tasks', () => {
    const data = input('2026-09-27', '2026-10-17');
    data.calendarDays.filter(day => day.date >= '2026-10-04' && day.date <= '2026-10-10').forEach(day => { day.dayType = 'holiday'; });
    data.tasks = [task('before', 1, 5), task('after', 2, 1)];
    const result = schedule(data);
    expect(result.lessons.find(lesson => lesson.taskId === 'after')?.date).toBe('2026-10-12');
    expect(result.weeks[1].lessonCount).toBe(0);
  });

  it('uses Friday timetable on a Sunday makeup day', () => {
    const data = input(); data.courseSchedules = [{ projectId: 'p', weekday: 5, periods: [2, 5] }];
    const sunday = data.calendarDays.find(day => day.date === '2026-09-20')!;
    sunday.dayType = 'makeup_workday'; sunday.scheduleWeekday = 5;
    data.tasks = [task('a', 1, 4)];
    const result = schedule(data);
    expect(result.lessons.filter(lesson => lesson.date === '2026-09-20').map(lesson => lesson.period)).toEqual([2, 5]);
  });

  it('honors temporary cancellation and extra periods', () => {
    const data = input('2026-09-14', '2026-09-15');
    data.scheduleOverrides = [
      { projectId: 'p', date: '2026-09-14', originalPeriods: [3], actualPeriods: [], reason: '活动' },
      { projectId: 'p', date: '2026-09-15', originalPeriods: [3], actualPeriods: [2, 3], reason: '加课' },
    ];
    data.tasks = [task('a', 1, 2)];
    expect(schedule(data).lessons.map(lesson => `${lesson.date}:${lesson.period}`)).toEqual(['2026-09-15:2', '2026-09-15:3']);
  });

  it('splits a two-period task across dates', () => {
    const data = input('2026-09-14', '2026-09-15'); data.tasks = [task('a', 1, 2)];
    expect(schedule(data).lessons.map(lesson => lesson.taskPeriodIndex)).toEqual([1, 2]);
  });

  it('reserves a fixed midterm exam and reports unfinished prerequisite work', () => {
    const data = input();
    data.tasks = [task('lesson', 1, 3), task('midterm', 2, 1, { type: 'exam', fixedDate: '2026-09-16' }), task('review', 3)];
    const result = schedule(data);
    expect(result.lessons.find(lesson => lesson.taskId === 'midterm')?.date).toBe('2026-09-16');
    expect(result.lessons.find(lesson => lesson.taskId === 'review')?.date).toBe('2026-09-17');
    expect(result.unscheduled).toContainEqual(expect.objectContaining({ taskId: 'lesson', remainingPeriods: 1 }));
    expect(result.conflicts.map(conflict => conflict.code)).toContain('ORDER_BEFORE_FIXED');
  });

  it('reports the exact number of excess periods', () => {
    const data = input('2026-09-14', '2026-09-15'); data.tasks = [task('a', 1, 8)];
    const result = schedule(data);
    expect(result.lessons).toHaveLength(2);
    expect(result.unscheduled[0].remainingPeriods).toBe(6);
    expect(result.conflicts.find(conflict => conflict.code === 'TERM_CAPACITY_EXCEEDED')?.message)
      .toBe('教学任务超出当前学期可用课时 6 课时。');
  });

  it('requires consecutive periods for a non-splittable task', () => {
    const data = input('2026-09-14', '2026-09-15'); data.tasks = [task('lab', 1, 2, { allowSplit: false })];
    const result = schedule(data);
    expect(result.lessons).toEqual([]);
    expect(result.conflicts.map(conflict => conflict.code)).toContain('NON_SPLIT_UNFIT');
    data.courseSchedules[0].periods = [3, 4];
    expect(schedule(data).lessons.map(lesson => lesson.period)).toEqual([3, 4]);
  });

  it('returns an input conflict if calendar days are missing', () => {
    const data = input(); data.calendarDays.pop(); data.tasks = [task('a', 1)];
    expect(schedule(data).conflicts[0].code).toBe('INVALID_INPUT');
  });
});
