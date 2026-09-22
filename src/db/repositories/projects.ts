import { generateCalendarDays, parseLocalDate } from '../../core/calendar/dates';
import type { SemesterProject, SharedCourseSlot, Weekday } from '../../types/domain';
import { db as appDb, type CurriculumDatabase } from '../schema';

export type ProjectInput = Pick<SemesterProject, 'schoolYear' | 'grade' | 'subject' | 'semester' | 'startDate' | 'endDate'>;

export function validateProjectInput(input: ProjectInput): ProjectInput {
  const clean = {
    schoolYear: input.schoolYear.trim(), grade: input.grade.trim(),
    subject: input.subject.trim(), semester: input.semester.trim(),
    startDate: input.startDate, endDate: input.endDate,
  };
  const match = /^(\d{4})-(\d{4})$/.exec(clean.schoolYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) throw new Error('学年请填写为 2026-2027 格式。');
  if (!clean.grade || !clean.subject || !clean.semester) throw new Error('年级、学科和学期不能为空。');
  parseLocalDate(clean.startDate);
  parseLocalDate(clean.endDate);
  if (clean.endDate < clean.startDate) throw new Error('结束日期不能早于开始日期。');
  return clean;
}

async function ensureUnique(input: ProjectInput, database: CurriculumDatabase, excludeId?: string) {
  const match = await database.projects.where('[schoolYear+grade+subject+semester]')
    .equals([input.schoolYear, input.grade, input.subject, input.semester]).first();
  if (match && match.id !== excludeId) throw new Error('同一学年、年级、学科和学期的项目已存在。');
}

export async function createProject(input: ProjectInput, database = appDb): Promise<SemesterProject> {
  const data = validateProjectInput(input);
  const id = crypto.randomUUID();
  const calendarDays = generateCalendarDays(id, data.startDate, data.endDate);
  const now = new Date().toISOString();
  const project: SemesterProject = { ...data, id, weekStart: 7, sharedCourseSlots: [], createdAt: now, updatedAt: now };
  await database.transaction('rw', database.projects, database.calendarDays, async () => {
    await ensureUnique(data, database);
    await database.projects.add(project);
    await database.calendarDays.bulkAdd(calendarDays);
  });
  return project;
}

export async function updateCalendarPreferences(
  id: string, weekStart: Weekday, sharedCourseSlots: SharedCourseSlot[], database = appDb,
): Promise<SemesterProject> {
  if (weekStart < 1 || weekStart > 7) throw new Error('一周开始日期无效。');
  const occupied = new Set<string>();
  for (const group of sharedCourseSlots) {
    if (!group.id || !group.label.trim() || group.members.length < 2) throw new Error('共享课位至少需要两个有效日期。');
    for (const member of group.members) {
      if (member.weekday < 1 || member.weekday > 7 || !Number.isInteger(member.period) || member.period < 1 || member.period > 20) throw new Error('共享课位的星期或节次无效。');
      const key = `${member.weekday}:${member.period}`;
      if (occupied.has(key)) throw new Error('同一个星期和节次不能加入多个共享课位。');
      occupied.add(key);
    }
  }
  const project = await database.projects.get(id);
  if (!project) throw new Error('项目不存在。');
  const next = { ...project, weekStart, sharedCourseSlots: sharedCourseSlots.map(group => ({ ...group, label: group.label.trim() })), updatedAt: new Date().toISOString() };
  await database.projects.put(next);
  return next;
}

export async function updateProject(id: string, input: ProjectInput, database = appDb): Promise<SemesterProject> {
  const data = validateProjectInput(input);
  return database.transaction('rw', database.projects, database.calendarDays, database.scheduleOverrides, async () => {
    const original = await database.projects.get(id);
    if (!original) throw new Error('项目不存在或已删除。');
    await ensureUnique(data, database, id);
    const next: SemesterProject = { ...original, ...data, updatedAt: new Date().toISOString() };
    const generated = generateCalendarDays(id, data.startDate, data.endDate);
    const existing = await database.calendarDays.where('projectId').equals(id).toArray();
    const byDate = new Map(existing.map(day => [day.date, day]));
    const valid = new Set(generated.map(day => day.date));
    await database.calendarDays.bulkPut(generated.map(day => byDate.get(day.date) ?? day));
    const obsolete: [string, string][] = existing.filter(day => !valid.has(day.date)).map(day => [id, day.date]);
    if (obsolete.length) await database.calendarDays.bulkDelete(obsolete);
    await database.scheduleOverrides.where('projectId').equals(id).filter(row => !valid.has(row.date)).delete();
    await database.projects.put(next);
    return next;
  });
}

export async function deleteProject(id: string, database = appDb): Promise<void> {
  await database.transaction('rw', [
    database.projects, database.calendarDays, database.courseSchedules, database.scheduleOverrides,
    database.teachingTasks, database.planVersions, database.scheduledLessons, database.actualRecords,
    database.changeLogs, database.weeklyNotes, database.planAnnotations, database.specialDuties,
    database.exams, database.examFiles, database.fileBlobs, database.settings],
    async () => {
      const attachments = await database.examFiles.where('projectId').equals(id).toArray();
      await database.fileBlobs.bulkDelete(attachments.map(file => file.blobId));
      const tables = [
        database.calendarDays, database.courseSchedules, database.scheduleOverrides,
        database.teachingTasks, database.planVersions, database.scheduledLessons,
        database.actualRecords, database.changeLogs, database.weeklyNotes,
        database.planAnnotations, database.specialDuties, database.exams,
        database.examFiles, database.settings,
      ];
      for (const table of tables) await table.where('projectId').equals(id).delete();
      await database.projects.delete(id);
    });
}
