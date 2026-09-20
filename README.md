# CurriculumFlow

面向中学备课组的本地优先教学计划与资源管理工具。当前已完成 V1 开发的 Phase 1–4：学期项目管理、校历课表、教学任务队列及独立排课引擎。计划视图、考试资源与导出功能将按 [实施计划](IMPLEMENTATION_PLAN.md) 继续开发。

## 运行

要求 Node.js 24 和 npm。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。检查命令：

```bash
npm run lint
npm run test
npm run build
```

## 数据存储

结构化数据和未来的考试附件保存在浏览器 IndexedDB 中，数据库名 `CurriculumFlow`。当前不依赖服务器或账号，也不上传教学数据。浏览器清除网站数据会删除本地项目；完整 ZIP 备份与恢复在 Phase 10 实现。在该功能完成前，请不要把此开发版本作为唯一数据副本。

## 项目文档

- [实施计划](IMPLEMENTATION_PLAN.md)
- [数据模型](DATA_MODEL.md)
- [排课规格](SCHEDULER_SPEC.md)
- [现有工作计划分析](TEMPLATE_ANALYSIS.md)
- [开发文档](docs/README.md)

界面截图将在主要页面完成后添加。
