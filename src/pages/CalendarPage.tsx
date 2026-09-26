import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { buildTeachingSlots, calendarStatus, type CalendarStatus } from '../core/calendar/availability';
import { orderedWeekdays, weekdayOf } from '../core/calendar/dates';
import { applyCalendarStatusRange, updateCalendarDay } from '../db/repositories/calendar';
import { defaultWeeklyProgressSlots, updateCalendarPreferences, updateWeeklyProgressSlots } from '../db/repositories/projects';
import { db } from '../db/schema';
import type { CalendarDay, Weekday, WeeklyProgressSlot } from '../types/domain';

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

function progressLabel(slot: WeeklyProgressSlot) {
  return slot.weekdays.map(day => weekdayNames[day - 1]).join(' / ');
}

export function CalendarPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const days = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const overrides = useLiveQuery(() => db.scheduleOverrides.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const [month, setMonth] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [makeupWeekday, setMakeupWeekday] = useState<Weekday>(2);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const progressSlots = project?.weeklyProgressSlots ?? defaultWeeklyProgressSlots();
  const merged = progressSlots.find(slot => slot.weekdays.length > 1)?.weekdays ?? [3, 4];
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
  const slotCount = project && days && overrides ? buildTeachingSlots(project.startDate, days, [], overrides, {
    weekStart: project.weekStart ?? 7, weeklyProgressSlots: progressSlots,
  }).length : undefined;
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

  async function changeWeekStart(value: Weekday) {
    try { await updateCalendarPreferences(projectId, value, []); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '一周起始日保存失败。'); }
  }

  async function changeMergedDays(value: string) {
    const start = Number(value) as Weekday; const end = (Number(value) + 1) as Weekday;
    try { await updateWeeklyProgressSlots(projectId, defaultWeeklyProgressSlots([start, end]), db); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '每周教学进度保存失败。'); }
  }

  if (project === undefined || !days || !overrides) return <main className="workspace">正在读取校历与课表…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;

  return <main className="workspace calendar-workspace">
    <Link to={`/projects/${projectId}`} className="back-link">← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>校历与教学安排</h1><p className="muted">先确定每周四个教学进度，再在月历中标记上课、放假和考试。</p></div><div className="slot-summary"><strong>{slotCount ?? '…'}</strong><span>学期可用教学进度</span></div></div>
    {error && <p role="alert" className="error page-error">{error}</p>}
    {notice && <p role="status" className="calendar-notice">{notice}</p>}

    <section className="section-panel calendar-section progress-pattern-section">
      <div className="section-heading"><div><h2>每周 4 个教学进度</h2><p>五个工作日映射为四个计划课时，周三和周四默认使用同一个教学内容。</p></div><div className="progress-settings"><label>合并日期<select value={merged[0]} onChange={event => void changeMergedDays(event.target.value)}><option value="1">周一 / 周二</option><option value="2">周二 / 周三</option><option value="3">周三 / 周四</option><option value="4">周四 / 周五</option></select></label><label>一周开始于<select value={project.weekStart ?? 7} onChange={event => void changeWeekStart(Number(event.target.value) as Weekday)}>{([1,2,3,4,5,6,7] as Weekday[]).map(day => <option key={day} value={day}>{weekdayNames[day - 1]}</option>)}</select></label></div></div>
      <div className="progress-slot-grid">{progressSlots.map((slot, index) => <article className={`progress-slot-card ${slot.weekdays.length > 1 ? 'merged' : ''}`} key={slot.id}><span>计划课时 {index + 1}</span><strong>{progressLabel(slot)}</strong><small>{slot.weekdays.length > 1 ? '两天使用同一个教学进度，合计 1 课时' : '独立教学进度，计 1 课时'}</small></article>)}</div>
      <p className="calendar-preference-hint">修改后会用于下一次生成教学计划，已经确认的历史版本保持不变。</p>
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
        const progressIndex = progressSlots.findIndex(slot => slot.weekdays.includes(effectiveWeekday));
        const inRange = !!rangeStart && date >= rangeStart && date <= (rangeEnd || rangeStart);
        return <button type="button" key={date} className={`term-day ${status} ${selectedDate === date ? 'selected' : ''} ${inRange ? 'in-range' : ''}`} onClick={event => selectCalendarDate(date, event)}><span className="day-number">{dateParts(date).day}</span><span className="day-kind">{statusLabels[status]}</span>{day.title && <strong>{day.title}</strong>}{status === 'teaching' && progressIndex >= 0 && <em>计划课时 {progressIndex + 1}</em>}{day.dayType === 'makeup_workday' && <small>执行{weekdayNames[effectiveWeekday - 1]}安排</small>}{!day.title && status === 'holiday' && <small>{day.weekday >= 6 && day.dayType === 'normal' ? '周末' : '已设为放假'}</small>}</button>;
      })}</div></div>
      <div className="calendar-selection-summary"><span>{rangeStart ? `已选择：${rangeStart}${rangeEnd && rangeEnd !== rangeStart ? ` 至 ${rangeEnd}` : ''}` : '尚未选择日期'}</span><label>周末设为上课时执行<select value={makeupWeekday} onChange={event => setMakeupWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.slice(0, 5).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label></div>
      {selectedDay ? <DayEditor key={`${selectedDay.date}-${selectedDay.dayType}-${selectedDay.scheduleWeekday ?? ''}-${selectedDay.title ?? ''}`} day={selectedDay} onError={setError} /> : <aside className="day-editor empty-day-editor"><strong>选择一个日期</strong><p>点击月历日期后，可使用数字键快速设置状态。</p></aside>}
    </section>
  </main>;
}
