# MBDE3S 旁白中断恢复快速部署 — 2026-09-15

用户本轮明确要求“快速部署”。现有 Worker `zhuwei` 部署完成，控制面确认新版本接收 100% 流量；MBDE3S 登录后的页面已显示“行动已经结算，但这条 KP 回复尚未送达”和“重试 KP 回复”，永久等待的失败呈现路径在线上生效。没有点击重试或发送玩家行动，不把恢复入口可用等同于模型回复已经恢复。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 房间入口 | https://zhuwei.yinskyriver.workers.dev/table/MBDE3S |
| 部署时间 | 2026-09-15 00:07:30.689758，Asia/Shanghai |
| Worker version | `65ce7151-8b30-4f5a-938e-a33a20099f90` |
| Deployment | `7844cd3c-d42b-4ac0-a683-2764367cca02` |
| 冻结源码 SHA | `fd9788ef5e95007ba1090ebdde1cf724c67fae7b` |
| 上一线上 version | `0fb3a9f3-db19-47e2-a3d2-3932266ebdef` |
| 上一冻结源码 SHA | `8e05915f11f170e85e17d3263aab624fc67b1c77` |
| 主工作区 HEAD | `ff78223102950adb4605d8fee9b8c837a34d55fa`，保持不变 |

部署前发现并核对[此前投影发布](multiplayer-projection-hotfix-20260914.md)已经完成：本次以其干净快照为基线，保留已上线的多人旁白及投影保留修复。只加入 Room action、authority-store、durable-object、story-narration 四个运行时文件及中断恢复测试。生产源码与主工作区对应文件逐字一致；其他生产代码、工作流、依赖和构建配置与上一线上候选一致。

在独立本地 `cloudflare` checkout 形成冻结 commit，未修改主工作区分支、暂存区或既有差量；无 Git push。本地快照不是远端提交。

## 影响与兼容

修复依据与中断矩阵见[本地修复回执](../receipts/room-narration-mbde3s-20260915.md)。受众发布增加两分钟期限和私有尝试编号，观察接口识别失效 pending；恢复保留原 Receipt、Viewer、冻结材料、delivery generation 和实际模型调用身份，旧尝试不能覆盖新恢复。已存响应复用，未知结果仍不重新采样。

DO 私有 SQLite schema 在原 `ensureSchema` 中增加两条可空 INTEGER 列 `publication_lease_until`、`publication_attempt`，旧记录数据保持。既有 Room 的增列与写入—读取恢复在冻结候选的 Worker 测试中通过。这是随代码运行的局部 schema 升级；Cloudflare DO migration tag 仍为 `room-do-v1`，没有执行远端 D1 migration 命令、清理房间或修改权威事件解释。

出现问题优先按当前数据做前向修复，保留所有已有提交及物理调用记录，不通过换模型、重采样或回滚事件消除错误。

## 实际检查与操作

按用户“快速部署”及[快速发布流程](release.md)执行，没有全项目测试或 Lint。

| 检查/操作 | 实际结果 |
| --- | --- |
| `wrangler whoami`、部署前 deployment/version 读取 | exit 0；既有账号、Worker 和版本 |
| 冻结候选 Worker 定向组 | 9/9：中断恢复 7 项、正常多人旁白 1 项、投影 Room 服务 1 项 |
| 冻结候选 Node 定向组 | 5/5：桌面同步与公开错误反馈 |
| `npm run typecheck` | exit 0 |
| `wrangler d1 migrations list DB --remote` | exit 0，无待执行迁移 |
| `CI=1 DEPLOY_SOURCE_SHA=… node cloudflare/verify-deploy-config.mjs` | 构建前和上传前均 exit 0；未放宽保护 |
| `npm run build` | exit 0，一次 production build |
| `CI=1 HTTPS_PROXY=… DEPLOY_SOURCE_SHA=… npx wrangler deploy --message …` | exit 0，复用冻结构建；只在进程内使用机器已有代理 |
| 部署后 deployment/version 读取 | exit 0；新版本 100% 流量 |
| 绑定与 runtime 配置比较 | 与原版相同：DB、ROOMS namespace、AI、ASSETS、Secret 名称、compatibility、DO migration tag |
| 源码及构建指纹 | 1,150 个源码文件和 112 个产物在上传前后均不变 |
| 登录房间冒烟 | Chrome 已显示未送达错误与“重试 KP 回复”；没有触发模型或发送新行动 |
| `git diff --check` 与回执链接核对 | 通过 |

定向命令：

```sh
npx vitest run tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts tests/product/table/table-sync.room.test.ts
npx tsx --test tests/product/table/table-sync.test.mjs tests/product/safety/player-error-feedback.test.mjs
```

现有资源仍为 `DB/zhuwei-dev`（`f5a448fd-4224-4e52-bafb-a84cb190b618`）、`ROOMS/RoomDurableObject`、`AI`、`ASSETS`。没有 Secret 变更、新资源、远端 D1 migration、Git push 或房间数据删除。

本机证据位于 `.wrangler/quick-deploy-narration-recovery-20260915/`：独立 `source/`、源码/产物指纹、测试/类型/构建/部署日志、部署前后控制面 JSON、迁移只读结果和脱敏 `smoke.json`。未复制密钥。

## 尚未证明

这次确认本地验证、部署生效和 MBDE3S 的恢复入口。没有点击“重试 KP 回复”，因此没有宣称原回复已送达、未知调用已恢复或新行动已成功。最初投影断开的平台/RPC 触发原因仍未闭合。
