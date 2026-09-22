import { generateCalendarDays, teachingWeekNumber } from '../../core/calendar/dates';
import type { SemesterProject, TeachingTask } from '../../types/domain';
import { db as appDb } from '../schema';
import { validateProjectInput, type ProjectInput } from './projects';

export interface CopyOptions {
  tasks: boolean; plannedPeriods: boolean; examNodes: boolean; selfStudy: boolean;
  calendar: boolean; courseSchedule: boolean; authors: boolean; reviewers: boolean;
}
export const defaultCopyOptions: CopyOptions = {
  tasks: true, plannedPeriods: true, examNodes: true, selfStudy: true,
  calendar: false, courseSchedule: false, authors: false, reviewers: false,
};

export async function copyHistoricalProject(
  sourceProjectId: string, input: ProjectInput, options: CopyOptions = defaultCopyOptions, database = appDb,
): Promise<SemesterProject> {
  const data = validateProjectInput(input);
  return database.transaction('rw', [database.projects, database.calendarDays, database.courseSchedules, database.teachingTasks, database.exams], async () => {
    const source = await database.projects.get(sourceProjectId);
    if (!source) throw new Error('往届项目不存在。');
    const existing = await database.projects.where('[schoolYear+grade+subject+semester]').equals([data.schoolYear, data.grade, data.subject, data.semester]).first();
    if (existing) throw new Error('同一学年、年级、学科和学期的项目已存在。');
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const project: SemesterProject = {
      ...data, id, sourceProjectId, weekStart: source.weekStart ?? 7,
      sharedCourseSlots: options.courseSchedule ? (source.sharedCourseSlots ?? []).map(group => ({ ...group, id: crypto.randomUUID() })) : [],
      createdAt: timestamp, updatedAt: timestamp,
    };
    const days = generateCalendarDays(id, data.startDate, data.endDate);
    if (options.calendar) {
      const oldDays = await database.calendarDays.where('projectId').equals(sourceProjectId).sortBy('date');
      days.forEach((day, index) => {
        const previous = oldDays[index];
        if (!previous) return;
        day.dayType = previous.dayType;
        day.scheduleWeekday = previous.scheduleWeekday;
        day.title = previous.title;
        day.note = previous.note;
      });
    }
    await database.projects.add(project);
    await database.calendarDays.bulkAdd(days);
    if (options.courseSchedule) {
      const schedules = await database.courseSchedules.where('projectId').equals(sourceProjectId).toArray();
      await database.courseSchedules.bulkAdd(schedules.map(row => ({ ...row, projectId: id })));
    }
    if (options.tasks) {
      const oldTasks = await database.teachingTasks.where('projectId').equals(sourceProjectId).sortBy('order');
      const selected = oldTasks.filter(task => (options.examNodes || task.type !== 'exam' && task.type !== 'quiz') &&
        (options.selfStudy || task.type !== 'self_study'));
      const oldExams = options.examNodes ? await database.exams.where('projectId').equals(sourceProjectId).toArray() : [];
      const examIdMap = new Map<string, string>();
      const newExams = oldExams.map(exam => {
        const newId = crypto.randomUUID(); examIdMap.set(exam.id, newId);
        return {
          ...exam, id: newId, projectId: id, grade: data.grade, subject: data.subject,
          examDate: undefined,
          authorIds: options.authors ? exam.authorIds : [], authorNames: options.authors ? exam.authorNames : [],
          reviewerIds: options.reviewers ? exam.reviewerIds : [], reviewerNames: options.reviewers ? exam.reviewerNames : [],
          createdAt: timestamp, updatedAt: timestamp,
        };
      });
      if (newExams.length) await database.exams.bulkAdd(newExams);
      const maxWeek = teachingWeekNumber(data.startDate, data.endDate, project.weekStart ?? 7);
      await database.teachingTasks.bulkAdd(selected.map((task, index) => ({
        ...task, id: crypto.randomUUID(), projectId: id, order: index + 1,
        plannedPeriods: options.plannedPeriods ? task.plannedPeriods : 1,
        fixedDate: undefined, fixedWeek: task.fixedWeek && task.fixedWeek <= maxWeek ? task.fixedWeek : undefined,
        examId: task.examId ? examIdMap.get(task.examId) : undefined,
        createdAt: timestamp, updatedAt: timestamp,
      })));
    }
    return project;
  });
}

export interface HistoricalReference {
  sourceProject: SemesterProject; sourceTask: TeachingTask;
  actualPeriods?: number; reason?: string;
}

export async function getHistoricalReference(task: TeachingTask, database = appDb): Promise<HistoricalReference | undefined> {
  const project = await database.projects.get(task.projectId);
  if (!project?.sourceProjectId) return undefined;
  const sourceProject = await database.projects.get(project.sourceProjectId);
  if (!sourceProject) return undefined;
  const sourceTasks = await database.teachingTasks.where('projectId').equals(sourceProject.id).toArray();
  const sourceTask = sourceTasks.find(candidate => candidate.section && candidate.section === task.section) ??
    sourceTasks.find(candidate => candidate.title === task.title);
  if (!sourceTask) return undefined;
  const records = await database.actualRecords.where('[projectId+taskId]').equals([sourceProject.id, sourceTask.id]).toArray();
  const completed = records.filter(record => record.status === 'completed' || record.status === 'partially_completed');
  const actualPeriods = completed.length ? completed.reduce((sum, record) => sum + (record.actualPeriods ?? record.plannedPeriods), 0) : undefined;
  return { sourceProject, sourceTask, actualPeriods, reason: records.find(record => record.reason)?.reason };
}
