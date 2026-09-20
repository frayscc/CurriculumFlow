import type { Exam, ExamFile, ExamFileType, ExamType, SemesterProject, Teacher } from '../../types/domain';
import { validateExamFileType } from '../../core/naming';
import { parseLocalDate } from '../../core/calendar/dates';
import { db as appDb } from '../schema';

export interface ExamInput {
  title: string; examType: ExamType; examDate?: string; authorNames: string[]; reviewerNames: string[]; note?: string;
}
const validTypes: ExamType[] = ['quiz', 'chapter_test', 'monthly_exam', 'midterm', 'final', 'mock_exam', 'special_training', 'other'];

function cleanNames(names: string[]): string[] { return [...new Set(names.map(name => name.trim()).filter(Boolean))]; }
function validate(input: ExamInput): ExamInput {
  if (!input.title.trim()) throw new Error('考试标题不能为空。');
  if (!validTypes.includes(input.examType)) throw new Error('考试类型无效。');
  if (input.examDate) parseLocalDate(input.examDate);
  return { ...input, title: input.title.trim(), authorNames: cleanNames(input.authorNames), reviewerNames: cleanNames(input.reviewerNames), note: input.note?.trim() || undefined };
}

async function resolveTeachers(names: string[], database: typeof appDb): Promise<Teacher[]> {
  const result: Teacher[] = [];
  for (const name of names) {
    let teacher = await database.teachers.where('name').equals(name).first();
    if (!teacher) { teacher = { id: crypto.randomUUID(), name }; await database.teachers.add(teacher); }
    result.push(teacher);
  }
  return result;
}

export async function createExam(projectId: string, input: ExamInput, database = appDb): Promise<Exam> {
  const clean = validate(input);
  return database.transaction('rw', database.projects, database.exams, database.teachers, async () => {
    const project = await database.projects.get(projectId);
    if (!project) throw new Error('项目不存在。');
    const authors = await resolveTeachers(clean.authorNames, database);
    const reviewers = await resolveTeachers(clean.reviewerNames, database);
    const timestamp = new Date().toISOString();
    const exam: Exam = {
      id: crypto.randomUUID(), projectId, title: clean.title, grade: project.grade, subject: project.subject,
      examType: clean.examType, examDate: clean.examDate || undefined,
      authorIds: authors.map(person => person.id), reviewerIds: reviewers.map(person => person.id),
      authorNames: clean.authorNames, reviewerNames: clean.reviewerNames,
      note: clean.note, createdAt: timestamp, updatedAt: timestamp,
    };
    await database.exams.add(exam);
    return exam;
  });
}

export async function updateExam(examId: string, input: ExamInput, database = appDb): Promise<Exam> {
  const clean = validate(input);
  return database.transaction('rw', database.exams, database.teachers, async () => {
    const old = await database.exams.get(examId);
    if (!old) throw new Error('考试不存在。');
    const authors = await resolveTeachers(clean.authorNames, database);
    const reviewers = await resolveTeachers(clean.reviewerNames, database);
    const next: Exam = {
      ...old, title: clean.title, examType: clean.examType, examDate: clean.examDate || undefined,
      authorIds: authors.map(person => person.id), reviewerIds: reviewers.map(person => person.id),
      authorNames: clean.authorNames, reviewerNames: clean.reviewerNames,
      note: clean.note, updatedAt: new Date().toISOString(),
    };
    await database.exams.put(next);
    return next;
  });
}

export async function uploadExamFile(examId: string, fileType: ExamFileType, file: Blob, filename: string, database = appDb): Promise<ExamFile> {
  validateExamFileType(fileType, filename);
  if (file.size === 0) throw new Error('不能上传空文件。');
  return database.transaction('rw', database.exams, database.examFiles, database.fileBlobs, async () => {
    const exam = await database.exams.get(examId);
    if (!exam) throw new Error('考试不存在。');
    const previous = await database.examFiles.where('[examId+fileType]').equals([examId, fileType]).first();
    const blobId = crypto.randomUUID();
    const metadata: ExamFile = {
      id: previous?.id ?? crypto.randomUUID(), projectId: exam.projectId, examId, fileType,
      originalFileName: filename, mimeType: file.type, size: file.size, blobId,
      uploadedAt: new Date().toISOString(),
    };
    await database.fileBlobs.add({ id: blobId, blob: file });
    await database.examFiles.put(metadata);
    if (previous) await database.fileBlobs.delete(previous.blobId);
    return metadata;
  });
}

export async function deleteExamFile(fileId: string, database = appDb): Promise<void> {
  await database.transaction('rw', database.examFiles, database.fileBlobs, async () => {
    const file = await database.examFiles.get(fileId);
    if (!file) return;
    await database.examFiles.delete(fileId);
    await database.fileBlobs.delete(file.blobId);
  });
}

export async function deleteExam(examId: string, database = appDb): Promise<void> {
  await database.transaction('rw', database.exams, database.examFiles, database.fileBlobs, database.teachingTasks, async () => {
    const exam = await database.exams.get(examId);
    if (!exam) return;
    const linked = await database.teachingTasks.where('[projectId+examId]').equals([exam.projectId, examId]).count();
    if (linked) throw new Error('该考试已关联教学任务，请先解除关联。');
    const files = await database.examFiles.where('examId').equals(examId).toArray();
    await database.fileBlobs.bulkDelete(files.map(file => file.blobId));
    await database.examFiles.bulkDelete(files.map(file => file.id));
    await database.exams.delete(examId);
  });
}

export interface ArchiveFilter {
  query?: string; schoolYear?: string; grade?: string; subject?: string;
  examType?: ExamType | ''; author?: string; reviewer?: string;
}
export async function searchExams(filter: ArchiveFilter, database = appDb): Promise<Array<{ exam: Exam; project: SemesterProject }>> {
  const projects = await database.projects.toArray();
  const projectById = new Map(projects.map(project => [project.id, project]));
  const exams = await database.exams.toArray();
  const contains = (value: string, needle?: string) => !needle || value.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
  return exams.flatMap(exam => {
    const project = projectById.get(exam.projectId);
    if (!project || !contains(`${exam.title} ${exam.note ?? ''}`, filter.query) || !contains(project.schoolYear, filter.schoolYear) ||
      !contains(exam.grade, filter.grade) || !contains(exam.subject, filter.subject) ||
      filter.examType && exam.examType !== filter.examType ||
      !contains(exam.authorNames.join('、'), filter.author) || !contains(exam.reviewerNames.join('、'), filter.reviewer)) return [];
    return [{ exam, project }];
  }).sort((a, b) => b.exam.updatedAt.localeCompare(a.exam.updatedAt));
}
