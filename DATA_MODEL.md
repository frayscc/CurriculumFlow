# CurriculumFlow V1 数据模型

状态：待确认。本文是逻辑模型，持久化采用 Dexie/IndexedDB v1。日期一律是本地日历字符串 `YYYY-MM-DD`，时间戳使用 ISO 8601；ID 使用 UUID。记录由 `projectId` 隔离，引用在写事务中校验。

## 基础类型

```ts
type ID = string;
type LocalDate = string; // YYYY-MM-DD
type Timestamp = string; // ISO 8601
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 周一 = 1
type DayType = 'normal' | 'holiday' | 'makeup_workday' | 'school_event' | 'exam' | 'unavailable';
type TaskType = 'new_lesson' | 'exercise' | 'quiz' | 'exam' | 'exam_review'
  | 'review' | 'self_study' | 'experiment' | 'special_training' | 'other';
type ActualStatus = 'pending' | 'completed' | 'partially_completed' | 'postponed' | 'cancelled';
type ExamType = 'quiz' | 'chapter_test' | 'monthly_exam' | 'midterm'
  | 'final' | 'mock_exam' | 'special_training' | 'other';
type ExamFileType = 'paper_word' | 'paper_pdf' | 'answer_sheet_pdf'
  | 'answer_word' | 'answer_pdf' | 'specification_xlsx';
```

## 项目、校历和课表

```ts
interface SemesterProject {
  id: ID;
  schoolYear: string; grade: string; subject: string; semester: string;
  startDate: LocalDate; endDate: LocalDate;
  sourceProjectId?: ID;
  createdAt: Timestamp; updatedAt: Timestamp;
}
interface CalendarDay {
  projectId: ID; date: LocalDate; weekday: Weekday;
  dayType: DayType; scheduleWeekday?: Weekday;
  title?: string; note?: string;
}
interface CourseSchedule {
  projectId: ID; weekday: Weekday;
  periods: number[]; // 正整数节次，升序去重；简化“1课时”可映射为 [1]
}
interface ScheduleOverride {
  projectId: ID; date: LocalDate;
  originalPeriods: number[]; actualPeriods: number[];
  reason: string;
}
```

每个项目日期区间中的日历日都有一条 `CalendarDay`。自然周末的 `normal` 日默认无课；周末如需教学应设为 `makeup_workday` 并填写 `scheduleWeekday`，或用日期覆盖明确增加课时。项目日期变更时在事务中增删边缘日，已有特殊日不得被静默清除。`originalPeriods` 是生成覆盖时的审计快照，排课只读取 `actualPeriods`。

## 教学任务、计划及执行

```ts
interface TeachingTask {
  id: ID; projectId: ID; order: number;
  title: string; type: TaskType; plannedPeriods: number; // 正整数
  chapter?: string; section?: string;
  fixedDate?: LocalDate; fixedWeek?: number; // 二者互斥，周次从 1 起
  allowSplit: boolean; note?: string; examId?: ID;
  createdAt: Timestamp; updatedAt: Timestamp;
}
interface PlanVersion {
  id: ID; projectId: ID; version: number; createdAt: Timestamp;
  reason: string;
  scheduleSnapshot: ScheduledLessonSnapshot[];
  inputFingerprint: string; // 项目、校历、课表、覆盖、任务的规范化哈希
}
interface ScheduledLessonSnapshot {
  id: ID; taskId: ID; date: LocalDate; weekNumber: number;
  period: number; taskPeriodIndex: number; plannedPeriods: number;
}
interface ScheduledLesson extends ScheduledLessonSnapshot {
  projectId: ID; planVersionId: ID;
}
interface ActualTeachingRecord {
  id: ID; projectId: ID; taskId: ID;
  scheduledLessonId?: ID; planVersionId?: ID;
  plannedDate: LocalDate; actualDate?: LocalDate;
  status: ActualStatus; plannedPeriods: number; actualPeriods?: number;
  reason?: string; reflection?: string;
  createdAt: Timestamp; updatedAt: Timestamp;
}
interface ChangeLog {
  id: ID; projectId: ID; entityType: string; entityId: ID;
  action: string; before: unknown; after: unknown;
  reason?: string; timestamp: Timestamp;
}
interface WeeklyNote {
  projectId: ID; weekNumber: number;
  note?: string; specialWork?: string; updatedAt: Timestamp;
}
interface PlanAnnotation {
  id: ID; projectId: ID;
  kind: 'calendar_note' | 'assessment_preparation';
  startDate: LocalDate; endDate: LocalDate;
  text: string; examId?: ID; updatedAt: Timestamp;
}
interface SpecialTrainingDuty {
  id: ID; projectId: ID;
  startDate: LocalDate; endDate: LocalDate;
  teacherId?: ID; teacherNameSnapshot?: string;
  note?: string; taskId?: ID; updatedAt: Timestamp;
}
```

