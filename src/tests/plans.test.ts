import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compactTitles } from '../core/plan/summary';
import { createProject } from '../db/repositories/projects';
import { setCourseSchedule } from '../db/repositories/calendar';
import { createTask, updateTask } from '../db/repositories/tasks';
import { confirmScheduleDraft, createScheduleDraft } from '../db/repositories/plans';
import { CurriculumDatabase } from '../db/schema';

const projectInput = {
  schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
  startDate: '2026-09-14', endDate: '2026-09-18',
};
const firstTask = { title: '13.1 分子热运动', type: 'new_lesson' as const, plannedPeriods: 1, allowSplit: true };

describe('plan versions', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`plans-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('keeps prior schedule and title snapshots when a new version is confirmed', async () => {
    const project = await createProject(projectInput, database);
    await setCourseSchedule(project.id, 1, [3], database);
    await setCourseSchedule(project.id, 2, [3], database);
    const task = await createTask(project.id, firstTask, database);
    const v1 = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '初始计划', database);
    expect(v1.version).toBe(1);
    expect(v1.scheduleMode).toBe('progress');
    expect(v1.scheduleSnapshot[0]).toMatchObject({ taskId: task.id, date: '2026-09-14', taskTitle: firstTask.title });
    await updateTask(task.id, { ...firstTask, title: '13.1 新标题', plannedPeriods: 2 }, database);
    const v2 = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '增加课时', database);
    expect(v2.version).toBe(2);
    expect(v2.scheduleSnapshot).toHaveLength(2);
    expect((await database.planVersions.get(v1.id))?.scheduleSnapshot[0].taskTitle).toBe(firstTask.title);
    expect(await database.scheduledLessons.where('planVersionId').equals(v1.id).count()).toBe(1);
  });

  it('rejects stale previews and leaves the database unchanged', async () => {
    const project = await createProject(projectInput, database);
    await setCourseSchedule(project.id, 1, [3], database);
    const task = await createTask(project.id, firstTask, database);
    const draft = await createScheduleDraft(project.id, database);
    await updateTask(task.id, { ...firstTask, plannedPeriods: 2 }, database);
    await expect(confirmScheduleDraft(project.id, draft, '过期草案', database)).rejects.toThrow('已变化');
    expect(await database.planVersions.count()).toBe(0);
    expect(await database.scheduledLessons.count()).toBe(0);
  });

  it('compacts only consecutive section codes at display time', () => {
    expect(compactTitles(['13.1 分子热运动', '13.2 内能', '13章练习', '14.1 热机', '14.2 热机效率']))
      .toBe('13.1-13.2；13章练习；14.1-14.2');
  });
});
