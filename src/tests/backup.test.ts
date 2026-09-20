import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportProjectBackup, prepareProjectBackup, restoreProjectBackup } from '../db/repositories/backup';
import { createProject, deleteProject } from '../db/repositories/projects';
import { createExam, uploadExamFile } from '../db/repositories/exams';
import { createTask } from '../db/repositories/tasks';
import { setCourseSchedule } from '../db/repositories/calendar';
import { createScheduleDraft, confirmScheduleDraft } from '../db/repositories/plans';
import { recordActual } from '../db/repositories/actual';
import { CurriculumDatabase } from '../db/schema';

const input = { schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-12' };

describe('complete project backup', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`backup-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('restores records, references and original attachment bytes after project deletion', async () => {
    const project = await createProject(input, database);
    await database.settings.put({ key: 'naming:paper_pdf', value: '原命名规则' });
    await setCourseSchedule(project.id, 2, [1], database);
    const exam = await createExam(project.id, { title: '单元检测', examType: 'chapter_test', authorNames: ['甲老师'], reviewerNames: [] }, database);
    await uploadExamFile(exam.id, 'paper_pdf', new Blob(['real-paper'], { type: 'application/pdf' }), '试卷.pdf', database);
    await createTask(project.id, { title: '运动', type: 'new_lesson', plannedPeriods: 1, allowSplit: true }, database);
    const version = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '初稿', database);
    await recordActual(version.scheduleSnapshot[0].id, { status: 'completed', actualPeriods: 1 }, database);
    const backup = await exportProjectBackup(project.id, database);
    const prepared = await prepareProjectBackup(backup.blob);
    expect(prepared.manifest.files).toHaveLength(1);
    await deleteProject(project.id, database);
    await database.settings.put({ key: 'naming:paper_pdf', value: '临时规则' });
    const restored = await restoreProjectBackup(prepared, database);
    expect(restored.id).not.toBe(project.id);
    expect(await database.calendarDays.where('projectId').equals(restored.id).count()).toBe(12);
    expect(await database.planVersions.where('[projectId+version]').equals([restored.id, 1]).count()).toBe(1);
    expect(await database.actualRecords.where('projectId').equals(restored.id).count()).toBe(1);
    const file = (await database.examFiles.where('projectId').equals(restored.id).first())!;
    expect(await (await database.fileBlobs.get(file.blobId))!.blob.text()).toBe('real-paper');
    const restoredExam = (await database.exams.where('projectId').equals(restored.id).first())!;
    expect(restoredExam.authorIds).toHaveLength(1);
    expect(await database.teachers.get(restoredExam.authorIds[0])).toBeDefined();
    expect((await database.settings.get('naming:paper_pdf'))?.value).toBe('原命名规则');
    const restoredLesson = (await database.scheduledLessons.where('projectId').equals(restored.id).first())!;
    expect((await database.actualRecords.where('projectId').equals(restored.id).first())!.scheduledLessonId).toBe(restoredLesson.id);
  });

  it('rejects altered attachment and leaves the database unchanged', async () => {
    const project = await createProject(input, database);
    const exam = await createExam(project.id, { title: '检测', examType: 'quiz', authorNames: [], reviewerNames: [] }, database);
    await uploadExamFile(exam.id, 'paper_pdf', new Blob(['original']), 'paper.pdf', database);
    const result = await exportProjectBackup(project.id, database);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const path = Object.keys(zip.files).find(name => name.startsWith('files/') && !zip.files[name].dir)!;
    zip.file(path, 'altered!');
    const corrupt = await zip.generateAsync({ type: 'blob' });
    await expect(prepareProjectBackup(corrupt)).rejects.toThrow('完整性校验失败');
    expect(await database.projects.count()).toBe(1);
  });

  it('does not write a partial project on duplicate semester', async () => {
    const project = await createProject(input, database);
    const prepared = await prepareProjectBackup((await exportProjectBackup(project.id, database)).blob);
    await expect(restoreProjectBackup(prepared, database)).rejects.toThrow('已存在');
    expect(await database.projects.count()).toBe(1);
    expect(await database.calendarDays.count()).toBe(12);
  });
});
