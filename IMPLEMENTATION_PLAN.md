# CurriculumFlow V1.0 实施计划

状态：待确认。依据《备课组教学计划与资源管理系统 V1.0 完整开发规格书》及已提供的现有工作计划 XLSX 制定。本文件是开发前的设计交付物，不表示 Phase 1 已启动。

## 1. 目标与边界

以结构化的学期、校历、课表、教学任务为事实来源，离线生成可解释的计划；独立保存实际执行、版本和考试资源；提供 XLSX、考试 ZIP 和完整备份。V1 不引入账号、后端、云同步、AI 或在线 Office。所有资源留在本机 IndexedDB。

验收以规格书第 88 节的完整工作流为准，包括备份删除后恢复时数据与附件一致。

## 2. 现有 XLSX 分析状态

已完成只读结构分析，详见 [TEMPLATE_ANALYSIS.md](TEMPLATE_ANALYSIS.md)。样本只有 `Sheet1!A1:N25`，第 1 行表头，之后 24 个日历周分段对应 21 个教学周，跨月周拆成两行。日期列 `C:I` 是**周日至周六**；`J/K` 为周教学内容/课时；`L/M` 有跨周合并的备注/考务内容；`N` 每个日历分段行记录物理专训负责人。整体是宋体 11 磅、细边框、A4 横向。此结构将作为默认 Excel 导出模板的验收基准。

## 3. 最终技术选型

| 层 | 选型与用途 |
| --- | --- |
| UI | React、TypeScript、Vite、React Router；桌面优先、1366×768 起 |
| 状态 | Zustand 管理界面状态；持久化数据由 Dexie 查询与事务管理，不复制整个数据库到状态树 |
| 本地存储 | Dexie/IndexedDB，版本化 schema，文件 Blob 单独表 |
| 日期 | date-fns；持久化日期使用本地日历 `YYYY-MM-DD`，不经 UTC 日期转换 |
| 排序 | dnd-kit；同时提供键盘移动操作 |
| 表格 | 原生表格与轻量组件；优先保证键盘编辑和信息密度 |
| Excel | ExcelJS 生成 XLSX；仅在实际需要读取模板时增加 SheetJS |
| 压缩与下载 | JSZip、浏览器下载适配层；大型文件的内存上限在风险项说明 |
| 测试 | Vitest 测核心模块，Testing Library 测关键交互，Playwright 测离线端到端工作流 |
| 离线安装 | Vite PWA 插件，应用资源本地打包，不使用 CDN |

依赖安装和版本锁定在 Phase 1 执行。业务逻辑不调用桌面平台 API；`FileService` 封装选择与下载。代码按 `src/core`、`src/db`、`src/features`、`src/pages` 分层。

## 4. 数据模型与 IndexedDB Schema

完整字段、主外键、生命周期见 [DATA_MODEL.md](DATA_MODEL.md)。核心关系为：`SemesterProject` → `CalendarDay`、`CourseSchedule`、`ScheduleOverride`、`TeachingTask`、`PlanVersion`、`ScheduledLesson`、`ActualTeachingRecord`、`Exam`、`ChangeLog`、`WeeklyNote`；`Exam` → `ExamFile` 元数据 → `FileBlob`。`Teacher` 是独立字典，考试保存教师 ID 与必要姓名快照，避免改名后旧导出不可解释。

首版 Dexie `version(1)` 表及索引建议：

```text
projects:        id, [schoolYear+grade+subject+semester], updatedAt
calendarDays:    [projectId+date], projectId, [projectId+dayType]
courseSchedules: [projectId+weekday], projectId
scheduleOverrides:[projectId+date], projectId
teachingTasks:   id, [projectId+order], projectId, [projectId+examId]
planVersions:    id, [projectId+version], [projectId+createdAt]
scheduledLessons: id, [projectId+planVersionId+date], [projectId+taskId], planVersionId
actualRecords:   id, [projectId+scheduledLessonId], [projectId+taskId], [projectId+actualDate]
changeLogs:      id, [projectId+timestamp], [entityType+entityId]
exams:           id, [projectId+examDate], [projectId+examType], title
examFiles:       id, [examId+fileType], examId
fileBlobs:       id
teachers:        id, name
weeklyNotes:     [projectId+weekNumber], projectId
planAnnotations: id, [projectId+startDate], [projectId+endDate], kind
specialDuties:   id, [projectId+startDate], [projectId+endDate], teacherId
settings:        key
```

所有表从 v1 开始定义迁移规则；后续通过 `db.version(n).stores(...).upgrade(...)` 升级，不清库。项目删除和备份恢复使用单一写事务处理元数据及 Blob。大型附件只在上传、下载或压缩时读取。

