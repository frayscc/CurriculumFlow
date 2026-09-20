import type { CalendarDay, CourseSchedule, ScheduleOverride, Weekday } from '../../types/domain';
import { teachingWeekNumber } from './dates';

export interface TeachingSlot {
  date: string; weekNumber: number; period: number;
  source: 'weekly' | 'makeup' | 'override';
}

export function normalizePeriods(periods: number[]): number[] {
  if (periods.some(period => !Number.isInteger(period) || period < 1 || period > 20)) {
    throw new Error('节次必须是 1 至 20 的整数。');
  }
  return [...new Set(periods)].sort((a, b) => a - b);
}

export function parsePeriods(text: string): number[] {
  if (!text.trim()) return [];
  const fields = text.split(/[,，、\s]+/).filter(Boolean);
  const numbers = fields.map(field => Number(field));
  return normalizePeriods(numbers);
}

export function availablePeriods(
  day: CalendarDay, schedules: CourseSchedule[], override?: ScheduleOverride,
): number[] {
  if (day.dayType === 'holiday' || day.dayType === 'unavailable') return [];
  if (override) return normalizePeriods(override.actualPeriods);
  if (day.dayType === 'school_event' || day.dayType === 'exam') return [];
  let weekday: Weekday;
  if (day.dayType === 'makeup_workday') {
    if (!day.scheduleWeekday) throw new Error(`${day.date} 调休日缺少执行课表星期。`);
    weekday = day.scheduleWeekday;
  } else {
    if (day.weekday === 6 || day.weekday === 7) return [];
    weekday = day.weekday;
  }
  return normalizePeriods(schedules.find(schedule => schedule.weekday === weekday)?.periods ?? []);
}

export function buildTeachingSlots(
  startDate: string, days: CalendarDay[], schedules: CourseSchedule[], overrides: ScheduleOverride[],
): TeachingSlot[] {
  const overrideByDate = new Map(overrides.map(override => [override.date, override]));
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).flatMap(day => {
    const override = overrideByDate.get(day.date);
    const source = override ? 'override' : day.dayType === 'makeup_workday' ? 'makeup' : 'weekly';
    return availablePeriods(day, schedules, override).map(period => ({
      date: day.date, weekNumber: teachingWeekNumber(startDate, day.date), period, source,
    }));
  });
}
