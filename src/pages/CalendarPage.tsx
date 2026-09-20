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

function DayRow({ day, override, periods, onError }: {
  day: CalendarDay; override?: ScheduleOverride; periods: number[]; onError: (message: string) => void;
}) {
  const save = async (edit: Partial<CalendarDay>) => {
    try {
      await updateCalendarDay(day.projectId, day.date, {
        dayType: edit.dayType ?? day.dayType,
        scheduleWeekday: edit.scheduleWeekday ?? day.scheduleWeekday ?? 5,
        title: edit.title ?? day.title,
        note: edit.note ?? day.note,
      });
      onError('');
    } catch (error) { onError(error instanceof Error ? error.message : '校历保存失败。'); }
  };
  return <tr>
    <td>{day.date}</td><td>{weekdayNames[day.weekday - 1]}</td>
    <td><select aria-label={`${day.date}日期类型`} value={day.dayType} onChange={event => void save({ dayType: event.target.value as DayType })}>{dayTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
    <td>{day.dayType === 'makeup_workday' && <select aria-label={`${day.date}执行课表`} value={day.scheduleWeekday ?? 5} onChange={event => void save({ scheduleWeekday: Number(event.target.value) as Weekday })}>{weekdayNames.map((label, index) => <option key={label} value={index + 1}>{label}课表</option>)}</select>}</td>
    <td><input aria-label={`${day.date}标题`} defaultValue={day.title ?? ''} onBlur={event => { if (event.target.value !== (day.title ?? '')) void save({ title: event.target.value }); }} placeholder="节日或活动名称" /></td>
    <td><input aria-label={`${day.date}备注`} defaultValue={day.note ?? ''} onBlur={event => { if (event.target.value !== (day.note ?? '')) void save({ note: event.target.value }); }} placeholder="备注" /></td>
    <td className="period-cell">{periods.length ? `第 ${periods.join('、')} 节` : '—'}{override && <span className="override-marker">已覆盖</span>}</td>
  </tr>;
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
  const [error, setError] = useState('');
  const activeMonth = month || project?.startDate.slice(0, 7) || '';
  const months = useMemo(() => [...new Set((days ?? []).map(day => day.date.slice(0, 7)))], [days]);
  const monthDays = useMemo(() => (days ?? []).filter(day => day.date.startsWith(activeMonth)), [days, activeMonth]);
  const overrideByDate = useMemo(() => new Map((overrides ?? []).map(row => [row.date, row])), [overrides]);
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量设置失败。'); }
  }

  if (project === undefined || !days || !schedules || !overrides) return <main className="workspace">正在读取校历与课表…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  return <main className="workspace calendar-workspace">
    <Link to={`/projects/${projectId}`} className="back-link">← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>校历与课表</h1><p className="muted">特殊日期、每周固定课时和临时调整自动保存到本机。</p></div><div className="slot-summary"><strong>{slotCount ?? '…'}</strong><span>学期可用课时</span></div></div>
    {error && <p role="alert" className="error page-error">{error}</p>}
    <section className="section-panel calendar-section"><div className="section-heading"><div><h2>每周学科课表</h2><p>填写节次，多个节次用逗号分隔；留空表示当天没有本学科课。</p></div></div><div className="schedule-grid">{([1,2,3,4,5,6,7] as Weekday[]).map(weekday => <CourseRow key={weekday} projectId={projectId} weekday={weekday} periods={schedules.find(row => row.weekday === weekday)?.periods ?? []} onError={setError} />)}</div></section>
    <section className="section-panel calendar-section"><div className="section-heading"><div><h2>逐日校历</h2><p>节假日和停课日无课。调休日按选择的星期课表上课。</p></div><select aria-label="选择月份" value={activeMonth} onChange={event => setMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>{value}</option>)}</select></div><form className="range-form" onSubmit={applyRange}><label>从<input aria-label="范围开始日期" type="date" min={project.startDate} max={project.endDate} value={rangeStart} onChange={event => setRangeStart(event.target.value)} required /></label><label>至<input aria-label="范围结束日期" type="date" min={project.startDate} max={project.endDate} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} required /></label><label>设为<select aria-label="范围日期类型" value={rangeType} onChange={event => setRangeType(event.target.value as DayType)}>{dayTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{rangeType === 'makeup_workday' && <label>执行课表<select aria-label="范围执行课表" value={rangeWeekday} onChange={event => setRangeWeekday(Number(event.target.value) as Weekday)}>{weekdayNames.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>}<label>名称<input aria-label="范围名称" value={rangeTitle} onChange={event => setRangeTitle(event.target.value)} placeholder="例如 国庆节" /></label><button className="button secondary" type="submit">批量设置</button></form><div className="table-scroll"><table className="data-table"><thead><tr><th>日期</th><th>星期</th><th>类型</th><th>执行课表</th><th>名称</th><th>备注</th><th>可用课时</th></tr></thead><tbody>{monthDays.map(day => <DayRow key={day.date} day={day} override={overrideByDate.get(day.date)} periods={availablePeriods(day, schedules, overrideByDate.get(day.date))} onError={setError} />)}</tbody></table></div></section>
    <section className="section-panel calendar-section"><div className="section-heading"><div><h2>指定日期课时调整</h2><p>用空节次取消当天学科课；学校活动或考试日可显式增加课时。</p></div></div><form className="override-form" onSubmit={addOverride}><label>日期<input aria-label="调整日期" type="date" min={project.startDate} max={project.endDate} value={overrideDate} onChange={event => setOverrideDate(event.target.value)} required /></label><label>调整后节次<input aria-label="调整后节次" value={overridePeriods} onChange={event => setOverridePeriods(event.target.value)} placeholder="例如 2, 5；留空为停课" /></label><label>原因<input aria-label="调整原因" value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="例如 学校活动" required /></label><button className="button primary" type="submit">添加调整</button></form>{overrides.length > 0 && <div className="override-list">{overrides.map(row => <div key={row.date} className="override-row"><strong>{row.date}</strong><span>原第 {row.originalPeriods.join('、') || '—'} 节 → 调整后第 {row.actualPeriods.join('、') || '—'} 节</span><span>{row.reason}</span><button className="text-button" onClick={() => void deleteScheduleOverride(projectId, row.date)}>移除</button></div>)}</div>}</section>
  </main>;
}
