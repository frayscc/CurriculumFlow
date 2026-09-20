import { useState, type DragEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { browserFileService } from '../core/files/browser';
import { examFileSlots, namedExamFile } from '../core/naming';
import { createExam, deleteExam, deleteExamFile, updateExam, uploadExamFile, type ExamInput } from '../db/repositories/exams';
import { db } from '../db/schema';
import { loadNamingTemplates } from '../db/repositories/settings';
import type { Exam, ExamFile, ExamType } from '../types/domain';

const examTypes: Record<ExamType, string> = {
  quiz: '随堂检测', chapter_test: '单元检测', monthly_exam: '月考', midterm: '期中考试',
  final: '期末考试', mock_exam: '模拟考试', special_training: '专项训练', other: '其他',
};

function PeopleField({ label, names, onChange, suggestions }: {
  label: string; names: string[]; onChange: (names: string[]) => void; suggestions: string[];
}) {
  const [value, setValue] = useState('');
  function add() {
    const name = value.trim();
    if (name && !names.includes(name)) onChange([...names, name]);
    setValue('');
  }
  return <div className="people-field"><span className="field-label">{label}</span><div className="people-chips">{names.map(name => <span className="person-chip" key={name}>{name}<button type="button" aria-label={`移除${name}`} onClick={() => onChange(names.filter(item => item !== name))}>×</button></span>)}</div><div className="people-entry"><input value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} list={`teachers-${label}`} placeholder="输入教师姓名" /><datalist id={`teachers-${label}`}>{suggestions.map(name => <option value={name} key={name} />)}</datalist><button type="button" className="button secondary" onClick={add}>添加</button></div></div>;
}

