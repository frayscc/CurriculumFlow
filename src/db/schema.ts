import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  ActualTeachingRecord, AppSetting, CalendarDay, ChangeLog, CourseSchedule,
  Exam, ExamFile, FileBlob, PlanAnnotation, PlanVersion, ScheduleOverride,
  ScheduledLesson, SemesterProject, SpecialTrainingDuty, Teacher, TeachingTask, WeeklyNote,
} from '../types/domain';

export class CurriculumDatabase extends Dexie {
  projects!: EntityTable<SemesterProject, 'id'>;
  calendarDays!: Table<CalendarDay, [string, string]>;
  courseSchedules!: Table<CourseSchedule, [string, number]>;
  scheduleOverrides!: Table<ScheduleOverride, [string, string]>;
  teachingTasks!: EntityTable<TeachingTask, 'id'>;
  planVersions!: EntityTable<PlanVersion, 'id'>;
  scheduledLessons!: EntityTable<ScheduledLesson, 'id'>;
  actualRecords!: EntityTable<ActualTeachingRecord, 'id'>;
  changeLogs!: EntityTable<ChangeLog, 'id'>;
  weeklyNotes!: Table<WeeklyNote, [string, number]>;
  planAnnotations!: EntityTable<PlanAnnotation, 'id'>;
  specialDuties!: EntityTable<SpecialTrainingDuty, 'id'>;
  exams!: EntityTable<Exam, 'id'>;
  examFiles!: EntityTable<ExamFile, 'id'>;
  fileBlobs!: EntityTable<FileBlob, 'id'>;
  teachers!: EntityTable<Teacher, 'id'>;
  settings!: EntityTable<AppSetting, 'key'>;

  constructor(name = 'CurriculumFlow') {
    super(name);
    this.version(1).stores({
      projects: 'id, [schoolYear+grade+subject+semester], updatedAt',
      calendarDays: '[projectId+date], projectId, [projectId+dayType]',
      courseSchedules: '[projectId+weekday], projectId',
      scheduleOverrides: '[projectId+date], projectId',
      teachingTasks: 'id, [projectId+order], projectId, [projectId+examId]',
      planVersions: 'id, [projectId+version], [projectId+createdAt]',
      scheduledLessons: 'id, [projectId+planVersionId+date], [projectId+taskId], planVersionId',
      actualRecords: 'id, [projectId+scheduledLessonId], [projectId+taskId], [projectId+actualDate]',
      changeLogs: 'id, [projectId+timestamp], [entityType+entityId]',
      weeklyNotes: '[projectId+weekNumber], projectId',
      planAnnotations: 'id, [projectId+startDate], [projectId+endDate], kind',
      specialDuties: 'id, [projectId+startDate], [projectId+endDate], teacherId',
      exams: 'id, [projectId+examDate], [projectId+examType], title',
      examFiles: 'id, [examId+fileType], projectId, examId',
      fileBlobs: 'id',
      teachers: 'id, name',
      settings: 'key, projectId',
    });
    // Add a direct project index for execution views. Dexie upgrades existing
    // v1 databases in place; no records or attachments are cleared.
    this.version(2).stores({
      actualRecords: 'id, projectId, [projectId+scheduledLessonId], [projectId+taskId], [projectId+actualDate]',
    });
    // Several views and project deletion query by projectId directly. Make
    // those indexes explicit so existing v1/v2 databases migrate safely.
    this.version(3).stores({
      planVersions: 'id, projectId, [projectId+version], [projectId+createdAt]',
      scheduledLessons: 'id, projectId, [projectId+planVersionId+date], [projectId+taskId], planVersionId',
      planAnnotations: 'id, projectId, [projectId+startDate], [projectId+endDate], kind',
      specialDuties: 'id, projectId, [projectId+startDate], [projectId+endDate], teacherId',
      exams: 'id, projectId, [projectId+examDate], [projectId+examType], title',
    });
  }
}

export const db = new CurriculumDatabase();
