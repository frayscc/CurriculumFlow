import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CurriculumDatabase } from '../db/schema';
import { createProject } from '../db/repositories/projects';
import { createExam, uploadExamFile } from '../db/repositories/exams';
import { createTask } from '../db/repositories/tasks';
import { copyHistoricalProject, getHistoricalReference } from '../db/repositories/history';
import { setCourseSchedule } from '../db/repositories/calendar';
import { confirmScheduleDraft, createScheduleDraft } from '../db/repositories/plans';
import { recordActual } from '../db/repositories/actual';

describe('historical project reuse', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`history-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('copies reusable tasks and exam metadata without old dates, people, files, or actuals', async () => {
    const source = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-14', endDate: '2026-09-18' }, database);
    await setCourseSchedule(source.id, 1, [3, 4], database);
    await setCourseSchedule(source.id, 5, [3], database);
    const exam = await createExam(source.id, { title: '单元检测', examType: 'chapter_test', examDate: '2026-09-18', authorNames: ['麦舒淇'], reviewerNames: ['谢丽璇'] }, database);
    await uploadExamFile(exam.id, 'paper_pdf', new Blob(['test']), '试卷.pdf', database);
    const sourceTask = await createTask(source.id, { title: '13.1 分子热运动', type: 'new_lesson', plannedPeriods: 1, allowSplit: true, fixedDate: '2026-09-14' }, database);
    await createTask(source.id, { title: '单元检测', type: 'exam', plannedPeriods: 1, allowSplit: true, examId: exam.id }, database);
    const version = await confirmScheduleDraft(source.id, await createScheduleDraft(source.id, database), '原计划', database);
    await recordActual(version.scheduleSnapshot[0].id, { status: 'completed', actualPeriods: 1 }, database);
    const copy = await copyHistoricalProject(source.id, { schoolYear: '2027-2028', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2027-09-01', endDate: '2027-09-05' }, {
      tasks: true, plannedPeriods: true, examNodes: true, selfStudy: true,
      calendar: false, courseSchedule: false, authors: false, reviewers: false,
    }, database);
    expect(copy.sourceProjectId).toBe(source.id);
    const copiedTasks = await database.teachingTasks.where('projectId').equals(copy.id).sortBy('order');
    expect(copiedTasks).toHaveLength(2);
    expect(copiedTasks[0]).toMatchObject({ plannedPeriods: 1, fixedDate: undefined });
    expect(copiedTasks[0].id).not.toBe(sourceTask.id);
    expect(await database.calendarDays.where('projectId').equals(copy.id).count()).toBe(5);
    expect(await database.actualRecords.where('projectId').equals(copy.id).count()).toBe(0);
    expect(await database.courseSchedules.where('projectId').equals(copy.id).count()).toBe(0);
    const copiedExam = await database.exams.get(copiedTasks[1].examId!);
    expect(copiedExam).toMatchObject({ examDate: undefined, authorNames: [], reviewerNames: [] });
    expect(await database.examFiles.where('examId').equals(copiedExam!.id).count()).toBe(0);
    const reference = await getHistoricalReference(copiedTasks[0], database);
    expect(reference?.sourceTask.id).toBe(sourceTask.id);
    expect(reference?.actualPeriods).toBe(1);
  });
});
