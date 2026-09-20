import { availablePeriods, normalizePeriods } from '../../core/calendar/availability';
import { parseLocalDate } from '../../core/calendar/dates';
import type { CalendarDay, DayType, Weekday } from '../../types/domain';
import { db as appDb } from '../schema';

export type CalendarDayEdit = Pick<CalendarDay, 'dayType'> & Partial<Pick<CalendarDay, 'scheduleWeekday' | 'title' | 'note'>>;
const validTypes: DayType[] = ['normal', 'holiday', 'makeup_workday', 'school_event', 'exam', 'unavailable'];

export async function updateCalendarDay(projectId: string, date: string, edit: CalendarDayEdit, database = appDb) {
  return database.transaction('rw', database.calendarDays, database.scheduleOverrides, async () => {
    const old = await database.calendarDays.get([projectId, date]);
    if (!old) throw new Error('日期不在项目的学期范围内。');
    if (!validTypes.includes(edit.dayType)) throw new Error('日期类型无效。');
    if (edit.dayType === 'makeup_workday' && (!edit.scheduleWeekday || edit.scheduleWeekday < 1 || edit.scheduleWeekday > 7)) {
      throw new Error('调休日必须选择执行哪一天的课表。');
    }
    const next: CalendarDay = {
      ...old, dayType: edit.dayType,
      scheduleWeekday: edit.dayType === 'makeup_workday' ? edit.scheduleWeekday : undefined,
      title: edit.title?.trim() || undefined,
      note: edit.note?.trim() || undefined,
    };
    await database.calendarDays.put(next);
    if (edit.dayType === 'holiday' || edit.dayType === 'unavailable') {
      await database.scheduleOverrides.delete([projectId, date]);
    }
    return next;
  });
}

export async function applyCalendarRange(
  projectId: string, startDate: string, endDate: string, edit: CalendarDayEdit, database = appDb,
) {
  parseLocalDate(startDate); parseLocalDate(endDate);
  if (endDate < startDate) throw new Error('结束日期不能早于开始日期。');
  if (!validTypes.includes(edit.dayType)) throw new Error('日期类型无效。');
  if (edit.dayType === 'makeup_workday' && (!edit.scheduleWeekday || edit.scheduleWeekday < 1 || edit.scheduleWeekday > 7)) {
    throw new Error('调休日必须选择执行哪一天的课表。');
  }
  await database.transaction('rw', database.calendarDays, database.scheduleOverrides, async () => {
    const days = await database.calendarDays.where('[projectId+date]').between([projectId, startDate], [projectId, endDate], true, true).toArray();
    if (!days.length || days[0].date !== startDate || days[days.length - 1].date !== endDate) {
      throw new Error('选择的日期范围不在当前学期内。');
    }
    const updated = days.map(day => ({
      ...day, dayType: edit.dayType,
      scheduleWeekday: edit.dayType === 'makeup_workday' ? edit.scheduleWeekday : undefined,
      title: edit.title?.trim() || undefined,
      note: edit.note?.trim() || undefined,
    }));
    await database.calendarDays.bulkPut(updated);
    if (edit.dayType === 'holiday' || edit.dayType === 'unavailable') {
      await database.scheduleOverrides.where('[projectId+date]').between([projectId, startDate], [projectId, endDate], true, true).delete();
    }
  });
}

export async function setCourseSchedule(projectId: string, weekday: Weekday, periods: number[], database = appDb) {
  if (weekday < 1 || weekday > 7) throw new Error('星期无效。');
  if (!await database.projects.get(projectId)) throw new Error('项目不存在。');
  await database.courseSchedules.put({ projectId, weekday, periods: normalizePeriods(periods) });
}

export async function setScheduleOverride(projectId: string, date: string, periods: number[], reason: string, database = appDb) {
  parseLocalDate(date);
  const normalized = normalizePeriods(periods);
  if (!reason.trim()) throw new Error('请填写课时调整原因。');
  await database.transaction('rw', database.calendarDays, database.courseSchedules, database.scheduleOverrides, async () => {
    const day = await database.calendarDays.get([projectId, date]);
    if (!day) throw new Error('日期不在项目的学期范围内。');
    if (day.dayType === 'holiday' || day.dayType === 'unavailable') throw new Error('节假日或停课日不能增加课时，请先修改日期类型。');
    const schedules = await database.courseSchedules.where('projectId').equals(projectId).toArray();
    const existing = await database.scheduleOverrides.get([projectId, date]);
    const originalPeriods = existing?.originalPeriods ?? availablePeriods(day, schedules);
    await database.scheduleOverrides.put({ projectId, date, originalPeriods, actualPeriods: normalized, reason: reason.trim() });
  });
}

export async function deleteScheduleOverride(projectId: string, date: string, database = appDb) {
  await database.scheduleOverrides.delete([projectId, date]);
}
