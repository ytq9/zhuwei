# 本地预览与 D1 迁移操作记录

- 日期：2026-09-30；用户明确要求启动预览，随后自行测试。
- 源码：cloudflare 工作区，包含 NPC 审核 A 段及原先保留的改动。
- 本地准备：执行 `node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to .wrangler/vnext/state`，exit 0；仅应用已有的 `0013_smiling_shinobi_shaw.sql`，Wrangler 报告 4 条命令成功。该 migration 创建故事归档分块表并增加检查点字段；未改写 migration 文件。
- 启动：`npm run dev:vnext -- --hostname 127.0.0.1 --port 4320`；独立本地 D1/DO 状态目录为 `.wrangler/vnext/state`，配置关闭 remoteBindings。
- 预览：[酒馆](http://127.0.0.1:4320/hall)。首页、酒馆和 `/api/auth/session` 均返回 HTTP 200；匿名会话为 `user: null`，页面含登录、注册入口。
- 仅核对本地密钥文件及两种模型密钥的配置存在性，没有输出密钥值；由用户登录后操作测试。
- 启动核对未提交游戏行动，未调用真实模型。未执行远端 migration、部署或 push，未清理已有本地房间数据。
- 此记录描述启动时状态，不保证服务在进程退出或系统重启后仍然运行。
