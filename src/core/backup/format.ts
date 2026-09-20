import type { ActualTeachingRecord, AppSetting, CalendarDay, ChangeLog, CourseSchedule, Exam, ExamFile, PlanAnnotation, PlanVersion, ScheduleOverride, ScheduledLesson, SemesterProject, SpecialTrainingDuty, Teacher, TeachingTask, WeeklyNote } from '../../types/domain';

export const BACKUP_SCHEMA_VERSION = 3;
export interface BackupData {
  project: SemesterProject;
  calendarDays: CalendarDay[]; courseSchedules: CourseSchedule[]; scheduleOverrides: ScheduleOverride[];
  teachingTasks: TeachingTask[]; planVersions: PlanVersion[]; scheduledLessons: ScheduledLesson[];
  actualRecords: ActualTeachingRecord[]; changeLogs: ChangeLog[]; weeklyNotes: WeeklyNote[];
  planAnnotations: PlanAnnotation[]; specialDuties: SpecialTrainingDuty[];
  exams: Exam[]; examFiles: ExamFile[]; teachers: Teacher[]; settings: AppSetting[];
}
export interface BackupManifest {
  schemaVersion: number; appVersion: string; exportedAt: string; data: BackupData;
  files: Array<{ blobId: string; path: string; size: number; sha256: string }>;
}
export const backupTables = ['calendarDays', 'courseSchedules', 'scheduleOverrides', 'teachingTasks', 'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'weeklyNotes', 'planAnnotations', 'specialDuties', 'exams', 'examFiles', 'teachers', 'settings'] as const;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

export function validateManifest(value: unknown): BackupManifest {
  if (!object(value) || value.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('备份版本不兼容。');
  if (!string(value.appVersion) || !string(value.exportedAt) || !object(value.data) || !Array.isArray(value.files)) throw new Error('备份清单格式无效。');
  const data = value.data;
  if (!object(data.project) || !string(data.project.id) || !string(data.project.schoolYear) || !string(data.project.grade) || !string(data.project.subject) || !string(data.project.semester) || !string(data.project.startDate) || !string(data.project.endDate)) throw new Error('项目资料不完整。');
  const projectId = data.project.id;
  for (const table of backupTables) {
    if (!Array.isArray(data[table])) throw new Error(`备份缺少 ${table}。`);
    for (const row of data[table]) {
      if (!object(row)) throw new Error(`${table} 包含无效记录。`);
      if (table !== 'teachers' && !(table === 'settings' && row.projectId === undefined) && row.projectId !== projectId) throw new Error(`${table} 项目关联不一致。`);
    }
  }
  const idTables = ['teachingTasks', 'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'planAnnotations', 'specialDuties', 'exams', 'examFiles', 'teachers'] as const;
  for (const table of idTables) {
    const ids = (data[table] as Array<Record<string, unknown>>).map(row => row.id);
    if (ids.some(id => !string(id)) || new Set(ids).size !== ids.length) throw new Error(`${table} 存在重复或无效 ID。`);
  }
  for (const [table, key] of [['calendarDays', 'date'], ['courseSchedules', 'weekday'], ['scheduleOverrides', 'date'], ['weeklyNotes', 'weekNumber'], ['settings', 'key']] as const) {
    const keys = (data[table] as Array<Record<string, unknown>>).map(row => row[key]);
    if (keys.some(keyValue => keyValue === undefined || keyValue === null) || new Set(keys).size !== keys.length) throw new Error(`${table} 存在重复键。`);
  }
  for (const row of data.settings as Array<Record<string, unknown>>) if (!string(row.key) || (row.projectId === undefined && !row.key.startsWith('naming:'))) throw new Error('备份包含无效的全局设置。');
  const ids = (table: string) => new Set((data[table] as Array<Record<string, unknown>>).map(row => row.id));
  const tasks = ids('teachingTasks'), versions = ids('planVersions'), lessons = ids('scheduledLessons'), exams = ids('exams'), teachers = ids('teachers');
  for (const row of data.planVersions as Array<Record<string, unknown>>) {
    if (!Array.isArray(row.scheduleSnapshot)) throw new Error('计划版本缺少课次快照。');
    for (const lesson of row.scheduleSnapshot) if (!object(lesson) || !string(lesson.id) || !tasks.has(lesson.taskId)) throw new Error('计划版本快照关联无效。');
  }
  for (const row of data.scheduledLessons as Array<Record<string, unknown>>) if (!tasks.has(row.taskId) || !versions.has(row.planVersionId)) throw new Error('排课记录引用了不存在的任务或版本。');
  for (const row of data.actualRecords as Array<Record<string, unknown>>) if (!tasks.has(row.taskId) || (row.scheduledLessonId && !lessons.has(row.scheduledLessonId)) || (row.planVersionId && !versions.has(row.planVersionId))) throw new Error('实际记录关联无效。');
  for (const row of data.teachingTasks as Array<Record<string, unknown>>) if (row.examId && !exams.has(row.examId)) throw new Error('教学任务关联考试无效。');
  for (const row of data.examFiles as Array<Record<string, unknown>>) if (!exams.has(row.examId) || !string(row.blobId) || !Number.isSafeInteger(row.size) || Number(row.size) < 0) throw new Error(`考试附件元数据无效：${JSON.stringify({ examId: row.examId, examFound: exams.has(row.examId), blobId: row.blobId, size: row.size })}`);
  for (const row of data.exams as Array<Record<string, unknown>>) {
    if (!Array.isArray(row.authorIds) || !Array.isArray(row.reviewerIds) || [...row.authorIds, ...row.reviewerIds].some(id => !teachers.has(id))) throw new Error('考试人员关联无效。');
  }
  for (const row of data.specialDuties as Array<Record<string, unknown>>) if ((row.teacherId && !teachers.has(row.teacherId)) || (row.taskId && !tasks.has(row.taskId))) throw new Error('专训安排关联无效。');
  for (const row of data.planAnnotations as Array<Record<string, unknown>>) if (row.examId && !exams.has(row.examId)) throw new Error('计划注记关联考试无效。');
  const files = value.files;
  if (files.reduce((total, file) => total + (object(file) && typeof file.size === 'number' ? file.size : 0), 0) > 750 * 1024 * 1024) throw new Error('附件总量超过当前导入限制。');
  if (files.length !== (data.examFiles as unknown[]).length) throw new Error('附件清单数量不一致。');
  const fileIds = new Set<string>(), paths = new Set<string>();
  for (const file of files) {
    if (!object(file) || !string(file.blobId) || !string(file.path) || !/^files\/[a-zA-Z0-9_-]+\.bin$/.test(file.path) || !Number.isSafeInteger(file.size) || Number(file.size) < 0 || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256) || fileIds.has(file.blobId) || paths.has(file.path)) throw new Error('附件清单无效。');
    fileIds.add(file.blobId); paths.add(file.path);
  }
  for (const row of data.examFiles as Array<Record<string, unknown>>) if (!fileIds.has(row.blobId as string) || files.find(file => (file as Record<string, unknown>).blobId === row.blobId)?.size !== row.size) throw new Error('附件清单与元数据不一致。');
  return value as unknown as BackupManifest;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
