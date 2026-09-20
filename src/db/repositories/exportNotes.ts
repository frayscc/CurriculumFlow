import { parseLocalDate, teachingWeekNumber } from '../../core/calendar/dates';
import type { PlanAnnotation, SpecialTrainingDuty } from '../../types/domain';
import { db as appDb } from '../schema';

async function validateRange(projectId: string, startDate: string, endDate: string, database: typeof appDb) {
  parseLocalDate(startDate); parseLocalDate(endDate);
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  if (endDate < startDate || startDate < project.startDate || endDate > project.endDate) throw new Error('日期范围不在当前学期内。');
  return project;
}

export async function setWeeklyNote(projectId: string, weekNumber: number, note: string, database = appDb) {
  const project = await database.projects.get(projectId);
  if (!project || weekNumber < 1 || weekNumber > teachingWeekNumber(project.startDate, project.endDate)) throw new Error('教学周无效。');
  const old = await database.weeklyNotes.get([projectId, weekNumber]);
  await database.weeklyNotes.put({ ...old, projectId, weekNumber, note: note.trim(), updatedAt: new Date().toISOString() });
}

export async function addPlanAnnotation(
  projectId: string, kind: PlanAnnotation['kind'], startDate: string, endDate: string,
  text: string, examId?: string, database = appDb,
) {
  if (!text.trim()) throw new Error('请填写注记内容。');
  await database.transaction('rw', database.projects, database.exams, database.planAnnotations, async () => {
    await validateRange(projectId, startDate, endDate, database);
    if (examId && (await database.exams.get(examId))?.projectId !== projectId) throw new Error('关联考试不属于当前项目。');
    await database.planAnnotations.add({ id: crypto.randomUUID(), projectId, kind, startDate, endDate, text: text.trim(), examId, updatedAt: new Date().toISOString() });
  });
}

export async function deletePlanAnnotation(id: string, database = appDb) { await database.planAnnotations.delete(id); }

export async function addSpecialDuty(projectId: string, startDate: string, endDate: string, teacherName: string, database = appDb) {
  if (!teacherName.trim()) throw new Error('请填写物理专训负责人或“无”。');
  await database.transaction('rw', database.projects, database.specialDuties, database.teachers, async () => {
    await validateRange(projectId, startDate, endDate, database);
    const name = teacherName.trim();
    let teacher = name === '无' ? undefined : await database.teachers.where('name').equals(name).first();
    if (!teacher && name !== '无') { teacher = { id: crypto.randomUUID(), name }; await database.teachers.add(teacher); }
    const duty: SpecialTrainingDuty = {
      id: crypto.randomUUID(), projectId, startDate, endDate,
      teacherId: teacher?.id, teacherNameSnapshot: name, updatedAt: new Date().toISOString(),
    };
    await database.specialDuties.add(duty);
  });
}

export async function deleteSpecialDuty(id: string, database = appDb) { await database.specialDuties.delete(id); }
