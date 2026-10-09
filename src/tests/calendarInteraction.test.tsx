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
import { moveTask, resizeTask } from '../db/repositories/manualSchedule';

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

it('keeps resizing enabled after clicking the handle and captures the pointer', async () => {
  const { a } = await fixture();
  const handle = container.querySelector('[aria-label="调整 课程A 的日期跨度"]') as HTMLElement;
  const capture = vi.fn();
  Object.assign(container.querySelector('.term-calendar-grid')!, { setPointerCapture: capture });
  await act(async () => handle.click());
  expect(container.querySelector('.is-stretching')).not.toBeNull();
  const down = pointer('pointerdown', 10, 10);
  await act(async () => handle.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect(capture).toHaveBeenCalledWith(1);
  expect(container.querySelector('.is-stretching')).toBeNull();
  await act(async () => day('2').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => day('2').dispatchEvent(pointer('pointerup', 50, 50)));
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-02'));
});

it('uses cell geometry when capture or a spanning bar retargets events to the old handle', async () => {
  const { a, b } = await fixture();
  const handle = container.querySelector('[aria-label="调整 课程A 的日期跨度"]')!;
  Object.assign(day('1'), { getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100, width: 100 }) });
  Object.assign(day('2'), { getBoundingClientRect: () => ({ left: 100, right: 200, top: 0, bottom: 100, width: 100 }) });
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => handle.dispatchEvent(pointer('pointermove', 150, 50)));
  await act(async () => handle.dispatchEvent(pointer('pointerup', 150, 50)));
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-02'));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-03');
});

it('previews growing and shrinking plus downstream ripple before saving', async () => {
  const { a, b } = await fixture();
  const bar = () => day('1').querySelector<HTMLElement>('.calendar-task-bar')!;
  await act(async () => bar().querySelector('.resize-handle')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  expect(bar().style.getPropertyValue('--task-span')).toBe('3');
  expect(bar().classList.contains('resize-preview')).toBe(true);
  expect(day('4').querySelector('.calendar-task-bar')?.getAttribute('data-task-id')).toBe(b.id);
  expect(container.querySelector('.resize-feedback')?.textContent).toContain('3 个上课日');
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-02');
  await act(async () => day('2').dispatchEvent(pointer('pointermove', 40, 50)));
  expect(bar().style.getPropertyValue('--task-span')).toBe('2');
  expect(day('3').querySelector('.calendar-task-bar')?.getAttribute('data-task-id')).toBe(b.id);
  await act(async () => day('2').dispatchEvent(pointer('pointerup', 40, 50)));
  await vi.waitFor(() => expect(container.querySelector('.resize-feedback')).toBeNull());
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-02');
});

it('keeps capture when shrinking removes the source segment across a weekend', async () => {
  const { a, b } = await fixture();
  await act(async () => resizeTask(a.id, '2026-09-07'));
  await vi.waitFor(() => expect(day('7').querySelector('.resize-handle')).not.toBeNull());
  const handle = day('7').querySelector('.resize-handle')!;
  const grid = container.querySelector('.term-calendar-grid')!;
  const release = vi.fn();
  Object.assign(grid, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: release });
  await act(async () => handle.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('2').dispatchEvent(pointer('pointermove', 50, 50)));
  expect(handle.isConnected).toBe(false);
  expect(day('1').querySelector<HTMLElement>('.calendar-task-bar')!.style.getPropertyValue('--task-span')).toBe('2');
  await act(async () => day('2').dispatchEvent(pointer('pointerup', 50, 50)));
  expect(release).toHaveBeenCalledWith(1);
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-02'));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-03');
});

it('rolls back the preview on invalid dates and cancellation without writes', async () => {
  const { a } = await fixture();
  await act(async () => day('1').querySelector('.resize-handle')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => day('5').dispatchEvent(pointer('pointermove', 60, 50)));
  expect(container.querySelector('.resize-feedback.invalid')?.textContent).toContain('不能安排');
  expect(day('1').querySelector<HTMLElement>('.calendar-task-bar')!.style.getPropertyValue('--task-span')).toBe('1');
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 70, 50)));
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(container.querySelector('.resize-feedback')).toBeNull();
  expect(day('1').querySelector<HTMLElement>('.calendar-task-bar')!.style.getPropertyValue('--task-span')).toBe('1');
  expect((await db.teachingTasks.get(a.id))?.scheduledEndDate).toBe('2026-09-01');
});

