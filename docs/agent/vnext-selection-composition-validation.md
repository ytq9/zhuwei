# 选择阶段的组合：完整填写边界前移 + 一次补选

2026-09-07。基线 `9a631fc` 加本次改动。用户裁定「甲和乙直接都做」，两项一并落地。开发期任务，零 API 调用，未部署、未 push。

设计依据与备选方案见[提案](vnext-selection-composition-proposal.md)；起因见 [round75 回执](vnext-round75-validation.md)。

## 能力合同

**模型在唯一能选择类型的时刻，必须看得见每个类型的完整填写边界；如果填写时才发现所选类型不足以表达完整意图，可以按并集补选一次。**

变化维度是「一句意图需要几个类型的组合」，不是某个具体类型。两项都不改变权威顺序：补选只加类型，不改冻结上下文、不重开裁决、不允许减少已选类型。

## 甲：完整填写边界前移到选择阶段

此前选择阶段只有 15 个能力的一句话摘要，详细填写指导在第二轮按已选能力加载，且填写提示词明写「不能再次选择 schema」。`social` 的详细指导里那句「需要时间或额外成本的行动必须有独立可执行计划」，模型读到时已经无法再加类型。

现在 `vnextProposalSystemPrompt("offer", …)` 附上全部类型的完整填写边界。offer 提示词从约 1,900 字符增至 **7,961 字符**（round75 的 offer 调用实际输入 19,293 token，预算上限 58,000）。

**守住的不变量**：选择阶段仍然不携带 `authority`、`planRuling`、`terminalRuling` —— 也就是裁决权威与决定填写规则。选择不能变成裁决。`kp-vnext-schema-retrieval.test.mjs` 的相应断言按此更新：三者仍断言缺席，`filling` 改为断言存在。

## 乙：一次补选

- 提案调用（ordinal 2）同时提供 `submit_kp_proposal_bundle` 与 `offer_kp_proposal_bundle`。模型调用后者即补选请求，复用既有 offer schema 与解析器，**不新增工具、不新增 schema**。
- 服务器取并集，按并集重新派生表单，ordinal 3 只提供 submit 工具 —— 补选只有一次。
- ordinal 4 只在补选真的发生过时存在，用于结算补选后那一稿（重发或修订）。
- Room 从**保存的 ordinal 2 响应**自行判定是否发生补选，不接受调用方声称；ordinal 4 在没有补选时被拒。

`callPolicy` 相应改为 `selections 1 / selectionAmendments 1 / proposals 1 / terminalMaximumTotal 3 / stepMaximumTotal 4`。

### 矩阵抓到的一个真实设计错误

初版只并了 capabilities。但 **`passTime` 是 terminal 不是 capability** —— 也就是说那一版补选会把 round75 真正需要的那一半悄悄丢掉，并且因为「没新增 capability」而被判为空补选拒绝。修正后补选同时并 capabilities 与 terminalKinds，并沿目录自身的拆分保留 `requestedCapabilities` / `requestedTerminalKinds`。

这是本次最有价值的一次失败：如果没写这条矩阵，改完仍然救不了起因那一例。

## 修改

- `proposal-guidance.ts`：offer 阶段附全部 `filling`；`vnextProposalSystemPrompt` 增 `amendable` 参数，填写阶段据此给出「可补选一次、只增不减、能表达就不要补」或原「不能再次选择 schema」。
- `proposal-schema.ts`：`createSubmitKpProposalBundleModelInput` 增 `amendable`，为真时工具面为 `[submit, offer]`；`StrictToolBundleModelInput.tools` 放宽为两种确定形状。
- `proposal-provider.ts`：`vnextProposalAmendmentRequest(response, capabilities, terminalKinds)` 仅从响应与当前选择判定，空补选返回 undefined；首轮结果新增 `amendmentRequested`；`invokeSubmitKpProposalBundleWithOneCorrection` 不提供补选并对该 kind 失败关闭；parser 合同 v40 → **v41**，`schemaRetrieval` → `full-filling-boundaries-at-selection-then-selected-forms-amendable-once-v5`。
- `adapter.ts`：提案与补选后提案共用一条 `settle`，按 `last`（3 或 4）决定还能花哪一次调用；补选后的一稿不能再补。
- `room/vnext-proposal-invocation.ts`：ordinal 放宽到 4；ordinal 2 断言补选形态的 surface；ordinal 3 按保存响应分派（补选 / 重发 / 修订）；ordinal 4 仅在补选后合法。
- `durable-object.ts`：接受 ordinal 4。
- `runtime-policy.ts`：调用预算。

## 代表性矩阵

`tests/kp-vnext-selection-amendment.test.mjs`，4/4：

1. **round75 的形状**：选了 `social`，补选 `formActorPlan` + `passTime`；断言 capability/terminal 各自归位、并集保留原有 `social`、补选轮工具面为 `[submit, offer]` 而补选后一轮只有 `[submit]`，最终 `locallyAccepted`。
2. **空补选不是继续**：只请求已加载类型返回 undefined；未开补选时同一响应就是错工具，按错工具失败。
3. **Room 独立证明**：补选后 ordinal 3 必须是并集且非补选形态的 surface；用原选择的 surface、再次可补选的 surface、带票据的请求全部被拒；ordinal 4 在未补选时被拒，ordinal 5 被拒。
4. **ordinal 2 形态**：Room 重建的正是补选形态；非补选形态被拒。

## 定向验证

所有失败与 `9a631fc` 基线（独立 worktree）逐名 `comm` 对照。

```
npx tsx --test tests/kp-vnext-selection-amendment.test.mjs                        4/4    exit 0
11 个 schema/repair/reference 消费者文件                                          78/106  失败集与基线逐名相同
npx vitest run tests/kp-vnext-provider-room.test.ts                              44/44  exit 0
npx vitest run tests/kp-vnext-stage3-room.test.ts                                31/35  4 项与基线同名
npm run typecheck                                                                       exit 0
git diff --check                                                                        exit 0
```

过程中引入并修正了 3 处：provider-room 的重放桩钉住了 ordinal 2 系统提示词（生产 surface 确实变了，补 `amendable`）；observation-reference-surface 的 ordinal 2 surface 同理；schema-retrieval 的「选择阶段无填写指导」断言按不变量更新（裁决三件仍缺席，filling 改为存在）。三处都是生产行为真的变化，不是为让实现通过而放宽。

## 未覆盖范围

- **零 API 调用。两项都没有任何真实模型证据。**
- **两项一起上，真实批次通过时无法区分是哪一项起的作用。** 事后可从 Room journal 分辨乙是否被触发：补选会留下 ordinal 3 的 offer 工具响应，未触发则 ordinal 2 直接是提案。甲无法这样分辨。
- 补选后的一稿若仍被内容校验拒绝，只剩 ordinal 4 一次修订；若那一稿又不可解析，重发与修订争用同一次调用，未做代表性验证。
- 未评估补选对 terminal-only 选择实际预算的影响：`terminalMaximumTotal` 改为 3 是为容纳补选，但没有真实批次证明这个数够用。
- 不裁定「NPC 口头承诺是否必须形成计划」这一产品问题；两项都只让正确组合可被选到，不强制模型选它。
