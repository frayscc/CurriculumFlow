import { teachingWeekNumber } from '../../core/calendar/dates';
import type { Exam, ScheduledLesson } from '../../types/domain';
import { db as appDb } from '../schema';

export interface DashboardData {
  currentWeek: number;
  thisWeek: ScheduledLesson[];
  plannedDue: number;
  completed: number;
  totalLessons: number;
  lagPeriods: number;
  nextExam?: Exam;
  structuredBytes: number;
  attachmentBytes: number;
  attachmentCount: number;
  progressMode: boolean;
}

export async function readProjectDashboard(projectId: string, today: string, database = appDb): Promise<DashboardData | undefined> {
  const project = await database.projects.get(projectId);
  if (!project) return undefined;
  const version = await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last();
  const [lessons, allLessons, actuals, exams, files, calendarDays, schedules, overrides, tasks, versions, notes, annotations, duties, logs, settings] = await Promise.all([
    version ? database.scheduledLessons.where('planVersionId').equals(version.id).toArray() : Promise.resolve([] as ScheduledLesson[]),
    database.scheduledLessons.where('projectId').equals(projectId).toArray(),
    database.actualRecords.where('projectId').equals(projectId).toArray(),
    database.exams.where('projectId').equals(projectId).toArray(),
    database.examFiles.where('projectId').equals(projectId).toArray(),
    database.calendarDays.where('projectId').equals(projectId).toArray(),
    database.courseSchedules.where('projectId').equals(projectId).toArray(),
    database.scheduleOverrides.where('projectId').equals(projectId).toArray(),
    database.teachingTasks.where('projectId').equals(projectId).toArray(),
    database.planVersions.where('projectId').equals(projectId).toArray(),
    database.weeklyNotes.where('projectId').equals(projectId).toArray(),
    database.planAnnotations.where('projectId').equals(projectId).toArray(),
    database.specialDuties.where('projectId').equals(projectId).toArray(),
    database.changeLogs.where('projectId').equals(projectId).toArray(),
    database.settings.where('projectId').equals(projectId).toArray(),
  ]);
  const weekStart = version?.weekStart ?? project.weekStart ?? 7;
  const currentWeek = today < project.startDate ? 0 : today > project.endDate
    ? teachingWeekNumber(project.startDate, project.endDate, weekStart) + 1
    : teachingWeekNumber(project.startDate, today, weekStart);
  const thisWeek = lessons.filter(lesson => lesson.weekNumber === currentWeek).sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  const allLessonById = new Map(allLessons.map(lesson => [lesson.id, lesson]));
  const completedKeys = new Set(actuals.filter(row => row.status === 'completed').map(row => {
    const lesson = row.scheduledLessonId ? allLessonById.get(row.scheduledLessonId) : undefined;
    return lesson ? `${lesson.taskId}:${lesson.taskPeriodIndex}` : '';
  }));
  const completed = lessons.filter(lesson => completedKeys.has(`${lesson.taskId}:${lesson.taskPeriodIndex}`)).length;
  const plannedDue = lessons.filter(lesson => lesson.date <= today).length;
  const nextExam = exams.filter(exam => exam.examDate && exam.examDate >= today).sort((a, b) => a.examDate!.localeCompare(b.examDate!))[0];
  const structured = { project, calendarDays, schedules, overrides, tasks, versions, allLessons, actuals, exams, files, notes, annotations, duties, logs, settings };
  return {
    currentWeek, thisWeek, plannedDue, completed, totalLessons: lessons.length,
    lagPeriods: Math.max(0, plannedDue - completed), nextExam,
    structuredBytes: new TextEncoder().encode(JSON.stringify(structured)).byteLength,
    attachmentBytes: files.reduce((total, file) => total + file.size, 0), attachmentCount: files.length,
    progressMode: version?.scheduleMode === 'progress',
  };
}
