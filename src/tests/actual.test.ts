import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { setCourseSchedule } from '../db/repositories/calendar';
import { createTask } from '../db/repositories/tasks';
import { createScheduleDraft, confirmScheduleDraft } from '../db/repositories/plans';
import { recordActual } from '../db/repositories/actual';
import { CurriculumDatabase } from '../db/schema';

describe('actual teaching records', () => {
  let database: CurriculumDatabase;
  beforeEach(() => { database = new CurriculumDatabase(`actual-${crypto.randomUUID()}`); });
  afterEach(async () => { await database.delete(); });

  it('records execution and later edits without changing the original plan', async () => {
    const project = await createProject({
      schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期',
      startDate: '2026-09-14', endDate: '2026-09-14',
    }, database);
    await setCourseSchedule(project.id, 1, [3], database);
    const task = await createTask(project.id, { title: '13.1', type: 'new_lesson', plannedPeriods: 1, allowSplit: true }, database);
    const version = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '初始', database);
    const lesson = version.scheduleSnapshot[0];
    const postponed = await recordActual(lesson.id, { status: 'postponed', reason: '学校活动' }, database);
    expect(postponed.plannedDate).toBe('2026-09-14');
    expect(postponed.actualDate).toBeUndefined();
    const completed = await recordActual(lesson.id, { status: 'completed', actualDate: '2026-09-15', actualPeriods: 1, reflection: '补上' }, database);
    expect(completed.id).toBe(postponed.id);
    expect(completed.createdAt).toBe(postponed.createdAt);
    expect(completed.actualDate).toBe('2026-09-15');
    expect((await database.planVersions.get(version.id))?.scheduleSnapshot[0].date).toBe('2026-09-14');
    expect((await database.teachingTasks.get(task.id))?.plannedPeriods).toBe(1);
    expect(await database.changeLogs.where('[entityType+entityId]').equals(['ActualTeachingRecord', completed.id]).count()).toBe(2);
  });

  it('requires a reason for a postponed lesson', async () => {
    await expect(recordActual('missing', { status: 'postponed' }, database)).rejects.toThrow('填写原因');
    expect(await database.actualRecords.count()).toBe(0);
  });
});
