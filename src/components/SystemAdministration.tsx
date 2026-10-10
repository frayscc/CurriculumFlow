import { useEffect, useState } from 'react';
import { api } from '../auth';
import { browserFileService } from '../core/files/browser';

type Entry = { id: number; timestamp: string; actor_name: string; action: string; target: string; details: string };
export function SystemAdministration() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function refresh() { setEntries((await api<{ entries: Entry[] }>('/api/admin/audit')).entries); }
  useEffect(() => { void refresh().catch(caught => setError(caught.message)); }, []);
  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/backup', { cache: 'no-store' });
      if (!response.ok) throw new Error('整站备份失败，请检查管理员登录状态。');
      browserFileService.saveFile(await response.blob(), `CurriculumFlow_system_${new Date().toISOString().slice(0, 10)}.db`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '备份失败'); }
    finally { setBusy(false); }
  }
  return <section className="section-panel"><h2>系统备份与审计</h2><p>整站数据库包含所有项目、附件、账号、备课组权限和操作记录。请加密保存，勿分发给普通老师。</p><p>恢复时须停止容器，将备份作为 data/curriculumflow.db 放入独立空目录后再启动；不要与旧 WAL 文件混用。</p>{error && <p role="alert" className="error">{error}</p>}<button className="button primary" disabled={busy} onClick={() => void download()}>{busy ? '正在生成…' : '下载整站数据库备份'}</button><button className="button secondary" onClick={() => void refresh().catch(caught => setError(caught.message))}>刷新操作记录</button><div className="table-scroll"><table className="data-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象 / 详情</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{new Date(entry.timestamp).toLocaleString('zh-CN')}</td><td>{entry.actor_name}</td><td>{entry.action}</td><td>{entry.target} · {entry.details}</td></tr>)}</tbody></table></div><p>最近 100 条；记录从本版本启用后开始，不包含密码或文件内容。</p></section>;
}
