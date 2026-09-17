# ZW-mu3qdzkw 故障排查

2026-09-16，故障编号 `ZW-mu3qdzkw-3824df180bd64212a2ae80f115e6fab7`，请求时间 `2026-09-16T06:40:01.376Z`。在已有未提交改动的 `cloudflare` 工作区排查，保留原有差量。远端仅查询历史日志与可查询字段，没有发送游戏请求、模型调用、远端写入或部署。

## 已确认的游戏故障

以下时间均为北京时间，记录通过同一 submission 哈希关联；没有按同房间或相近时间推定关联。

| 时间 | 证据 |
| --- | --- |
| 14:39:52.931 | 同一提交的前一次 `http.game.started` |
| 14:39:54.252 | 上述请求的 Cloudflare 原生请求记录为 `canceled`，wall time 2,040 ms，CPU 16 ms |
| 14:40:01.842 | 本故障编号的 `http.game.started` |
| 14:40:03.490 | `room.authority.prepare.completed`，结果 `prepared` |
| 14:40:03.715 | HTTP、Room Action 和 KP invocation 均报告 `STORY_INVOCATION_UNKNOWN`；分类为 `invocationOutcomeUnknown / invocationJournal / blocked` |

KP 记录显示 `modelTask=proposal`、`modelStage=offer`、`durationMs=0`。该次尝试在调用账本准入阶段停止，没有取得重新发送模型请求的许可。Cloudflare 记录的运行版本为 `c4fad104-31f0-43b5-a952-2276c54f093f`，与[诊断能力发布记录](../releases/game-diagnostics-20260916.md)一致。相关 Store、Room、提案恢复和 KP Adapter 文件与该发布的冻结源码逐字一致。

这证明本次阻塞位置，不证明最初为何产生未知调用。`canceled` 也不证明由谁取消、模型是否曾发送，或其与未知状态的因果关系。可能需要追溯更早的首次失败或检查精确绑定的调用记录。24 小时范围的两次精确哈希查询均没有命中，甚至未重现已知的当前记录，因此不作为“此前没有失败”的证据。已向用户询问本次是新行动还是重试，以及最早失败时间。

没有修改或解锁游戏调用记录。SPEC 0011 §2 与 SPEC 0016 §7.2 要求保留原调用身份，未知结果不能自动重采样。

## 排查中复现并修复的查询缺陷

原命令 `npm run diagnose -- --reference ZW-mu3qdzkw-3824df180bd64212a2ae80f115e6fab7` 只返回 2 条 HTTP 记录；同一时间窗口的结构化日志中实际存在 6 条同提交记录。

根因是 Cloudflare 将结构化 JSON 字段直接索引：应用 `requestId` 会覆盖 `$metadata.requestId`，而这些记录没有 `$metadata.message`。查询工具错误地把前者当作平台请求身份、把后者当作结构化日志全文，因而漏掉 Room 和 KP 关联记录。

[查询工具](../../../tools/diagnose-game.mjs)现从 `$workers.requestId` 取得平台身份，按实际 `submissionHash/rootActionHash/receiptHash` 字段精确关联，并保留旧字符串日志的 message 匹配。Worker、时间、分页和最多 20 个关联条件的边界不变。此修改只在本地查询工具生效，不需要部署 Worker，也不改变游戏恢复资格。

## 实际验证

- 新增索引语义回归用例先红：4 条预期记录只取得 1 条。
- `npx tsx --test tests/platform/telemetry/game-diagnostics.test.mjs`：7/7 通过，覆盖关联、同房间无关提交隔离、其他 Worker 隔离、脱敏、分页上限和权限错误。
- `npx vitest run tests/kp/provider/provider.room.test.ts -t 'ambiguous 429 preserves an unknown dispatch|rejects concurrent duplicate starts'`：2/2 通过，另 47 项未运行。此结果验证未知调用不重发及正常调用的权限边界；不证明线上首次故障就是 429。
- `npx eslint tools/diagnose-game.mjs tests/platform/telemetry/game-diagnostics.test.mjs`：通过。
- 原故障编号再次执行历史查询：`found`，取得全部 6 条已知关联结构化记录；未达到分页上限。
- `git diff --check`：通过。没有运行全量回归、build、部署或 Git push。

脱敏报告和修改前快照保存在本机 Git 忽略目录 `.wrangler/incident-mu3qdzkw/`。原始日志、请求头、模型文本和凭证未写入本回执或证据文件。游戏故障的首次原因及线上恢复仍未解决。
