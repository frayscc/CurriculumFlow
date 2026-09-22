import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { teachingWeekNumber } from '../core/calendar/dates';
import { recordActual, type ActualInput } from '../db/repositories/actual';
import { db } from '../db/schema';
import type { ActualStatus, ActualTeachingRecord, ScheduledLesson } from '../types/domain';

const statusLabels: Record<ActualStatus, string> = {
  pending: '待完成', completed: '已完成', partially_completed: '部分完成', postponed: '已延期', cancelled: '已取消',
};

function lessonTime(lesson: ScheduledLesson) {
  if (lesson.sharedOccurrences?.length) return `${lesson.sharedOccurrences.map(item => `${item.date} 第${item.period}节`).join(' / ')}（${lesson.sharedSlotLabel ?? '共享课位'}）`;
  return `${lesson.date} · 第 ${lesson.period} 节`;
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function ActualEditor({ lesson, previous, onClose }: {
  lesson: ScheduledLesson; previous?: ActualTeachingRecord; onClose: () => void;
}) {
  const [input, setInput] = useState<ActualInput>({
    status: previous?.status ?? 'completed', actualDate: previous?.actualDate ?? lesson.date,
    actualPeriods: previous?.actualPeriods ?? 1, reason: previous?.reason ?? '', reflection: previous?.reflection ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function changeStatus(status: ActualStatus) {
    setInput(previousInput => ({
      ...previousInput, status,
      actualDate: status === 'postponed' || status === 'cancelled' || status === 'pending' ? '' : previousInput.actualDate || lesson.date,
      actualPeriods: status === 'postponed' || status === 'cancelled' || status === 'pending' ? undefined : previousInput.actualPeriods ?? 1,
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await recordActual(lesson.id, input); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '实际教学记录保存失败。'); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="actual-title"><div className="dialog-heading"><h2 id="actual-title">记录实际教学</h2><button className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><p className="actual-context"><strong>{lesson.taskTitle}</strong><span>计划：{lessonTime(lesson)}</span></p><form onSubmit={submit}>
    <label>执行状态 <select value={input.status} onChange={event => changeStatus(event.target.value as ActualStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {(input.status === 'completed' || input.status === 'partially_completed') && <div className="form-grid"><label>实际日期 <input type="date" value={input.actualDate ?? ''} onChange={event => setInput(previousInput => ({ ...previousInput, actualDate: event.target.value }))} required /></label><label>实际课时 <input type="number" min="0" max="20" step="0.5" value={input.actualPeriods ?? ''} onChange={event => setInput(previousInput => ({ ...previousInput, actualPeriods: event.target.value === '' ? undefined : Number(event.target.value) }))} /></label></div>}
    <label>原因 <input value={input.reason ?? ''} onChange={event => setInput(previousInput => ({ ...previousInput, reason: event.target.value }))} placeholder="延期或取消时必填" required={input.status === 'postponed' || input.status === 'cancelled'} /></label>
    <label>教学反思 <textarea value={input.reflection ?? ''} onChange={event => setInput(previousInput => ({ ...previousInput, reflection: event.target.value }))} rows={3} placeholder="可记录学生掌握情况或后续安排" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" disabled={busy} type="submit">{busy ? '保存中…' : '保存记录'}</button></div>
  </form></section></div>;
}

export function ExecutionPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const currentVersion = useLiveQuery(() => db.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last(), [projectId]);
  const lessons = useLiveQuery(() => currentVersion ? db.scheduledLessons.where('planVersionId').equals(currentVersion.id).toArray() : Promise.resolve([] as ScheduledLesson[]), [currentVersion?.id]);
  const allLessons = useLiveQuery(() => db.scheduledLessons.where('projectId').equals(projectId).toArray(), [projectId]);
  const actualRecords = useLiveQuery(() => db.actualRecords.where('projectId').equals(projectId).toArray(), [projectId]);
  const [filter, setFilter] = useState<'all' | 'week' | 'today'>('all');
  const [editing, setEditing] = useState<ScheduledLesson | null>(null);

  if (project === undefined || lessons === undefined || allLessons === undefined || actualRecords === undefined || currentVersion === undefined) return <main className="workspace">正在读取教学执行记录…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  if (!currentVersion) return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="empty-state"><h2>请先生成教学计划</h2><p>确认排课版本后，才能逐课记录实际执行。</p><Link className="button primary" to={`/projects/${projectId}/plan`}>打开教学计划</Link></div></main>;

  const today = localToday();
  const currentWeek = teachingWeekNumber(project.startDate, today, currentVersion.weekStart ?? project.weekStart ?? 7);
  const allLessonById = new Map(allLessons.map(lesson => [lesson.id, lesson]));
  const priorCompleted = new Map<string, ActualTeachingRecord>();
  for (const record of actualRecords.filter(item => item.status === 'completed' || item.status === 'partially_completed').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    const source = record.scheduledLessonId ? allLessonById.get(record.scheduledLessonId) : undefined;
    if (source) priorCompleted.set(`${source.taskId}:${source.taskPeriodIndex}`, record);
  }
  const recordByLesson = new Map(lessons.map(lesson => [lesson.id, priorCompleted.get(`${lesson.taskId}:${lesson.taskPeriodIndex}`)]));
  for (const record of actualRecords.filter(item => item.planVersionId === currentVersion.id)) if (record.scheduledLessonId) recordByLesson.set(record.scheduledLessonId, record);
  const visible = [...lessons].filter(lesson => filter === 'all' || filter === 'today' && (lesson.date === today || !!lesson.sharedOccurrences?.some(item => item.date === today)) || filter === 'week' && lesson.weekNumber === currentWeek)
    .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  const completed = lessons.filter(lesson => recordByLesson.get(lesson.id)?.status === 'completed').length;
  const differences = actualRecords.filter(record => ['partially_completed', 'postponed', 'cancelled'].includes(record.status));

  return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="page-heading"><div><p className="eyebrow">V{currentVersion.version} · {currentVersion.reason}</p><h1>教学执行</h1><p className="muted">实际记录与原计划分别保存；延期后可预览后续顺延并确认新版计划。</p></div><Link className="button secondary" to={`/projects/${projectId}/plan`}>查看或调整计划 →</Link></div>
    <section className="overview-grid"><div className="stat-panel"><span>计划课时</span><strong>{lessons.length}</strong></div><div className="stat-panel"><span>已完成课时</span><strong>{completed}</strong></div><div className="stat-panel"><span>差异记录</span><strong>{differences.length}</strong></div></section>
    <section className="section-panel"><div className="execution-toolbar"><h2>计划课次</h2><select aria-label="筛选课次" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">全部</option><option value="week">本周</option><option value="today">今天</option></select></div><div className="table-scroll"><table className="data-table"><thead><tr><th>计划日期</th><th>节次</th><th>教学内容</th><th>实际状态</th><th>实际日期</th><th>实际课时</th><th>操作</th></tr></thead><tbody>{visible.map(lesson => {
      const record = recordByLesson.get(lesson.id);
      return <tr key={lesson.id}><td>{lesson.sharedOccurrences?.length ? lesson.sharedOccurrences.map(item => item.date).join(' / ') : lesson.date}</td><td>{lesson.sharedOccurrences?.length ? `${lesson.sharedSlotLabel ?? '共享'}（合计1课时）` : `第 ${lesson.period} 节`}</td><td>{lesson.taskTitle}{lesson.plannedPeriods > 1 ? ` (${lesson.taskPeriodIndex}/${lesson.plannedPeriods})` : ''}</td><td><span className={`status-tag ${record?.status ?? 'pending'}`}>{statusLabels[record?.status ?? 'pending']}</span></td><td>{record?.actualDate ?? '—'}</td><td>{record?.actualPeriods ?? '—'}</td><td><button className="text-button action-link" onClick={() => setEditing(lesson)}>{record ? '修改记录' : '记录实际'}</button></td></tr>;
    })}</tbody></table>{visible.length === 0 && <p className="no-results">当前范围没有计划课次。</p>}</div></section>
    {differences.length > 0 && <section className="section-panel difference-panel"><h2>差异记录（含历史版本）</h2>{differences.map(record => <div key={record.id} className="difference-row"><span>{record.plannedDate}</span><strong>{allLessonById.get(record.scheduledLessonId ?? '')?.taskTitle ?? record.taskId}</strong><span>{statusLabels[record.status]}</span><span>{record.reason ?? '未填写原因'}</span></div>)}</section>}
    {editing && <ActualEditor key={editing.id} lesson={editing} previous={recordByLesson.get(editing.id)} onClose={() => setEditing(null)} />}
  </main>;
}
