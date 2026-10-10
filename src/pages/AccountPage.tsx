import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, getAuth, setAuth, type Account, type AuthState, type TeachingGroup } from '../auth';
import { SystemAdministration } from '../components/SystemAdministration';

export function LoginPage({ state }: { state: AuthState }) {
  const [username, setUsername] = useState(''); const [name, setName] = useState('');
  const [password, setPassword] = useState(''); const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/auth/${state.initialized ? 'login' : 'setup'}`, 'POST', { username, name, password, setupToken }); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '登录失败'); }
    finally { setBusy(false); }
  }
  return <main className="workspace account-login"><section className="section-panel"><h1>{state.initialized ? '登录 CurriculumFlow' : '初始化管理员'}</h1><p>{state.initialized ? '使用管理员分配的账号登录备课工作空间。' : '升级后的旧项目会归入首位管理员账号，原试卷和附件继续保留。初始化密钥位于服务器 data/setup-token，或使用部署时设置的 SETUP_TOKEN。'}</p><form onSubmit={submit}>
    {!state.initialized && <><label>初始化密钥<input required type="password" autoComplete="off" value={setupToken} onChange={event => setSetupToken(event.target.value)} /></label><label>姓名<input required value={name} onChange={event => setName(event.target.value)} /></label></>}
    <label>账号<input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label><label>密码<input required minLength={state.initialized ? undefined : 10} maxLength={128} type="password" autoComplete={state.initialized ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
    {error && <p role="alert" className="error">{error}</p>}<button className="button primary" disabled={busy}>{busy ? '处理中…' : state.initialized ? '登录' : '创建管理员'}</button>
  </form></section></main>;
}

type AdminData = { users: Account[]; groups: TeachingGroup[]; teachers: Array<{ id: string; name: string }> };
export function AccountPage() {
  const user = getAuth()?.user;
  const [data, setData] = useState<AdminData>(); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Account>();
  const [draft, setDraft] = useState({ username: '', name: '', password: '', role: 'teacher', teacherId: '', disabled: false, memberships: [] as Account['memberships'] });
  const [group, setGroup] = useState({ schoolYear: '', grade: '', subject: '' });
  const [password, setPassword] = useState({ currentPassword: '', password: '' });
  async function refresh() { setData(await api<AdminData>('/api/admin')); setAuth(await api<AuthState>('/api/auth/status')); }
  useEffect(() => { if (user?.role === 'admin') void refresh().catch(caught => setError(caught.message)); }, [user?.role]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage('已保存。'); } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败'); }
    finally { setBusy(false); }
  }
  function edit(account?: Account) {
    setEditing(account);
    setDraft(account ? { username: account.username, name: account.name, password: '', role: account.role, teacherId: account.teacherId, disabled: account.disabled, memberships: account.memberships } : { username: '', name: '', password: '', role: 'teacher', teacherId: '', disabled: false, memberships: [] });
  }
  return <main className="workspace account-page"><Link to="/">← 学期项目</Link><h1>账号与备课组</h1><p>{user?.name} · {user?.role === 'admin' ? '管理员' : '老师'}</p>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <section className="section-panel"><h2>修改我的密码</h2><form className="form-grid" onSubmit={event => { event.preventDefault(); void run(async () => { await api('/api/auth/password', 'POST', password); setPassword({ currentPassword: '', password: '' }); }); }}><label>原密码<input required type="password" autoComplete="current-password" value={password.currentPassword} onChange={event => setPassword({ ...password, currentPassword: event.target.value })} /></label><label>新密码<input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password.password} onChange={event => setPassword({ ...password, password: event.target.value })} /></label><button className="button secondary" disabled={busy}>修改密码</button></form></section>
    {user?.role === 'admin' && <>
      <SystemAdministration />
      <section className="section-panel"><h2>创建备课组</h2><p>每个备课组对应一个学年、年级、学科；同一老师可加入多个备课组。</p><form className="form-grid" onSubmit={event => { event.preventDefault(); void run(async () => { await api('/api/admin/groups', 'POST', group); await refresh(); }); }}>{(['schoolYear', 'grade', 'subject'] as const).map((key, index) => <label key={key}>{['学年（2026-2027）', '年级', '学科'][index]}<input required value={group[key]} onChange={event => setGroup({ ...group, [key]: event.target.value })} /></label>)}<button className="button primary" disabled={busy}>创建备课组</button></form></section>
      <section className="section-panel"><h2>教师账号</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>姓名 / 账号</th><th>角色</th><th>备课组</th><th>状态</th><th /></tr></thead><tbody>{data?.users.map(account => <tr key={account.id}><td>{account.name} / {account.username}</td><td>{account.role === 'admin' ? '管理员' : '老师'}</td><td>{account.memberships.map(member => { const g = data.groups.find(group => group.id === member.groupId); return `${g?.schoolYear} ${g?.grade}${g?.subject}${member.leader ? '（组长）' : ''}`; }).join('、')}</td><td>{account.disabled ? '已停用' : '正常'}</td><td><button className="button secondary" onClick={() => edit(account)}>编辑</button></td></tr>)}</tbody></table></div></section>
      <section className="section-panel"><h2>{editing ? `编辑 ${editing.name}` : '新增教师账号'}</h2><button className="text-button" onClick={() => edit()}>切换为新增</button><form onSubmit={event => { event.preventDefault(); void run(async () => { await api(`/api/admin/users${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', draft); if (editing?.id === user.id) { window.location.reload(); return; } await refresh(); edit(); }); }}><div className="form-grid">
        <label>账号<input required value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label><label>姓名<input required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>{editing ? '重置密码（留空不修改）' : '初始密码'}<input required={!editing} minLength={10} maxLength={128} type="password" autoComplete="new-password" value={draft.password} onChange={event => setDraft({ ...draft, password: event.target.value })} /></label>
        <label>角色<select value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value })}><option value="teacher">普通老师</option><option value="admin">管理员</option></select></label><label>绑定原有命题 / 审题教师<select value={draft.teacherId} onChange={event => { const person = data?.teachers.find(person => person.id === event.target.value); setDraft({ ...draft, teacherId: event.target.value, name: person?.name ?? draft.name }); }}><option value="">自动关联同名教师 / 新建身份</option>{data?.teachers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={draft.disabled} onChange={event => setDraft({ ...draft, disabled: event.target.checked })} />停用账号</label>
      </div><h3>组内权限</h3>{data?.groups.map(g => { const membership = draft.memberships.find(member => member.groupId === g.id); return <div className="membership-row" key={g.id}><span>{g.schoolYear} · {g.grade}{g.subject}</span><select aria-label={`${g.grade}${g.subject}成员权限`} value={membership ? membership.leader ? 'leader' : 'teacher' : ''} onChange={event => setDraft({ ...draft, memberships: [...draft.memberships.filter(member => member.groupId !== g.id), ...(event.target.value ? [{ groupId: g.id, leader: event.target.value === 'leader' }] : [])] })}><option value="">未加入</option><option value="teacher">组内老师</option><option value="leader">备课组长</option></select></div>; })}<button className="button primary" disabled={busy}>保存账号</button></form></section>
    </>}
  </main>;
}
