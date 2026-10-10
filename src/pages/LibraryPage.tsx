import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getAuth } from '../auth';
import type { Exam, ExamFile, SemesterProject } from '../types/domain';
import { browserFileService } from '../core/files/browser';
import { namedExamFile } from '../core/naming';
import { buildExamPackage } from '../core/files/examPackage';

type Library = { projects: SemesterProject[]; exams: Exam[]; files: ExamFile[] };
export function LibraryPage() {
  const [data, setData] = useState<Library>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [year, setYear] = useState(''); const [grade, setGrade] = useState(''); const [subject, setSubject] = useState('');
  const [mine, setMine] = useState(false);
  useEffect(() => { void api<Library>('/api/library').then(setData).catch(caught => setError(caught.message)); }, []);
  async function download(exam: Exam, project: SemesterProject, file?: ExamFile) {
    setBusy(true); setError('');
    try {
      const files = file ? [file] : data!.files.filter(item => item.examId === exam.id);
      if (!files.length) throw new Error('该试卷尚无附件。');
      const parts = [];
      for (const metadata of files) {
        const response = await fetch(`/api/blobs/${encodeURIComponent(metadata.blobId)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('附件下载失败，请重新登录或稍后重试。');
        parts.push({ metadata, blob: await response.blob() });
      }
      if (file) browserFileService.saveFile(parts[0].blob, namedExamFile(file, project, exam));
      else { const result = await buildExamPackage(project, exam, parts); browserFileService.saveZip(result.blob, result.filename); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '下载失败'); }
    finally { setBusy(false); }
  }
  const filtered = (data?.exams ?? []).filter(exam => {
    const project = data!.projects.find(project => project.id === exam.projectId);
    const teacherId = getAuth()?.user?.teacherId;
    return project && (!year || project.schoolYear === year) && (!grade || project.grade === grade) && (!subject || project.subject === subject) && (!mine || exam.authorIds.includes(teacherId ?? '') || exam.reviewerIds.includes(teacherId ?? '')) && (!query || [exam.title, ...exam.authorNames, ...exam.reviewerNames, exam.note].join(' ').includes(query));
  });
  return <main className="workspace"><Link to="/">← 学期项目</Link><h1>全校试卷资源库</h1><p>按学年归档，所有老师可下载；对应备课组长和管理员维护资源。历史学年的资源继续保留。</p>{error && <p role="alert" className="error">{error}</p>}<section className="section-panel"><div className="archive-filters"><input aria-label="试卷搜索" value={query} onChange={event => setQuery(event.target.value)} placeholder="标题、命题人、审题人" />{([['学年', year, setYear, 'schoolYear'], ['年级', grade, setGrade, 'grade'], ['学科', subject, setSubject, 'subject']] as const).map(([label, value, setter, key]) => <select aria-label={`资源${label}`} key={key} value={value} onChange={event => setter(event.target.value)}><option value="">全部{label}</option>{[...new Set(data?.projects.map(project => project[key]))].sort().reverse().map(value => <option key={value}>{value}</option>)}</select>)}<label className="checkbox-label"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />我命题 / 审题的试卷</label></div><p>{data ? `${filtered.length} 份试卷` : '正在读取资源库…'}</p>
    {filtered.map(exam => { const project = data!.projects.find(project => project.id === exam.projectId)!; const user = getAuth()!.user!; const canManage = user.role === 'admin' || user.memberships.some(member => member.groupId === project.groupId && member.leader); return <article className="section-panel" key={exam.id}><h2>{exam.title}</h2><p>{project.schoolYear} · {project.grade}{project.subject} · {project.semester} · {exam.examDate || '日期未设置'}</p><p>命题：{exam.authorNames.join('、') || '—'} · 审题：{exam.reviewerNames.join('、') || '—'}</p><div className="library-actions"><button className="button primary" disabled={busy} onClick={() => void download(exam, project)}>下载完整资源包</button>{data!.files.filter(file => file.examId === exam.id).map(file => <button className="button secondary" disabled={busy} key={file.id} onClick={() => void download(exam, project, file)}>{file.originalFileName}</button>)}{canManage && <Link className="button secondary" to={`/projects/${project.id}/exams/${exam.id}`}>维护资源</Link>}</div></article>; })}
  </section></main>;
}
