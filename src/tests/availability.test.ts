import { describe, expect, it } from 'vitest';
import { availablePeriods, buildTeachingSlots, parsePeriods } from '../core/calendar/availability';
import { generateCalendarDays } from '../core/calendar/dates';
import type { CourseSchedule } from '../types/domain';

const schedules: CourseSchedule[] = [
  { projectId: 'p', weekday: 1, periods: [3] },
  { projectId: 'p', weekday: 5, periods: [2, 5] },
];

describe('teaching availability', () => {
  it('uses the subject schedule, not every weekday', () => {
    const days = generateCalendarDays('p', '2026-09-14', '2026-09-20');
    const slots = buildTeachingSlots('2026-09-01', days, schedules, []);
    expect(slots.map(slot => `${slot.date}:${slot.period}`)).toEqual(['2026-09-14:3', '2026-09-18:2', '2026-09-18:5']);
  });

  it('skips holidays and uses Friday lessons for Sunday makeup work', () => {
    const days = generateCalendarDays('p', '2026-09-14', '2026-09-20');
    days[0].dayType = 'holiday';
    days[6].dayType = 'makeup_workday'; days[6].scheduleWeekday = 5;
    expect(buildTeachingSlots('2026-09-01', days, schedules, []).map(slot => `${slot.date}:${slot.period}`))
      .toEqual(['2026-09-18:2', '2026-09-18:5', '2026-09-20:2', '2026-09-20:5']);
  });

  it('lets a date override cancel or add periods but never reopen a holiday', () => {
    const days = generateCalendarDays('p', '2026-09-14', '2026-09-18');
    const overrides = [
      { projectId: 'p', date: '2026-09-14', originalPeriods: [3], actualPeriods: [], reason: '学校活动' },
      { projectId: 'p', date: '2026-09-15', originalPeriods: [], actualPeriods: [4], reason: '临时加课' },
    ];
    expect(buildTeachingSlots('2026-09-01', days, schedules, overrides).map(slot => `${slot.date}:${slot.period}`))
      .toEqual(['2026-09-15:4', '2026-09-18:2', '2026-09-18:5']);
    days[1].dayType = 'holiday';
    expect(availablePeriods(days[1], schedules, overrides[1])).toEqual([]);
  });

  it('validates entered period lists', () => {
    expect(parsePeriods('3, 1，3')).toEqual([1, 3]);
    expect(parsePeriods('')).toEqual([]);
    expect(() => parsePeriods('第3节')).toThrow('节次');
  });
});
