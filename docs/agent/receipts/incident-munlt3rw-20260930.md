# ZW-munlt3rw：隐蔽行动草稿误失修订资格

- 日期：2026-09-30；分支 `cloudflare`，基点 `b6fac1fa75cc278f16eb50c1470eff973ff3f0a8`，保留既有未提交差量。
- 故障编号：`ZW-munlt3rw-0caaadb5fb8043c6ace163bf67fcdc8c`。
- 用户请求时间：`2026-09-30T04:27:12.092Z`，北京时间 12:27:12.092。
- 用户在 [NPC review 修复](npc-reply-review-follow-up-20260930.md)后要求“后续修复故障”，本轮恢复该故障的修复。

## 定位证据与根因

按时间和用户补充的完整行动原文，匹配本地 submission `e9560d06-51f5-479b-ad1d-c96248dca38e`。原 HTTP 控制台输出已被截断，因此这是保存请求与原文的匹配，不宣称恢复了故障编号到内部 submission 的完整日志链。

保存记录只有选择、填写两个完成的模型调用。选择了 `social`；填写的 `decision.kind` 为 `concealedCheck`，模型把本应位于根部的 `check`、`steps` 放进了 `decision`。解码器正确报告 `filling:check-belong-to-the-root`，字段位置为 `/decision/check`。

**根因不是“没有修订工单”，而是工单随后被错误的额度判断挡住。** `vnextProposalRevisionCandidate` 已保存可解析的原稿与诊断，首轮返回 `repairRequired`；但 `vnextProposalHasExecutionRepairBudget` 的裁决类型判断只写了 `directSuccess`、`check`，漏掉 `concealedCheck`。这个尚未解码成功的草稿也没有根部步骤，因而被误当成两次调用已用完的终结表单，返回 `repair:terminal-selection-call-budget-exhausted`。

同一判断由 Adapter 和 Room 调用账本复用。最小 Room 复现得到与故障相同的两个诊断、`PROPOSAL_REPAIR_EXHAUSTED` 和 `action: notCommitted`，修复前失败、修复后通过。只读查询原行动的权威事件数仍为 0，无须回滚。

## 修改与边界

- 额度判断直接复用填写合同的 `PROPOSAL_RULING_KINDS`，使隐蔽检定与其他执行裁决一致；不另维护一份易漏项的名单。
- Parser 升至 `kp-vnext2-proposal-parser-v78`，同步工作流 pin 和实现导航。工作流 hash：`sha256:e2bb8e4b74ef3a1385d33f01d38ddb7832d0a167610ade3c7dfd8915ab29f2a2`。
- 不移动或改写模型原稿中的字段；仍将原稿及诊断交给模型修订，再完整校验。没有增加修订轮数、来源额度或未知调用替补。
- 仅选择终结表单、未选择执行类型、实际只使用终结表单但闲置执行类型，均保留原拒绝边界。
- 适用合同为 SPEC 0001 §17、SPEC 0016 §7.2。无需修改已批准规格或新增 ADR。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 原始保存响应离线重放 | 进入 `repairRequired`，执行额度为 true，原工单可重证，修订请求读到精确原稿；派发边界主动停止，真实模型调用 0 次 |
| `proposal-revision.test.mjs`、`publication-repair.test.mjs` | 22 项通过 |
| Provider Room 定向组 | 6 项通过：嵌套隐蔽检定、原空步骤正常修订、终结额度拒绝；保存修订后驱逐恢复复用响应、提交一次且重复无新调用/状态变化 |
| `npm run gates:check` | exit 0；76 个声明测试文件全绿，规格错误与断链均为 0，基线未放宽 |
| `git diff --check` | 通过 |
| 本地预览 | `http://localhost:3000/hall` 返回 HTTP 200 |

前轮 review 中两项波动在本次规格门里未出现；没有将其登记为已定位或已修复。本轮未改共享类型或公共签名，未重复运行 typecheck；未运行 `npm test`、production build、部署、远端 migration 或 Git push。

## 私有证据与未覆盖范围

本地目录 `/tmp/zhuwei-munlt3rw/` 保存原捕获、修复前 Room 失败、定向通过、规格门输出，以及 `replay-repair-admission.mjs` 与脱敏结果 `repair-admission-result.json`。原模型 arguments 的 SHA-256 为 `b0ca54d497a729a6ec2098f433e95814ee8e50e948e74952685bc6a61c4b447c`，重放未修改保存响应。

没有替用户重新提交真实游戏行动，未新增付费调用。验证证明系统不再漏掉这类草稿的既有修订资格，不证明模型下一次一定能给出正确方案；此前 NPC 审核报告格式的稳定性问题仍以对应回执为准。
