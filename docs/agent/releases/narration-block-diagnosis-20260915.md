# MBDE3S 旁白恢复阻塞诊断 — 2026-09-15

用户要求“去查一下为什么阻塞”，承接本任务已授权的现有 `zhuwei` 快速部署与单次恢复排查。已定位直接拒绝原因，尚未恢复这条旧回复。

## 线上结论

北京时间 01:10:28，同一房间、同一旧行动的 `room.narration.invocation.blocked` 返回 `outcomeKind: callOutcomeUnknown`，用途为 `narrationRecovery`。该分支仅映射物理调用账本的 `STORY_INVOCATION_UNKNOWN`，出现在 `beginModelStage` 之后、`transport.run` 之前，因此本次恢复没有发送新模型请求。它不是再次耗尽 180 秒窗口，也不是此次请求身份冲突或预算耗尽。

旁白 Adapter 段为 123 ms；外层恢复请求平台 wall time 为 16,247 ms、CPU 39 ms。DO 拒绝所在请求为 wall time 106 ms、CPU 41 ms。应用内 `durationMs: 0` 不能解释成物理调用瞬时完成；平台时间用于区分整次请求和局部诊断段。

代码因果链：已发出的调用未获得可用完成记录，或处于恢复隔离时，账本返回 `STORY_INVOCATION_UNKNOWN`；Room 拒绝再次派发；Adapter 将其收敛为 `modelTransient`；前端显示通用“暂时不可用或超时”，并继续提供不能解开该状态的普通重试入口。原行动仍为 `committed`。这解释了延长窗口后该条回复仍失败。

现有日志没有区分当前调用自身 `unknown` 与同来源的恢复隔离，也不能确定最初响应丢失发生在 Provider、传输中断还是 Worker 中断。最初 45 秒失败与该状态的关联符合代码路径，但没有把最初中断原因作为已证实结论。未取得原 Provider 完成响应，未改写调用记录、重新结算或重采样。

[SPEC 0011 §2](../../specs/0011-reliability-correction-observability-and-evaluation.md#2-slo) 明确要求“保留原回执、冻结材料与实际调用身份，不以放宽窗口授权重新采样未知结果”。现役恢复需要同一调用的有效完成证据；若要在缺失原响应时仅重新生成旁白，须先明确修改这一产品恢复合同，不能靠删除未知记录实现。

## 同期归档证据

本次捕获的归档失败为 `archiveFailureStage: buildEnvelope`、`archiveFailureCode: STORY_ARCHIVE_BINDING_INVALID`，平台 CPU 约 17.6–18.3 秒、wall time 约 22.1–23.7 秒。一次投影读取应用段约 18 秒，随后一次为 381 ms。证明房间确实存在昂贵且失败的归档任务；没有证明它与旧旁白账本拒绝是同一个根因。

此前[归档诊断](../receipts/archive-diagnosis-mbde3s-20260915.md)复现的是旧旁白 host binding 与新版材料分类的兼容缺陷；本次线上错误码为 `STORY_ARCHIVE_BINDING_INVALID`，不能把两者直接等同。

## 发布与验证

| 项目 | 实际值 |
| --- | --- |
| 冻结源码 | `968f0d9489b5cf9d0f7a0781a9c49c7cf07c9ebe` |
| 基线源码 | `1ccab99b32a6a01f2ebea90e06642f51a688cd15` |
| 前版本 | `940da199-bc18-4af4-a36e-92ed8be23fdb` |
| Worker version | `b7f0ac75-4c85-4d3f-97ad-9af968fb261f` |
| Deployment | `9c565de9-dc90-4a1c-af10-507d3da3a672` |
| 生效时间 | 2026-09-15 01:04:10.032828 北京时间 |
| 流量 | 100% |

在另一个任务完成归档诊断部署和采样后，基于其干净 `cloudflare` 源码冻结，仅修改 `runNarrationInvocation` 的失败诊断和一个已有恢复用例。保留原归档诊断与 180 秒旁白窗口。日志只输出固定分支、用途、哈希关联和耗时，不输出异常正文、Prompt、响应或 capability；日志自身异常不改变原结果。

- 新诊断断言先红，修复后主工作区及冻结候选的 `npx vitest run tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts` 均 10/10。覆盖原未知调用重复恢复、已有完成响应复用、正常与多人发布、迟到发布者拒绝、慢回复窗口及隐私字段不泄漏。
- 冻结候选 `git diff --check`、部署 guard、一次 `npm run build`、一次 `wrangler deploy` 均 exit 0。当前补丁没有公共签名、DTO 或持久化结构变化，未重复全量类型检查、Lint 或测试。
- 部署前后 Wrangler deployment/version 读取 exit 0，bindings 和 runtime 一致；1,153 个源码文件、112 个构建文件上传前后 SHA256 一致。沿用同批前序归档发布刚完成的无待处理 migration 证据；本次未运行 migration。
- 浏览器加载阶段的最多 230 秒采样只取得归档/投影事件；桌面可用后另开最多 230 秒恢复采样。一次 UI 操作因页面状态变化被工具拒绝，重新读取页面后成功执行一次恢复点击；日志确认一次恢复拒绝后采样立即停止。没有第二次成功点击、新玩家行动或新物理模型调用。
- 未改 Secrets、创建资源、修改远端数据库或执行 Git push；主工作区分支、HEAD、暂存区及其他任务差量保留。

本机脱敏证据与冻结清单位于 `.wrangler/diagnose-narration-block-20260915/`，恢复证据为 `live-recovery-telemetry.json`。诊断已上线；旧回复仍未送达，不能声称正常游玩已恢复。
