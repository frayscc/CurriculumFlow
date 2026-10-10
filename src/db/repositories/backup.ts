import JSZip from 'jszip';
import { BACKUP_SCHEMA_VERSION, backupTables, sha256, validateManifest, type BackupData, type BackupManifest } from '../../core/backup/format';
import type { SemesterProject } from '../../types/domain';
import { db as appDb } from '../schema';
import { getAuth, projectOwnership } from '../../auth';
import { fileContent } from '../fileContent';

const appVersion = '1.6.0';
const maxZipBytes = 750 * 1024 * 1024;

export async function exportProjectBackup(projectId: string, database = appDb): Promise<{ blob: Blob; filename: string }> {
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  const data: BackupData = {
    project,
    calendarDays: await database.calendarDays.where('projectId').equals(projectId).toArray(),
    courseSchedules: await database.courseSchedules.where('projectId').equals(projectId).toArray(),
    scheduleOverrides: await database.scheduleOverrides.where('projectId').equals(projectId).toArray(),
    teachingTasks: await database.teachingTasks.where('projectId').equals(projectId).toArray(),
    planVersions: await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).toArray(),
    scheduledLessons: await database.scheduledLessons.where('projectId').equals(projectId).toArray(),
    actualRecords: await database.actualRecords.where('projectId').equals(projectId).toArray(),
    changeLogs: await database.changeLogs.where('projectId').equals(projectId).toArray(),
    weeklyNotes: await database.weeklyNotes.where('projectId').equals(projectId).toArray(),
    planAnnotations: await database.planAnnotations.where('projectId').equals(projectId).toArray(),
    specialDuties: await database.specialDuties.where('projectId').equals(projectId).toArray(),
    exams: await database.exams.where('projectId').equals(projectId).toArray(),
    examFiles: await database.examFiles.where('projectId').equals(projectId).toArray(),
    teachers: [], settings: (await database.settings.toArray()).filter(row => row.projectId === projectId || row.key.startsWith('naming:')),
  };
  const teacherIds = new Set([...data.exams.flatMap(exam => [...exam.authorIds, ...exam.reviewerIds]), ...data.specialDuties.map(duty => duty.teacherId).filter((id): id is string => !!id)]);
  data.teachers = await database.teachers.bulkGet([...teacherIds]).then(rows => rows.filter((row): row is NonNullable<typeof row> => !!row));
  const zip = new JSZip();
  const files: BackupManifest['files'] = [];
  for (const metadata of data.examFiles) {
    const record = await fileContent(metadata.blobId, database);
    if (!record) throw new Error(`附件 ${metadata.originalFileName} 缺少文件内容。`);
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    if (bytes.byteLength !== metadata.size) throw new Error(`附件 ${metadata.originalFileName} 大小不一致。`);
    const path = `files/${metadata.blobId}.bin`;
    zip.file(path, bytes);
    files.push({ blobId: metadata.blobId, path, size: bytes.byteLength, sha256: await sha256(bytes) });
  }
  const manifest: BackupManifest = { schemaVersion: BACKUP_SCHEMA_VERSION, appVersion, exportedAt: new Date().toISOString(), data, files };
  validateManifest(manifest);
  zip.file('project.json', JSON.stringify(manifest));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
  return { blob, filename: `CurriculumFlow_Backup_${project.schoolYear}_${project.grade}${project.subject}_${project.semester}.zip` };
}

export interface PreparedBackup { manifest: BackupManifest; blobs: Map<string, Blob>; }
export async function prepareProjectBackup(file: Blob): Promise<PreparedBackup> {
  if (file.size > maxZipBytes) throw new Error('备份文件超过 750 MB，当前浏览器导入器无法可靠处理。');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('无法读取 ZIP 文件。'); }
  const json = zip.file('project.json');
  if (!json) throw new Error('备份缺少 project.json。');
  let raw: unknown;
  try { raw = JSON.parse(await json.async('string')); } catch { throw new Error('project.json 不是有效 JSON。'); }
  const manifest = validateManifest(raw);
  const blobs = new Map<string, Blob>();
  for (const entry of manifest.files) {
    const zipped = zip.file(entry.path);
    if (!zipped) throw new Error(`备份缺少附件 ${entry.path}。`);
    const bytes = await zipped.async('uint8array');
    if (bytes.byteLength !== entry.size || await sha256(bytes) !== entry.sha256) throw new Error(`附件 ${entry.path} 完整性校验失败。`);
    blobs.set(entry.blobId, new Blob([bytes as BlobPart]));
  }
  return { manifest, blobs };
}

