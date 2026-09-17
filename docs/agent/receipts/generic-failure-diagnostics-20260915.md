# 通用错误日志细分 — 2026-09-15

用户明确将范围纠正为“通用错误都要细分”。本次完成统一诊断及直接错误包装链，未部署、未重试线上房间，未改变玩家恢复策略或未知调用的重发权限。依据 SPEC 0011 §§1、4、5。

## 实现范围

- 原有 13 类故障分类继续用于聚合；失败日志增加 `failureReason`、`failureStage`、`failureRetryability`。有实际证据时保留数值 `providerStatus` / `httpStatus`，没有依据时明确为 `unclassified` / `unknown`。
- 模型边界区分截止、主动中止、限流、容量、服务端错误、额度、鉴权、权限、模型配置、请求、响应格式及网络故障；只有已知名字、固定代码、合法状态码和有界 cause 链能形成诊断。
- 调用账本区分未知结果、在途调用、预算、身份、检查点；旁白保留已有受众、代次、冻结请求和发布阶段的拒绝原因。固定诊断通过私有 Worker RPC 错误消息传递，原始异常不进入消息。
- 归档保留校验、组包、D1 追加、进度保存和调度阶段；Authority 包装保留 prepare/observe/commit/ack 的异常证据；HTTP 入口和目录同步也进入统一序列化。
- vNext 提案的模型和账本异常在被包装前记录；生产回调改用统一白名单，私人选择材料与原始 ID 不写入日志。恢复汇总保留同一次旁白失败的诊断。
- 诊断中的“可重试”不构成派发许可：同一次传输结果被账本记为未知后，RPC 保留原 Provider 原因，同时将诊断标为 `blocked`。公开错误码、既有错误分类消费者和游戏结果保持原策略。

实现导航见 [repo map](../repo-map.md)。没有新增运行依赖、迁移、资源、模型调用或持久化预算配置。

## 实际验证

新增统一诊断测试先红：4/4 因 `failureReason` 缺失失败。最终定向证据共 44 项通过：

| 类别 | 命令与结果 |
| --- | --- |
| Node | `npx tsx --test tests/platform/telemetry/structured-telemetry.test.mjs tests/platform/telemetry/failure-diagnostics.test.mjs tests/platform/telemetry/public-failure-telemetry.test.mjs tests/platform/telemetry/room-authority-telemetry.test.mjs tests/kp/narration/narration-provider-failure.test.mjs`：29/29 |
| 旁白 Worker | `npx vitest run tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts`：11/11，包括真实 RPC、同调用未知恢复、实际传输截止和正常发布 |
| 提案 Worker | `npx vitest run tests/kp/provider/provider.room.test.ts -t 'an ambiguous 429'`：1/1，48 未选中；429 具体原因与后续账本未知分别可见，物理调用仍只有一次 |
| 归档诊断 Worker | `npx vitest run tests/platform/recovery/archive-do-resume.room.test.ts -t 'backs off'`：3/3，8 未选中 |

`npm run typecheck`、`git diff --check` 退出 0。已有 party narration 的源码接线测试定位到现役 `createRoomKpAdapter`，继续检查同一 receipt 回调；没有修改产品行为断言或检查基线。

## 归档扩展检查的缺口

曾运行整个 `archive-do-resume.room.test.ts`，11 项中 6 通过、5 失败，均表现为归档未完成推进。没有把该文件记为全绿。

选取 `uses the bound runtime through vNext export, checkpoint advancement, eviction and D1 recovery`，在改动前已部署的干净源码 `968f0d9489b5cf9d0f7a0781a9c49c7cf07c9ebe` 对照执行。相同断言第 482 行仍失败：预期 `progress.pending === false`，实际 `true`。该代表性失败不是本轮引入；其余 4 项没有逐项做基线对照，未断言它们全部同源，也未扩大为归档修复。

本机证据在 `.wrangler/generic-error-diagnostics-20260915/`；基线对照输出在 `.wrangler/diagnose-narration-block-20260915/archive-baseline-check.log`。未运行 production build、全项目测试/Lint、远端操作或 Git push。
