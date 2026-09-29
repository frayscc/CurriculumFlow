import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { calendarStatus, type CalendarStatus } from '../core/calendar/availability';
import { orderedWeekdays, weekdayOf } from '../core/calendar/dates';
import { applyCalendarStatusRange, updateCalendarDay } from '../db/repositories/calendar';
import { createTask } from '../db/repositories/tasks';
import { placeTask, unplaceTask } from '../db/repositories/manualSchedule';
import { db } from '../db/schema';
import type { CalendarDay, TaskType, TeachingTask, Weekday } from '../types/domain';

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

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daySpan(start?: string, end?: string) {
  if (!start || !end) return 1;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

export function CalendarPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const days = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const tasks = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).sortBy('order'), [projectId]);
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

  const activeMonth = month || project?.startDate.slice(0, 7) || '';
  const months = useMemo(() => [...new Set((days ?? []).map(day => day.date.slice(0, 7)))], [days]);
  const dayByDate = useMemo(() => new Map((days ?? []).map(day => [day.date, day])), [days]);
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
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      const status = shortcutStatus[event.key];
      if (!status || (!selectedDate && !rangeStart)) return;
      event.preventDefault(); void applyStatus(status);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
    event.dataTransfer.effectAllowed = mode === 'move' ? 'move' : 'link';
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
        await placeTask(task.id, task.scheduledStartDate, date);
      } else {
        const span = daySpan(task.scheduledStartDate, task.scheduledEndDate);
        await placeTask(task.id, date, addDays(date, span - 1));
      }
      setError(''); setNotice('教学安排已保存为最终版。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '教学安排保存失败。'); }
  }

  async function removePlacement(taskId: string) {
    try { await unplaceTask(taskId); setError(''); setNotice('已移回待安排区。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '取消安排失败。'); }
  }

  async function clickCalendarDate(date: string, event: MouseEvent) {
    if (!stretchingTaskId) return selectCalendarDate(date, event);
    const task = tasks?.find(item => item.id === stretchingTaskId);
    if (!task?.scheduledStartDate) { setStretchingTaskId(''); return; }
    try {
      await placeTask(task.id, task.scheduledStartDate, date);
      setStretchingTaskId(''); setError(''); setNotice(`${task.title} 已延长至 ${date}。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '日期跨度调整失败。'); }
  }

  function chooseStretchEnd(event: MouseEvent, task: TeachingTask) {
    event.stopPropagation(); setStretchingTaskId(task.id); setError('');
    setNotice(`正在调整“${task.title}”：请拖动手柄到结束日期，或直接点击结束日期。`);
  }

  if (project === undefined || !days || !tasks) return <main className="workspace">正在读取校历与教学安排…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;

  return <main className="workspace calendar-workspace">
    <Link to={`/projects/${projectId}`} className="back-link">← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>校历与教学安排</h1><p className="muted">把教学内容拖入上课日；拖动卡片右侧手柄可延长或缩短日期跨度。</p></div></div>
    {error && <p role="alert" className="error page-error">{error}</p>}
    {notice && <p role="status" className="calendar-notice">{notice}</p>}

    <section className="section-panel calendar-section schedule-palette-section">
      <div className="section-heading"><div><h2>待安排教学内容</h2><p>可新增新课、练习、考试等内容，拖入月历后即成为最终安排。</p></div><Link to={`/projects/${projectId}/tasks`}>管理全部内容 →</Link></div>
      <form className="quick-task-form" onSubmit={event => void addContent(event)}><input value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="输入教学内容" required /><select value={newType} onChange={event => setNewType(event.target.value as TaskType)}>{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button secondary" type="submit">新增</button></form>
      <div className="schedule-palette">{tasks.filter(task => !task.scheduledStartDate).map(task => <div className={`schedule-chip ${task.type}`} draggable onDragStart={event => startDrag(event, task, 'move')} key={task.id}><span>{task.title}</span><small>{taskTypeLabels[task.type]} · 拖入月历</small></div>)}{tasks.length > 0 && tasks.every(task => task.scheduledStartDate) && <p className="muted">所有教学内容都已安排。</p>}{tasks.length === 0 && <p className="muted">请先新增一项教学内容。</p>}</div>
    </section>

    <section className="section-panel calendar-section visual-calendar-section">
      <div className="calendar-toolbar"><div><h2>学期月历</h2><p>点击日期后按快捷键；按住 Shift 再点另一个日期可选择连续范围。</p></div><div className="month-switcher"><button type="button" aria-label="上个月" disabled={months.indexOf(activeMonth) <= 0} onClick={() => moveMonth(-1)}>←</button><select aria-label="选择月份" value={activeMonth} onChange={event => { setMonth(event.target.value); setSelectedDate(''); setRangeStart(''); setRangeEnd(''); }}>{months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}</select><button type="button" aria-label="下个月" disabled={months.indexOf(activeMonth) >= months.length - 1} onClick={() => moveMonth(1)}>→</button></div></div>
      <div className="calendar-quickbar"><div className="calendar-legend"><span><i className="legend-dot teaching" />上课</span><span><i className="legend-dot holiday" />放假</span><span><i className="legend-dot exam" />考试</span></div><div className="calendar-shortcuts"><button type="button" onClick={() => void applyStatus('teaching')}><kbd>1</kbd> 上课</button><button type="button" onClick={() => void applyStatus('holiday')}><kbd>2</kbd> 放假</button><button type="button" onClick={() => void applyStatus('exam')}><kbd>3</kbd> 考试</button><button type="button" onClick={() => void applyStatus('default')}><kbd>0</kbd> 恢复默认</button></div></div>
      <div className="term-calendar"><div className="term-weekdays">{calendarWeekdays.map(day => <span key={day}>{weekdayNames[day - 1]}</span>)}</div><div className="term-calendar-grid">{calendarCells.map((date, index) => {
        if (!date) return <span className="term-day blank" key={`blank-${index}`} />;
        const day = dayByDate.get(date);
        if (!day) return <span className="term-day outside" key={date}><span>{dateParts(date).day}</span></span>;
        const status = calendarStatus(day);
        const effectiveWeekday = day.dayType === 'makeup_workday' && day.scheduleWeekday ? day.scheduleWeekday : day.weekday;
        const inRange = !!rangeStart && date >= rangeStart && date <= (rangeEnd || rangeStart);
        const startingTasks = tasks.filter(task => task.scheduledStartDate === date || (index % 7 === 0 && !!task.scheduledStartDate && !!task.scheduledEndDate && task.scheduledStartDate < date && task.scheduledEndDate >= date));
        return <div role="button" tabIndex={0} key={date} className={`term-day ${status} ${selectedDate === date ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${stretchingTaskId ? 'stretch-target' : ''}`} onClick={event => void clickCalendarDate(date, event)} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => void dropOnDate(event, date)}><span className="day-number">{dateParts(date).day}</span><span className="day-kind">{statusLabels[status]}</span>{day.title && <strong>{day.title}</strong>}<div className="day-schedule-items">{startingTasks.map(task => <div className={`calendar-task-bar ${task.type} ${stretchingTaskId === task.id ? 'stretching' : ''}`} style={{ '--task-span': Math.min(daySpan(date, task.scheduledEndDate), 7 - (index % 7)) } as CSSProperties} onClick={event => event.stopPropagation()} key={task.id}><span className="task-title-drag" title="拖动整张卡片" draggable onDragStart={event => startDrag(event, task, 'move')}>{task.title}</span><span className="resize-handle" role="button" tabIndex={0} draggable onDragStart={event => startDrag(event, task, 'resize')} onClick={event => chooseStretchEnd(event, task)} title="拖动或点击后选择结束日期" aria-label={`调整 ${task.title} 的日期跨度`}>❙</span><button type="button" onClick={() => void removePlacement(task.id)} title="移回待安排区" aria-label={`取消安排 ${task.title}`}>×</button></div>)}</div>{day.dayType === 'makeup_workday' && <small>执行{weekdayNames[effectiveWeekday - 1]}安排</small>}{!day.title && status === 'holiday' && <small>{day.weekday >= 6 && day.dayType === 'normal' ? '周末' : '已设为放假'}</small>}</div>;
      })}</div></div>
      <div className="calendar-selection-summary"><span>{rangeStart ? `已选择：${rangeStart}${rangeEnd && rangeEnd !== rangeStart ? ` 至 ${rangeEnd}` : ''}` : '尚未选择日期'}</span><label>周末设为上课时执行<select value={makeupWeekday} onChange={event => setMakeupWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.slice(0, 5).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label></div>
      {selectedDay ? <DayEditor key={`${selectedDay.date}-${selectedDay.dayType}-${selectedDay.scheduleWeekday ?? ''}-${selectedDay.title ?? ''}`} day={selectedDay} onError={setError} /> : <aside className="day-editor empty-day-editor"><strong>选择一个日期</strong><p>点击月历日期后，可使用数字键快速设置状态。</p></aside>}
    </section>
  </main>;
}
