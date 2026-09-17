# 旁白发布分级与有界修稿发布

2026-09-15，用户明确批准实现，并承接同一线上事故的“快速部署”授权。产品决定见 [ADR 0024](../../adr/0024-narration-publication-and-bounded-repair.md)，现行规则见 [SPEC 0016 §8.3](../../specs/0016-part-c-compound-actions-and-claims.md#83-narrationgrounding-与重试)。只更新现有 Worker `zhuwei`。

## 结果与直接影响

原流程把纯表达意见也作为发布拒绝；恢复复用相同审核响应，反复点击无法改变结果。新的独立发布策略允许只有表达意见的有效报告原文发布；具体实质问题允许一次修稿及一次复审，最多四阶段。损坏或矛盾报告、实质不确定、复审仍拒绝时停止。所有阶段共用原回执、Viewer、冻结材料、delivery generation、原预算账户及本次 180 秒窗口。

前两阶段请求与既有工作流哈希保持不变。新增阶段由 Room 根据已完成原稿和审核重建请求，使用独立发布策略哈希；第四阶段完成后才能发布精确通过的修稿。已完成调用只重用，未知调用不重采样；原草稿、诊断、修稿、复审留在既有私有调用账本，普通日志不增加原文。恢复资格由 Room 读取本受众调用记录派生，前端据此显示按钮；旧表达拒绝可以恢复，终局拒绝及未知物理调用不显示无效重试。

包含修稿阶段的归档使用 v2 旁白宿主格式；既有 v1 保留原校验。两者均严格重建请求和恢复绑定，不新增表或 migration。未修改 Proposal、Rules、骰子、资源或行动结算。

## 冻结与验证

从上一版已部署源码 `e7705e700f690bea20b769b04d690eb4dfe54249` 建立独立 `cloudflare` 候选，逐项审查并复制本次 26 个代码、测试、规格和导航文件。根工作区中的其他差量保留，根分支未提交或清理。

冻结源码：`3a767304768b4edaf86a8b64192297db6312f5c1`。

| 证据 | 实际结果 |
| --- | --- |
| Node：publication-repair、review、recovery、narration-provider-failure、delivery-confirmation | 45/45 |
| Node：story-archive-host 中 narration 定向用例 | 2/2，v1/v2 导出恢复及伪造绑定拒绝 |
| Worker：interrupted-publication、multiplayer-publication | 17/17，真实 Room/RPC、旧表达拒绝恢复、修稿阶段中断、未知结果、原稿强行发布拒绝、多人受众隔离 |
| 候选 typecheck、spec:check、部署 guard、git diff --check、build、deploy | exit 0；spec:check 为 0 错误、7 条文档警告 |

开发验证中，新增归档测试初次因夹具遗漏既有恢复所需的 source budget quarantine 被拒绝，补齐夹具后通过，未放宽恢复校验。归档格式扩展触发 TypeScript 联合类型收窄错误，改为显式格式判别联合后通过。冻结候选上述 64 项全部通过，未执行全项目测试或 Lint。

## 部署事实

- Worker version：`007fa66b-afaf-4517-9224-ebafde0c970c`。
- Deployment：`16784d99-fe44-44e1-8b76-47ef7bb0c6f9`，北京时间 2026-09-15 02:55:19，100% 流量。
- 控制面确认 AI、ASSETS、D1 `zhuwei-dev`、ROOMS 与既有 Secret 名称绑定均与前版本一致。
- 1158 个跟踪源码文件、112 个构建文件上传前后 SHA256 一致；26 个任务文件与根工作区逐字一致。
- 未执行 Git push、远端 migration、Secret 变更或新建资源。
- 无认证路由直连在 TLS 阶段失败；一次代理通道对照返回 HTTP 200，1.375 秒。不把直连失败归因于业务代码。

脱敏清单、命令输出、控制面记录和本次恢复计划保存在 `.wrangler/narration-repair-20260915/`。未覆盖的长期 SLO、真实模型语义稳定性及历史归档故障保留原边界；本次归档往返通过不代表旧归档事故已修复。


## 线上恢复验证

本次预先限定 A48CY8 的现有回复恢复一次、不提交新玩家行动、最多新增两次修稿相关调用，首个恢复完成即停止采样。北京时间 02:57:33–34 的日志显示同一原行动哈希 `sha256:ddecfd6278fc46d3d8a3500d34e02f62953a1dd2e8c377492f8ba71346258384`：narrationRecovery 与 narrationRecoveryReview 均为 success、各 92 ms，随后 room.viewerNarrationRecovery.completed。没有进入第三、四阶段。

认证 Chrome 桌面实际出现该行动对应的莉安回应，确认原来卡住的正文已经送达。原生成和审核在前次故障中已完成，此次依照同一调用身份复用；没有提交新行动或重新结算。此次证明线上表达拒绝恢复成功，实质错误的修稿/复审已通过定向确定性测试，未另造线上错误调用模型做采样。
