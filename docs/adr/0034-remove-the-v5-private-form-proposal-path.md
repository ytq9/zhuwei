# ADR 0034：删除 V5 私有 Form 提案路径及其离线评测

- 状态：已接受
- 日期：2026-09-20
- 依据：用户于 2026-09-20 裁定「V3 已经被淘汰，跟现役无关的内容应全部归档」。
- 当前规则：[SPEC 0016 当前边界](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)
- 取代范围：[ADR 0028](./0028-abandon-persisted-v5-private-form-rooms.md)「是否删除 V5 提案路径另行决定」这一未决项；SPEC 0015 中把私有 Form 管线描述为现役路径的条款自此只解释历史。沿用 [ADR 0016](./0016-development-reset-of-pre-0.4-rooms.md) 与 ADR 0028 的做法，不为被删路径保留 Adapter、fallback、migration 或测试。

## 背景

ADR 0028 已在 2026-09-18 放弃已持久化的 V5 私有 Form 房间，删除了只能在 V5 房间里成立的 Room 套件，并明确把提案路径本身的去留留作后续决定。

2026-09-20 核实的现役接线：

- `app/_runtime/lib/room/server.ts` 只在房间 profile 等于 vNext 时走 `createVNextKpAdapter`，它自己实现 `propose`，只把 `narrate`、`decideDueActorPlan`、`decidePendingInput` 委托给旧适配器。
- `app/_runtime/lib/table/server.ts` 的 `createRoom` 用 `profileByModelId` 选 profile，而 `app/_runtime/lib/room/runtime-configuration.ts` 的该方法只返回 vNext profile。当前代码创建的每个房间都绑 vNext；V5 分支只有更早代码写下的房间行才解析得到，而那些房间已按 ADR 0028 不再是产品支持面。
- vNext 的降级在 `app/_runtime/lib/kp/vnext/room-bridge.ts` 产出 `applyAtomicWorldInteractionSteps`、`performAbilityOperation`、`materializeNpc` 等 Rules 输入；`executeCausalActionProgram` 这一输入类型只由 V5 的 `compileKpFormDraft` 产生，`app/_runtime/lib/rules/v2/actions.ts` 仍为它保留一条分派。
- `KP_STRUCTURED_OUTPUT_MODES` 为空，因此 V5 的 strict-tool 编码没有任何 profile 启用。

## 决定

1. 删除 V5 私有 Form 提案路径：Form 目录与其草稿 schema、私有 Form 请求策略、strict 双生编码、V5 Context/RAG 准备与 planner、`server.ts` 的 V5 分支，以及 `authoritative.ts` 的提案半边。叙述、到期 ActorPlan 决定与待决输入决定继续由现役 vNext 适配器消费，保留。
2. 删除 `executeCausalActionProgram` 这一 Rules 输入类型及其分派、编译器与专用模型；`rules/v2/causal-model.ts` 中被现役 Rules 共用的导出按导出逐项判断去留，不整体删除。
3. 删除只量 V5 提案请求的离线评测 `tools/run-kp-v3-eval.mjs`、它的门测试与 120 条 gold 夹具，并从 SPEC 0015 的 `gates` 去掉。`tools/run-live-kp-eval.mjs` 打的是真实生产 origin，与提案编码无关，保留。
4. 各 SPEC 的 `gates` 去掉被删文件，不为变绿补登任何未运行或未通过的门。

## 后果

- SPEC 0015 §§2–6 描述的「私有小表 Proposal → 三层 Context Pack → 静态 RAG → 封闭因果程序」管线不再有实现；该规格自此整体只解释历史，当前规则以 SPEC 0016 为准。
- 失去的验收证据：`tools/run-kp-v3-eval.mjs` 的 16 项结构硬门（120 条 gold 的引用召回、表单合法性、路由覆盖、故障回退与四项体积门）。这些门量的是 V5 请求的构成，在 vNext 上没有对应对象；vNext 的请求体积没有等价的离线门，属于已知缺口。
- 基线里以「KP V3 runner invokes production seams and passes local evaluation hard gates」登记的那条单测失败随文件一并消失，不是修好，是被删路径的门不再存在。
- 追踪矩阵 KR11、KR14 两行的证据来源被删，改为记录该门已随本决定退役。
- 已持久化的 V5 房间行此后在绑定校验处被拒，与 0.4 对待 0.4 以前房间的处理一致；D1 数据保留，产品不承诺回放或继续游玩。
- [ADR 0019](./0019-on-demand-proposal-schema-contract.md) 的按需 schema 合同只约束 vNext 的 Bundle 选择面，不因本决定改变。
