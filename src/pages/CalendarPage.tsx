import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { availablePeriods, buildTeachingSlots, parsePeriods } from '../core/calendar/availability';
import { applyCalendarRange, deleteScheduleOverride, setCourseSchedule, setScheduleOverride, updateCalendarDay } from '../db/repositories/calendar';
import { db } from '../db/schema';
import type { CalendarDay, DayType, ScheduleOverride, Weekday } from '../types/domain';

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const dayTypes: Array<[DayType, string]> = [
  ['normal', '正常'], ['holiday', '节假日'], ['makeup_workday', '调休上课'],
  ['school_event', '学校活动'], ['exam', '考试'], ['unavailable', '停课'],
];

function CourseRow({ projectId, weekday, periods, onError }: {
  projectId: string; weekday: Weekday; periods: number[]; onError: (message: string) => void;
}) {
  const [text, setText] = useState(periods.join(', '));
  async function save() {
    try { await setCourseSchedule(projectId, weekday, parsePeriods(text)); onError(''); }
    catch (error) { onError(error instanceof Error ? error.message : '课表保存失败。'); }
  }
  return <label className="schedule-row"><span>{weekdayNames[weekday - 1]}</span><input aria-label={`${weekdayNames[weekday - 1]}节次`} value={text} onChange={event => setText(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} placeholder="例如 1, 3" /></label>;
}

function DayEditor({ day, override, periods, onError }: {
  day: CalendarDay; override?: ScheduleOverride; periods: number[]; onError: (message: string) => void;
}) {
  const [dayType, setDayType] = useState(day.dayType);
  const [scheduleWeekday, setScheduleWeekday] = useState<Weekday>(day.scheduleWeekday ?? 5);
  const [title, setTitle] = useState(day.title ?? '');
  const [note, setNote] = useState(day.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateCalendarDay(day.projectId, day.date, {
        dayType,
        scheduleWeekday: dayType === 'makeup_workday' ? scheduleWeekday : undefined,
        title,
        note,
      });
      onError('');
    } catch (error) { onError(error instanceof Error ? error.message : '校历保存失败。'); }
    finally { setBusy(false); }
  };
  return <aside className="day-editor"><div className="day-editor-heading"><div><span>{day.date} · {weekdayNames[day.weekday - 1]}</span><strong>{day.title || dayTypes.find(([value]) => value === day.dayType)?.[1]}</strong></div><div className="period-summary">{periods.length ? `可用：第 ${periods.join('、')} 节` : '当天无课'}{override && <span className="override-marker">已覆盖</span>}</div></div>
    <div className="day-type-picker" role="group" aria-label={`${day.date}日期类型`}>{dayTypes.map(([value, label]) => <button type="button" key={value} className={`day-type-button ${dayType === value ? `active ${value}` : ''}`} onClick={() => setDayType(value)}>{label}</button>)}</div>
    <div className="day-editor-fields">{dayType === 'makeup_workday' && <label>执行课表<select value={scheduleWeekday} onChange={event => setScheduleWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.map((label, index) => <option key={label} value={index + 1}>{label}课表</option>)}</select></label>}<label>名称<input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如 国庆节、运动会" /></label><label>备注<input value={note} onChange={event => setNote(event.target.value)} placeholder="可选" /></label><button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存这一天'}</button></div>
  </aside>;
}

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function localDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function CalendarPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const days = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const schedules = useLiveQuery(() => db.courseSchedules.where('projectId').equals(projectId).toArray(), [projectId]);
  const overrides = useLiveQuery(() => db.scheduleOverrides.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const [month, setMonth] = useState('');
  const [overrideDate, setOverrideDate] = useState('');
  const [overridePeriods, setOverridePeriods] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeType, setRangeType] = useState<DayType>('holiday');
  const [rangeTitle, setRangeTitle] = useState('');
  const [rangeWeekday, setRangeWeekday] = useState<Weekday>(5);
  const [selectedDate, setSelectedDate] = useState('');
  const [pickingRange, setPickingRange] = useState(false);
  const [error, setError] = useState('');
  const activeMonth = month || project?.startDate.slice(0, 7) || '';
  const months = useMemo(() => [...new Set((days ?? []).map(day => day.date.slice(0, 7)))], [days]);
  const dayByDate = useMemo(() => new Map((days ?? []).map(day => [day.date, day])), [days]);
  const overrideByDate = useMemo(() => new Map((overrides ?? []).map(row => [row.date, row])), [overrides]);
  const calendarCells = useMemo(() => {
    if (!activeMonth) return [] as Array<string | null>;
    const [year, monthNumber] = activeMonth.split('-').map(Number);
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const mondayOffset = (firstWeekday + 6) % 7;
    const cells: Array<string | null> = Array(mondayOffset).fill(null);
    for (let day = 1; day <= count; day++) cells.push(localDate(year, monthNumber, day));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [activeMonth]);
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;
  const slotCount = project && days && schedules && overrides ? buildTeachingSlots(project.startDate, days, schedules, overrides).length : undefined;

  async function addOverride(event: FormEvent) {
    event.preventDefault();
    try {
      await setScheduleOverride(projectId, overrideDate, parsePeriods(overridePeriods), overrideReason);
      setOverrideDate(''); setOverridePeriods(''); setOverrideReason(''); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '课时调整失败。'); }
  }

  async function applyRange(event: FormEvent) {
    event.preventDefault();
    try {
      await applyCalendarRange(projectId, rangeStart, rangeEnd, {
        dayType: rangeType, title: rangeTitle,
        scheduleWeekday: rangeType === 'makeup_workday' ? rangeWeekday : undefined,
      });
      setRangeStart(''); setRangeEnd(''); setRangeTitle(''); setError('');
      setPickingRange(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量设置失败。'); }
  }

  function selectCalendarDate(date: string) {
    if (!dayByDate.has(date)) return;
    setSelectedDate(date);
    if (!pickingRange) return;
    if (!rangeStart || rangeEnd) {
      setRangeStart(date); setRangeEnd('');
    } else {
      setRangeStart(date < rangeStart ? date : rangeStart);
      setRangeEnd(date < rangeStart ? rangeStart : date);
    }
  }

  function moveMonth(direction: -1 | 1) {
    const index = months.indexOf(activeMonth);
    const next = months[index + direction];
    if (next) { setMonth(next); setSelectedDate(''); }
  }

  if (project === undefined || !days || !schedules || !overrides) return <main className="workspace">正在读取校历与课表…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  return <main className="workspace calendar-workspace">
    <Link to={`/projects/${projectId}`} className="back-link">← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>校历与课表</h1><p className="muted">特殊日期、每周固定课时和临时调整自动保存到本机。</p></div><div className="slot-summary"><strong>{slotCount ?? '…'}</strong><span>学期可用课时</span></div></div>
    {error && <p role="alert" className="error page-error">{error}</p>}
    <section className="section-panel calendar-section"><div className="section-heading"><div><h2>每周学科课表</h2><p>填写节次，多个节次用逗号分隔；留空表示当天没有本学科课。</p></div></div><div className="schedule-grid">{([1,2,3,4,5,6,7] as Weekday[]).map(weekday => <CourseRow key={weekday} projectId={projectId} weekday={weekday} periods={schedules.find(row => row.weekday === weekday)?.periods ?? []} onError={setError} />)}</div></section>
    <section className="section-panel calendar-section visual-calendar-section">
      <div className="calendar-toolbar"><div><h2>学期校历</h2><p>点击某一天进行标注；开启“选择日期范围”后，再依次点击开始和结束日期。</p></div><div className="month-switcher"><button type="button" aria-label="上个月" disabled={months.indexOf(activeMonth) <= 0} onClick={() => moveMonth(-1)}>←</button><select aria-label="选择月份" value={activeMonth} onChange={event => { setMonth(event.target.value); setSelectedDate(''); }}>{months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}</select><button type="button" aria-label="下个月" disabled={months.indexOf(activeMonth) >= months.length - 1} onClick={() => moveMonth(1)}>→</button></div></div>
      <div className="calendar-legend">{dayTypes.map(([value, label]) => <span key={value}><i className={`legend-dot ${value}`} />{label}</span>)}</div>
      <div className="term-calendar"><div className="term-weekdays">{weekdayNames.map(name => <span key={name}>{name}</span>)}</div><div className="term-calendar-grid">{calendarCells.map((date, index) => {
        if (!date) return <span className="term-day blank" key={`blank-${index}`} />;
        const day = dayByDate.get(date);
        const isRange = !!rangeStart && date >= rangeStart && date <= (rangeEnd || rangeStart);
        if (!day) return <span className="term-day outside" key={date}><span>{dateParts(date).day}</span></span>;
        const periods = availablePeriods(day, schedules, overrideByDate.get(date));
        return <button type="button" key={date} className={`term-day ${day.dayType} ${selectedDate === date ? 'selected' : ''} ${isRange ? 'in-range' : ''}`} onClick={() => selectCalendarDate(date)}><span className="day-number">{dateParts(date).day}</span><span className="day-kind">{dayTypes.find(([value]) => value === day.dayType)?.[1]}</span>{day.title && <strong>{day.title}</strong>}<small>{periods.length ? `${periods.length} 课时` : '无课'}{overrideByDate.has(date) ? ' · 已调整' : ''}</small></button>;
      })}</div></div>
      <div className="calendar-edit-layout"><form className={`range-form calendar-range-form ${pickingRange ? 'picking' : ''}`} onSubmit={applyRange}><div className="range-form-heading"><strong>批量标注</strong><button type="button" className={`button ${pickingRange ? 'primary' : 'secondary'}`} onClick={() => { setPickingRange(value => !value); setRangeStart(''); setRangeEnd(''); }}>{pickingRange ? '正在选择日期…' : '选择日期范围'}</button></div><label>从<input aria-label="范围开始日期" type="date" min={project.startDate} max={project.endDate} value={rangeStart} onChange={event => setRangeStart(event.target.value)} required /></label><label>至<input aria-label="范围结束日期" type="date" min={project.startDate} max={project.endDate} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} required /></label><label>设为<select aria-label="范围日期类型" value={rangeType} onChange={event => setRangeType(event.target.value as DayType)}>{dayTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{rangeType === 'makeup_workday' && <label>执行课表<select aria-label="范围执行课表" value={rangeWeekday} onChange={event => setRangeWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>}<label>名称<input aria-label="范围名称" value={rangeTitle} onChange={event => setRangeTitle(event.target.value)} placeholder="例如 国庆节" /></label><button className="button primary" type="submit">应用到所选日期</button></form>{selectedDay ? <DayEditor key={selectedDay.date} day={selectedDay} override={overrideByDate.get(selectedDay.date)} periods={availablePeriods(selectedDay, schedules, overrideByDate.get(selectedDay.date))} onError={setError} /> : <aside className="day-editor empty-day-editor"><strong>选择一个日期</strong><p>点击上方日历中的日期，即可设置节假日、调休、考试、活动或停课。</p></aside>}</div>
    </section>
    <section className="section-panel calendar-section"><div className="section-heading"><div><h2>指定日期课时调整</h2><p>用空节次取消当天学科课；学校活动或考试日可显式增加课时。</p></div></div><form className="override-form" onSubmit={addOverride}><label>日期<input aria-label="调整日期" type="date" min={project.startDate} max={project.endDate} value={overrideDate} onChange={event => setOverrideDate(event.target.value)} required /></label><label>调整后节次<input aria-label="调整后节次" value={overridePeriods} onChange={event => setOverridePeriods(event.target.value)} placeholder="例如 2, 5；留空为停课" /></label><label>原因<input aria-label="调整原因" value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="例如 学校活动" required /></label><button className="button primary" type="submit">添加调整</button></form>{overrides.length > 0 && <div className="override-list">{overrides.map(row => <div key={row.date} className="override-row"><strong>{row.date}</strong><span>原第 {row.originalPeriods.join('、') || '—'} 节 → 调整后第 {row.actualPeriods.join('、') || '—'} 节</span><span>{row.reason}</span><button className="text-button" onClick={() => void deleteScheduleOverride(projectId, row.date)}>移除</button></div>)}</div>}</section>
  </main>;
}
