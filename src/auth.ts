import type { SemesterProject } from './types/domain';

export interface TeachingGroup { id: string; schoolYear: string; grade: string; subject: string; }
export interface Account { id: string; username: string; name: string; role: 'admin' | 'teacher'; teacherId: string; disabled: boolean; memberships: Array<{ groupId: string; leader: boolean }>; }
export interface AuthState { initialized: boolean; user?: Account; groups: TeachingGroup[]; }
let current: AuthState | undefined;
export const getAuth = () => current;
export const setAuth = (value: AuthState | undefined) => { current = value; };
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `请求失败（${response.status}）`);
  return value as T;
}
export function canEditProject(project?: SemesterProject | null, resources = false) {
  if (!current) return true; // Standalone offline edition.
  const user = current.user;
  if (!user || !project) return false;
  if (project.archived && !resources) return false;
  return user.role === 'admin' || user.memberships.some(member => member.groupId === project.groupId && (member.leader || (!resources && user.id === project.ownerId)));
}
export function projectOwnership(input: Pick<SemesterProject, 'schoolYear' | 'grade' | 'subject'>) {
  if (!current) return {};
  const group = current.groups.find(group => group.schoolYear === input.schoolYear && group.grade === input.grade && group.subject === input.subject);
  if (!group && current.user?.role !== 'admin') throw new Error('请先由管理员将你加入对应学年、年级、学科的备课组。');
  return { ownerId: current.user?.id, groupId: group?.id };
}
