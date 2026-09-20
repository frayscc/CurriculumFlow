import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { dateFromTimestamp, parseLocalDate } from '../core/calendar/dates';
import { compactTitles } from '../core/plan/summary';
import { buildScheduledWeeks, type DraftLesson } from '../core/scheduler';
import { confirmScheduleDraft, createRescheduleDraft, createScheduleDraft, type ScheduleDraft } from '../db/repositories/plans';
import { db } from '../db/schema';
import type { ScheduledLesson } from '../types/domain';

function countMoved(current: ScheduledLesson[], draft: DraftLesson[]) {
  const old = new Map(current.map(lesson => [`${lesson.taskId}:${lesson.taskPeriodIndex}`, `${lesson.date}:${lesson.period}`]));
  return draft.filter(lesson => old.get(`${lesson.taskId}:${lesson.taskPeriodIndex}`) !== `${lesson.date}:${lesson.period}`).length;
}

export function PlanPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const tasks = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  const versions = useLiveQuery(() => db.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).toArray(), [projectId]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [reason, setReason] = useState('');
  const [view, setView] = useState<'week' | 'calendar'>('week');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const currentVersion = versions?.at(-1);
  const selectedVersion = versions?.find(version => version.id === selectedId) ?? currentVersion;
  const savedLessons = useLiveQuery(
    () => selectedVersion ? db.scheduledLessons.where('planVersionId').equals(selectedVersion.id).toArray() : Promise.resolve([] as ScheduledLesson[]),
    [selectedVersion?.id],
  );
  const currentLessons = useLiveQuery(
    () => currentVersion ? db.scheduledLessons.where('planVersionId').equals(currentVersion.id).toArray() : Promise.resolve([] as ScheduledLesson[]),
    [currentVersion?.id],
  );

  async function generate() {
    setBusy(true); setError('');
    try { setDraft(await createScheduleDraft(projectId)); setReason(currentVersion ? '教学进度调整' : '开学初计划'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '生成排课草案失败。'); }
    finally { setBusy(false); }
  }
  async function generateAfterPostponement() {
    setBusy(true); setError('');
    try { setDraft(await createRescheduleDraft(projectId)); setReason('延期后顺延'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '重新计算失败。'); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const version = await confirmScheduleDraft(projectId, draft, reason);
      setSelectedId(version.id); setDraft(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '确认计划失败。'); }
    finally { setBusy(false); }
  }

  if (project === undefined || !tasks || !versions || !savedLessons || !currentLessons) return <main className="workspace">正在读取教学计划…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;

  const lessonRows: DraftLesson[] = draft ? draft.result.lessons : savedLessons;
  const sortedLessons = [...lessonRows].sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  const weeks = draft ? draft.result.weeks : buildScheduledWeeks(project, sortedLessons);
  const taskTitles = new Map(tasks.map(task => [task.id, task.title]));
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const snapshotTitles = new Map(savedLessons.map(lesson => [lesson.taskId, lesson.taskTitle]));
  const titleOf = (lesson: DraftLesson) => draft ? (taskTitles.get(lesson.taskId) ?? lesson.taskId) : (snapshotTitles.get(lesson.taskId) ?? lesson.taskId);
  const weekTitle = (ids: string[]) => compactTitles(ids.map(id => draft ? (taskTitles.get(id) ?? id) : (snapshotTitles.get(id) ?? id)));
  const byDate = new Map<string, DraftLesson[]>();
  for (const lesson of sortedLessons) byDate.set(lesson.date, [...(byDate.get(lesson.date) ?? []), lesson]);

  return <main className="workspace plan-workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link>
    <div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>教学计划</h1><p className="muted">由校历、学科课表和任务队列计算；确认后形成不可变计划版本。</p></div><div className="header-actions">{currentVersion && <button className="button secondary" onClick={() => void generateAfterPostponement()} disabled={busy}>延期后顺延</button>}<button className="button primary" onClick={() => void generate()} disabled={busy || tasks.length === 0}>{busy ? '计算中…' : currentVersion ? '全部重新排程' : '生成排课草案'}</button></div></div>
    {error && <p className="error page-error" role="alert">{error}</p>}
    {tasks.length === 0 && <div className="empty-state"><h2>先录入教学任务</h2><p>排课需要有顺序的教学任务和预计课时。</p><Link className="button primary" to={`/projects/${projectId}/tasks`}>打开任务队列</Link></div>}
    {draft && <section className="section-panel plan-draft"><div className="draft-heading"><h2>排课草案</h2><span>{draft.result.lessons.length} / {draft.result.slots.length} 个课时已安排</span></div>
      {currentVersion && <p className="muted">与 V{currentVersion.version} 相比，{countMoved(currentLessons, draft.result.lessons)} 个课时的位置发生变化或新加入。</p>}
      {draft.kind === 'reflow' && <p className="muted">从 {draft.cutoff} 的延期课次开始顺延；已完成课次和此前计划保留在新版本中。</p>}
      {currentVersion && <div className="table-scroll"><table className="data-table"><thead><tr><th>教学内容</th><th>原计划</th><th>调整后</th></tr></thead><tbody>{draft.result.lessons.filter(lesson => currentLessons.find(old => old.taskId === lesson.taskId && old.taskPeriodIndex === lesson.taskPeriodIndex)?.date !== lesson.date || currentLessons.find(old => old.taskId === lesson.taskId && old.taskPeriodIndex === lesson.taskPeriodIndex)?.period !== lesson.period).map(lesson => { const old = currentLessons.find(item => item.taskId === lesson.taskId && item.taskPeriodIndex === lesson.taskPeriodIndex); return <tr key={`${lesson.taskId}:${lesson.taskPeriodIndex}`}><td>{tasksById.get(lesson.taskId)?.title ?? lesson.taskId} · 第{lesson.taskPeriodIndex}课时</td><td>{old ? `${old.date} 第${old.period}节` : '新增'}</td><td>{lesson.date} 第{lesson.period}节</td></tr>; })}</tbody></table></div>}
      {draft.result.conflicts.length > 0 && <div className="conflict-list">{draft.result.conflicts.map((conflict, index) => <p key={`${conflict.code}-${index}`}>⚠ {conflict.message}</p>)}</div>}
      {draft.result.unscheduled.length > 0 && <p className="error">还有 {draft.result.unscheduled.reduce((sum, item) => sum + item.remainingPeriods, 0)} 课时未排入，请调整任务或课表后重新生成。</p>}
      <div className="draft-actions"><label>版本原因 <input value={reason} onChange={event => setReason(event.target.value)} placeholder="例如 开学初计划" /></label><button className="button secondary" onClick={() => setDraft(null)}>放弃草案</button><button className="button primary" onClick={() => void confirm()} disabled={busy || !reason.trim() || draft.result.conflicts.length > 0 || draft.result.unscheduled.length > 0}>确认并保存新版本</button></div>
    </section>}
    {!draft && versions.length > 0 && <div className="plan-controls"><label>计划版本 <select value={selectedVersion?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>V{version.version} · {version.reason} · {new Date(version.createdAt).toLocaleDateString('zh-CN')}</option>)}</select></label><span>历史版本只读保存</span></div>}
    {(draft || selectedVersion) && <section className="section-panel"><div className="view-tabs"><button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>周计划</button><button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>日历</button></div>
      {view === 'week' ? <div className="table-scroll"><table className="data-table plan-table"><thead><tr><th>周次</th><th>日期</th><th>工作安排</th><th>课时</th></tr></thead><tbody>{weeks.map(week => <tr key={week.weekNumber}><td>第 {week.weekNumber} 周</td><td>{week.startDate} 至 {week.endDate}</td><td>{weekTitle(week.taskIds) || '—'}<div className="week-exam-links">{week.taskIds.flatMap(id => { const task = tasksById.get(id); return task?.examId ? [<Link key={id} to={`/projects/${projectId}/exams/${task.examId}`}>📎 {task.title} 考试资源</Link>] : []; })}</div></td><td>{week.lessonCount}</td></tr>)}</tbody></table></div> : <div className="calendar-grid"><div className="calendar-weekday">日</div><div className="calendar-weekday">一</div><div className="calendar-weekday">二</div><div className="calendar-weekday">三</div><div className="calendar-weekday">四</div><div className="calendar-weekday">五</div><div className="calendar-weekday">六</div>{weeks.flatMap(week => {
        const start = parseLocalDate(week.startDate);
        const sunday = start - new Date(start).getUTCDay() * 86_400_000;
        return Array.from({ length: 7 }, (_, index) => {
          const date = dateFromTimestamp(sunday + index * 86_400_000);
          const active = date >= project.startDate && date <= project.endDate;
          return <div key={date} className={`calendar-cell ${active ? '' : 'outside'}`}><span className="calendar-date">{active ? date.slice(5) : ''}</span>{active && (byDate.get(date) ?? []).map(lesson => <div key={`${lesson.taskId}-${lesson.taskPeriodIndex}`} className="calendar-lesson">第{lesson.period}节 · {titleOf(lesson)}</div>)}</div>;
        });
      })}</div>}
    </section>}
    {!draft && tasks.length > 0 && !selectedVersion && <div className="empty-state"><h2>尚无计划版本</h2><p>生成排课草案，检查结果后再确认保存。</p></div>}
  </main>;
}
