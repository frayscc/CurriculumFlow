export type ID = string;
export type LocalDate = string;
export type Timestamp = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type DayType = 'normal' | 'holiday' | 'makeup_workday' | 'school_event' | 'exam' | 'unavailable';
export type TaskType = 'new_lesson' | 'exercise' | 'quiz' | 'exam' | 'exam_review' | 'review' | 'self_study' | 'experiment' | 'special_training' | 'other';
export type ActualStatus = 'pending' | 'completed' | 'partially_completed' | 'postponed' | 'cancelled';
export type ExamType = 'quiz' | 'chapter_test' | 'monthly_exam' | 'midterm' | 'final' | 'mock_exam' | 'special_training' | 'other';
export type ExamFileType = 'paper_word' | 'paper_pdf' | 'answer_sheet_word' | 'answer_sheet_pdf' | 'answer_word' | 'answer_pdf' | 'specification_xlsx';

export interface SemesterProject {
  id: ID; schoolYear: string; grade: string; subject: string; semester: string;
  startDate: LocalDate; endDate: LocalDate; sourceProjectId?: ID; weekStart?: Weekday;
  sharedCourseSlots?: SharedCourseSlot[];
  createdAt: Timestamp; updatedAt: Timestamp;
}
export interface SharedCourseSlot {
  id: ID; label: string;
  members: Array<{ weekday: Weekday; period: number }>;
}
export interface CalendarDay {
  projectId: ID; date: LocalDate; weekday: Weekday; dayType: DayType;
  scheduleWeekday?: Weekday; title?: string; note?: string;
}
export interface CourseSchedule { projectId: ID; weekday: Weekday; periods: number[]; }
export interface ScheduleOverride { projectId: ID; date: LocalDate; originalPeriods: number[]; actualPeriods: number[]; reason: string; }
export interface TeachingTask {
  id: ID; projectId: ID; order: number; title: string; type: TaskType; plannedPeriods: number;
  chapter?: string; section?: string; fixedDate?: LocalDate; fixedWeek?: number;
  allowSplit: boolean; note?: string; examId?: ID; createdAt: Timestamp; updatedAt: Timestamp;
}
export interface ScheduledLessonSnapshot {
  id: ID; taskId: ID; date: LocalDate; weekNumber: number; period: number;
  taskPeriodIndex: number; plannedPeriods: number; taskTitle: string; taskType: TaskType;
  sharedSlotLabel?: string; sharedOccurrences?: Array<{ date: LocalDate; period: number }>;
}
export interface PlanVersion {
  id: ID; projectId: ID; version: number; createdAt: Timestamp; reason: string;
  scheduleSnapshot: ScheduledLessonSnapshot[]; inputFingerprint: string; weekStart?: Weekday;
}
export interface ScheduledLesson extends ScheduledLessonSnapshot { projectId: ID; planVersionId: ID; }
export interface ActualTeachingRecord {
  id: ID; projectId: ID; taskId: ID; scheduledLessonId?: ID; planVersionId?: ID;
  plannedDate: LocalDate; actualDate?: LocalDate; status: ActualStatus;
  plannedPeriods: number; actualPeriods?: number; reason?: string; reflection?: string;
  createdAt: Timestamp; updatedAt: Timestamp;
}
export interface ChangeLog {
  id: ID; projectId: ID; entityType: string; entityId: ID; action: string;
  before: unknown; after: unknown; reason?: string; timestamp: Timestamp;
}
export interface WeeklyNote {
  projectId: ID; weekNumber: number; note?: string; specialWork?: string; updatedAt: Timestamp;
}
export interface PlanAnnotation {
  id: ID; projectId: ID; kind: 'calendar_note' | 'assessment_preparation';
  startDate: LocalDate; endDate: LocalDate; text: string; examId?: ID; updatedAt: Timestamp;
}
export interface SpecialTrainingDuty {
  id: ID; projectId: ID; startDate: LocalDate; endDate: LocalDate;
  teacherId?: ID; teacherNameSnapshot?: string; note?: string; taskId?: ID; updatedAt: Timestamp;
}
export interface Exam {
  id: ID; projectId: ID; title: string; grade: string; subject: string;
  examType: ExamType; examDate?: LocalDate; authorIds: ID[]; reviewerIds: ID[];
  authorNames: string[]; reviewerNames: string[]; note?: string;
  createdAt: Timestamp; updatedAt: Timestamp;
}
export interface Teacher { id: ID; name: string; }
export interface ExamFile {
  id: ID; projectId: ID; examId: ID; fileType: ExamFileType;
  originalFileName: string; mimeType: string; size: number; blobId: ID; uploadedAt: Timestamp;
}
export interface FileBlob { id: ID; blob: Blob; }
export interface AppSetting { key: string; projectId?: ID; value: unknown; }
