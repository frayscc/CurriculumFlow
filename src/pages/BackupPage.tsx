import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { browserFileService } from '../core/files/browser';
import { exportProjectBackup, prepareProjectBackup, restoreProjectBackup, type PreparedBackup } from '../db/repositories/backup';
import { db } from '../db/schema';
import type { ExamFile } from '../types/domain';

export function BackupPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useLiveQuery(async () => projectId ? await db.projects.get(projectId) : undefined, [projectId]);
  const files = useLiveQuery(async () => projectId ? await db.examFiles.where('projectId').equals(projectId).toArray() : [] as ExamFile[], [projectId]);
  const prepared = useRef<PreparedBackup | null>(null);
  const [summary, setSummary] = useState<PreparedBackup['manifest']['data'] | null>(null);
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function exportBackup() {
    if (!projectId) return;
    setBusy(true); setError('');
    try { const result = await exportProjectBackup(projectId); browserFileService.saveFile(result.blob, result.filename); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '备份导出失败。'); }
    finally { setBusy(false); }
  }
  async function selectBackup(file?: File) {
    prepared.current = null; setSummary(null); setError('');
    if (!file) return;
    setBusy(true);
    try {
      const result = await prepareProjectBackup(file);
      prepared.current = result; setSummary(result.manifest.data); setSize(file.size);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '备份文件校验失败。'); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!prepared.current) return;
    setBusy(true); setError('');
    try { const restored = await restoreProjectBackup(prepared.current); prepared.current = null; navigate(`/projects/${restored.id}`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '恢复失败，原有数据未更改。'); }
    finally { setBusy(false); }
  }
  const attachmentBytes = files?.reduce((total, file) => total + file.size, 0) ?? 0;
  return <main className="workspace"><Link className="back-link" to={projectId ? `/projects/${projectId}` : '/'}>← 返回{projectId ? '项目概览' : '项目列表'}</Link><div className="page-heading"><div><p className="eyebrow">本地数据安全</p><h1>完整备份与恢复</h1><p className="muted">ZIP 包含校历、课表、任务、计划版本、执行记录、考试信息和附件。请选择可靠位置保存。</p></div></div>{error && <p role="alert" className="error">{error}</p>}
    {projectId && project && <section className="section-panel"><h2>导出当前项目</h2><p>{project.schoolYear}学年 · {project.grade}{project.subject} · {project.semester}</p><p className="muted">附件 {files?.length ?? 0} 个，约 {(attachmentBytes / 1048576).toFixed(1)} MB。生成 ZIP 时浏览器需要额外内存；较大的项目请先确认设备有足够空间。</p><button className="button primary" disabled={busy} onClick={() => void exportBackup()}>{busy ? '处理中…' : '导出完整项目备份'}</button></section>}
    <section className="section-panel"><h2>从 ZIP 恢复项目</h2><p className="muted">先校验版本、关联数据和每个附件的 SHA-256，再显示摘要。恢复将创建一个新项目；相同学年、年级、学科和学期的项目不能重复。</p><input aria-label="选择备份 ZIP" type="file" accept=".zip,application/zip" disabled={busy} onChange={event => void selectBackup(event.target.files?.[0])} />{busy && <p>正在处理，请保持此页面打开…</p>}
      {summary && <div className="backup-summary"><h3>校验通过，等待确认</h3><p><strong>{summary.project.schoolYear}学年 · {summary.project.grade}{summary.project.subject} · {summary.project.semester}</strong></p><p>{summary.project.startDate} 至 {summary.project.endDate} · ZIP {(size / 1048576).toFixed(1)} MB</p><p>教学任务 {summary.teachingTasks.length} 项 · 计划版本 {summary.planVersions.length} 个 · 实际记录 {summary.actualRecords.length} 条 · 考试 {summary.exams.length} 场 · 附件 {summary.examFiles.length} 个</p><button className="button primary" disabled={busy} onClick={() => void restore()}>确认恢复为新项目</button></div>}</section>
  </main>;
}
