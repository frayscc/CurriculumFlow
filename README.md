# CurriculumFlow

面向中学备课组的本地优先教学计划与资源管理工具。V1.4 支持 Docker 与 SQLite 持久化，同时保留双击 HTML 即用的便携版。应用包含学期项目、卡片式工作台、三状态可视化校历、自定义一周起始日、每周四个教学进度、教学任务、自动排课、计划版本、实际教学、延期顺延、考试资源、往届项目复制、Excel 工作计划及完整 ZIP 备份恢复。

## Docker 运行（推荐）

```bash
docker run -d --name curriculumflow --restart unless-stopped \
  -p 8080:8080 -v "$(pwd)/data:/data" \
  frayscc/curriculumflow:latest
```

浏览器打开 `http://localhost:8080`。Docker 版把项目和附件保存到当前目录的 `data` 文件夹。完整部署、升级、备份与云构建说明见 [Docker 部署文档](docs/DOCKER.md)。

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

生产运行：`npm run build && DATA_DIR=./data npm start`。首次联网打开后，PWA 会预缓存页面和导出代码；等待服务工作线程安装完成，再次打开可离线使用。

不安装开发环境时，可从 GitHub Releases 下载便携版 ZIP，解压后使用 Chrome 或 Edge 双击 `index.html`。便携版仍把数据保存在浏览器 IndexedDB 中。

## 每周教学进度

默认将五个工作日映射为四个备课组教学进度：周一、周二、周三/周四、周五。周三和周四显示为同一张计划课时卡片，排课时合计为 1 课时，同时保留两个日期。月历只使用上课、放假、考试三种状态；按数字键 `1`、`2`、`3` 可快速设置，按 `0` 恢复工作日或周末的默认状态。

## 数据存储

Docker 版把结构化数据和考试附件存入 `/data/curriculumflow.db`；网页中的 IndexedDB 作为即时操作缓存，并自动与 SQLite 同步。便携版只使用浏览器 IndexedDB。请定期通过项目页的“完整备份”下载 ZIP 并保存到可靠位置。恢复会校验附件并创建新项目；相同学年、年级、学科和学期的项目不能并存。

备份包含项目数据、原始附件及文件命名设置。导入器限制 ZIP 与附件总量各不超过 750 MB；JSZip 压缩和校验期间会占用额外浏览器内存。更大项目尚未验证。请在空闲时导出备份，并在下载完成后确认 ZIP 文件已保存。

## 项目文档

- [实施计划](IMPLEMENTATION_PLAN.md)
- [数据模型](DATA_MODEL.md)
- [排课规格](SCHEDULER_SPEC.md)
- [现有工作计划分析](TEMPLATE_ANALYSIS.md)
- [开发文档](docs/README.md)

测试覆盖供应的九年级物理工作计划中 20 个非空教学周、跨月展示、延期顺延，以及删除项目后从 ZIP 恢复数据和附件。实际学校校历仍需在项目中核对录入；原工作计划仅作为版式与示例来源，应用不把 Excel 当作数据库。
