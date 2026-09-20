# 开发文档

核心规则与阶段目标见仓库根目录的 `IMPLEMENTATION_PLAN.md`、`DATA_MODEL.md` 和 `SCHEDULER_SPEC.md`。

数据库 schema 从版本 1 开始，版本 2 为实际教学记录增加项目索引，版本 3 为计划课次、考试、注记、专训等表补充项目索引。升级通过 Dexie 版本声明完成，不清空已有数据。页面只处理展示与交互，排课、日历、命名、Excel 和备份逻辑分别放在 `src/core/`。

`src/tests/acceptance.test.ts` 覆盖规格书第 88 节的数据闭环；`src/tests/samplePhysics.test.ts` 使用所提供工作计划转录的周内容和课时验证 21 周、24 行的排课与导出投影。PWA 构建生成 `manifest.webmanifest`、`sw.js` 和静态资源预缓存清单。当前自动化没有真实浏览器的断网操作测试，离线可用性还需在目标设备上实测。
