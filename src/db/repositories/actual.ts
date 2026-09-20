import { parseLocalDate } from '../../core/calendar/dates';
import type { ActualStatus, ActualTeachingRecord } from '../../types/domain';
import { db as appDb } from '../schema';

export interface ActualInput {
  status: ActualStatus; actualDate?: string; actualPeriods?: number;
  reason?: string; reflection?: string;
}
const statuses: ActualStatus[] = ['pending', 'completed', 'partially_completed', 'postponed', 'cancelled'];

export async function recordActual(scheduledLessonId: string, input: ActualInput, database = appDb): Promise<ActualTeachingRecord> {
  if (!statuses.includes(input.status)) throw new Error('教学执行状态无效。');
  if (input.actualDate) parseLocalDate(input.actualDate);
  if (input.actualPeriods !== undefined && (!Number.isFinite(input.actualPeriods) || input.actualPeriods < 0 || input.actualPeriods > 20)) {
    throw new Error('实际课时须为 0 至 20 的数字。');
  }
  const reason = input.reason?.trim() || undefined;
  if ((input.status === 'postponed' || input.status === 'cancelled') && !reason) throw new Error('延期或取消时请填写原因。');
  return database.transaction('rw', database.scheduledLessons, database.actualRecords, database.changeLogs, async () => {
    const lesson = await database.scheduledLessons.get(scheduledLessonId);
    if (!lesson) throw new Error('计划课次不存在。');
    const previous = await database.actualRecords.where('[projectId+scheduledLessonId]').equals([lesson.projectId, lesson.id]).first();
    const timestamp = new Date().toISOString();
    const actualDate = input.status === 'completed' || input.status === 'partially_completed'
      ? (input.actualDate || lesson.date) : input.actualDate || undefined;
    const next: ActualTeachingRecord = {
      id: previous?.id ?? crypto.randomUUID(), projectId: lesson.projectId,
      taskId: lesson.taskId, scheduledLessonId: lesson.id, planVersionId: lesson.planVersionId,
      plannedDate: lesson.date, plannedPeriods: 1,
      status: input.status, actualDate,
      actualPeriods: input.actualPeriods,
      reason, reflection: input.reflection?.trim() || undefined,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
    };
    await database.actualRecords.put(next);
    await database.changeLogs.add({
      id: crypto.randomUUID(), projectId: lesson.projectId, entityType: 'ActualTeachingRecord',
      entityId: next.id, action: previous ? 'update' : 'create', before: previous ?? null,
      after: next, reason, timestamp,
    });
    return next;
  });
}
