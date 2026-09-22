import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { browserFileService } from '../core/files/browser';
import { buildWorkPlanView } from '../core/excel/planView';
import { addPlanAnnotation, addSpecialDuty, deletePlanAnnotation, deleteSpecialDuty, setWeeklyNote } from '../db/repositories/exportNotes';
import { db } from '../db/schema';
import type { PlanAnnotation, ScheduledLesson, SpecialTrainingDuty } from '../types/domain';

function WeeklyNoteEditor({ projectId, weekNumber, initial, onError }: {
  projectId: string; weekNumber: number; initial: string; onError: (message: string) => void;
}) {
  const [value, setValue] = useState(initial);
  async function save() {
    if (value === initial) return;
    try { await setWeeklyNote(projectId, weekNumber, value); onError(''); }
    catch (caught) { onError(caught instanceof Error ? caught.message : '周备注保存失败。'); }
  }
  return <textarea aria-label={`第${weekNumber}周备注`} rows={3} value={value} onChange={event => setValue(event.target.value)} onBlur={() => void save()} placeholder="补充本周备注，离开输入框后自动保存" />;
}

export function ExportPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const currentVersion = useLiveQuery(() => db.planVersions.where('[projectId+version]').between([projectId, 0], [projectId, Infinity]).last(), [projectId]);
  const lessons = useLiveQuery(() => currentVersion ? db.scheduledLessons.where('planVersionId').equals(currentVersion.id).toArray() : Promise.resolve([] as ScheduledLesson[]), [currentVersion?.id]);
  const days = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).sortBy('date'), [projectId]);
  const weeklyNotes = useLiveQuery(() => db.weeklyNotes.where('projectId').equals(projectId).toArray(), [projectId]);
  const annotations = useLiveQuery(() => db.planAnnotations.where('[projectId+startDate]').between([projectId, ''], [projectId, '\uffff']).toArray(), [projectId]);
  const duties = useLiveQuery(() => db.specialDuties.where('[projectId+startDate]').between([projectId, ''], [projectId, '\uffff']).toArray(), [projectId]);
  const exams = useLiveQuery(() => db.exams.where('projectId').equals(projectId).toArray(), [projectId]);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [annotationKind, setAnnotationKind] = useState<PlanAnnotation['kind']>('calendar_note');
  const [annotationStart, setAnnotationStart] = useState('');
  const [annotationEnd, setAnnotationEnd] = useState('');
  const [annotationText, setAnnotationText] = useState('');
  const [annotationExamId, setAnnotationExamId] = useState('');
  const [dutyStart, setDutyStart] = useState('');
  const [dutyEnd, setDutyEnd] = useState('');
  const [dutyTeacher, setDutyTeacher] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const exportProject = project ? { ...project, weekStart: currentVersion?.weekStart ?? project.weekStart ?? 7 } : undefined;
  const rows = useMemo(() => exportProject && lessons && days && weeklyNotes && annotations && duties && exams
    ? buildWorkPlanView({ project: exportProject, lessons, calendarDays: days, weeklyNotes, annotations, specialDuties: duties, exams }) : [],
  [exportProject, lessons, days, weeklyNotes, annotations, duties, exams]);

  async function addAnnotation(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      await addPlanAnnotation(projectId, annotationKind, annotationStart, annotationEnd, annotationText, annotationExamId || undefined);
      setAnnotationStart(''); setAnnotationEnd(''); setAnnotationText(''); setAnnotationExamId('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '注记保存失败。'); }
  }
  async function addDuty(event: FormEvent) {
    event.preventDefault(); setError('');
    try { await addSpecialDuty(projectId, dutyStart, dutyEnd, dutyTeacher); setDutyStart(''); setDutyEnd(''); setDutyTeacher(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '专训安排保存失败。'); }
  }
  async function download() {
    if (!exportProject || !days) return;
    setBusy(true); setError('');
    try {
      const { buildWorkPlanXlsx, workPlanFilename } = await import('../core/excel/workbook');
      browserFileService.saveFile(await buildWorkPlanXlsx(exportProject, rows, days), workPlanFilename(exportProject));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Excel 导出失败。'); }
    finally { setBusy(false); }
  }

  if (project === undefined || lessons === undefined || days === undefined || weeklyNotes === undefined || annotations === undefined || duties === undefined || exams === undefined || currentVersion === undefined) return <main className="workspace">正在生成工作计划预览…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  if (!currentVersion) return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="empty-state"><h2>请先确认教学计划</h2><Link className="button primary" to={`/projects/${projectId}/plan`}>打开教学计划</Link></div></main>;
  const weekNumbers = [...new Set(rows.map(row => row.weekNumber))];
  const selectedNote = weeklyNotes.find(note => note.weekNumber === selectedWeek)?.note ?? '';
  return <main className="workspace export-workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="page-heading"><div><p className="eyebrow">V{currentVersion.version} · {project.schoolYear}学年</p><h1>工作计划预览</h1><p className="muted">预览与 Excel 使用同一份结构化数据。教学内容请到任务队列修改。</p></div><button className="button primary" disabled={busy} onClick={() => void download()}>{busy ? '正在生成…' : '导出 Excel'}</button></div>{error && <p className="error page-error" role="alert">{error}</p>}
    <section className="section-panel export-preview"><div className="table-scroll"><table className="data-table workplan-table"><thead><tr>{['月份','周次','日','一','二','三','四','五','六','工作安排','课时','备注','单元检测','物理专训'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.weekNumber}-${index}`}><td>{row.month}</td><td>{row.firstWeekSegment ? `第${row.weekNumber}周` : ''}</td>{row.dates.map((day, dayIndex) => <td key={dayIndex} className={dayIndex === 0 || dayIndex === 6 ? 'weekend-cell' : ''}>{day?.day ?? ''}</td>)}<td className="preview-content">{row.content}</td><td>{row.firstWeekSegment ? row.periods : ''}</td><td className="preview-text">{row.note}</td><td className="preview-text">{row.assessment}</td><td>{row.specialTraining}</td></tr>)}</tbody></table></div></section>
    <div className="export-edit-grid"><section className="section-panel"><h2>本周备注</h2><p className="muted">补充文字只影响预览和导出，不改教学任务。</p><label className="editor-label">教学周 <select value={selectedWeek} onChange={event => setSelectedWeek(Number(event.target.value))}>{weekNumbers.map(week => <option key={week} value={week}>第 {week} 周</option>)}</select></label><WeeklyNoteEditor key={selectedWeek} projectId={projectId} weekNumber={selectedWeek} initial={selectedNote} onError={setError} /></section>
      <section className="section-panel"><h2>跨周备注与考务</h2><form className="annotation-form" onSubmit={event => void addAnnotation(event)}><select aria-label="注记类型" value={annotationKind} onChange={event => setAnnotationKind(event.target.value as PlanAnnotation['kind'])}><option value="calendar_note">备注</option><option value="assessment_preparation">单元检测 / 考务</option></select><input aria-label="注记开始日期" type="date" min={project.startDate} max={project.endDate} value={annotationStart} onChange={event => setAnnotationStart(event.target.value)} required /><input aria-label="注记结束日期" type="date" min={project.startDate} max={project.endDate} value={annotationEnd} onChange={event => setAnnotationEnd(event.target.value)} required /><input aria-label="注记内容" value={annotationText} onChange={event => setAnnotationText(event.target.value)} placeholder="例如 期末复习卷4套" required />{annotationKind === 'assessment_preparation' && <select aria-label="关联考试" value={annotationExamId} onChange={event => setAnnotationExamId(event.target.value)}><option value="">不关联考试</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select>}<button className="button secondary" type="submit">添加注记</button></form><div className="annotation-list">{annotations.map(item => <div key={item.id}><span>{item.startDate} 至 {item.endDate} · {item.text}</span><button className="text-button" onClick={() => void deletePlanAnnotation(item.id)}>移除</button></div>)}</div></section>
      <section className="section-panel"><h2>物理专训</h2><p className="muted">跨月周可以分别指定负责人。</p><form className="annotation-form" onSubmit={event => void addDuty(event)}><input aria-label="专训开始日期" type="date" min={project.startDate} max={project.endDate} value={dutyStart} onChange={event => setDutyStart(event.target.value)} required /><input aria-label="专训结束日期" type="date" min={project.startDate} max={project.endDate} value={dutyEnd} onChange={event => setDutyEnd(event.target.value)} required /><input aria-label="专训负责人" value={dutyTeacher} onChange={event => setDutyTeacher(event.target.value)} placeholder="教师姓名或“无”" required /><button className="button secondary" type="submit">添加安排</button></form><div className="annotation-list">{(duties as SpecialTrainingDuty[]).map(item => <div key={item.id}><span>{item.startDate} 至 {item.endDate} · {item.teacherNameSnapshot}</span><button className="text-button" onClick={() => void deleteSpecialDuty(item.id)}>移除</button></div>)}</div></section></div>
  </main>;
}
