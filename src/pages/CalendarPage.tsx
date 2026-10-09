import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { calendarStatus, type CalendarStatus } from '../core/calendar/availability';
import { orderedWeekdays, weekdayOf } from '../core/calendar/dates';
import { applyCalendarStatusRange, updateCalendarDay } from '../db/repositories/calendar';
import { createTask } from '../db/repositories/tasks';
import { manualScheduleReason, moveTask, normalizeManualTimeline, resizeTask, unplaceTask } from '../db/repositories/manualSchedule';
import { db } from '../db/schema';
import type { CalendarDay, TaskType, TeachingTask, Weekday } from '../types/domain';
import '../calendarDrag.css';

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const statusLabels: Record<CalendarStatus, string> = { teaching: '上课', holiday: '放假', exam: '考试' };
const shortcutStatus: Record<string, CalendarStatus | 'default'> = { '1': 'teaching', '2': 'holiday', '3': 'exam', '0': 'default' };

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function localDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function DayEditor({ day, onError }: { day: CalendarDay; onError: (message: string) => void }) {
  const [status, setStatus] = useState<CalendarStatus>(calendarStatus(day));
  const [scheduleWeekday, setScheduleWeekday] = useState<Weekday>(day.scheduleWeekday ?? 2);
  const [title, setTitle] = useState(day.title ?? '');
  const [note, setNote] = useState(day.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const dayType = status === 'exam' ? 'exam' : status === 'holiday' ? 'holiday' : day.weekday >= 6 ? 'makeup_workday' : 'normal';
      await updateCalendarDay(day.projectId, day.date, {
        dayType, scheduleWeekday: dayType === 'makeup_workday' ? scheduleWeekday : undefined, title, note,
      });
      onError('');
    } catch (caught) { onError(caught instanceof Error ? caught.message : '日期保存失败。'); }
    finally { setBusy(false); }
  }

  return <form className="day-editor" onSubmit={save}>
    <div className="day-editor-heading"><div><span>{day.date} · {weekdayNames[day.weekday - 1]}</span><strong>设置日期状态</strong></div><kbd>{status === 'teaching' ? '1' : status === 'holiday' ? '2' : '3'}</kbd></div>
    <div className="calendar-status-picker">{(['teaching', 'holiday', 'exam'] as CalendarStatus[]).map((value, index) => <button type="button" key={value} className={`calendar-status-button ${value} ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}><span>{index + 1}</span>{statusLabels[value]}</button>)}</div>
    <div className="day-editor-fields">
      {status === 'teaching' && day.weekday >= 6 && <label>执行哪天的教学进度<select value={scheduleWeekday} onChange={event => setScheduleWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.slice(0, 5).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>}
      <label>名称<input value={title} onChange={event => setTitle(event.target.value)} placeholder={status === 'exam' ? '例如 期中考试' : status === 'holiday' ? '例如 中秋节' : '可选'} /></label>
      <label>备注<input value={note} onChange={event => setNote(event.target.value)} placeholder="可选" /></label>
      <button type="submit" className="button primary" disabled={busy}>{busy ? '保存中…' : '保存这一天'}</button>
    </div>
  </form>;
}

const taskTypeLabels: Record<TaskType, string> = { new_lesson: '新课', exercise: '练习', quiz: '检测', exam: '考试', exam_review: '讲评', review: '复习', self_study: '自习', experiment: '实验', special_training: '专项训练', other: '其他' };

export function CalendarPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const days = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const tasks = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  const scheduledLessons = useLiveQuery(async () => {
    const version = await db.planVersions.where('projectId').equals(projectId).filter(row => row.reason === manualScheduleReason).first();
    return version ? db.scheduledLessons.where('planVersionId').equals(version.id).toArray() : [];
  }, [projectId]);
  const [month, setMonth] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [makeupWeekday, setMakeupWeekday] = useState<Weekday>(2);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<TaskType>('new_lesson');
  const [stretchingTaskId, setStretchingTaskId] = useState('');
  const [placingTaskId, setPlacingTaskId] = useState('');
  const [draggingTask, setDraggingTask] = useState(false);
  const upgrading = useRef(false);
  const pointerResize = useRef<{ taskId: string; pointerId: number; x: number; y: number; moved: boolean; element: HTMLElement } | null>(null);
  const calendarGrid = useRef<HTMLDivElement>(null);
  const suppressPointerClick = useRef(false);

  const activeMonth = month || project?.startDate.slice(0, 7) || '';
  const months = useMemo(() => [...new Set((days ?? []).map(day => day.date.slice(0, 7)))], [days]);
  const dayByDate = useMemo(() => new Map((days ?? []).map(day => [day.date, day])), [days]);
  const taskById = useMemo(() => new Map((tasks ?? []).map(task => [task.id, task])), [tasks]);
  const lessonTaskByDate = useMemo(() => new Map((scheduledLessons ?? []).map(lesson => [lesson.date, lesson.taskId])), [scheduledLessons]);
  const calendarCells = useMemo(() => {
    if (!activeMonth) return [] as Array<string | null>;
    const [year, monthNumber] = activeMonth.split('-').map(Number);
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const firstDate = localDate(year, monthNumber, 1);
    const weekStart = project?.weekStart ?? 7;
    const cells: Array<string | null> = Array((weekdayOf(firstDate) - weekStart + 7) % 7).fill(null);
    for (let day = 1; day <= count; day++) cells.push(localDate(year, monthNumber, day));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [activeMonth, project?.weekStart]);
  const calendarWeekdays = orderedWeekdays(project?.weekStart ?? 7);
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;

  async function applyStatus(status: CalendarStatus | 'default') {
    const start = rangeStart || selectedDate; const end = rangeEnd || start;
    if (!start || !end) return;
    try {
      await applyCalendarStatusRange(projectId, start, end, status, makeupWeekday);
      setError(''); setNotice(`${start === end ? start : `${start} 至 ${end}`} 已设置为${status === 'default' ? '默认状态' : statusLabels[status]}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '日期状态保存失败。'); }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { pointerResize.current = null; setDraggingTask(false); setStretchingTaskId(''); setPlacingTaskId(''); setNotice(''); return; }
      if (stretchingTaskId || placingTaskId) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      const status = shortcutStatus[event.key];
      if (!status || (!selectedDate && !rangeStart)) return;
      event.preventDefault(); void applyStatus(status);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const finishDrag = () => setDraggingTask(false);
    window.addEventListener('dragend', finishDrag);
    return () => window.removeEventListener('dragend', finishDrag);
  }, []);

  useEffect(() => {
    function targetDate(event: globalThis.PointerEvent) {
      // A wide bar belongs to its first day in the DOM. Hit-test the date cells,
      // not the bar, so pointer capture and overlapping segments cannot lie.
      const cells = [...(calendarGrid.current?.querySelectorAll<HTMLElement>('[data-calendar-date]') ?? [])];
      for (const cell of cells) {
        const bounds = cell.getBoundingClientRect();
        if (event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom) return cell.dataset.calendarDate;
      }
      if (cells.some(cell => cell.getBoundingClientRect().width > 0)) return undefined;
      const target = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
      return target instanceof Element ? target.closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate : undefined;
    }
    function move(event: globalThis.PointerEvent) {
      const current = pointerResize.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
      current.moved = true;
      setDraggingTask(true);
      if (event.cancelable) event.preventDefault();
    }
    function finish(event: globalThis.PointerEvent) {
      const current = pointerResize.current;
      if (!current || event.pointerId !== current.pointerId) return;
      pointerResize.current = null;
      if (current.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
      setDraggingTask(false);
      if (!current.moved) return;
      suppressPointerClick.current = true;
      const date = targetDate(event);
      if (!date) { setNotice('已取消跨度调整：请在月历日期内松开手柄。'); return; }
      void resizeTask(current.taskId, date).then(() => {
        setStretchingTaskId(''); setError(''); setNotice(`结束日期已调整为 ${date}，后续安排已重排。`);
      }).catch(caught => setError(caught instanceof Error ? caught.message : '跨度调整失败。'));
    }
    function cancel() {
      const current = pointerResize.current;
      pointerResize.current = null;
      if (current?.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
      setDraggingTask(false);
    }
    window.addEventListener('pointermove', move, { passive: false, capture: true });
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  function startPointerResize(event: PointerEvent<HTMLElement>, task: TeachingTask) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    suppressPointerClick.current = false;
    pointerResize.current = { taskId: task.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, element: event.currentTarget };
    setStretchingTaskId('');
    setPlacingTaskId('');
  }

  useEffect(() => {
    if (!tasks || !scheduledLessons) return;
    const dates = scheduledLessons.map(lesson => lesson.date);
    const needsUpgrade = tasks.some(task => task.scheduledStartDate && !task.scheduledDates) || new Set(dates).size !== dates.length;
    if (needsUpgrade && !upgrading.current) {
      upgrading.current = true;
      void normalizeManualTimeline(projectId).catch(caught => setError(caught instanceof Error ? caught.message : '旧版教学安排迁移失败。')).finally(() => { upgrading.current = false; });
    }
  }, [projectId, scheduledLessons, tasks]);

  function selectCalendarDate(date: string, event: MouseEvent) {
    if (!dayByDate.has(date)) return;
    setSelectedDate(date); setNotice('');
    if (event.shiftKey && (rangeStart || selectedDate)) {
      const anchor = rangeStart || selectedDate;
      setRangeStart(date < anchor ? date : anchor); setRangeEnd(date < anchor ? anchor : date);
    } else { setRangeStart(date); setRangeEnd(date); }
  }

  function moveMonth(direction: -1 | 1) {
    const next = months[months.indexOf(activeMonth) + direction];
    if (next) { setMonth(next); setSelectedDate(''); setRangeStart(''); setRangeEnd(''); }
  }

  async function addContent(event: FormEvent) {
    event.preventDefault();
    try { await createTask(projectId, { title: newTitle, type: newType }); setNewTitle(''); setError(''); setNotice('教学内容已添加，请拖到月历中。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '教学内容添加失败。'); }
  }

  function startDrag(event: DragEvent, task: TeachingTask, mode: 'move' | 'resize') {
    event.stopPropagation();
    setDraggingTask(true);
    setStretchingTaskId('');
    setPlacingTaskId('');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-curriculumflow-task', JSON.stringify({ taskId: task.id, mode }));
  }

  async function dropOnDate(event: DragEvent, date: string) {
    event.preventDefault(); event.stopPropagation();
    try {
      const raw = event.dataTransfer.getData('application/x-curriculumflow-task');
      if (!raw) return;
      const data = JSON.parse(raw) as { taskId: string; mode: 'move' | 'resize' };
      const task = tasks?.find(item => item.id === data.taskId);
      if (!task) return;
      if (data.mode === 'resize') {
        if (!task.scheduledStartDate) throw new Error('请先把这项内容拖入月历。');
        await resizeTask(task.id, date);
      } else {
        await moveTask(task.id, date);
      }
      setError(''); setNotice(data.mode === 'resize' ? '跨度已调整，后续内容已自动顺延。' : '内容已插入时间轴，后续内容已自动重排。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '教学安排保存失败。'); }
    finally { setDraggingTask(false); }
  }

  async function removePlacement(taskId: string) {
    try { await unplaceTask(taskId); setError(''); setNotice('已移回待安排区。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '取消安排失败。'); }
  }

  async function clickCalendarDate(date: string, event: MouseEvent) {
    if (placingTaskId) {
      try {
        await moveTask(placingTaskId, date);
        setPlacingTaskId(''); setError(''); setNotice('内容已插入，后续安排已顺延。');
      } catch (caught) { setError(caught instanceof Error ? caught.message : '插入失败。'); }
      return;
    }
    if (!stretchingTaskId) return selectCalendarDate(date, event);
    const task = tasks?.find(item => item.id === stretchingTaskId);
    if (!task?.scheduledStartDate) { setStretchingTaskId(''); return; }
    try {
      await resizeTask(task.id, date);
      setStretchingTaskId(''); setError(''); setNotice(`${task.title} 的结束日期已调整为 ${date}。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '日期跨度调整失败。'); }
  }

  function chooseStretchEnd(event: MouseEvent, task: TeachingTask) {
    event.stopPropagation(); setStretchingTaskId(task.id); setError('');
    setPlacingTaskId('');
    setNotice(`正在调整“${task.title}”：请拖动手柄到结束日期，或直接点击结束日期。`);
  }

  if (project === undefined || !days || !tasks || !scheduledLessons) return <main className="workspace">正在读取校历与教学安排…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;

  return <main className="workspace calendar-workspace" onClickCapture={event => { if (suppressPointerClick.current) { suppressPointerClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <Link to={`/projects/${projectId}`} className="back-link">← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>校历与教学安排</h1><p className="muted">像剪辑时间轴一样编排：插入或移动内容会自动重排后续内容，拖动右侧手柄可调整跨度。</p></div></div>
    {error && <p role="alert" className="error page-error">{error}</p>}
    {notice && <p role="status" className="calendar-notice">{notice}</p>}

    <section className="section-panel calendar-section schedule-palette-section">
      <div className="section-heading"><div><h2>待安排教学内容</h2><p>拖到某一天即从当天插入；该日及之后的内容顺延，之前的安排保留。</p></div><Link to={`/projects/${projectId}/tasks`}>管理全部内容 →</Link></div>
      <form className="quick-task-form" onSubmit={event => void addContent(event)}><input value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="输入教学内容" required /><select value={newType} onChange={event => setNewType(event.target.value as TaskType)}>{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button secondary" type="submit">新增</button></form>
      <div className="schedule-palette">{tasks.filter(task => !task.scheduledStartDate).map(task => <div role="button" tabIndex={0} aria-pressed={placingTaskId === task.id} className={`schedule-chip ${task.type}`} draggable onDragStart={event => startDrag(event, task, 'move')} onClick={() => { setPlacingTaskId(task.id); setStretchingTaskId(''); setNotice(`请选择“${task.title}”的插入日期，按 Esc 取消。`); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }} key={task.id}><span>{task.title}</span><small>{taskTypeLabels[task.type]} · 拖入或点击后选日期</small></div>)}{tasks.length > 0 && tasks.every(task => task.scheduledStartDate) && <p className="muted">所有教学内容都已安排。</p>}{tasks.length === 0 && <p className="muted">请先新增一项教学内容。</p>}</div>
    </section>

    <section className="section-panel calendar-section visual-calendar-section">
      <div className="calendar-toolbar"><div><h2>学期月历</h2><p>点击日期后按快捷键；按住 Shift 再点另一个日期可选择连续范围。</p></div><div className="month-switcher"><button type="button" aria-label="上个月" disabled={months.indexOf(activeMonth) <= 0} onClick={() => moveMonth(-1)}>←</button><select aria-label="选择月份" value={activeMonth} onChange={event => { setMonth(event.target.value); setSelectedDate(''); setRangeStart(''); setRangeEnd(''); }}>{months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}</select><button type="button" aria-label="下个月" disabled={months.indexOf(activeMonth) >= months.length - 1} onClick={() => moveMonth(1)}>→</button></div></div>
      <div className="calendar-quickbar"><div className="calendar-legend"><span><i className="legend-dot teaching" />上课</span><span><i className="legend-dot holiday" />放假</span><span><i className="legend-dot exam" />考试</span></div><div className="calendar-shortcuts"><button type="button" onClick={() => void applyStatus('teaching')}><kbd>1</kbd> 上课</button><button type="button" onClick={() => void applyStatus('holiday')}><kbd>2</kbd> 放假</button><button type="button" onClick={() => void applyStatus('exam')}><kbd>3</kbd> 考试</button><button type="button" onClick={() => void applyStatus('default')}><kbd>0</kbd> 恢复默认</button></div></div>
      <div className={`term-calendar ${draggingTask ? 'is-dragging' : ''} ${stretchingTaskId || placingTaskId ? 'is-stretching' : ''}`}><div className="term-weekdays">{calendarWeekdays.map(day => <span key={day}>{weekdayNames[day - 1]}</span>)}</div><div className="term-calendar-grid" ref={calendarGrid}>{calendarCells.map((date, index) => {
        if (!date) return <span className="term-day blank" key={`blank-${index}`} />;
        const day = dayByDate.get(date);
        if (!day) return <span className="term-day outside" key={date}><span>{dateParts(date).day}</span></span>;
        const status = calendarStatus(day);
        const effectiveWeekday = day.dayType === 'makeup_workday' && day.scheduleWeekday ? day.scheduleWeekday : day.weekday;
        const inRange = !!rangeStart && date >= rangeStart && date <= (rangeEnd || rangeStart);
        const taskId = lessonTaskByDate.get(date);
        const previousDate = index > 0 ? calendarCells[index - 1] : null;
        const startsSegment = !!taskId && (index % 7 === 0 || !previousDate || lessonTaskByDate.get(previousDate) !== taskId);
        const startingTask = startsSegment ? taskById.get(taskId) : undefined;
        let segmentSpan = 1;
        while (startingTask && segmentSpan < 7 - (index % 7)) {
          const nextDate = calendarCells[index + segmentSpan];
          if (!nextDate || lessonTaskByDate.get(nextDate) !== taskId) break;
          segmentSpan += 1;
        }
        return <div role="button" tabIndex={0} key={date} data-calendar-date={date} className={`term-day ${status} ${selectedDate === date ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${stretchingTaskId ? 'stretch-target' : ''}`}
          onClick={event => void clickCalendarDate(date, event)}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => void dropOnDate(event, date)}>
          <span className="day-number">{dateParts(date).day}</span><span className="day-kind">{statusLabels[status]}</span>{day.title && <strong>{day.title}</strong>}
          <div className="day-schedule-items">{startingTask && <div className={`calendar-task-bar ${startingTask.type} ${stretchingTaskId === startingTask.id ? 'stretching' : ''}`} style={{ '--task-span': segmentSpan } as CSSProperties} onClick={event => event.stopPropagation()}>
            <span className="task-title-drag" title="拖动整张卡片" draggable onDragStart={event => startDrag(event, startingTask, 'move')}>{startingTask.title}</span>
            <span className="resize-handle" role="button" tabIndex={0} draggable={false} onDragStart={event => event.preventDefault()} onPointerDown={event => startPointerResize(event, startingTask)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); event.currentTarget.click(); } }}
              onClick={event => chooseStretchEnd(event, startingTask)} title="拖动或点击后选择结束日期" aria-label={`调整 ${startingTask.title} 的日期跨度`}>❙</span>
            <button type="button" onClick={() => void removePlacement(startingTask.id)} title="移回待安排区" aria-label={`取消安排 ${startingTask.title}`}>×</button>
          </div>}</div>
          {day.dayType === 'makeup_workday' && <small>执行{weekdayNames[effectiveWeekday - 1]}安排</small>}
          {!day.title && status === 'holiday' && <small>{day.weekday >= 6 && day.dayType === 'normal' ? '周末' : '已设为放假'}</small>}
        </div>;
      })}</div></div>
      <div className="calendar-selection-summary"><span>{rangeStart ? `已选择：${rangeStart}${rangeEnd && rangeEnd !== rangeStart ? ` 至 ${rangeEnd}` : ''}` : '尚未选择日期'}</span><label>周末设为上课时执行<select value={makeupWeekday} onChange={event => setMakeupWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.slice(0, 5).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label></div>
      {selectedDay ? <DayEditor key={`${selectedDay.date}-${selectedDay.dayType}-${selectedDay.scheduleWeekday ?? ''}-${selectedDay.title ?? ''}`} day={selectedDay} onError={setError} /> : <aside className="day-editor empty-day-editor"><strong>选择一个日期</strong><p>点击月历日期后，可使用数字键快速设置状态。</p></aside>}
    </section>
  </main>;
}