## 5. 页面结构

项目选择首页：新建、打开、基于历史创建、导入、删除（确认）。项目内左侧导航：

1. 首页：本周教学、计划/实际进度、差异、下一次考试。
2. 教学计划：任务队列（新增、批量、拖拽、键盘重排）、周计划、日历、排程预览与版本对比。
3. 校历与课表：日期范围、节假日、调休、特殊日期、周课表、日期覆盖。
4. 教学执行：今日/本周任务、完成/部分/延期/取消、差异和反思。
5. 考试资源：考试列表与筛选、教师选择、六类附件槽位、单文件及 ZIP 下载。
6. 历史经验：来源项目、计划/实际课时对比、采用参考课时。
7. 导出：工作计划预览、周备注、跨周考务注记、物理专训分段负责人、XLSX 导出。
8. 项目设置与备份：命名模板、容量估算、备份与恢复。

所有改动自动提交到 IndexedDB，界面显示保存状态；危险删除二次确认。对任务排序、删除、课时更改保留最近一次可撤销快照。删除有实际记录或考试关联的任务时阻止静默级联。

## 6. Scheduler 算法

详见 [SCHEDULER_SPEC.md](SCHEDULER_SPEC.md)。纯函数输入为项目日期范围、逐日校历、周课表、日期覆盖、按顺序排列的任务；输出课时槽、课次、周聚合、未排任务和可解释的冲突。先生成日历槽，再预留固定日期/周节点，最后按完整任务顺序填充普通节点；固定节点前容量不足的任务明确留在未排清单中。`allowSplit=false` 只允许在同一教学日内连续可用槽完成；无法满足则明确报冲突。调休日期使用 `scheduleWeekday`；日期覆盖在可用日期上替代周课表。超出学期的课时不能丢弃。

点击重新排程先生成草案及与当前版本的差异。用户确认后才写入新的 `PlanVersion` 与课次；旧版只读保存，实际记录继续指向原计划课次。不得修改原计划以表达实际教学。

## 7. Excel Export 方案

`WeeklyPlanView` 由课次、周备注、跨周注记和专项安排生成，保存任务 ID 列表、日期、课时数、考试引用；章节号压缩只在展示层执行。ExcelJS 的默认模板按样本生成月份、周次、周日到周六的日期、工作安排、课时、备注、单元检测、物理专训。跨月周按月份拆成两行并合并周次/工作安排/课时；跨周注记按日期范围合并显示，物理专训保留每个分段的负责人。导出前显示与导出同源的预览，并让用户确认。命题/审题信息由关联考试带出，样本中位于 `M` 列。

后续模板机制通过独立 `WorkbookTemplateAdapter` 实现映射，避免在业务数据里记录单元格坐标。Phase 9 使用样本校验合并、颜色语义、列宽、字体、边框和 A4 横向打印；实际打印效果仍需人工检查。

## 8. 考试附件与命名

考试是元数据主体；附件按 `paper_word`、`paper_pdf`、`answer_sheet_pdf`、`answer_word`、`answer_pdf`、`specification_xlsx` 六类存储。扩展名与 MIME 双重检查，MIME 缺失时以扩展名为准，提示具体期望格式。保留原文件名与 Blob；下载时用命名引擎生成文件名，不修改原始上传信息。模板变量 `{schoolYear}`、`{grade}`、`{subject}`、`{examTitle}`、`{examType}`、`{date}`；默认名称与 ZIP 目录严格采用规格书第 38–41 节。对路径分隔符和保留字符做文件名安全处理。空槽位不建 ZIP 子目录。

## 9. 完整备份与恢复

备份 ZIP 包含 `project.json`（`schemaVersion`、`appVersion`、`exportedAt`、所有项目结构化记录及附件清单）和 `files/` 下的原始 Blob；清单记录路径、字节数和 SHA-256。恢复流程：读取 ZIP → 校验 JSON 结构与版本 → 校验主外键、ID 唯一性、文件清单、长度和哈希 → 显示项目摘要及冲突策略 → 用户确认 → 单一 Dexie 事务写入。事务失败回滚，不覆盖现有项目的一半。默认以新 ID 导入，已有项目不直接覆写。

ZIP 生成/解析对浏览器内存有压力。V1 要给出明确的文件大小/内存提示，并优先分段读取、避免将所有 Blob 常驻 React 状态；数 GB 场景要做浏览器实测。如 JSZip 无法可靠处理大容量，实施前评估流式 ZIP 适配器，保持备份格式不变。这是当前技术风险，不把“数 GB”性能承诺建立在未测试的 JSZip 内存行为上。

