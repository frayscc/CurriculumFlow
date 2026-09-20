import { schedule, type ScheduleResult, type SchedulerInput } from '../../core/scheduler';
import type { PlanVersion, ScheduledLesson } from '../../types/domain';
import { db as appDb, type CurriculumDatabase } from '../schema';

function fingerprint(input: SchedulerInput): string {
  const normalized = JSON.stringify({
    project: input.project,
    calendarDays: [...input.calendarDays].sort((a, b) => a.date.localeCompare(b.date)),
    courseSchedules: [...input.courseSchedules].sort((a, b) => a.weekday - b.weekday),
    scheduleOverrides: [...input.scheduleOverrides].sort((a, b) => a.date.localeCompare(b.date)),
    tasks: [...input.tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  });
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= BigInt(normalized.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv64:${hash.toString(16).padStart(16, '0')}`;
}

async function readInput(projectId: string, database: CurriculumDatabase): Promise<SchedulerInput> {
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('项目不存在。');
  const [calendarDays, courseSchedules, scheduleOverrides, tasks] = await Promise.all([
    database.calendarDays.where('projectId').equals(projectId).toArray(),
    database.courseSchedules.where('projectId').equals(projectId).toArray(),
    database.scheduleOverrides.where('projectId').equals(projectId).toArray(),
    database.teachingTasks.where('projectId').equals(projectId).toArray(),
  ]);
  return { project: { startDate: project.startDate, endDate: project.endDate }, calendarDays, courseSchedules, scheduleOverrides, tasks };
}

export interface ScheduleDraft { inputFingerprint: string; result: ScheduleResult; }

export async function createScheduleDraft(projectId: string, database = appDb): Promise<ScheduleDraft> {
  const input = await database.transaction('r', [
    database.projects, database.calendarDays, database.courseSchedules, database.scheduleOverrides, database.teachingTasks,
  ], () => readInput(projectId, database));
  return { inputFingerprint: fingerprint(input), result: schedule(input) };
}

export async function confirmScheduleDraft(projectId: string, draft: ScheduleDraft, reason: string, database = appDb): Promise<PlanVersion> {
  if (!reason.trim()) throw new Error('请填写计划版本原因。');
  return database.transaction('rw', [
    database.projects, database.calendarDays, database.courseSchedules, database.scheduleOverrides,
    database.teachingTasks, database.planVersions, database.scheduledLessons,
  ], async () => {
    const input = await readInput(projectId, database);
    if (fingerprint(input) !== draft.inputFingerprint) throw new Error('校历、课表或任务已变化，请重新生成排课草案。');
    const result = schedule(input);
    if (result.conflicts.length || result.unscheduled.length) throw new Error('排课仍有冲突或未排任务，请先调整后再确认。');
    const previous = await database.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last();
    const id = crypto.randomUUID();
    const tasksById = new Map(input.tasks.map(task => [task.id, task]));
    const snapshot = result.lessons.map(lesson => ({
      ...lesson, id: crypto.randomUUID(),
      taskTitle: tasksById.get(lesson.taskId)!.title,
      taskType: tasksById.get(lesson.taskId)!.type,
    }));
    const version: PlanVersion = {
      id, projectId, version: (previous?.version ?? 0) + 1, createdAt: new Date().toISOString(),
      reason: reason.trim(), scheduleSnapshot: snapshot, inputFingerprint: draft.inputFingerprint,
    };
    const rows: ScheduledLesson[] = snapshot.map(lesson => ({ ...lesson, projectId, planVersionId: id }));
    await database.planVersions.add(version);
    await database.scheduledLessons.bulkAdd(rows);
    return version;
  });
}
