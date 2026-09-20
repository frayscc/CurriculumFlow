import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { defaultNamingTemplates, type NamingTemplates } from '../core/naming';
import { searchExams } from '../db/repositories/exams';
import { loadNamingTemplates, saveNamingTemplates } from '../db/repositories/settings';
import type { ExamType } from '../types/domain';

const typeNames: Record<ExamType, string> = {
  quiz: '随堂检测', chapter_test: '单元检测', monthly_exam: '月考', midterm: '期中考试',
  final: '期末考试', mock_exam: '模拟考试', special_training: '专项训练', other: '其他',
};
const templateLabels: Record<keyof NamingTemplates, string> = {
  paper: '试卷', answerSheet: '答题卷', answer: '答案', specification: '细目表', zip: '考试 ZIP',
};

function NamingSettings() {
  const stored = useLiveQuery(() => loadNamingTemplates());
  const [draft, setDraft] = useState<NamingTemplates | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const value = draft ?? stored ?? defaultNamingTemplates;
  async function save() {
    try { await saveNamingTemplates(value); setDraft(null); setError(''); setMessage('命名模板已保存。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败。'); }
  }
  return <section className="section-panel naming-settings"><h2>文件命名设置</h2><p className="muted">下载时动态生成文件名，不修改上传文件。支持 {'{schoolYear}、{grade}、{subject}、{examTitle}、{examType}、{date}'}。</p><div className="naming-grid">{(Object.keys(defaultNamingTemplates) as Array<keyof NamingTemplates>).map(key => <label key={key}>{templateLabels[key]}<input value={value[key]} onChange={event => { setDraft({ ...value, [key]: event.target.value }); setMessage(''); }} /></label>)}</div>{error && <p className="error" role="alert">{error}</p>}{message && <p className="success-message">{message}</p>}<div className="naming-actions"><button className="button secondary" onClick={() => setDraft({ ...defaultNamingTemplates })}>恢复默认</button><button className="button primary" onClick={() => void save()}>保存命名模板</button></div></section>;
}

export function ArchivePage() {
  const [query, setQuery] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState<ExamType | ''>('');
  const [author, setAuthor] = useState('');
  const [reviewer, setReviewer] = useState('');
  const results = useLiveQuery(() => searchExams({ query, schoolYear, grade, subject, examType, author, reviewer }), [query, schoolYear, grade, subject, examType, author, reviewer]);
  return <main className="workspace archive-workspace"><Link className="back-link" to="/">← 项目列表</Link><div className="page-heading"><div><p className="eyebrow">跨学期资源</p><h1>考试资源库</h1><p className="muted">仅搜索本机保存的考试元数据；附件只在下载时读取。</p></div></div><section className="section-panel"><div className="archive-filters"><input aria-label="标题或关键词" placeholder="标题或关键词" value={query} onChange={event => setQuery(event.target.value)} /><input aria-label="学年" placeholder="学年" value={schoolYear} onChange={event => setSchoolYear(event.target.value)} /><input aria-label="年级" placeholder="年级" value={grade} onChange={event => setGrade(event.target.value)} /><input aria-label="学科" placeholder="学科" value={subject} onChange={event => setSubject(event.target.value)} /><select aria-label="考试类型" value={examType} onChange={event => setExamType(event.target.value as ExamType | '')}><option value="">全部类型</option>{Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="命题人" placeholder="命题人" value={author} onChange={event => setAuthor(event.target.value)} /><input aria-label="审题人" placeholder="审题人" value={reviewer} onChange={event => setReviewer(event.target.value)} /></div><p className="result-count">找到 {results?.length ?? '…'} 场考试</p><div className="table-scroll"><table className="data-table"><thead><tr><th>考试</th><th>学年</th><th>年级学科</th><th>类型</th><th>日期</th><th>命题人</th><th>审题人</th></tr></thead><tbody>{results?.map(({ exam, project }) => <tr key={exam.id}><td><Link className="exam-title-link" to={`/projects/${project.id}/exams/${exam.id}`}>{exam.title}</Link></td><td>{project.schoolYear}</td><td>{exam.grade}{exam.subject}</td><td>{typeNames[exam.examType]}</td><td>{exam.examDate ?? '—'}</td><td>{exam.authorNames.join('、') || '—'}</td><td>{exam.reviewerNames.join('、') || '—'}</td></tr>)}</tbody></table>{results?.length === 0 && <p className="no-results">没有符合条件的考试。</p>}</div></section><NamingSettings /></main>;
}