## 10. 分阶段任务与交付门槛

| 阶段 | 交付 | 通过条件 |
| --- | --- | --- |
| Phase 1 基础架构 | React/TS/Vite、路由、Dexie v1、项目 CRUD、CI、文档骨架 | 新建、重开、删除项目正确；lint/test/build 通过 |
| Phase 2 校历课表 | 日期生成、节假日/调休、周课表、覆盖 | 正常周、假期、周末调休、临时停课可计算 |
| Phase 3 教学任务 | 类型、课时、固定节点、拖拽/键盘排序、撤销 | 顺序与修改持久化，不误删关联记录 |
| Phase 4 排课引擎 | 纯函数、冲突说明、版本草案 | 规格书 7 个 Case 全通过，结果确定性 |
| Phase 5 计划视图 | 队列、周计划、日历、预览、周备注 | 视图和导出投影使用同一数据源 |
| Phase 6 实际教学 | 状态、课时、原因、ChangeLog、版本对比 | 更新实际不改原计划，历史版可查 |
| Phase 7 考试资源 | 考试/教师 CRUD、附件槽、搜索、下载、ZIP | 文件名、目录、内容和原文件一致 |
| Phase 8 历史经验 | 项目复制、历届课时参考 | 默认不复制具体日期、实际记录和人员 |
| Phase 9 Excel | 现有文件分析、默认模板、学校格式映射、预览导出 | 比对真实样本的结构和打印效果 |
| Phase 10 备份恢复 | ZIP、校验、事务恢复、容量提示 | 删除后恢复全部元数据和附件，失败回滚 |
| Phase 11 验收 | 真实九年级物理示例、离线 PWA、端到端测试、文档 | 第 88 节完整闭环通过 |

每阶段分别提交 Git commit。仓库在 Phase 1 初始化，加入 MIT License、README、CHANGELOG、`docs/` 和运行 lint/test/build 的 GitHub Actions。是否推送远端由已有远端和用户要求决定。

## 11. 测试方案

- 单元：日期跨月/跨年、闰年、周次、调休、覆盖优先级、固定节点、`allowSplit`、超量、排序稳定性、章节压缩和命名模板。
- 数据：Dexie 迁移、事务回滚、关联校验、项目复制和历史版本只读；在浏览器环境执行，不用内存模拟掩盖 IndexedDB 行为。
- 文件：六种附件格式校验、错误文件友好提示、ZIP 路径与命名、SHA-256 往返、损坏 ZIP 与缺文件回滚。
- Excel：比较工作簿字段、合并区域、样式和打印设置；取得真实 XLSX 后与其核对。
- 端到端：以第 88 节的真实工作流贯通，并在断网模式运行；覆盖 1366×768 桌面视口。
- 容量：至少测试常见大附件以及接近浏览器配额的情况，明确可支持范围。

## 12. 已发现风险与待确认问题

1. **原表有跨月周与跨周合并**：21 个教学周占 24 个展示行，不能按“一周一行”硬编码。`L/M` 合并范围对应业务时间跨度；`N` 专训负责人按分段记录。详见模板分析。
2. **固定周语义未完全定义**：建议固定周任务只能排在指定教学周内；若该周槽不足则产生冲突，不自动移至其他周。固定日期也只允许当日。见 Scheduler 规格。
3. **特殊日期与覆盖的优先级**：建议 `holiday`/`unavailable` 恒为零课时；`school_event`/`exam` 默认零课时，需在该日显式覆盖才能排学科课；调休按指定课表日。请确认是否符合学校规则。
4. **`allowSplit=false` 的“连续”范围**：建议 V1 定义为同一天内连续的节次；跨日不算连续。若学校要求跨日连续课时，需要另行定义。
5. **多次实际教学与重排的关联**：采用每个计划课次一条实际记录，附加补课记录独立保存并关联任务；重排不会重写旧版记录。此为避免丢失计划/实际差异的实现细化。
6. **数 GB 附件与浏览器存储**：IndexedDB 配额、JSZip 内存及跨浏览器行为存在差异。Phase 7/10 必须实测，必要时换流式 ZIP 实现，不改变本地优先架构。
7. **现有表含计划而非已确认校历**：颜色与备注可提示节假日、调休、考试，但导入时必须核对；Phase 11 可以此文件作真实样本，仍需用户确认日期。
8. **“物理专训”的业务含义**：建议 V1 保存日期区间、负责人及备注，可选关联任务；请确认其是否需要更具体的流程。

确认本计划和上述学校规则后进入 Phase 1。其余实现细节按规格书和本计划执行。
