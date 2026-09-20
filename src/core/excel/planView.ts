import { compactTitles } from '../plan/summary';
import { teachingWeekNumber } from '../calendar/dates';
import type { CalendarDay, Exam, PlanAnnotation, ScheduledLesson, SemesterProject, SpecialTrainingDuty, WeeklyNote } from '../../types/domain';

export interface WorkPlanRow {
  month: string; weekNumber: number; startDate: string; endDate: string;
  dates: Array<{ day: number; date: string } | null>; // C:I, Sunday to Saturday
  firstWeekSegment: boolean; content: string; periods: number;
  note: string; assessment: string; specialTraining: string;
}

export function buildWorkPlanView(input: {
  project: SemesterProject; lessons: ScheduledLesson[]; calendarDays: CalendarDay[];
  weeklyNotes: WeeklyNote[]; annotations: PlanAnnotation[];
  specialDuties: SpecialTrainingDuty[]; exams: Exam[];
}): WorkPlanRow[] {
  const { project, lessons, calendarDays, weeklyNotes, annotations, specialDuties, exams } = input;
  const orderedDays = [...calendarDays].sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<string, CalendarDay[]>();
  for (const day of orderedDays) {
    const week = teachingWeekNumber(project.startDate, day.date);
    const key = `${week}:${day.date.slice(0, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  const lessonsByWeek = new Map<number, ScheduledLesson[]>();
  for (const lesson of lessons) lessonsByWeek.set(lesson.weekNumber, [...(lessonsByWeek.get(lesson.weekNumber) ?? []), lesson]);
  const noteByWeek = new Map(weeklyNotes.map(note => [note.weekNumber, note]));
  const seenWeeks = new Set<number>();
  return [...groups.entries()].map(([key, days]) => {
    const weekNumber = Number(key.split(':')[0]);
    const firstWeekSegment = !seenWeeks.has(weekNumber);
    seenWeeks.add(weekNumber);
    const first = days[0].date; const last = days[days.length - 1].date;
    const weekLessons = [...(lessonsByWeek.get(weekNumber) ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
    const uniqueTasks = [...new Map(weekLessons.map(lesson => [lesson.taskId, lesson.taskTitle])).values()];
    const daysByWeekday = new Map(days.map(day => [new Date(`${day.date}T00:00:00Z`).getUTCDay(), day]));
    const dates = Array.from({ length: 7 }, (_, index) => {
      const day = daysByWeekday.get(index);
      return day ? { day: Number(day.date.slice(8)), date: day.date } : null;
    });
    const visibleAnnotations = annotations.filter(item => item.startDate <= last && item.endDate >= first);
    const calendarText = days.filter(day => day.dayType !== 'normal' && (day.title || day.note))
      .map(day => `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8))}日${day.title ?? day.note ?? ''}`);
    const weekNote = firstWeekSegment ? noteByWeek.get(weekNumber)?.note : undefined;
    const note = [weekNote, ...calendarText, ...visibleAnnotations.filter(item => item.kind === 'calendar_note').map(item => item.text)]
      .filter(Boolean).join('\n');
    const assessments = visibleAnnotations.filter(item => item.kind === 'assessment_preparation').map(item => item.text);
    for (const exam of exams) {
      if (exam.examDate && exam.examDate >= first && exam.examDate <= last && !visibleAnnotations.some(item => item.examId === exam.id)) {
        const people = [exam.authorNames.length ? `命题：${exam.authorNames.join('、')}` : '', exam.reviewerNames.length ? `审题：${exam.reviewerNames.join('、')}` : ''].filter(Boolean).join('；');
        assessments.push(`${exam.title}${people ? `：${people}` : ''}`);
      }
    }
    const specialTraining = [...new Set(specialDuties.filter(duty => duty.startDate <= last && duty.endDate >= first)
      .map(duty => duty.teacherNameSnapshot || duty.note || '无'))].join('、');
    return {
      month: `${Number(first.slice(5, 7))}月`, weekNumber, startDate: first, endDate: last,
      dates, firstWeekSegment,
      content: firstWeekSegment ? compactTitles(uniqueTasks) : '',
      periods: firstWeekSegment ? weekLessons.length : 0,
      note, assessment: assessments.join('\n'), specialTraining,
    };
  });
}
