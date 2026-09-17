# 多人旁白与投影重试快速部署 — 2026-09-14

用户本轮先明确要求“快速部署”，旁白修复上传后追加“投影也部署”。最终现有 Worker `zhuwei` 已同时包含两项修复，控制面确认 100% 流量。公开房间入口冒烟通过；未进行登录后的真实多人或模型复测。

## 发布标识

| 项目 | 实际值 |
| --- | --- |
| 地址 | https://zhuwei.yinskyriver.workers.dev/table/MBDE3S |
| 最终部署时间 | 2026-09-14T23:42:33.352882+08:00 |
| 最终 Worker version | `0fb3a9f3-db19-47e2-a3d2-3932266ebdef` |
| 最终 Deployment | `dedae4d6-9c05-4ac1-af69-a227923c4c40` |
| 最终冻结源码 SHA | `8e05915f11f170e85e17d3263aab624fc67b1c77` |
| 中间旁白 version | `f22dc4b0-c26f-4e27-9a8f-eaf0582beeea` |
| 中间 Deployment | `10ff67ea-8f52-4cdc-96e2-b3f8d7d00678` |
| 中间冻结源码 SHA | `6e3039734fa339e330a549af040f8f4c66a06535` |
| 原线上 version | `f7fb2037-6684-4b6f-a87c-ce9e78e5af8c` |

从此前已部署快照 `a53c09f68ddc39039bea99ea3ed7a737df8062f1` 创建独立、干净的本地 `cloudflare` checkout；首版只加入旁白分类修复和两个测试文件，追加版只加入 table 客户端/服务端及两个测试文件。主工作区 HEAD 仍为 `ff78223102950adb4605d8fee9b8c837a34d55fa`，原分支、暂存区与其他未提交改动保留，无 Git push。

## 影响与兼容性

- [旁白修复](../receipts/multiplayer-observer-narration-20260914.md)：旁观者唯一可见的必需结果不再错误标成不可叙述的 `stepSettlement`。
- [投影修复](../receipts/room-projection-mbde3s-20260914.md)：临时 Room 读取失败走查询错误/重试路径，保留桌面和草稿；拒绝或不合格投影仍停止展示。
- 为保护当前房间，撤回旁白修复中非必要的 Prompt 补充及 v18 升版，只修正违反既有合同的材料分类实现。候选完整工作流与前一线上快照逐字一致；只读 D1 核对 MBDE3S 的绑定也精确匹配，workflow 字符串 SHA-256 均为 `ea33f8369e2a3c1692db464b2207e7edd380502ea499c16b0532baa8aba27bc0`。未放宽任何版本校验、迁移或退役房间。
- 保持当前协议与数据，若出现问题优先前向修复；这次没有改变持久化 schema 或权威事件解释。

## 实际检查与操作

按[快速发布流程](release.md)执行，未运行全项目测试或 Lint。

| 检查/操作 | 结果 |
| --- | --- |
| 最终旁白 presentation/generation/review Node 定向组 | 27/27；撤回 Prompt 补充后重新通过 |
| 旁白 multiplayer-publication Room 纵切 | 1/1；冻结候选执行 |
| 投影 table-sync / player-error-feedback Node 定向组 | 5/5；最终冻结候选执行 |
| 投影 table-sync Room 服务集成 | 1/1；最终冻结候选执行 |
| `npm run typecheck` | 两个不同候选各一次，均 exit 0 |
| 精确 SHA 的部署保护 | 两个候选构建前/上传前均 exit 0 |
| `npm run build` | 两个不同候选各一次，均 exit 0；追加授权后形成第二候选 |
| `wrangler whoami`、部署/版本读取 | exit 0；现有账号及 Worker |
| `wrangler d1 migrations list DB --remote` | exit 0，无待处理 migration |
| `wrangler d1 execute DB --remote` | 只读 MBDE3S 工作流绑定，精确匹配 |
| 指定 `CI=1 DEPLOY_SOURCE_SHA` 的 `wrangler deploy --message` | 两次 exit 0；各自复用已验证构建 |
| 发布后 deployment/version | 最终版本 100%；资源绑定、Secret 名称、compatibility 与 DO migration tag 均与原版本一致 |
| 源码及构建指纹 | 中间 1,259、最终 1,261 个文件在各自上传前后保持一致 |
| 浏览器公开入口冒烟 | 页面标题“跑团桌｜烛帷”，显示“先登录，再入座”及登录入口 |
| `git diff --check` | 通过 |

现有资源仍为 `DB/zhuwei-dev`（`f5a448fd-4224-4e52-bafb-a84cb190b618`）、`ROOMS/RoomDurableObject`、`AI`、`ASSETS`；DO migration 为 `room-do-v1`。没有远端 migration、Secret 修改、新资源、房间删除或 Git push。

当前证据证明部署与公开入口可达；没有登录后的多人实测，不承诺补发历史未成功旁白。投影读取最初为何异常仍以排查回执的未闭合范围为准，不能将桌面保留修复说成已消除所有后端异常。

本机操作证据：`.wrangler/quick-deploy-multiplayer-20260914/` 和 `.wrangler/quick-deploy-projection-20260914/`，包含独立冻结源码、检查/构建/部署日志、控制面 JSON、兼容性及文件指纹。无密钥进入快照或公开记录。
