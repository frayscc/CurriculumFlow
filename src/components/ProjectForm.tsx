import { useState, type FormEvent, type ReactNode } from 'react';
import type { ProjectInput } from '../db/repositories/projects';

const empty: ProjectInput = {
  schoolYear: '', grade: '', subject: '', semester: '第一学期', startDate: '', endDate: '',
};

interface Props {
  initial?: ProjectInput;
  title: string;
  submitLabel: string;
  onSubmit: (input: ProjectInput) => Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}

export function ProjectForm({ initial, title, submitLabel, onSubmit, onCancel, children }: Props) {
  const [value, setValue] = useState<ProjectInput>(initial ?? empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof ProjectInput>(key: K, fieldValue: ProjectInput[K]) {
    setValue(previous => ({ ...previous, [key]: fieldValue }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await onSubmit(value); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="form-title">
        <div className="dialog-heading">
          <h2 id="form-title">{title}</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <form onSubmit={submit}>
          <label>学年 <input value={value.schoolYear} onChange={event => set('schoolYear', event.target.value)} placeholder="2026-2027" required autoFocus /></label>
          <div className="form-grid">
            <label>年级 <input value={value.grade} onChange={event => set('grade', event.target.value)} placeholder="九年级" required /></label>
            <label>学科 <input value={value.subject} onChange={event => set('subject', event.target.value)} placeholder="物理" required /></label>
          </div>
          <label>学期 <select value={value.semester} onChange={event => set('semester', event.target.value)}>
            <option>第一学期</option><option>第二学期</option>
          </select></label>
          <div className="form-grid">
            <label>开始日期 <input type="date" value={value.startDate} onChange={event => set('startDate', event.target.value)} required /></label>
            <label>结束日期 <input type="date" value={value.endDate} onChange={event => set('endDate', event.target.value)} required /></label>
          </div>
          {children}
          {error && <p role="alert" className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="button primary" disabled={busy}>{busy ? '保存中…' : submitLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
