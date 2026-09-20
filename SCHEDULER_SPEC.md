# CurriculumFlow V1 排课引擎规格

状态：待确认。引擎位于 `src/core/scheduler/`，不依赖 React、Dexie、系统时钟或随机数。相同规范化输入得到相同课时安排与冲突顺序。日期使用本地日历值；课表星期编号周一为 1。现有 XLSX 的教学周按**周日至周六**聚合。

## 输入与输出

```ts
interface SchedulerInput {
  project: Pick<SemesterProject, 'startDate' | 'endDate'>;
  calendarDays: CalendarDay[];
  courseSchedules: CourseSchedule[];
  scheduleOverrides: ScheduleOverride[];
  tasks: TeachingTask[];
}
interface TeachingSlot {
  date: LocalDate; weekNumber: number; period: number;
  source: 'weekly' | 'makeup' | 'override';
}
interface ScheduleResult {
  slots: TeachingSlot[];
  lessons: Array<{
    taskId: ID; date: LocalDate; weekNumber: number;
    period: number; taskPeriodIndex: number; plannedPeriods: number;
  }>;
  weeks: Array<{ weekNumber: number; startDate: LocalDate;
    endDate: LocalDate; taskIds: ID[]; lessonCount: number }>;
  unscheduled: Array<{ taskId: ID; remainingPeriods: number; reason: string }>;
  conflicts: Array<{ code: string; taskId?: ID; date?: LocalDate; message: string }>;
}
```

课次 ID、版本 ID 和时间戳由应用服务在确认版本时生成，不属于确定性算法输出。UI 预览和最终保存必须用同一个 `ScheduleResult`；若输入指纹在确认前改变，重新计算并要求再确认。

## 1. 输入校验

日期范围有效、每天恰有一条 `CalendarDay`；课表和覆盖节次为正整数且去重；任务标题非空、课时为正整数、`order` 唯一；`fixedDate` 与 `fixedWeek` 不共存；关联日期在学期范围；调休日有有效 `scheduleWeekday`。错误以结构化冲突返回，不发生部分写入。`fixedWeek` 从 1 起且不超过学期周数。

## 2. 教学周与可用槽

学期开始日期所在的周日至周六是第 1 周，即使开始日期是周二；下一个周日是第 2 周。现有 XLSX 的第 1 周是 2026-08-30 至 09-05（仅展示 09-01 起的日期），第 2 周从 09-06 开始。日期区间两端都包含。按日期升序逐日计算：

1. `holiday`、`unavailable`：零槽；日期覆盖不能暗中恢复这些日期。
2. `school_event`、`exam`：默认零槽；只有明确的 `ScheduleOverride.actualPeriods` 才可排学科课程。
3. `makeup_workday`：取 `scheduleWeekday` 对应课表；允许周末；覆盖可替代。
4. `normal`：周一至周五取自然星期的学科课表，周末默认零槽；若周末确需上课，以调休或明确日期覆盖表示。
5. 对允许的日期，若有覆盖则以 `actualPeriods` 完全替代上述课表结果；空数组表示临时停课。按节次升序输出槽。

覆盖有 `reason`，用于预览说明。星期课表无对应条目等价于零课时。计算槽时不以“工作日”替代“有学科课”。

## 3. 固定节点预留

先将任务按 `(order, id)` 排序。所有 `fixedDate` 任务只能使用指定日期的槽；所有 `fixedWeek` 任务只能使用指定教学周的槽。固定任务之间按任务顺序占用。固定任务容量不足时产生冲突，未安排部分留在 `unscheduled`；不能越过约束偷偷顺延。固定任务占槽后，普通任务才开始排。

固定节点会占用学期中的真实课时，因此普通任务不能挤占该槽。随后按完整任务队列推进游标：排到固定任务时游标推进至该固定任务的最后一个槽之后；排在固定任务前的普通任务只使用该固定任务首槽之前的空槽。若前置容量不足，其剩余课时进入 `unscheduled` 并产生 `ORDER_BEFORE_FIXED` 冲突，不会挤掉固定考试，也不会在考试之后偷偷补排而破坏顺序。固定任务之后的普通任务从游标位置继续。固定节点本身若无足够槽，返回冲突，不能把考试自动挪期。

## 4. 普通任务分配

按 `order` 处理普通任务，游标只向后移动，且不得越过下一个固定节点的首槽。`allowSplit=true` 时逐个取空槽，给每个课时生成一条课次，并标记 `taskPeriodIndex=1..plannedPeriods`；可以跨日期。`allowSplit=false` 时寻找**同一日期且节次相邻**的连续空槽，数量须达到 `plannedPeriods`，否则跳至下一个日期。跳过的空槽保持空闲，以维护教学顺序。

学期末槽不足时，返回每个任务未排课时和总不足课时。例如总未排为 6 时提示“教学任务超出当前学期可用课时 6 课时。”`allowSplit=false` 因连续槽约束失败时应另列原因，不能把全部问题误报为容量不足。

## 5. 周聚合与展示

课次按 `(date, period, task order)` 排序。周投影收集原始任务 ID，按首次出现去重，保留该周实际计划课时数与日期。跨周任务会在两个周中出现。`13.1、13.2、13.3 → 13.1-13.3` 之类的压缩仅在预览和 Excel 展示时运行，不存入排程结果。周备注是独立记录，不更改任务。

## 6. 计划版本与实际教学

第一次确认生成 V1。再次排程先用现有版本和新结果对比，按任务显示日期/节次移动、增加、移除和冲突；用户确认后追加 V2，旧版保留。由延期触发的重新排程沿用此流程，不能直接改原课次。`ActualTeachingRecord` 继续引用发生时的版本与课次；若补课另建实际记录。`ChangeLog` 记录任务与执行修改，重新排程记录版本创建原因。

## 7. 错误码建议

| 代码 | 含义 |
| --- | --- |
| `INVALID_INPUT` | 日期、节次、课时或任务约束不合法 |
| `NO_SLOT_ON_FIXED_DATE` | 固定日期无可用槽 |
| `FIXED_WEEK_CAPACITY` | 固定周课时不足 |
| `FIXED_CONFLICT` | 固定节点争用同一容量 |
| `ORDER_BEFORE_FIXED` | 前置任务无法在固定节点前完成，剩余课时未排 |
| `NON_SPLIT_UNFIT` | 找不到足够的同日连续槽 |
| `TERM_CAPACITY_EXCEEDED` | 学期可用槽不足，附剩余课时数 |

## 8. 必测场景

| 场景 | 关键断言 |
| --- | --- |
| 正常五天工作周 | 只在有本学科课表的日期排课，节次正确 |
| 国庆放假一周 | 假期零槽，任务顺延，周号按周日边界连续 |
| 周日按周五调休 | 周日取周五的具体节次，不取周日课表 |
| 某日临时停课 | 覆盖为空数组，该日零槽 |
| 2 课时任务跨日期 | 可拆分任务生成 1/2、2/2，任务 ID 相同 |
| 固定期中考试 | 考试仅在固定日期/周，前后任务不占其槽 |
| 总课时超量 | 返回剩余课时及中文可读提示，不静默丢弃 |
| 不可拆分任务 | 跨日不拼接；连续节次不足时报错 |
| 重排 | 旧版本及旧实际记录不变，新版本独立存在 |
| 决定性 | 同样输入多次运行，课次与冲突完全相同 |

待确认规则：`school_event`/`exam` 的默认容量、固定周只能在本周、`allowSplit=false` 的连续定义；见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 风险项。
