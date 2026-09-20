import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createTask, deleteTask, reorderTasks, restoreDeletedTask, updateTask, type TaskInput } from '../db/repositories/tasks';
import { db } from '../db/schema';
import { getHistoricalReference } from '../db/repositories/history';
import type { TeachingTask } from '../types/domain';

const labels: Record<TeachingTask['type'], string> = {
  new_lesson: '新课', exercise: '习题', quiz: '检测', exam: '考试', exam_review: '讲评',
  review: '复习', self_study: '自习', experiment: '实验', special_training: '专项训练', other: '其他',
};
const empty: TaskInput = { title: '', type: 'new_lesson', plannedPeriods: 1, allowSplit: true };

function TaskEditor({ task, projectId, onClose, onPeriodChange }: {
  task?: TeachingTask; projectId: string; onClose: () => void;
  onPeriodChange: (task: TeachingTask) => void;
}) {
  const [input, setInput] = useState<TaskInput>(task ?? empty);
  const exams = useLiveQuery(() => db.exams.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  const historical = useLiveQuery(() => task ? getHistoricalReference(task) : undefined, [task?.id]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fixedMode, setFixedMode] = useState<'none' | 'date' | 'week'>(task?.fixedDate ? 'date' : task?.fixedWeek ? 'week' : 'none');
  function set<K extends keyof TaskInput>(key: K, value: TaskInput[K]) { setInput(previous => ({ ...previous, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError('');
    try {
      const data = { ...input, fixedDate: fixedMode === 'date' ? input.fixedDate : undefined, fixedWeek: fixedMode === 'week' ? input.fixedWeek : undefined };
      if (task) {
        await updateTask(task.id, data);
        if (task.plannedPeriods !== data.plannedPeriods) onPeriodChange(task);
      } else await createTask(projectId, data);
      onClose();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : '任务保存失败。'); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"><div className="dialog-heading"><h2 id="task-dialog-title">{task ? '编辑教学任务' : '新增教学任务'}</h2><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div><form onSubmit={submit}>
    <label>教学内容 <input required autoFocus value={input.title} onChange={event => set('title', event.target.value)} placeholder="例如 13.1 分子热运动" /></label>
    <div className="form-grid"><label>类型 <select value={input.type} onChange={event => set('type', event.target.value as TeachingTask['type'])}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>预计课时 <input type="number" min="1" max="100" value={input.plannedPeriods} onChange={event => set('plannedPeriods', Number(event.target.value))} required /></label></div>
    <div className="form-grid"><label>章节 <input value={input.chapter ?? ''} onChange={event => set('chapter', event.target.value)} placeholder="例如 第13章" /></label><label>小节 <input value={input.section ?? ''} onChange={event => set('section', event.target.value)} placeholder="例如 13.1" /></label></div>
    <div className="form-grid"><label>固定节点 <select value={fixedMode} onChange={event => setFixedMode(event.target.value as 'none' | 'date' | 'week')}><option value="none">不固定</option><option value="date">指定日期</option><option value="week">指定教学周</option></select></label>{fixedMode === 'date' && <label>固定日期 <input type="date" value={input.fixedDate ?? ''} onChange={event => set('fixedDate', event.target.value)} required /></label>}{fixedMode === 'week' && <label>固定周次 <input type="number" min="1" value={input.fixedWeek ?? ''} onChange={event => set('fixedWeek', Number(event.target.value))} required /></label>}</div>
    <label className="checkbox-label"><input type="checkbox" checked={input.allowSplit} onChange={event => set('allowSplit', event.target.checked)} />允许跨日期拆分课时</label>
    <label>关联考试资源 <select value={input.examId ?? ''} onChange={event => set('examId', event.target.value || undefined)}><option value="">不关联</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label>
    <label>备注 <input value={input.note ?? ''} onChange={event => set('note', event.target.value)} placeholder="可选" /></label>
    {historical && <div className="historical-tip"><strong>往届参考 · {historical.sourceProject.schoolYear}</strong><span>计划 {historical.sourceTask.plannedPeriods} 课时{historical.actualPeriods !== undefined ? ` · 实际 ${historical.actualPeriods} 课时` : ' · 暂无实际课时记录'}</span>{historical.reason && <span>原因：{historical.reason}</span>}{historical.actualPeriods !== undefined && historical.actualPeriods > 0 && <button type="button" className="text-button" onClick={() => set('plannedPeriods', Math.ceil(historical.actualPeriods!))}>采用往届实际课时</button>}</div>}
    {formError && <p className="error" role="alert">{formError}</p>}
    <div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? '保存中…' : task ? '保存修改' : '添加任务'}</button></div>
  </form></section></div>;
}

function SortableTaskRow({ task, index, total, onEdit, onDelete, onMove }: {
  task: TeachingTask; index: number; total: number;
  onEdit: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .55 : 1 }}>
    <td><button className="drag-handle" aria-label={`拖动排序：${task.title}`} {...attributes} {...listeners}>⠿</button><span className="order-number">{index + 1}</span></td>
    <td className="task-title-cell"><strong>{task.title}</strong>{task.note && <small>{task.note}</small>}</td>
    <td>{labels[task.type]}</td><td>{task.plannedPeriods}</td>
    <td>{task.fixedDate ?? (task.fixedWeek ? `第 ${task.fixedWeek} 周` : '—')}</td>
    <td>{task.allowSplit ? '可拆分' : '同日连续'}</td>
    <td className="task-actions"><button disabled={index === 0} onClick={() => onMove(-1)} aria-label={`上移 ${task.title}`}>↑</button><button disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`下移 ${task.title}`}>↓</button><button onClick={onEdit}>编辑</button><button className="delete-link" onClick={onDelete}>删除</button></td>
  </tr>;
}

export function TasksPage() {
  const { projectId = '' } = useParams();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const tasks = useLiveQuery(() => db.teachingTasks.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  const [editing, setEditing] = useState<TeachingTask | 'new' | null>(null);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function move(from: number, to: number) {
    if (!tasks || from === to || to < 0 || to >= tasks.length) return;
    const ids = tasks.map(task => task.id); const [id] = ids.splice(from, 1); ids.splice(to, 0, id);
    try {
      const oldIds = tasks.map(task => task.id);
      await reorderTasks(projectId, ids); setError('');
      setUndo({ label: '撤销排序', run: () => reorderTasks(projectId, oldIds) });
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : '排序失败。'); }
  }
  function dragEnd(event: DragEndEvent) {
    if (!tasks || !event.over || event.active.id === event.over.id) return;
    void move(tasks.findIndex(task => task.id === event.active.id), tasks.findIndex(task => task.id === event.over?.id));
  }
  async function remove(task: TeachingTask) {
    if (!window.confirm(`删除教学任务“${task.title}”？`)) return;
    try {
      await deleteTask(task.id); setError('');
      setUndo({ label: '撤销删除', run: () => restoreDeletedTask(task) });
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败。'); }
  }
  async function runUndo() {
    if (!undo) return;
    try { await undo.run(); setUndo(null); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '撤销失败。'); }
  }

  if (project === undefined || !tasks) return <main className="workspace">正在读取教学任务…</main>;
  if (!project) return <main className="workspace"><Link to="/">返回项目列表</Link><h1>项目不存在</h1></main>;
  return <main className="workspace"><Link className="back-link" to={`/projects/${projectId}`}>← 返回项目概览</Link><div className="page-heading"><div><p className="eyebrow">{project.grade}{project.subject} · {project.semester}</p><h1>教学任务队列</h1><p className="muted">维护教学顺序与预计课时。拖动或使用上移、下移调整顺序。</p></div><button className="button primary" onClick={() => setEditing('new')}>＋ 新增任务</button></div>
    {error && <p className="error page-error" role="alert">{error}</p>}
    <section className="section-panel"><div className="task-toolbar"><span>{tasks.length} 项任务 · 预计 {tasks.reduce((sum, task) => sum + task.plannedPeriods, 0)} 课时</span><span>{undo && <button className="undo-button" onClick={() => void runUndo()}>{undo.label}</button>}所有修改自动保存</span></div>{tasks.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}><div className="table-scroll"><table className="data-table tasks-table"><thead><tr><th>顺序</th><th>教学内容</th><th>类型</th><th>课时</th><th>固定节点</th><th>拆分规则</th><th>操作</th></tr></thead><tbody>{tasks.map((task, index) => <SortableTaskRow key={task.id} task={task} index={index} total={tasks.length} onEdit={() => setEditing(task)} onDelete={() => void remove(task)} onMove={direction => void move(index, index + direction)} />)}</tbody></table></div></SortableContext></DndContext> : <div className="task-empty"><p>还没有教学任务。</p><button className="button primary" onClick={() => setEditing('new')}>添加第一项任务</button></div>}</section>
    {editing && <TaskEditor key={editing === 'new' ? 'new' : editing.id} task={editing === 'new' ? undefined : editing} projectId={projectId} onClose={() => setEditing(null)} onPeriodChange={oldTask => setUndo({ label: '撤销课时修改', run: async () => { await updateTask(oldTask.id, oldTask); } })} />}
  </main>;
}
