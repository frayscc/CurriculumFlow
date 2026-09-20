import type { CalendarDay, LocalDate, Weekday } from '../../types/domain';

const DAY_MS = 86_400_000;

export function parseLocalDate(value: LocalDate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期必须使用 YYYY-MM-DD 格式。');
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('日期无效。');
  return timestamp;
}

export function dateFromTimestamp(timestamp: number): LocalDate {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function weekdayOf(date: LocalDate): Weekday {
  const jsDay = new Date(parseLocalDate(date)).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

export function generateCalendarDays(projectId: string, startDate: LocalDate, endDate: LocalDate): CalendarDay[] {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (end < start) throw new Error('结束日期不能早于开始日期。');
  if ((end - start) / DAY_MS > 550) throw new Error('学期日期范围不能超过 550 天。');
  const days: CalendarDay[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) {
    const date = dateFromTimestamp(timestamp);
    days.push({ projectId, date, weekday: weekdayOf(date), dayType: 'normal' });
  }
  return days;
}

export function teachingWeekNumber(startDate: LocalDate, date: LocalDate): number {
  const start = parseLocalDate(startDate);
  const current = parseLocalDate(date);
  const startSundayOffset = new Date(start).getUTCDay();
  return Math.floor((current - start + startSundayOffset * DAY_MS) / (7 * DAY_MS)) + 1;
}