function ExamEditor({ exam, projectId, onClose, onSaved }: {
  exam?: Exam; projectId: string; onClose: () => void; onSaved: (exam: Exam) => void;
}) {
  const teachers = useLiveQuery(() => db.teachers.toArray()) ?? [];
  const [input, setInput] = useState<ExamInput>({
    title: exam?.title ?? '', examType: exam?.examType ?? 'chapter_test', examDate: exam?.examDate ?? '',
    authorNames: exam?.authorNames ?? [], reviewerNames: exam?.reviewerNames ?? [], note: exam?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { onSaved(exam ? await updateExam(exam.id, input) : await createExam(projectId, input)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '考试保存失败。'); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="exam-dialog-title"><div className="dialog-heading"><h2 id="exam-dialog-title">{exam ? '编辑考试' : '新建考试'}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><form onSubmit={submit}>
    <label>考试标题 <input autoFocus required value={input.title} onChange={event => setInput(previous => ({ ...previous, title: event.target.value }))} placeholder="例如 13-14章单元检测" /></label>
    <div className="form-grid"><label>类型 <select value={input.examType} onChange={event => setInput(previous => ({ ...previous, examType: event.target.value as ExamType }))}>{Object.entries(examTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>考试日期 <input type="date" value={input.examDate ?? ''} onChange={event => setInput(previous => ({ ...previous, examDate: event.target.value }))} /></label></div>
    <PeopleField label="命题人" names={input.authorNames} onChange={authorNames => setInput(previous => ({ ...previous, authorNames }))} suggestions={teachers.map(person => person.name)} />
    <PeopleField label="审题人" names={input.reviewerNames} onChange={reviewerNames => setInput(previous => ({ ...previous, reviewerNames }))} suggestions={teachers.map(person => person.name)} />
    <label>备注 <input value={input.note ?? ''} onChange={event => setInput(previous => ({ ...previous, note: event.target.value }))} placeholder="可选" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存考试'}</button></div>
  </form></section></div>;
}

function ExamList({ projectId }: { projectId: string }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const exams = useLiveQuery(async () => (await db.exams.where('projectId').equals(projectId).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projectId]);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const navigate = useNavigate();
  if (project === undefined || !exams) return <main className="workspace">正在读取考试资源…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  const filtered = exams.filter(exam => (!query || [exam.title, ...exam.authorNames, ...exam.reviewerNames].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())) && (!type || exam.examType === type));
  return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>考试资源</h1><p className="muted">按考试管理命题信息、试卷、答题卡、答案和细目表。</p></div><button className="button primary" onClick={() => setEditing(true)}>＋ 新建考试</button></div><section className="section-panel"><div className="exam-filters"><input aria-label="搜索考试" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、命题人或审题人" /><select aria-label="考试类型筛选" value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(examTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><span>{filtered.length} 场考试</span></div>{filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>标题</th><th>类型</th><th>日期</th><th>命题人</th><th>审题人</th><th></th></tr></thead><tbody>{filtered.map(exam => <tr key={exam.id}><td><Link className="exam-title-link" to={`/projects/${projectId}/exams/${exam.id}`}>{exam.title}</Link></td><td>{examTypes[exam.examType]}</td><td>{exam.examDate ?? '—'}</td><td>{exam.authorNames.join('、') || '—'}</td><td>{exam.reviewerNames.join('、') || '—'}</td><td><Link to={`/projects/${projectId}/exams/${exam.id}`}>打开 →</Link></td></tr>)}</tbody></table></div> : <div className="task-empty"><p>{exams.length ? '没有符合条件的考试。' : '还没有考试资源。'}</p></div>}</section>{editing && <ExamEditor projectId={projectId} onClose={() => setEditing(false)} onSaved={exam => { setEditing(false); navigate(`/projects/${projectId}/exams/${exam.id}`); }} />}</main>;
}

function ExamDetail({ projectId, examId }: { projectId: string; examId: string }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const exam = useLiveQuery(() => db.exams.get(examId), [examId]);
  const files = useLiveQuery(() => db.examFiles.where('examId').equals(examId).toArray(), [examId]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function upload(type: ExamFile['fileType'], file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try { await uploadExamFile(examId, type, file, file.name); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '附件上传失败。'); }
    finally { setBusy(false); }
  }
  async function download(file: ExamFile) {
    if (!project || !exam) return;
    try {
      const content = await db.fileBlobs.get(file.blobId);
      if (!content) throw new Error('附件内容缺失。');
      browserFileService.saveFile(content.blob, namedExamFile(file, project, exam, await loadNamingTemplates()));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '下载失败。'); }
  }
  async function downloadZip() {
    if (!project || !exam || !files?.length) return;
    setBusy(true); setError('');
    try {
      const parts = [];
      for (const metadata of files) {
        const content = await db.fileBlobs.get(metadata.blobId);
        if (!content) throw new Error(`附件“${metadata.originalFileName}”内容缺失。`);
        parts.push({ metadata, blob: content.blob });
      }
      const { buildExamPackage } = await import('../core/files/examPackage');
      const packageFile = await buildExamPackage(project, exam, parts, await loadNamingTemplates());
      browserFileService.saveZip(packageFile.blob, packageFile.filename);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '考试包生成失败。'); }
    finally { setBusy(false); }
  }
  async function removeExam() {
    if (!exam || !window.confirm(`删除考试“${exam.title}”及全部附件？此操作无法撤销。`)) return;
    try { await deleteExam(examId); navigate(`/projects/${projectId}/exams`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除考试失败。'); }
  }
  async function removeFile(file: ExamFile) {
    if (!window.confirm(`删除附件“${file.originalFileName}”？`)) return;
    try { await deleteExamFile(file.id); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除附件失败。'); }
  }
  function onDrop(event: DragEvent<HTMLDivElement>, type: ExamFile['fileType']) {
    event.preventDefault(); void upload(type, event.dataTransfer.files[0]);
  }

  if (project === undefined || exam === undefined || files === undefined) return <main className="workspace">正在读取考试…</main>;
  if (!project || !exam) return <main className="workspace"><Link to={`/projects/${projectId}/exams`}>← 返回考试列表</Link><h1>考试不存在</h1></main>;
  return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}/exams`}>← 考试列表</Link><div className="page-heading"><div><p className="eyebrow">{project.schoolYear}学年 · {project.grade}{project.subject}</p><h1>{exam.title}</h1><p className="muted">{examTypes[exam.examType]} · {exam.examDate ?? '未设置日期'}</p></div><div className="header-actions"><button className="button secondary" onClick={() => setEditing(true)}>编辑信息</button><button className="button danger" onClick={() => void removeExam()}>删除考试</button></div></div>
    {error && <p className="error page-error" role="alert">{error}</p>}
    <section className="section-panel exam-meta"><dl className="detail-grid"><dt>命题人</dt><dd>{exam.authorNames.join('、') || '—'}</dd><dt>审题人</dt><dd>{exam.reviewerNames.join('、') || '—'}</dd><dt>备注</dt><dd>{exam.note || '—'}</dd></dl></section>
    <section className="section-panel"><div className="section-heading"><div><h2>标准附件槽位</h2><p>文件保留原始名称与内容，下载时按命名规则生成新文件名。可拖拽文件到对应槽位。</p></div><button className="button primary" disabled={!files.length || busy} onClick={() => void downloadZip()}>{busy ? '处理中…' : '下载完整考试包'}</button></div><div className="file-slots">{examFileSlots.map(slot => {
      const file = files.find(item => item.fileType === slot.type);
      return <div key={slot.type} className="file-slot" onDragOver={event => event.preventDefault()} onDrop={event => onDrop(event, slot.type)}><div><strong>{slot.label}</strong><small>{file ? `${file.originalFileName} · ${(file.size / 1024).toFixed(1)} KB` : `支持 ${slot.extensions.join('、')}`}</small></div><div className="slot-actions"><label className="button secondary upload-button">{file ? '替换' : '上传'}<input type="file" accept={slot.extensions.join(',')} onChange={event => { void upload(slot.type, event.target.files?.[0]); event.target.value = ''; }} /></label>{file && <><button className="button secondary" onClick={() => void download(file)}>下载</button><button className="text-button" onClick={() => void removeFile(file)}>删除</button></>}</div></div>;
    })}</div></section>
    {editing && <ExamEditor exam={exam} projectId={projectId} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
  </main>;
}

export function ExamPage() {
  const { projectId = '', examId } = useParams();
  return examId ? <ExamDetail projectId={projectId} examId={examId} /> : <ExamList projectId={projectId} />;
}
