# ZW-mu3qdzkw 首次超时与持续阻塞

2026-09-16，承接[第一轮排查](incident-mu3qdzkw-20260916.md)。用户确认本次是重试，首次失败在昨天。本轮查询限定同一 submission/rootAction 哈希及已匹配房间，没有发送游戏请求、调用模型或修改远端数据。

## 首次失败已找到

以北京时间 2026-09-15 00:00–06:00 的有界历史查询，取得 6 条同一提交记录。命中模型失败后停止后续窗口查询。关联哈希与今天故障完全相同。

| 北京时间 | 记录 |
| --- | --- |
| 2026-09-15 02:59:01.903 | Room prepare 成功，耗时 334 ms |
| 2026-09-15 02:59:47.069 | KP `proposal / offer`，`PROPOSAL_PROVIDER_TIMEOUT`，`providerAborted / modelRequest`，耗时精确为 45,000 ms |
| 2026-09-15 02:59:48.342 | Room Action 返回 `retryableFailure / PROPOSAL_PROVIDER_TIMEOUT`，总耗时 46,773 ms |
| 2026-09-15 03:09:05.217 | 同一提交重试，在 `offer` 准入阶段返回 `STORY_INVOCATION_UNKNOWN`，模型阶段耗时 0 ms |

因此，今天 14:39 的 canceled 请求不构成首次故障原因。首次确定故障是 45 秒时限触发请求中止；日志不能进一步区分 Provider 排队、生成过慢或传输没有及时返回。

## 代码因果链

1. [vNext Adapter](../../../app/_runtime/lib/kp/vnext/adapter.ts)在已取得调用许可后设置 `controller.abort()` 的 45,000 ms 定时器。
2. Provider 抛出中止异常后，Adapter 报告 `PROPOSAL_PROVIDER_TIMEOUT`，并以 `retryable` 完成调用。
3. [Room](../../../app/_runtime/lib/room/durable-object.ts)的 `completeVNextProposalInvocation` 把这种结果写为物理调用的 `unknown`。
4. [Store](../../../app/_runtime/lib/room/story-creation-store.ts)恢复该身份时返回 `STORY_INVOCATION_UNKNOWN`，不再次派发；等到次日或重启也不改变资格。
5. 对外 `retryableFailure` 与[重试分类](../../../app/_runtime/lib/room/telemetry.ts)仍允许普通重试，形成可反复点击但不能解除的阻塞。

前期[旁白超时调整](../../adr/0023-narration-timeout-window.md)仅将冻结旁白总窗口放宽至 180 秒，明确保留其他阶段时限，所以没有改变本次提案的 45 秒。

这条链说明超时为什么变成持续阻塞。它没有证明当前调用有可找回的原始完成响应，也没有将任何测试夹具中的 429 当作此次线上原因。

## 恢复证据边界

通过日志 roomHash 与 D1 的 7 条房间 ID 做命名空间哈希比对，唯一匹配 A48CY8。随后两次只读 SELECT 查该房间检查点及分片目录，分别读取 42、78 行，均写入 0 行。

D1 唯一归档为 2026-09-15 01:21:42.845（北京时间），eventSeq 10、story generation 34、38/38 分片、2,219,866 bytes。它早于本次 02:59 故障，不能提供该调用的完成证据；没有把旧备份覆盖回活跃房间，也没有下载秘密正文。当前活跃 DO 的完整调用记录本轮未直接读取。

## 已验证与建议修复边界

`npx vitest run tests/kp/stories/story-external-invocation-journal.room.test.ts -t 'started and unknown calls never gain a second permit|only proven notSent'`：2/2 通过，5 项未运行。验证超时及重启不授予二次派发、原响应迟到时可保存并复用、只有能证明未发送的调用可恢复发送许可。`git diff --check` 与本回执相对链接检查通过。本轮没有修改业务实现、规格或部署。

建议将修复分成两层：准确呈现无法由普通重试解除的状态；为尚未冻结裁决、未发生随机或机械提交的提案，明确批准一次由玩家触发的有界恢复。恢复必须保留原未知调用和用量占用，绑定原意图与冻结请求，防止旧响应迟到与新响应重复生效，并继续遵守来源及房间预算。若同时把提案等待窗口放宽至 180 秒，需要修改 SPEC 0011 §2 的明确 45 秒条款；未知调用恢复与新增调用资格亦须先裁定适用范围，不能以删除旧记录、换 submissionId 或增加超时时间暗中取得。

脱敏首次失败日志位于本机 Git 忽略目录 `.wrangler/incident-mu3qdzkw/yesterday-summary.json`；D1 结果只保留分片/检查点元数据，临时房间 ID 映射已删除。线上旧行动仍未解锁。
