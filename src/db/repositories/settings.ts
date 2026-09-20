import { defaultNamingTemplates, type NamingTemplates } from '../../core/naming';
import { db as appDb } from '../schema';

const allowedVariables = new Set(['schoolYear', 'grade', 'subject', 'examTitle', 'examType', 'date']);

export async function loadNamingTemplates(database = appDb): Promise<NamingTemplates> {
  const rows = await database.settings.where('key').startsWith('naming:').toArray();
  const result = { ...defaultNamingTemplates };
  for (const row of rows) {
    const key = row.key.slice('naming:'.length) as keyof NamingTemplates;
    if (key in result && typeof row.value === 'string') result[key] = row.value;
  }
  return result;
}

export async function saveNamingTemplates(templates: NamingTemplates, database = appDb): Promise<void> {
  for (const [key, template] of Object.entries(templates)) {
    if (!template.trim()) throw new Error(`${key} 文件名模板不能为空。`);
    for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
      if (!allowedVariables.has(match[1])) throw new Error(`不支持的命名变量：{${match[1]}}。`);
    }
  }
  await database.settings.bulkPut(Object.entries(templates).map(([key, value]) => ({ key: `naming:${key}`, value })));
}
