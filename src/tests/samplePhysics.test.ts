import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { applyCalendarRange, setCourseSchedule } from '../db/repositories/calendar';
import { createTask } from '../db/repositories/tasks';
import { confirmScheduleDraft, createScheduleDraft } from '../db/repositories/plans';
import { buildWorkPlanView } from '../core/excel/planView';
import { CurriculumDatabase } from '../db/schema';

// Transcribed from the supplied 2026–2027 Grade 9 physics workbook. Split
// cross-month rows are represented once per teaching week.
const weeklyWork: Array<[string, number]> = [
  ['13.1-13.2', 3], ['13.3；13章练习；14.1-14.2', 4], ['14.3-14.4；13-14章检测', 3],
  ['15.1-15.4', 4], ['15.5；15章练习', 2], ['16.1-16.2', 2],
  ['16.3-16.5；16章练习', 4], ['15-16章检测；15-16章检测讲评；17.1-17.2', 4],
  ['欧姆定律计算练习；17.3-17.4；期中复习1', 4], ['期中复习2-3', 2],
  ['期中试卷讲评；18.1-18.3', 4], ['18.4；17-18章练习；17-18章检测；17-18章检测讲评', 4],
  ['19.1-19.3；19章练习', 4], ['20.1-20.4', 4],
  ['20.5-20.6；19-20章检测；19-20章检测讲评', 4], ['21；22章；总复习1-2', 4],
  ['综合检测1；综合检测1讲评；综合检测1考后练习；综合检测2', 4],
  ['综合检测2讲评；综合检测2考后练习；综合检测3；综合检测3讲评', 3],
  ['综合检测3考后练习；综合检测4；综合检测4讲评；综合检测4考后练习', 4], ['查漏补缺', 2],
];

let database: CurriculumDatabase;
beforeEach(() => { database = new CurriculumDatabase(`sample-${crypto.randomUUID()}`); });
afterEach(async () => { await database.delete(); });

describe('supplied physics workbook scenario', () => {
  it('schedules all 20 nonempty weeks and creates 24 month-split export rows', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2027-01-23' }, database);
    for (const weekday of [1, 2, 4, 5] as const) await setCourseSchedule(project.id, weekday, [1], database);
    await applyCalendarRange(project.id, '2026-10-01', '2026-10-07', { dayType: 'holiday', title: '国庆假期（测试设置）' }, database);
    for (const [index, [title, plannedPeriods]] of weeklyWork.entries()) {
      await createTask(project.id, { title, type: 'new_lesson', plannedPeriods, allowSplit: true, fixedWeek: index + 1 }, database);
    }
    const draft = await createScheduleDraft(project.id, database);
    expect(draft.result.conflicts).toEqual([]);
    expect(draft.result.unscheduled).toEqual([]);
    const version = await confirmScheduleDraft(project.id, draft, '样本计划', database);
    const rows = buildWorkPlanView({ project, calendarDays: await database.calendarDays.where('projectId').equals(project.id).toArray(), lessons: await database.scheduledLessons.where('planVersionId').equals(version.id).toArray(), weeklyNotes: [], annotations: [], specialDuties: [], exams: [] });
    expect(rows).toHaveLength(24);
    expect(rows.filter(row => row.firstWeekSegment).map(row => row.periods)).toEqual([...weeklyWork.map(([, hours]) => hours), 0]);
    expect(rows.find(row => row.weekNumber === 5 && row.month === '10月')?.firstWeekSegment).toBe(false);
  });
});
