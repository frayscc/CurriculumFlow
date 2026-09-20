import { describe, expect, it } from 'vitest';
import { generateCalendarDays, teachingWeekNumber, weekdayOf } from '../core/calendar/dates';

describe('calendar dates', () => {
  it('generates each local day without timezone shifts across months', () => {
    const days = generateCalendarDays('project', '2026-09-29', '2026-10-02');
    expect(days.map(day => day.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(days.map(day => day.weekday)).toEqual([2, 3, 4, 5]);
  });

  it('uses Sunday to Saturday teaching weeks from the sample plan', () => {
    expect(weekdayOf('2026-09-06')).toBe(7);
    expect(teachingWeekNumber('2026-09-01', '2026-09-05')).toBe(1);
    expect(teachingWeekNumber('2026-09-01', '2026-09-06')).toBe(2);
    expect(teachingWeekNumber('2026-09-01', '2027-01-23')).toBe(21);
  });

  it('rejects invalid and reversed dates', () => {
    expect(() => generateCalendarDays('project', '2026-02-30', '2026-03-01')).toThrow('日期无效');
    expect(() => generateCalendarDays('project', '2026-10-02', '2026-09-01')).toThrow('结束日期');
  });
});
