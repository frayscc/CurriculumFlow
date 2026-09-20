import { teachingWeekNumber } from '../../core/calendar/dates';
import type { SemesterProject, TaskType, TeachingTask } from '../../types/domain';
import { db as appDb } from '../schema';

export type TaskInput = Pick<TeachingTask, 'title' | 'type' | 'plannedPeriods' | 'allowSplit'> &
  Partial<Pick<TeachingTask, 'chapter' | 'section' | 'fixedDate' | 'fixedWeek' | 'note' | 'examId'>>;

const taskTypes: TaskType[] = ['new_lesson', 'exercise', 'quiz', 'exam', 'exam_review', 'review', 'self_study', 'experiment', 'special_training', 'other'];

function validate(input: TaskInput, project: SemesterProject): TaskInput {
  const title = input.title.trim();
  if (!title) throw new Error('教学任务名称不能为空。');
  if (!taskTypes.includes(input.type)) throw new Error('教学任务类型无效。');
  if (!Number.isInteger(input.plannedPeriods) || input.plannedPeriods < 1 || input.plannedPeriods > 100) throw new Error('预计课时须为 1 至 100 的整数。');
  if (input.fixedDate && input.fixedWeek) throw new Error('固定日期和固定周次只能选择一种。');
  if (input.fixedDate && (input.fixedDate < project.startDate || input.fixedDate > project.endDate)) throw new Error('固定日期不在学期范围内。');
  const maxWeek = teachingWeekNumber(project.startDate, project.endDate);
  if (input.fixedWeek && (!Number.isInteger(input.fixedWeek) || input.fixedWeek < 1 || input.fixedWeek > maxWeek)) throw new Error(`固定周次须为 1 至 ${maxWeek}。`);
  return {
    ...input, title, chapter: input.chapter?.trim() || undefined,
    section: input.section?.trim() || undefined, note: input.note?.trim() || undefined,
    fixedDate: input.fixedDate || undefined, fixedWeek: input.fixedWeek || undefined,
  };
}

export async function createTask(projectId: string, input: TaskInput, database = appDb): Promise<TeachingTask> {
  return database.transaction('rw', database.projects, database.teachingTasks, async () => {
    const project = await database.projects.get(projectId);
    if (!project) throw new Error('项目不存在。');
    const data = validate(input, project);
    const last = await database.teachingTasks.where('[projectId+order]').between([projectId, 0], [projectId, Infinity]).last();
    const now = new Date().toISOString();
    const task: TeachingTask = { ...data, id: crypto.randomUUID(), projectId, order: (last?.order ?? 0) + 1, createdAt: now, updatedAt: now };
    await database.teachingTasks.add(task);
    return task;
  });
}

export async function updateTask(taskId: string, input: TaskInput, database = appDb): Promise<TeachingTask> {
  return database.transaction('rw', database.projects, database.teachingTasks, database.changeLogs, async () => {
    const old = await database.teachingTasks.get(taskId);
    if (!old) throw new Error('教学任务不存在。');
    const project = await database.projects.get(old.projectId);
    if (!project) throw new Error('项目不存在。');
    const data = validate(input, project);
    const next: TeachingTask = { ...old, ...data, updatedAt: new Date().toISOString() };
    await database.teachingTasks.put(next);
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId: old.projectId, entityType: 'TeachingTask', entityId: old.id, action: 'update', before: old, after: next, timestamp: next.updatedAt });
    return next;
  });
}

export async function reorderTasks(projectId: string, orderedIds: string[], database = appDb): Promise<void> {
  await database.transaction('rw', database.teachingTasks, database.changeLogs, async () => {
    const tasks = await database.teachingTasks.where('projectId').equals(projectId).sortBy('order');
    if (tasks.length !== orderedIds.length || new Set(orderedIds).size !== tasks.length || tasks.some(task => !orderedIds.includes(task.id))) {
      throw new Error('任务列表已发生变化，请刷新后重试排序。');
    }
    const byId = new Map(tasks.map(task => [task.id, task]));
    const timestamp = new Date().toISOString();
    await database.teachingTasks.bulkPut(orderedIds.map((id, index) => ({ ...byId.get(id)!, order: index + 1, updatedAt: timestamp })));
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId, entityType: 'TeachingTask', entityId: projectId, action: 'reorder', before: tasks.map(task => task.id), after: orderedIds, timestamp });
  });
}

export async function deleteTask(taskId: string, database = appDb): Promise<void> {
  await database.transaction('rw', database.teachingTasks, database.actualRecords, database.changeLogs, async () => {
    const task = await database.teachingTasks.get(taskId);
    if (!task) return;
    const actualCount = await database.actualRecords.where('[projectId+taskId]').equals([task.projectId, taskId]).count();
    if (actualCount || task.examId) throw new Error('该任务存在实际教学记录或考试资源关联，请先解除关联。');
    await database.teachingTasks.delete(taskId);
    const remaining = await database.teachingTasks.where('projectId').equals(task.projectId).sortBy('order');
    await database.teachingTasks.bulkPut(remaining.map((item, index) => ({ ...item, order: index + 1 })));
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: taskId, action: 'delete', before: task, after: null, timestamp: new Date().toISOString() });
  });
}

export async function restoreDeletedTask(task: TeachingTask, database = appDb): Promise<void> {
  await database.transaction('rw', database.projects, database.teachingTasks, database.changeLogs, async () => {
    if (!await database.projects.get(task.projectId)) throw new Error('项目已不存在，无法撤销删除。');
    if (await database.teachingTasks.get(task.id)) throw new Error('任务已存在，无法重复恢复。');
    const tasks = await database.teachingTasks.where('projectId').equals(task.projectId).sortBy('order');
    const position = Math.min(Math.max(task.order, 1), tasks.length + 1);
    const timestamp = new Date().toISOString();
    await database.teachingTasks.bulkPut(tasks.filter(item => item.order >= position).map(item => ({ ...item, order: item.order + 1, updatedAt: timestamp })));
    await database.teachingTasks.add({ ...task, order: position, updatedAt: timestamp });
    await database.changeLogs.add({ id: crypto.randomUUID(), projectId: task.projectId, entityType: 'TeachingTask', entityId: task.id, action: 'restore', before: null, after: task, timestamp });
  });
}
