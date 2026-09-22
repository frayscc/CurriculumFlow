import type { CalendarDay, CourseSchedule, ScheduleOverride, SharedCourseSlot, Weekday } from '../../types/domain';
import { teachingWeekNumber } from './dates';

export interface TeachingSlot {
  date: string; weekNumber: number; period: number;
  source: 'weekly' | 'makeup' | 'override';
  sharedSlotId?: string; sharedSlotLabel?: string;
  occurrences?: Array<{ date: string; period: number }>;
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
  options: { weekStart?: Weekday; sharedCourseSlots?: SharedCourseSlot[] } = {},
): TeachingSlot[] {
  const overrideByDate = new Map(overrides.map(override => [override.date, override]));
  const sharedMember = new Map<string, SharedCourseSlot>();
  for (const group of options.sharedCourseSlots ?? []) {
    for (const member of group.members) sharedMember.set(`${member.weekday}:${member.period}`, group);
  }
  const raw = [...days].sort((a, b) => a.date.localeCompare(b.date)).flatMap(day => {
    const override = overrideByDate.get(day.date);
    const source = override ? 'override' : day.dayType === 'makeup_workday' ? 'makeup' : 'weekly';
    const scheduleWeekday = day.dayType === 'makeup_workday' && day.scheduleWeekday ? day.scheduleWeekday : day.weekday;
    return availablePeriods(day, schedules, override).map(period => {
      const shared = sharedMember.get(`${scheduleWeekday}:${period}`);
      return {
        date: day.date, weekNumber: teachingWeekNumber(startDate, day.date, options.weekStart ?? 7), period, source,
        sharedSlotId: shared?.id, sharedSlotLabel: shared?.label,
        occurrences: shared ? [{ date: day.date, period }] : undefined,
      } satisfies TeachingSlot;
    });
  });
  const result: TeachingSlot[] = [];
  const grouped = new Map<string, TeachingSlot>();
  for (const slot of raw) {
    if (!slot.sharedSlotId) { result.push(slot); continue; }
    const key = `${slot.weekNumber}:${slot.sharedSlotId}`;
    const existing = grouped.get(key);
    if (!existing) { grouped.set(key, slot); result.push(slot); continue; }
    existing.occurrences = [...(existing.occurrences ?? [{ date: existing.date, period: existing.period }]), { date: slot.date, period: slot.period }]
      .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
}
