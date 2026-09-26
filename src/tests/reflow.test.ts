import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../db/repositories/projects';
import { setCourseSchedule } from '../db/repositories/calendar';
import { createTask } from '../db/repositories/tasks';
import { createRescheduleDraft, createScheduleDraft, confirmScheduleDraft } from '../db/repositories/plans';
import { recordActual } from '../db/repositories/actual';
import { CurriculumDatabase } from '../db/schema';

let database: CurriculumDatabase;
beforeEach(() => { database = new CurriculumDatabase(`reflow-${crypto.randomUUID()}`); });
afterEach(async () => { await database.delete(); });

describe('postponement reflow', () => {
  it('preserves completed lessons and old version while shifting later lessons', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-12' }, database);
    await setCourseSchedule(project.id, 2, [1], database);
    await setCourseSchedule(project.id, 4, [1], database);
    await createTask(project.id, { title: '力学', type: 'new_lesson', plannedPeriods: 3, allowSplit: true }, database);
    const first = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '初稿', database);
    expect(first.scheduleSnapshot.map(row => row.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
    await recordActual(first.scheduleSnapshot[0].id, { status: 'completed', actualPeriods: 1 }, database);
    await recordActual(first.scheduleSnapshot[1].id, { status: 'postponed', reason: '停课' }, database);
    const draft = await createRescheduleDraft(project.id, database);
    expect(draft.result.lessons.map(row => row.date)).toEqual(['2026-09-01', '2026-09-03', '2026-09-04']);
    const second = await confirmScheduleDraft(project.id, draft, '延期后顺延', database);
    expect(second.version).toBe(2);
    expect((await database.planVersions.get(first.id))!.scheduleSnapshot.map(row => row.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
    expect(await database.actualRecords.where('projectId').equals(project.id).count()).toBe(2);
  });

  it('rejects a stale preview after the actual record changes', async () => {
    const project = await createProject({ schoolYear: '2026-2027', grade: '九年级', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate: '2026-09-12' }, database);
    await setCourseSchedule(project.id, 2, [1], database);
    await createTask(project.id, { title: '力学', type: 'new_lesson', plannedPeriods: 2, allowSplit: true }, database);
    const first = await confirmScheduleDraft(project.id, await createScheduleDraft(project.id, database), '初稿', database);
    await recordActual(first.scheduleSnapshot[0].id, { status: 'postponed', reason: '停课' }, database);
    const draft = await createRescheduleDraft(project.id, database);
    await recordActual(first.scheduleSnapshot[0].id, { status: 'postponed', reason: '停课两天' }, database);
    await expect(confirmScheduleDraft(project.id, draft, '顺延', database)).rejects.toThrow('实际教学记录已变化');
    expect(await database.planVersions.where('projectId').equals(project.id).count()).toBe(1);
  });
});
