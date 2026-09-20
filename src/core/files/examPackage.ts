import JSZip from 'jszip';
import type { Exam, ExamFile, SemesterProject } from '../../types/domain';
import { defaultNamingTemplates, examFileSlots, examZipName, namedExamFile, renderName, type NamingTemplates } from '../naming';

export async function buildExamPackage(
  project: SemesterProject, exam: Exam, files: Array<{ metadata: ExamFile; blob: Blob }>,
  templates: NamingTemplates = defaultNamingTemplates,
): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  const root = zip.folder(renderName(templates.zip, project, exam));
  if (!root) throw new Error('无法创建考试包目录。');
  for (const { metadata, blob } of files) {
    const slot = examFileSlots.find(item => item.type === metadata.fileType);
    if (!slot) throw new Error('考试附件类型无效。');
    const folder = root.folder(slot.group);
    if (!folder) throw new Error('无法创建考试包子目录。');
    folder.file(namedExamFile(metadata, project, exam, templates), blob);
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: examZipName(project, exam, templates) };
}
