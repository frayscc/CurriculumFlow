import type { TeachingTask } from '../../types/domain';

export function compactTitles(titles: string[]): string {
  const parts: string[] = [];
  let run: Array<{ chapter: number; section: number; code: string }> = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(run.length > 1 ? `${run[0].code}-${run[run.length - 1].code}` : run[0].code);
    run = [];
  };
  for (const title of titles) {
    const match = /^(\d+)\.(\d+)(?:\s|$)/.exec(title.trim());
    if (!match) { flush(); parts.push(title.trim()); continue; }
    const current = { chapter: Number(match[1]), section: Number(match[2]), code: `${match[1]}.${match[2]}` };
    const previous = run[run.length - 1];
    if (previous && (previous.chapter !== current.chapter || previous.section + 1 !== current.section)) flush();
    run.push(current);
  }
  flush();
  return parts.join('；');
}

export function compactTaskTitles(tasks: TeachingTask[]): string {
  return compactTitles(tasks.map(task => task.title));
}
