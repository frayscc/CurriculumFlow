import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { createExam, deleteExam, searchExams, uploadExamFile } from '../db/repositories/exams';
import { createTask } from '../db/repositories/tasks';
import { CurriculumDatabase } from '../db/schema';
import { buildExamPackage } from '../core/files/examPackage';
import { examZipName, namedExamFile } from '../core/naming';

describe('exam resources', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`exams-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('stores exam metadata and teachers, replacing only the selected attachment slot', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2027-01-23' }, database);
    const exam = await createExam(project.id, { title: '13-14章检测', examType: 'chapter_test', authorNames: ['麦舒淇'], reviewerNames: ['谢丽璇'] }, database);
    expect(await database.teachers.count()).toBe(2);
    await expect(uploadExamFile(exam.id, 'paper_pdf', new Blob(['x']), 'wrong.txt', database)).rejects.toThrow('仅支持');
    const first = await uploadExamFile(exam.id, 'paper_pdf', new Blob(['paper-v1'], { type: 'application/pdf' }), '原试卷.pdf', database);
    const next = await uploadExamFile(exam.id, 'paper_pdf', new Blob(['paper-v2'], { type: 'application/pdf' }), '新版试卷.pdf', database);
    expect(next.id).toBe(first.id);
    expect(await database.fileBlobs.get(first.blobId)).toBeUndefined();
    expect(await database.examFiles.where('examId').equals(exam.id).count()).toBe(1);
    expect(namedExamFile(next, project, exam)).toBe('（九年级物理学科）13-14章检测.pdf');
    expect(examZipName(project, exam)).toBe('（九年级物理学科）13-14章检测试题.zip');
    expect((await searchExams({ author: '麦舒淇', schoolYear: '2026-2027' }, database)).map(item => item.exam.id)).toEqual([exam.id]);
    const content = await database.fileBlobs.get(next.blobId);
    const packageFile = await buildExamPackage(project, exam, [{ metadata: next, blob: content!.blob }]);
    const zip = await JSZip.loadAsync(await packageFile.blob.arrayBuffer());
    expect(Object.keys(zip.files).some(path => path.includes('1、试卷/（九年级物理学科）13-14章检测.pdf'))).toBe(true);
    expect(Object.keys(zip.files).some(path => path.includes('3、答案/'))).toBe(false);
  });

  it('prevents deleting an exam linked to a teaching task', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-05' }, database);
    const exam = await createExam(project.id, { title: '单元检测', examType: 'chapter_test', authorNames: [], reviewerNames: [] }, database);
    await createTask(project.id, { title: '单元检测', type: 'exam', plannedPeriods: 1, allowSplit: true, examId: exam.id }, database);
    await expect(deleteExam(exam.id, database)).rejects.toThrow('关联');
    expect(await database.exams.get(exam.id)).toBeDefined();
  });
});
