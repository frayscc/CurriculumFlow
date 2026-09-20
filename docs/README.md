# 开发文档

核心规则与阶段目标见仓库根目录的 `IMPLEMENTATION_PLAN.md`、`DATA_MODEL.md` 和 `SCHEDULER_SPEC.md`。

数据库 schema 从版本 1 开始，版本 2 为实际教学记录增加项目索引。升级通过 Dexie 版本声明完成，不清空已有数据。页面只处理展示与交互，排课、日历、命名、Excel 和备份逻辑分别放在 `src/core/`。
