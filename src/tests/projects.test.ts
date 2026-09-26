import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, defaultWeeklyProgressSlots, deleteProject, updateCalendarPreferences, updateProject, updateWeeklyProgressSlots } from '../db/repositories/projects';
import { CurriculumDatabase } from '../db/schema';
import { applyCalendarRange, applyCalendarStatusRange, setCalendarStatus, setCourseSchedule, setScheduleOverride, updateCalendarDay } from '../db/repositories/calendar';
import { calendarStatus } from '../core/calendar/availability';

const initial = {
  schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
  startDate: '2026-09-01', endDate: '2026-09-05',
};

describe('project repository', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`test-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('creates a project and every calendar day in one operation', async () => {
    const project = await createProject(initial, database);
    expect(await database.projects.get(project.id)).toEqual(project);
    expect(project.weeklyProgressSlots).toEqual(defaultWeeklyProgressSlots());
    expect(await database.calendarDays.where('projectId').equals(project.id).count()).toBe(5);
    await expect(createProject(initial, database)).rejects.toThrow('已存在');
    expect(await database.projects.count()).toBe(1);
  });

  it('keeps existing special days when editing the date range and removes obsolete days', async () => {
    const project = await createProject(initial, database);
    await database.calendarDays.update([project.id, '2026-09-02'], { dayType: 'holiday', title: '校庆' });
    await updateProject(project.id, { ...initial, startDate: '2026-09-02', endDate: '2026-09-06' }, database);
    expect(await database.calendarDays.get([project.id, '2026-09-02'])).toMatchObject({ dayType: 'holiday', title: '校庆' });
    expect(await database.calendarDays.get([project.id, '2026-09-01'])).toBeUndefined();
    expect(await database.calendarDays.get([project.id, '2026-09-06'])).toMatchObject({ weekday: 7, dayType: 'normal' });
  });

  it('deletes project-owned records without deleting shared teachers', async () => {
    const project = await createProject(initial, database);
    await database.teachers.add({ id: 'teacher', name: '张老师' });
    await database.settings.add({ key: 'project-setting', projectId: project.id, value: 'x' });
    await deleteProject(project.id, database);
    expect(await database.projects.count()).toBe(0);
    expect(await database.calendarDays.count()).toBe(0);
    expect(await database.settings.count()).toBe(0);
    expect(await database.teachers.count()).toBe(1);
  });

  it('updates a date range atomically and removes overrides on holidays', async () => {
    const project = await createProject(initial, database);
    await setCourseSchedule(project.id, 5, [2], database);
    await setScheduleOverride(project.id, '2026-09-04', [3], '调课', database);
    await applyCalendarRange(project.id, '2026-09-03', '2026-09-05', { dayType: 'holiday', title: '假期' }, database);
    expect(await database.calendarDays.get([project.id, '2026-09-04'])).toMatchObject({ dayType: 'holiday', title: '假期' });
    expect(await database.scheduleOverrides.get([project.id, '2026-09-04'])).toBeUndefined();
    await expect(applyCalendarRange(project.id, '2026-08-31', '2026-09-02', { dayType: 'holiday' }, database)).rejects.toThrow('不在当前学期');
    expect(await database.calendarDays.get([project.id, '2026-09-01'])).toMatchObject({ dayType: 'normal' });
    await updateCalendarDay(project.id, '2026-09-04', { dayType: 'makeup_workday', scheduleWeekday: 5 }, database);
    expect(await database.calendarDays.get([project.id, '2026-09-04'])).toMatchObject({ dayType: 'makeup_workday', scheduleWeekday: 5 });
  });

  it('stores a custom week start and validates shared course slots', async () => {
    const project = await createProject(initial, database);
    const groups = [{ id: 'shared', label: '周三/周四共享', members: [{ weekday: 3 as const, period: 2 }, { weekday: 4 as const, period: 3 }] }];
    const updated = await updateCalendarPreferences(project.id, 1, groups, database);
    expect(updated).toMatchObject({ weekStart: 1, sharedCourseSlots: groups });
    await expect(updateCalendarPreferences(project.id, 1, [
      ...groups,
      { id: 'duplicate', label: '重复', members: [{ weekday: 3, period: 2 }, { weekday: 5, period: 1 }] },
    ], database)).rejects.toThrow('不能加入多个');
  });

  it('stores a four-progress weekly pattern and applies quick calendar states', async () => {
    const project = await createProject({ ...initial, endDate: '2026-09-06' }, database);
    const pattern = defaultWeeklyProgressSlots([2, 3]);
    expect((await updateWeeklyProgressSlots(project.id, pattern, database)).weeklyProgressSlots).toEqual(pattern);
    await setCalendarStatus(project.id, '2026-09-04', 'exam', undefined, database);
    await applyCalendarStatusRange(project.id, '2026-09-05', '2026-09-06', 'holiday', undefined, database);
    expect(calendarStatus((await database.calendarDays.get([project.id, '2026-09-04']))!)).toBe('exam');
    expect(calendarStatus((await database.calendarDays.get([project.id, '2026-09-05']))!)).toBe('holiday');
    await setCalendarStatus(project.id, '2026-09-06', 'teaching', 2, database);
    expect(await database.calendarDays.get([project.id, '2026-09-06'])).toMatchObject({ dayType: 'makeup_workday', scheduleWeekday: 2 });
    await updateCalendarDay(project.id, '2026-09-05', { dayType: 'holiday', title: '临时假期' }, database);
    await setCalendarStatus(project.id, '2026-09-05', 'default', undefined, database);
    expect(await database.calendarDays.get([project.id, '2026-09-05'])).toMatchObject({ dayType: 'normal', title: undefined });
  });
});
