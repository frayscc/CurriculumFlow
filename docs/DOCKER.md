# Docker 部署

CurriculumFlow 的 Docker 版包含网页、Node.js 服务和 SQLite 数据库。结构化数据与考试附件都持久化在 `/data/curriculumflow.db`。

## 直接运行

```bash
docker run -d \
  --name curriculumflow \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$(pwd)/data:/data" \
  frayscc/curriculumflow:latest
```

浏览器打开 `http://localhost:8080`。V1.6 首次升级需先初始化管理员，执行 `docker exec curriculumflow cat /data/setup-token` 读取密钥后在网页完成设置。原数据库项目保留并归首位管理员，详见 [多人使用说明](MULTIUSER.md)。页面右上角显示“SQLite 已同步”即表示保存正常。

也可以下载仓库中的 `docker-compose.yml`，在其目录执行：

```bash
docker compose up -d
```

Compose 会把同目录的 `./data` 映射到容器内的 `/data`，数据库文件可以直接在宿主机的 `data` 文件夹中查看和备份。

镜像目前由云端构建为 `linux/amd64`。在普通 AMD64 服务器上，Docker 会直接读取镜像架构，因此 Compose 不需要 `platform` 字段。如果在 ARM 电脑上通过 Docker Desktop 模拟运行，可自行在服务下增加 `platform: linux/amd64`；是否支持模拟由该主机的 Docker 环境决定。

## 升级

```bash
docker compose pull
docker compose up -d
```

升级或重新创建容器不会删除 `./data`。请保留该目录，并避免在容器运行时直接修改其中的 SQLite 文件。

## 备份和恢复

项目迁移使用“完整备份”ZIP；整站备份请以管理员登录，在“账号 → 系统备份与审计”下载数据库，包含账号、权限、所有学年项目和试卷附件。该功能使用 SQLite 在线备份生成一致副本，不包含有效登录会话。备份含密码派生值和教师信息，请加密保管。

整站恢复时先停止容器，把下载文件重命名为 `curriculumflow.db`，放入新的空数据目录，保留原目录作为回退备份。调整数据卷映射到新目录，并确保容器 UID/GID 1000 可读写，再启动；不要混用原目录的 WAL/SHM 文件。恢复后所有人重新登录。也可先执行 `docker compose stop`，再复制整个 `./data` 目录。SQLite 同时使用 WAL 文件，运行中只复制单个数据库文件可能得到不完整备份。

## 从浏览器本地版迁移

V1.6 账号缓存与原个人缓存分开，不自动上传个人浏览器数据。请先在旧个人版或便携版导出“完整备份”，再初始化管理员并恢复 ZIP。原 SQLite 数据不需导入，初始化时原地迁移。无待同步修改时读取服务器；有待同步修改时使用原基线尝试合并，无关项目修改不互相覆盖；真正冲突则停止同步，提示先保留本机副本，再读取服务器。

## Docker Hub 云端构建

GitHub Actions 在推送 `v*` 标签或手动触发时，构建 `linux/amd64` 镜像并发布到 `frayscc/curriculumflow`。仓库需要配置两个 Actions secrets：

- `DOCKERHUB_USERNAME`：`frayscc`
- `DOCKERHUB_TOKEN`：Docker Hub 中创建的 Personal Access Token

令牌只保存在 GitHub Actions secrets 中，不要写进仓库或聊天记录。