export async function restoreProjectBackup(prepared: PreparedBackup, database = appDb): Promise<SemesterProject> {
  if (getAuth() && getAuth()?.user?.role !== 'admin') throw new Error('多人版仅管理员可恢复完整备份。');
  const { manifest, blobs } = prepared;
  validateManifest(manifest);
  const data = manifest.data;
  if (blobs.size !== manifest.files.length) throw new Error('附件未全部校验。');
  for (const file of manifest.files) {
    const blob = blobs.get(file.blobId);
    if (!blob || blob.size !== file.size || await sha256(new Uint8Array(await blob.arrayBuffer())) !== file.sha256) throw new Error('附件校验已失效。');
  }
  const newProjectId = crypto.randomUUID();
  const remap = new Map<string, string>([[data.project.id, newProjectId]]);
  const existingTeachers = await database.teachers.toArray();
  const reusedTeachers = new Set<string>();
  for (const teacher of data.teachers) {
    const existing = existingTeachers.find(row => row.id === teacher.id)
      ?? (teacher.userId ? existingTeachers.find(row => row.userId === teacher.userId) : undefined)
      ?? existingTeachers.find(row => row.userId && row.name === teacher.name);
    remap.set(teacher.id, existing?.id ?? crypto.randomUUID());
    if (existing) reusedTeachers.add(teacher.id);
  }
  for (const table of ['teachingTasks', 'planVersions', 'scheduledLessons', 'actualRecords', 'changeLogs', 'planAnnotations', 'specialDuties', 'exams', 'examFiles'] as const) {
    for (const row of data[table]) remap.set(row.id, crypto.randomUUID());
  }
  for (const file of manifest.files) remap.set(file.blobId, crypto.randomUUID());
  const id = (old?: string) => old ? remap.get(old) ?? old : undefined;
  const now = new Date().toISOString();
  const project: SemesterProject = { ...data.project, ...projectOwnership(data.project), archived: undefined, id: newProjectId, sourceProjectId: undefined, createdAt: now, updatedAt: now };
  await database.transaction('rw', [database.projects, ...backupTables.map(table => database[table]), database.fileBlobs], async () => {
    const duplicate = await database.projects.where('[schoolYear+grade+subject+semester]').equals([project.schoolYear, project.grade, project.subject, project.semester]).filter(project => !project.archived).first();
    if (duplicate) throw new Error('相同学年、年级、学科和学期的项目已存在。请先调整现有项目或备份内容。');
    await database.projects.add(project);
    await database.calendarDays.bulkAdd(data.calendarDays.map(row => ({ ...row, projectId: newProjectId })));
    await database.courseSchedules.bulkAdd(data.courseSchedules.map(row => ({ ...row, projectId: newProjectId })));
    await database.scheduleOverrides.bulkAdd(data.scheduleOverrides.map(row => ({ ...row, projectId: newProjectId })));
    await database.teachers.bulkPut(data.teachers.filter(row => !reusedTeachers.has(row.id)).map(row => ({ ...row, id: id(row.id)!, userId: undefined })));
    const teacherName = (oldId: string, fallback: string) => existingTeachers.find(row => row.id === id(oldId))?.name ?? fallback;
    await database.exams.bulkAdd(data.exams.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, authorIds: row.authorIds.map(value => id(value)!), reviewerIds: row.reviewerIds.map(value => id(value)!), authorNames: row.authorIds.map((value, index) => teacherName(value, row.authorNames[index])), reviewerNames: row.reviewerIds.map((value, index) => teacherName(value, row.reviewerNames[index])) })));
    await database.teachingTasks.bulkAdd(data.teachingTasks.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, examId: id(row.examId) })));
    await database.planVersions.bulkAdd(data.planVersions.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, scheduleSnapshot: row.scheduleSnapshot.map(lesson => ({ ...lesson, id: id(lesson.id)!, taskId: id(lesson.taskId)! })) })));
    await database.scheduledLessons.bulkAdd(data.scheduledLessons.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, taskId: id(row.taskId)!, planVersionId: id(row.planVersionId)! })));
    await database.actualRecords.bulkAdd(data.actualRecords.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, taskId: id(row.taskId)!, scheduledLessonId: id(row.scheduledLessonId), planVersionId: id(row.planVersionId) })));
    await database.changeLogs.bulkAdd(data.changeLogs.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, entityId: id(row.entityId) ?? row.entityId })));
    await database.weeklyNotes.bulkAdd(data.weeklyNotes.map(row => ({ ...row, projectId: newProjectId })));
    await database.planAnnotations.bulkAdd(data.planAnnotations.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, examId: id(row.examId) })));
    await database.specialDuties.bulkAdd(data.specialDuties.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, teacherId: id(row.teacherId), taskId: id(row.taskId) })));
    await database.examFiles.bulkAdd(data.examFiles.map(row => ({ ...row, id: id(row.id)!, projectId: newProjectId, examId: id(row.examId)!, blobId: id(row.blobId)! })));
    await database.fileBlobs.bulkAdd(manifest.files.map(row => ({ id: id(row.blobId)!, blob: blobs.get(row.blobId)! })));
    await database.settings.bulkPut(data.settings.map(row => row.projectId === undefined ? row : { ...row, key: `${newProjectId}:${row.key}`, projectId: newProjectId }));
  });
  return project;
}
