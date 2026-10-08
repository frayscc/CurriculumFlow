// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarPage } from '../pages/CalendarPage';
import { ExportPage } from '../pages/ExportPage';
import { db } from '../db/schema';
import { createProject } from '../db/repositories/projects';
import { createTask } from '../db/repositories/tasks';
import { moveTask } from '../db/repositories/manualSchedule';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await db.open();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await db.delete(); });

async function fixture(page: 'calendar' | 'export' = 'calendar', endDate = '2026-09-18') {
  const project = await createProject({ schoolYear: '2026-2027', grade: '测试', subject: '物理', semester: '第一学期', startDate: '2026-09-01', endDate });
  const a = await createTask(project.id, { title: '课程A', type: 'new_lesson' });
  const b = await createTask(project.id, { title: '课程B', type: 'new_lesson' });
  if (page === 'calendar') { await moveTask(a.id, '2026-09-01'); await moveTask(b.id, '2026-09-02'); }
  await act(async () => root.render(<MemoryRouter initialEntries={[`/projects/${project.id}/${page}`]}><Routes><Route path="/projects/:projectId/calendar" element={<CalendarPage />} /><Route path="/projects/:projectId/export" element={<ExportPage />} /></Routes></MemoryRouter>));
  await vi.waitFor(() => expect(container.textContent).toContain(page === 'calendar' ? '课程A' : '请先在月历中安排教学内容'));
  return { project, a, b };
}

function day(number: string) {
  const element = [...container.querySelectorAll('.term-day')].find(element => element.querySelector('.day-number')?.textContent === number);
  if (!element) throw new Error(`缺少日期 ${number}`);
  return element;
}

function pointer(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y });
  return event;
}

it('resizes with pointer movement across a weekend and shifts later content', async () => {
  const { a, b } = await fixture();
  await act(async () => container.querySelector('[aria-label="调整 课程A 的日期跨度"]')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('7').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => day('7').dispatchEvent(pointer('pointerup', 50, 50)));
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-07'));
  expect((await db.teachingTasks.get(a.id))?.scheduledDates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']);
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-08');
});

it('rejects pointer resize onto a weekend without changing either course', async () => {
  const { a, b } = await fixture();
  await act(async () => container.querySelector('[aria-label="调整 课程A 的日期跨度"]')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('5').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => day('5').dispatchEvent(pointer('pointerup', 50, 50)));
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('不能安排'));
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-02');
});

it('cancels pointer resize outside the calendar even after crossing a valid day', async () => {
  const { a } = await fixture();
  await act(async () => container.querySelector('[aria-label="调整 课程A 的日期跨度"]')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => window.dispatchEvent(pointer('pointerup', 60, 60)));
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
  expect(container.textContent).toContain('已取消跨度调整');
});

it('cancels pointer resize on Escape', async () => {
  const { a } = await fixture();
  await act(async () => container.querySelector('[aria-label="调整 课程A 的日期跨度"]')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => day('3').dispatchEvent(pointer('pointerup', 50, 50)));
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
});

it('connects course drag to exact insertion and shifts the following course', async () => {
  const { a, b } = await fixture();
  const values = new Map<string, string>();
  const transfer = { effectAllowed: 'none', dropEffect: 'none', setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? '' };
  function dragEvent(type: string) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    return event;
  }
  await act(async () => container.querySelector('.task-title-drag')!.dispatchEvent(dragEvent('dragstart')));
  expect(transfer.effectAllowed).toBe('move');
  await act(async () => day('3').dispatchEvent(dragEvent('dragover')));
  expect(transfer.dropEffect).toBe('move');
  await act(async () => day('3').dispatchEvent(dragEvent('drop')));
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-03'));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-01');
});

it('supports clicking a handle and selecting an end date', async () => {
  const { a } = await fixture();
  await act(async () => (container.querySelector('[aria-label="调整 课程A 的日期跨度"]') as HTMLElement).click());
  expect(container.querySelector('.term-calendar.is-stretching')).not.toBeNull();
  await act(async () => (day('3') as HTMLElement).click());
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-03'));
});

it('resizes across months by choosing an end date in the next month', async () => {
  const { a, b } = await fixture('calendar', '2026-10-09');
  await act(async () => (container.querySelector('[aria-label="调整 课程A 的日期跨度"]') as HTMLElement).click());
  const monthSelect = container.querySelector('[aria-label="选择月份"]') as HTMLSelectElement;
  await act(async () => { monthSelect.value = '2026-10'; monthSelect.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => (container.querySelector('[data-calendar-date="2026-10-01"]') as HTMLElement).click());
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-10-01'));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-10-02');
});

it('leaves the saved course unchanged when dropped on a weekend', async () => {
  const { a } = await fixture();
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { getData: () => JSON.stringify({ taskId: a.id, mode: 'resize' }) } });
  await act(async () => day('5').dispatchEvent(event));
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('不能安排'));
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
});

it('shows the export empty state instead of loading forever', async () => {
  await fixture('export');
  expect(container.textContent).toContain('打开教学安排');
  expect(container.textContent).not.toContain('正在生成工作计划预览');
});

it('inserts a pending course using click selection and shifts existing content', async () => {
  const { project, b } = await fixture();
  const c = await createTask(project.id, { title: '插入练习', type: 'exercise' });
  await vi.waitFor(() => expect(container.querySelector('.schedule-chip')?.textContent).toContain('插入练习'));
  await act(async () => (container.querySelector('.schedule-chip') as HTMLElement).click());
  await act(async () => (day('2') as HTMLElement).click());
  await vi.waitFor(async () => expect((await db.teachingTasks.get(c.id))?.scheduledStartDate).toBe('2026-09-02'));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-03');
  expect(container.querySelector('.term-calendar.is-stretching')).toBeNull();
});
