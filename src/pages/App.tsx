import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ProjectForm } from '../components/ProjectForm';
import { createProject, deleteProject, updateProject } from '../db/repositories/projects';
import { db } from '../db/schema';
import type { SemesterProject } from '../types/domain';
import { CalendarPage } from './CalendarPage';
import { TasksPage } from './TasksPage';
import { PlanPage } from './PlanPage';
import { ExecutionPage } from './ExecutionPage';

function projectTitle(project: SemesterProject) {
  return `${project.schoolYear}学年 · ${project.grade}${project.subject} · ${project.semester}`;
}

function Home() {
  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray());
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <main className="workspace">
      <div className="page-heading">
        <div><p className="eyebrow">工作空间</p><h1>学期项目</h1><p className="muted">教学计划、执行记录和考试资源，保存在这台设备上。</p></div>
        <button className="button primary" onClick={() => setCreating(true)}>＋ 新建项目</button>
      </div>
      {projects === undefined ? <p>正在读取本地项目…</p> : projects.length === 0 ? (
        <div className="empty-state"><h2>还没有学期项目</h2><p>从新建项目开始，设置学年、年级、学科和日期。</p><button className="button primary" onClick={() => setCreating(true)}>新建第一个项目</button></div>
      ) : (
        <div className="project-list">
          {projects.map(project => <Link className="project-row" to={`/projects/${project.id}`} key={project.id}>
            <div className="project-icon">{project.subject.slice(0, 1)}</div>
            <div className="project-summary"><strong>{projectTitle(project)}</strong><span>{project.startDate} 至 {project.endDate}</span></div>
            <span className="row-arrow" aria-hidden="true">→</span>
          </Link>)}
        </div>
      )}
      {creating && <ProjectForm title="新建学期项目" submitLabel="创建项目" onCancel={() => setCreating(false)} onSubmit={async input => {
        const project = await createProject(input); setCreating(false); navigate(`/projects/${project.id}`);
      }} />}
    </main>
  );
}

function ProjectPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const dayCount = useLiveQuery(() => db.calendarDays.where('projectId').equals(projectId).count(), [projectId]);
  const taskCount = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).count(), [projectId]);
  const versionCount = useLiveQuery(() => db.planVersions.where('projectId').equals(projectId).count(), [projectId]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function remove() {
    if (!project) return;
    if (!window.confirm(`删除“${projectTitle(project)}”？此操作会删除该项目的校历、任务、考试和附件，无法撤销。`)) return;
    setError('');
    try { await deleteProject(project.id); navigate('/'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败，请重试。'); }
  }

  if (project === undefined) return <main className="workspace"><p>正在读取项目…</p></main>;
  if (!project) return <main className="workspace"><Link to="/">← 返回项目列表</Link><h1>项目不存在</h1></main>;
  return (
    <main className="workspace">
      <Link to="/" className="back-link">← 所有项目</Link>
      <div className="page-heading project-heading">
        <div><p className="eyebrow">学期项目</p><h1>{projectTitle(project)}</h1><p className="muted">{project.startDate} 至 {project.endDate}</p></div>
        <div className="header-actions"><button className="button secondary" onClick={() => setEditing(true)}>编辑信息</button><button className="button danger" onClick={remove}>删除项目</button></div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <section className="overview-grid">
        <div className="stat-panel"><span>校历日期</span><strong>{dayCount ?? '…'}</strong><small>覆盖整个学期，每天一条记录</small></div>
        <div className="stat-panel"><span>教学任务</span><strong>{taskCount ?? '…'}</strong><small>后续阶段从任务队列录入</small></div>
        <div className="stat-panel"><span>计划版本</span><strong>{versionCount ?? '…'}</strong><small>排课确认后保留历史版本</small></div>
      </section>
      <section className="section-panel feature-link-panel"><div><h2>校历与课表</h2><p>设置节假日、调休日、每周学科课和指定日期调整。</p></div><Link className="button primary" to={`/projects/${project.id}/calendar`}>打开校历与课表 →</Link></section>
      <section className="section-panel feature-link-panel"><div><h2>教学任务队列</h2><p>按顺序维护新课、练习、检测、考试和复习任务。</p></div><Link className="button primary" to={`/projects/${project.id}/tasks`}>打开任务队列 →</Link></section>
      <section className="section-panel feature-link-panel"><div><h2>教学计划</h2><p>生成排课草案，查看周计划和日历，并保留计划版本。</p></div><Link className="button primary" to={`/projects/${project.id}/plan`}>打开教学计划 →</Link></section>
      <section className="section-panel feature-link-panel"><div><h2>教学执行</h2><p>逐课记录完成、部分完成、延期和取消情况。</p></div><Link className="button primary" to={`/projects/${project.id}/execution`}>打开教学执行 →</Link></section>
      <section className="section-panel"><h2>项目基础信息</h2><dl className="detail-grid"><dt>学年</dt><dd>{project.schoolYear}</dd><dt>年级</dt><dd>{project.grade}</dd><dt>学科</dt><dd>{project.subject}</dd><dt>学期</dt><dd>{project.semester}</dd><dt>创建时间</dt><dd>{new Date(project.createdAt).toLocaleString('zh-CN')}</dd><dt>保存状态</dt><dd>已自动保存到本机</dd></dl></section>
      {editing && <ProjectForm title="编辑项目信息" submitLabel="保存修改" initial={project} onCancel={() => setEditing(false)} onSubmit={async input => { await updateProject(project.id, input); setEditing(false); }} />}
    </main>
  );
}

export function App() {
  return <div className="app-shell"><header className="app-header"><Link to="/" className="brand"><span className="brand-mark">C</span><span>CurriculumFlow</span></Link><span className="header-note">本地教学工作空间</span></header><Routes><Route path="/" element={<Home />} /><Route path="/projects/:projectId" element={<ProjectPage />} /><Route path="/projects/:projectId/calendar" element={<CalendarPage />} /><Route path="/projects/:projectId/tasks" element={<TasksPage />} /><Route path="/projects/:projectId/plan" element={<PlanPage />} /><Route path="/projects/:projectId/execution" element={<ExecutionPage />} /><Route path="*" element={<main className="workspace"><h1>页面不存在</h1><Link to="/">返回项目列表</Link></main>} /></Routes></div>;
}