it('blocks native drag ghosts on the resize control', async () => {
  await fixture();
  const handle = container.querySelector('[aria-label="调整 课程A 的日期跨度"]') as HTMLElement;
  expect(handle.draggable).toBe(false);
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  await act(async () => handle.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
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

it('connects course center pointer drag to moving and reflow', async () => {
  const { a, b } = await fixture();
  await act(async () => day('1').querySelector('.task-title-drag')!.dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  expect(day('3').querySelector('.calendar-task-bar')?.getAttribute('data-task-id')).toBe(a.id);
  expect(day('1').querySelector('.calendar-task-bar')?.getAttribute('data-task-id')).toBe(b.id);
  expect(container.querySelector('.resize-feedback')?.textContent).toContain('移动预览');
  expect((await db.teachingTasks.get(a.id))?.scheduledStartDate).toBe('2026-09-01');
  await act(async () => day('3').dispatchEvent(pointer('pointerup', 50, 50)));
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

it('moves a whole multi-day course from its middle without changing duration or grab offset', async () => {
  const { a, b } = await fixture();
  await act(async () => resizeTask(a.id, '2026-09-03'));
  await vi.waitFor(() => expect(day('1').querySelector<HTMLElement>('.calendar-task-bar')!.style.getPropertyValue('--task-span')).toBe('3'));
  Object.assign(day('2'), { getBoundingClientRect: () => ({ left: 100, right: 200, top: 0, bottom: 100, width: 100 }) });
  Object.assign(day('3'), { getBoundingClientRect: () => ({ left: 200, right: 300, top: 0, bottom: 100, width: 100 }) });
  const original = day('1').querySelector('.calendar-task-bar')!;
  await act(async () => original.dispatchEvent(pointer('pointerdown', 150, 50)));
  await act(async () => window.dispatchEvent(pointer('pointermove', 250, 50)));
  expect(day('2').querySelector('.calendar-task-bar')?.getAttribute('data-task-id')).toBe(a.id);
  expect(container.querySelector('.resize-feedback')?.textContent).toContain('2026-09-02 · 3 个上课日');
  await act(async () => window.dispatchEvent(pointer('pointerup', 250, 50)));
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledDates).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']));
  expect((await db.teachingTasks.get(b.id))?.scheduledStartDate).toBe('2026-09-01');
});

it('cancels center dragging and rejects holidays without changing the course', async () => {
  const { a } = await fixture();
  const center = () => day('1').querySelector('.task-title-drag')!;
  await act(async () => center().dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('3').dispatchEvent(pointer('pointermove', 50, 50)));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => day('3').dispatchEvent(pointer('pointerup', 50, 50)));
  expect((await db.teachingTasks.get(a.id))?.scheduledStartDate).toBe('2026-09-01');
  await act(async () => center().dispatchEvent(pointer('pointerdown', 10, 10)));
  await act(async () => day('5').dispatchEvent(pointer('pointermove', 50, 50)));
  expect(container.querySelector('.resize-feedback.invalid')?.textContent).toContain('不能安排');
  await act(async () => day('5').dispatchEvent(pointer('pointerup', 50, 50)));
  expect((await db.teachingTasks.get(a.id))?.scheduledStartDate).toBe('2026-09-01');
});

it('supports clicking the course center and choosing a new start date', async () => {
  const { a } = await fixture();
  await act(async () => (day('1').querySelector('.task-title-drag') as HTMLElement).click());
  await act(async () => (day('3') as HTMLElement).click());
  await vi.waitFor(async () => expect((await db.teachingTasks.get(a.id))?.scheduledStartDate).toBe('2026-09-03'));
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
