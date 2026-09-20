import ExcelJS from 'exceljs';
import type { CalendarDay, SemesterProject } from '../../types/domain';
import type { WorkPlanRow } from './planView';

const headers = ['月份', '周次', '日', '一', '二', '三', '四', '五', '六', '工作安排', '课时', '备注', '单元检测', '物理专训'];
const chineseWeeks = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '二一'];
const border: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
};

export async function buildWorkPlanXlsx(project: SemesterProject, rows: WorkPlanRow[], calendarDays: CalendarDay[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CurriculumFlow';
  workbook.subject = `${project.schoolYear}学年${project.grade}${project.subject}${project.semester}备课组工作计划`;
  const sheet = workbook.addWorksheet('备课组工作计划', {
    pageSetup: { paperSize: 9, orientation: 'landscape', margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
    views: [{ state: 'normal', zoomScale: 145, showGridLines: false }],
  });
  const widths = [5.66, 5.66, 4, 8.43, 8.43, 8.43, 8.43, 8.43, 8.43, 64.66, 5.66, 25.33, 53.33, 9.33];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).values = headers;
  const dayByDate = new Map(calendarDays.map(day => [day.date, day]));
  rows.forEach((entry, index) => {
    const row = sheet.getRow(index + 2);
    row.values = [entry.month, entry.firstWeekSegment ? chineseWeeks[entry.weekNumber] ?? String(entry.weekNumber) : '',
      ...entry.dates.map(day => day?.day ?? null), entry.content, entry.firstWeekSegment ? entry.periods : null,
      entry.note, entry.assessment, entry.specialTraining];
    const longest = Math.max(entry.content.length / 30, entry.note.length / 16, entry.assessment.length / 30);
    row.height = Math.min(80, Math.max(22, 20 + Math.ceil(longest) * 13));
    entry.dates.forEach((day, weekday) => {
      if (!day) return;
      const cell = row.getCell(weekday + 3);
      const calendar = dayByDate.get(day.date);
      if (calendar?.dayType === 'makeup_workday') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      else if (weekday === 0 || weekday === 6 || calendar?.dayType === 'holiday' || calendar?.dayType === 'unavailable') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFABF8F' } };
      if (calendar?.dayType === 'exam') cell.font = { name: '宋体', size: 11, color: { argb: 'FFFF0000' } };
    });
  });

  // Group months, then merge the split rows of a teaching week across months.
  function mergeSame(startColumn: number, endColumn: number, key: (row: WorkPlanRow) => string, allowEmpty = false) {
    let start = 0;
    while (start < rows.length) {
      let end = start;
      const value = key(rows[start]);
      while (end + 1 < rows.length && key(rows[end + 1]) === value && (allowEmpty || !!value)) end++;
      if (end > start && (allowEmpty || !!value)) sheet.mergeCells(start + 2, startColumn, end + 2, endColumn);
      start = end + 1;
    }
  }
  mergeSame(1, 1, row => row.month);
  for (let start = 0; start < rows.length;) {
    let end = start;
    while (end + 1 < rows.length && rows[end + 1].weekNumber === rows[start].weekNumber) end++;
    if (end > start) for (const column of [2, 10, 11]) sheet.mergeCells(start + 2, column, end + 2, column);
    start = end + 1;
  }
  mergeSame(12, 12, row => row.note);
  mergeSame(13, 13, row => row.assessment);

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    for (let column = 1; column <= 14; column++) {
      const cell = row.getCell(column);
      cell.border = border;
      cell.alignment = { horizontal: column === 10 || column === 13 ? 'left' : 'center', vertical: 'middle', wrapText: true };
      if (!cell.font?.color) cell.font = { name: '宋体', size: 11, bold: rowNumber === 1, color: { argb: 'FF000000' } };
      if (rowNumber === 1) cell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FF000000' } };
    }
  });
  const bytes = await workbook.xlsx.writeBuffer();
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function workPlanFilename(project: SemesterProject): string {
  return `备课组工作计划_${project.schoolYear}_${project.grade}${project.subject}_${project.semester}.xlsx`;
}
