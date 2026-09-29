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

浏览器打开 `http://localhost:8080`。页面右上角显示“SQLite 已同步”即表示保存正常。

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

建议优先使用应用中的“完整备份”导出功能。也可以先执行 `docker compose stop`，再复制整个 `./data` 目录。SQLite 同时使用 WAL 文件，运行中只复制单个数据库文件可能得到不完整备份。

## 从浏览器本地版迁移

服务器数据库为空时，应用会自动把当前站点地址下的浏览器数据上传到 SQLite。由于浏览器会隔离不同网址和本地文件的数据，从双击 HTML 的便携版迁移时，请先在便携版导出“完整备份”，再到 Docker 版恢复。服务器已有数据时，以服务器数据为准。

## Docker Hub 云端构建

GitHub Actions 在推送 `v*` 标签或手动触发时，构建 `linux/amd64` 镜像并发布到 `frayscc/curriculumflow`。仓库需要配置两个 Actions secrets：

- `DOCKERHUB_USERNAME`：`frayscc`
- `DOCKERHUB_TOKEN`：Docker Hub 中创建的 Personal Access Token

令牌只保存在 GitHub Actions secrets 中，不要写进仓库或聊天记录。