任务是内容与预计课时的权威记录；`ScheduledLesson` 是某版本对每个课时的安排。`PlanVersion.scheduleSnapshot` 保存不可变历史，`scheduledLessons` 是按版本索引的课次行，便于查询；写入时两者必须一致。当前版本由同项目最大 `version` 决定。生成草案不写数据库。实际记录永不覆盖计划课次；首次标记执行时创建记录，再次编辑写 `ChangeLog`。对于补课或额外教学，可创建无 `scheduledLessonId` 但有关联 `taskId` 的记录，`plannedPeriods=0`。任务删除前检查实际记录和考试关联；若存在则要求先解除关系或取消删除。

`fixedDate` 和 `fixedWeek` 互斥；固定任务的失败必须在排程结果中显式报告。教学周按周日至周六计，与现有 XLSX 一致；课表星期编号仍是周一为 1。版本中的课次 ID 是稳定的历史 ID，重排产生新 ID；旧实际记录继续引用旧课次。

`PlanAnnotation` 保存有业务日期跨度的校历说明或考务安排，如“期末复习卷4套”，可以关联考试，但不以单元格合并范围作为业务字段。`SpecialTrainingDuty` 保存“物理专训”的分段负责人，日期区间可细至跨月教学周的前后两段；即使同属一周也不合并为一个人。这两个模型来自现有工作计划的 `L/M/N` 栏，具体映射见 [TEMPLATE_ANALYSIS.md](TEMPLATE_ANALYSIS.md)。

## 考试、教师与文件

```ts
interface Exam {
  id: ID; projectId: ID; title: string; grade: string; subject: string;
  examType: ExamType; examDate?: LocalDate;
  authorIds: ID[]; reviewerIds: ID[];
  authorNames: string[]; reviewerNames: string[]; // 保存当时姓名快照
  note?: string; createdAt: Timestamp; updatedAt: Timestamp;
}
interface Teacher { id: ID; name: string; }
interface ExamFile {
  id: ID; projectId: ID; examId: ID; fileType: ExamFileType;
  originalFileName: string; mimeType: string; size: number;
  blobId: ID; uploadedAt: Timestamp;
}
interface FileBlob { id: ID; blob: Blob; }
```

`ExamFile` 与 `FileBlob` 分表，列表查询不加载二进制数据。每考试每槽位最多一个文件；替换附件在事务内写新 Blob 并移除旧 Blob。考试可由 `TeachingTask.examId` 引用；删除考试前检查引用，防止悬空。教师词典可跨项目复用，但备份仍包含项目考试所需的教师记录和姓名快照。

## 设置与备份格式

```ts
interface AppSetting { key: string; value: unknown; }
interface BackupManifest {
  schemaVersion: number; appVersion: string; exportedAt: Timestamp;
  project: SemesterProject;
  data: {
    calendarDays: CalendarDay[]; courseSchedules: CourseSchedule[];
    scheduleOverrides: ScheduleOverride[]; teachingTasks: TeachingTask[];
    planVersions: PlanVersion[]; scheduledLessons: ScheduledLesson[];
    actualRecords: ActualTeachingRecord[]; changeLogs: ChangeLog[];
    exams: Exam[]; examFiles: ExamFile[]; teachers: Teacher[];
    weeklyNotes: WeeklyNote[]; planAnnotations: PlanAnnotation[];
    specialDuties: SpecialTrainingDuty[]; settings: AppSetting[];
  };
  files: Array<{ blobId: ID; path: string; size: number; sha256: string }>;
}
```

文件字节不放入 `project.json`；清单指向 ZIP 的 `files/`。导入前必须验证每个 `ExamFile.blobId` 有对应文件，且不存在未引用的项目附件。备份采用版本号驱动迁移；不支持的较新版本给出明确提示。

## 索引和完整性规则

- 唯一键：`[projectId+date]` 校历和覆盖、`[projectId+weekday]` 周课表、`[projectId+version]` 计划版本、`[examId+fileType]` 附件槽、`[projectId+weekNumber]` 周备注。
- 跨周注记和专训安排按日期范围索引；同一专项在相同日期区间若出现多位负责人，须明确是共同负责还是冲突，不能静默覆盖。
- `TeachingTask.order` 在项目内稳定且不重复，移动后事务内重新编号；课时、日期和节次输入先校验再保存。
- 所有引用对象必须属于同一项目；跨项目复制生成新 ID 映射，不复用旧课次 ID。
- 版本和变更日志只追加；项目删除作为唯一例外，需二次确认并在事务中清理全部所属记录及 Blob。
- 结构化数据与文件存储的容量估算分别计算；不在普通列表查询中读取 `FileBlob`。
