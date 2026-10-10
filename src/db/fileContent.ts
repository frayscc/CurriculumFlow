import { db, type CurriculumDatabase } from './schema';
import { getAuth } from '../auth';

/** Online attachments are immutable and cached only when requested. */
export async function fileContent(blobId: string, database: CurriculumDatabase = db) {
  const cached = await database.fileBlobs.get(blobId);
  if (cached) return cached;
  if (database !== db || !getAuth()?.user) return undefined;
  const response = await fetch(`/api/blobs/${encodeURIComponent(blobId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('附件下载失败，请检查登录状态和网络。');
  const record = { id: blobId, blob: await response.blob() };
  await database.fileBlobs.put(record);
  return record;
}
