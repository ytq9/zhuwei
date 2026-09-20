# round104：V5 归档后的第一次真实批次

2026-09-20。源码状态 `822280c`，工作区无未提交改动。

## 为什么跑这一批

[ADR 0034](../../adr/0034-remove-the-v5-private-form-proposal-path.md) 删了 37,402 行，动到现役的 Rules 分派链、事件折叠、Viewer 投影、更正效果与 telemetry。本地全绿——完整 Worker 套件 45/45 文件 341/341 用例、54/54 声明的门、单测 0 失败——但按用户既有规矩，本地绿不算工作。用户于 2026-09-20 批准一次有界批次。

授权依据是 [生产替换 TODO](../vnext-production-todo.md#用户已确认的执行边界2026-09-05) 2026-09-05 的「授权自主进行有界 DeepSeek 真实 API 链路测试」，停止条件沿用「预设预算、失败即停、保留原稿和全部失败」。

## 批次参数

```bash
node --import tsx tools/run-deepseek-vnext2-authored-probe.mjs --live --env-file .dev.vars --max-calls 4
```

| | |
| --- | --- |
| 模型 | `deepseek-v4-flash` |
| 用例 | 2（hazard、item） |
| 调用预算 | 4（每例首稿 + 一次修订） |
| 实际调用 | **3** |
| schemaHash | `sha256:501e3c94c3d4300b006cc7d6f04202b0930bfed536447dd1123cbf6aae0df23a` |
| parserHash | `sha256:28cd4d293a0f8d3208f5fc6490829c6a467f52c2b7d4779a284151a07552405a` |

## 结果：两例全通过

九个阶段逐个为真：`schema / fixture / provider / parser / lowering / rules / replay / projection / nextContext`。

**hazard**（`requestHash sha256:05c021cd…`，`bundleHash sha256:e6d55fe1…`）
- 2 次调用，真实用了一次修订（`repairUsed: true`，票据 hash `sha256:fa30b91f…`）
- 提案：`materializeDefinition ×2、completeObject、worldInteraction`
- 14 个事件，含 `DefinitionRegistered`、`AuthoredMaterializationResolved`、`SemanticDefinitionRevised`、`DamagePacketResolved`、`SensoryEvidenceAcquired`、`WorldInteractionResolved`、`AtomicWorldInteractionStepsResolved`
- 1 轮随机；`finalStateHash sha256:8a0728d6…`；后继上下文 2 条 requiredRefs，frontier 已穷尽

**item**（`requestHash sha256:62d3497c…`，`bundleHash sha256:9928f73e…`）
- 1 次调用，首稿即通过（`repairUsed: false`）
- 提案：`materializeDefinition ×2、materializeItem、inventoryOperation ×2`
- 15 个事件，含 `ItemDefinitionRegistered`、`ItemMaterialized`、`InventoryOperationApplied`、`ItemUsed`、`AbilityInvoked`、`HealingResolved`
- 1 轮随机；`finalStateHash sha256:06222697…`；后继上下文 3 条 requiredRefs

## 用量

| 用例 | 调用 | prompt tokens | completion tokens |
| --- | --- | --- | --- |
| hazard | 2 | 49,001 + 49,071 | 1,412 + 118 |
| item | 1 | 49,006 | 1,042 |
| **合计** | **3** | **147,078** | **2,572** |

## 顺带得到的计数器校准证据

[ADR 0035](../../adr/0035-ratchet-the-vnext-proposal-request-size.md) 把「`conservative-v1` 从未对真实 provider 校准」记为未决。本批的请求是确定性的——离线重建 `createSubmitKpProposalBundleModelInput` 得到的 `requestHash` 与批次记录逐字节相同——所以可以对**同一段文本**比对两个计数：

| 用例 | conservative-v1 估算 | DeepSeek 实际 prompt | 估算/实际 |
| --- | --- | --- | --- |
| hazard | 52,915 | 49,001 | 1.080 |
| item | 52,889 | 49,006 | 1.079 |

**方向与设计一致：它高估，不低估**，余量约 8%。这是该计数器第一份真实对照。

**边界**：两个样本、同一种输入形状（中文指令 + JSON schema + JSON 冻结上下文）。不能据此声称计数器已校准，也不能外推到旁白、审核或其他形状。`budget.ts` 所写的「校准属于部署资格且尚未进行」仍然成立。

## 这一批没有覆盖的

- **Room telemetry 的两处改动**。归档把 `kpProposalFailureTelemetry` 的 formId 白名单换成 `VNEXT_BUNDLE_FORM_IDS`，并收缩了诊断字段脱敏白名单。这两处在 Room 路径上，本 probe 不经过 Room，只有真实房间的失败提案才会触发。仍未真实验证。
- **V5 房间绑定拒绝**。`server.ts` 现在对 V5 profile 的房间行返回 `v3BindingRejection()`；本批不涉及已持久化房间。
- **生产形状的请求**。probe 不做能力选择，直接发全 16 能力的完整 schema：实测约 49,000 prompt tokens，而生产 `VNEXT_PROPOSAL_BUDGET` 只允许 26,000，`assemble.ts` 会挡下这个形状。本批证明的是模型能填完整束并通过全链，不是生产请求的体积可行。
- 统计稳定性。两例一次通过不代表成功率，未重采样挑选成功记录。

## 结论

真实模型路径在 V5 归档之后仍然贯通：真实 DeepSeek → strict tool → parser → lowering → Rules → replay → projection → 后继上下文，含一次真实修订恢复。本批未部署、未 push、未做远端 migration、未改 Secrets。
