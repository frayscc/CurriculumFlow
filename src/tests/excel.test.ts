import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generateCalendarDays } from '../core/calendar/dates';
import { buildWorkPlanView } from '../core/excel/planView';
import { buildWorkPlanXlsx } from '../core/excel/workbook';
import type { SemesterProject } from '../types/domain';

describe('work plan export', () => {
  it('matches the sample layout with Sunday-first dates and split cross-month weeks', async () => {
    const project: SemesterProject = {
      id: 'p', schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
      startDate: '2026-09-01', endDate: '2027-01-23', createdAt: '', updatedAt: '',
    };
    const days = generateCalendarDays('p', project.startDate, project.endDate);
    const rows = buildWorkPlanView({
      project, lessons: [], calendarDays: days, weeklyNotes: [], exams: [],
      annotations: [{ id: 'a', projectId: 'p', kind: 'assessment_preparation', startDate: '2026-09-20', endDate: '2026-10-10', text: '15-16章检测', updatedAt: '' }],
      specialDuties: [
        { id: 'd1', projectId: 'p', startDate: '2026-09-27', endDate: '2026-09-30', teacherNameSnapshot: '甲老师', updatedAt: '' },
        { id: 'd2', projectId: 'p', startDate: '2026-10-01', endDate: '2026-10-03', teacherNameSnapshot: '乙老师', updatedAt: '' },
      ],
    });
    expect(rows).toHaveLength(24);
    expect(rows.at(-1)?.weekNumber).toBe(21);
    expect(rows[0].dates.map(day => day?.day ?? null)).toEqual([null, null, 1, 2, 3, 4, 5]);
    expect(rows[4]).toMatchObject({ month: '9月', weekNumber: 5, specialTraining: '甲老师' });
    expect(rows[5]).toMatchObject({ month: '10月', weekNumber: 5, firstWeekSegment: false, specialTraining: '乙老师' });

    const blob = await buildWorkPlanXlsx(project, rows, days);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('备课组工作计划')!;
    expect(sheet.rowCount).toBe(25);
    expect(sheet.getCell('C1').value).toBe('日');
    expect(sheet.getCell('E2').value).toBe(1);
    expect(sheet.getCell('C3').value).toBe(6);
    expect(sheet.getCell('B7').master.address).toBe('B6');
    expect(sheet.getCell('A7').value).toBe('10月');
    expect(sheet.getCell('N6').value).toBe('甲老师');
    expect(sheet.getCell('N7').value).toBe('乙老师');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.paperSize).toBe(9);
  });
});
