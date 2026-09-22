import type { Exam, ExamFile, ExamFileType, SemesterProject } from '../../types/domain';

export interface NamingTemplates {
  paper: string; answerSheet: string; answer: string; specification: string; zip: string;
}
export const defaultNamingTemplates: NamingTemplates = {
  paper: '（{grade}{subject}学科）{examTitle}',
  answerSheet: '（{grade}{subject}学科）{examTitle}答题卷',
  answer: '（{grade}{subject}学科）{examTitle}答案',
  specification: '（{grade}{subject}学科）{examTitle}细目表',
  zip: '（{grade}{subject}学科）{examTitle}试题',
};

const examTypeNames: Record<Exam['examType'], string> = {
  quiz: '随堂检测', chapter_test: '单元检测', monthly_exam: '月考', midterm: '期中考试',
  final: '期末考试', mock_exam: '模拟考试', special_training: '专项训练', other: '其他',
};

function safeName(value: string): string {
  const clean = [...value].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('')
    .replace(/[\\/:*?"<>|]/g, '_').replace(/[.\s]+$/g, '').trim();
  return clean || '未命名';
}

export function renderName(template: string, project: SemesterProject, exam: Exam): string {
  const values: Record<string, string> = {
    schoolYear: project.schoolYear, grade: exam.grade, subject: exam.subject,
    examTitle: exam.title, examType: examTypeNames[exam.examType], date: exam.examDate ?? '',
  };
  const rendered = template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`文件命名模板包含不支持的变量：{${key}}。`);
    return values[key];
  });
  return safeName(rendered);
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(index).toLowerCase() : '';
}

export function namedExamFile(file: ExamFile, project: SemesterProject, exam: Exam, templates = defaultNamingTemplates): string {
  const key: keyof NamingTemplates = file.fileType.startsWith('paper_') ? 'paper'
    : file.fileType.startsWith('answer_sheet_') ? 'answerSheet'
      : file.fileType.startsWith('answer_') ? 'answer' : 'specification';
  return `${renderName(templates[key], project, exam)}${extensionOf(file.originalFileName)}`;
}

export function examZipName(project: SemesterProject, exam: Exam, templates = defaultNamingTemplates): string {
  return `${renderName(templates.zip, project, exam)}.zip`;
}

export const examFileSlots: Array<{ type: ExamFileType; label: string; group: string; extensions: string[] }> = [
  { type: 'paper_word', label: '试卷 Word', group: '1、试卷', extensions: ['.doc', '.docx'] },
  { type: 'paper_pdf', label: '试卷 PDF', group: '1、试卷', extensions: ['.pdf'] },
  { type: 'answer_sheet_word', label: '答题卡 Word', group: '2、答题卷', extensions: ['.doc', '.docx'] },
  { type: 'answer_sheet_pdf', label: '答题卡 PDF', group: '2、答题卷', extensions: ['.pdf'] },
  { type: 'answer_word', label: '答案 Word', group: '3、答案', extensions: ['.doc', '.docx'] },
  { type: 'answer_pdf', label: '答案 PDF', group: '3、答案', extensions: ['.pdf'] },
  { type: 'specification_xlsx', label: '细目表 Excel', group: '4、细目表', extensions: ['.xls', '.xlsx'] },
];

export function validateExamFileType(fileType: ExamFileType, filename: string): void {
  const slot = examFileSlots.find(item => item.type === fileType);
  if (!slot) throw new Error('附件类型无效。');
  if (!slot.extensions.includes(extensionOf(filename))) {
    throw new Error(`${slot.label}仅支持 ${slot.extensions.join('、')} 文件。`);
  }
}
