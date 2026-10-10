import type { ReactNode } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { canEditProject } from '../auth';
import { db } from '../db/schema';

export function ProjectAccess({ children }: { children: ReactNode }) {
  const { projectId = '' } = useParams();
  const location = useLocation();
  const project = useLiveQuery(async () => await db.projects.get(projectId) ?? null, [projectId]);
  const tasks = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  if (project === undefined) return <main className="workspace">正在读取项目…</main>;
  if (!project) return <main className="workspace"><Link to="/">← 项目列表</Link><h1>项目不存在或不属于你的备课组</h1></main>;
  if (canEditProject(project) || location.pathname.endsWith('/calendar')) return children;
  return <main className="workspace"><Link to={`/projects/${projectId}`}>← 项目概览</Link><h1>{project.grade}{project.subject} · 教学安排</h1><p className="readonly-banner">组内共享 · 只读。创建者和备课组长可修改本项目。</p><Link className="button secondary" to={`/projects/${projectId}/export`}>查看 / 下载教学计划</Link><section className="section-panel"><table className="data-table"><thead><tr><th>教学内容</th><th>开始</th><th>结束</th><th>上课日数</th></tr></thead><tbody>{tasks?.map(task => <tr key={task.id}><td>{task.title}</td><td>{task.scheduledStartDate ?? '未安排'}</td><td>{task.scheduledEndDate ?? '—'}</td><td>{task.scheduledDates?.length ?? 0}</td></tr>)}</tbody></table></section></main>;
}
