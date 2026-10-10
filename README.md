# CurriculumFlow

面向中学备课组的本地优先教学安排与资源管理工具。V1.6 支持多人账号、分年级备课组与年度试卷资源库，使用 Docker 与 SQLite 持久化，同时保留双击 HTML 即用的个人便携版。应用支持在月历中直接拖放新课、练习和考试，以日期跨度表示安排长度，并提供往届项目复制、Excel 工作计划、项目 ZIP 备份和管理员整站数据库备份。

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

生产运行：`npm run build && DATA_DIR=./data npm start`。PWA 会预缓存页面和导出代码；多人账号版启动时仍需连接服务端验证身份。需要完全离线使用时选择便携版。

不安装开发环境时，可从 GitHub Releases 下载便携版 ZIP，解压后使用 Chrome 或 Edge 双击 `index.html`。便携版仍把数据保存在浏览器 IndexedDB 中。

## 月历教学安排

先录入教学内容，再把卡片拖入月历中的上课日。拖动卡片右侧手柄可改变日期跨度；放假日、考试日不允许放入教学内容。月历中最后保存的安排就是最终版，不再另行记录计划与实际执行差异。日期状态可用数字键 `1`、`2`、`3` 快速设置，按 `0` 恢复默认状态。

## 数据存储

多人账号版支持管理员、普通老师和按备课组授权的组长。教学项目按学年、年级、学科隔离，试卷资源全校共享下载。首次升级需要初始化管理员，旧数据会原地迁移；部署和权限说明见 [多人使用说明](docs/MULTIUSER.md)。

Docker 版把结构化数据和试卷附件存入 `/data/curriculumflow.db`；网页中的 IndexedDB 作为即时操作缓存，并自动与 SQLite 同步。便携版只使用浏览器 IndexedDB。请定期通过项目页的“完整备份”下载 ZIP 并保存到可靠位置。恢复会校验附件并创建新项目；相同学年、年级、学科和学期的项目不能并存。

备份包含项目数据、原始附件及文件命名设置。导入器限制 ZIP 与附件总量各不超过 750 MB；JSZip 压缩和校验期间会占用额外浏览器内存。更大项目尚未验证。请在空闲时导出备份，并在下载完成后确认 ZIP 文件已保存。

## 项目文档

- [实施计划](IMPLEMENTATION_PLAN.md)
- [数据模型](DATA_MODEL.md)
- [排课规格](SCHEDULER_SPEC.md)
- [现有工作计划分析](TEMPLATE_ANALYSIS.md)
- [开发文档](docs/README.md)

测试覆盖供应的九年级物理工作计划中 20 个非空教学周、跨月展示、延期顺延，以及删除项目后从 ZIP 恢复数据和附件。实际学校校历仍需在项目中核对录入；原工作计划仅作为版式与示例来源，应用不把 Excel 当作数据库。
