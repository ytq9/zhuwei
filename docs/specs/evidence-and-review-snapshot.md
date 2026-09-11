---
kind: annex
role: snapshot
title: "实现证据与交叉审查快照（2026-08-31）"
---
# 实现证据与交叉审查快照

本文件是 2026-08-31 记录的一次快照，**不随代码更新**：表中的实现映射与证据在那之后可能已经改变。
它保留当时对每项证据边界的判断——哪些是本地绿、哪些经过真实模型、哪些尚未验收——这部分没有工具能生成。

当前的规格与代码对应关系由 `npm run spec:trace` 从 frontmatter 和代码里的 `SPEC NNNN` 引用生成，
每份规格的验收门记在它自己的 `gates` 字段。

## 当前实现证据索引（2026-08-31）

本节把**当前存在的公开测试映射**、定向绿色与已发生的发布事实分开陈述。测试文件、已部署版本或局部命令不等于最终源码已经通过完整门；本轮完整门依用户明确豁免未运行，也不得由其他证据拼接成通过。

| 产品语义 | 生产实现映射 | 当前有效证据 | 证据边界 |
| --- | --- | --- | --- |
| 0.4 当前行动接缝、非战斗、长团与投影 | 普通 KP 提案经 `executeCausalActionProgram` + 精确 `actionLanguageRef`；多人管理经服务端生成的 `authenticatedPartyAction`；NPC 计划、退休与 Activity 经精确 `authenticatedCampaignAction`；Rules/Room 仍只有 `step/project/replay` 与权威提交链 | 当前公开映射为 `tests/causal-action-rules-v3.test.mjs`、`tests/world-campaign-v2.test.mjs`、`tests/item-materialization-causal-v5.test.mjs`、`tests/combat-mechanics-v2.test.mjs`、`tests/rules-multiplayer-v2.test.mjs`、`tests/multiplayer-room-v2.test.ts`、`tests/actor-plan-kp-boundary-v3.test.mjs`、`tests/actor-plan-room-v2.test.ts`、`tests/actor-plan-due-room-v2.test.ts` 及 observer/delivery runner | 只证明各 runner 明示的因果、世界、物品、战斗、多人、ActorPlan 与投影切片；真实 Workers AI、HTTP/浏览器和最终全量门另计 |
| `SPEC 0012` 战斗机械 B07–B15、B17–B22、B29–B30、B35–B40、B49 | `rules/v2/combat-*`、`combat/*`、`campaign-actions.ts`、`projector.ts` | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`；日志已记录 B07 2/2、B38 8/8、Trigger/Time 15/15 及 B19–B22/B20/G14 定向 12/12 | 当前文件分别声明 45、2、8、15、1 个场景；声明规模不是冻结源码全文件通过证明 |
| B16/B27/B50 通用恢复与 B53 生产垂直链 | Room DO 随机 journal、D1 checkpoint/归档恢复、Room Action → Rules → Viewer | `tests/randomness-recovery-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/archive-d1-batches-v2.test.mjs`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`、`tests/combat-vertical-v2.test.ts`；archive D1 11/11、80+ events/48 audits 的 reader→fresh DO 1/1、无当前受控 viewer 的 D1→fresh DO 1/1 | 结清随机、单调 checkpoint、prefix/audit、ahead event/genesis conflict 校验、移除成员不复权已有局部证据；不得把它扩张为冻结源码或远端 D1 生产恢复完成 |
| `SPEC 0013` P/A/G/T/F Profile conformance | `rules/profiles/*`、`rules/compiler/*`、`rules/combat/*`、`rules/timeline.ts` | P：`tests/runtime-profiles-v2.test.mjs`；A：`tests/ability-profile-v2.test.mjs` + combat A06；G：`tests/combat-mechanics-v2.test.mjs` + `tests/privacy-bypass-v2.test.mjs`；T/F：`tests/runtime-trigger-time-v2.test.mjs` | 当前文件分别声明 13、8、45+1、15 个场景；日志已记录 Profile 组合和逐向量定向绿色，生产源码冻结后仍须整组重跑 |
| 精确版本管理读取 | `table/server.ts#getRoomManagement` | 源码与 `tests/rendered-html.test.mjs` 的 HTTP 验收断言已接入 | 房主 Read Model 返回 `ruleset_version`/`kp_model`，普通成员拒绝；冻结源码 Node/Worker 发布门尚未执行，故不计最终门 |
| `SPEC 0014` 战术空间与二维地图 | 当前 V5 Geometry/Environment Profile + Builder/Rules/Room + 待完成的 Tactical Projection/preview 与 `play-table.tsx` Adapter | 当前 runner 映射为 Geometry G01–G15、`tests/chandelier-environment-rules-v3.test.mjs`、`tests/dynamic-environment-room-lowering-v3.test.ts` 及环境 Room 测试；不沿用 env-v4 长轨迹作为 0.4 当前证据 | **部分实现，仍阻塞**：环境 FSM、破坏/区域、隐藏 target、archive→fresh DO 与 replay 有定向映射；当前源码回执、完整地图/preview、路径输入和双视口仍待 |
| `SPEC 0015` Form/Context/RAG/Narration/双状态/动态环境 | `kp/{form-catalog,context-pack,v3-context-runtime,static-retrieval,static-corpus,private-form-policy,causal-action-program,model-registry,context-planner-policy,narration-v3}.ts` + `room/v3-binding.ts` + 既有 Room/Rules/Geometry/DO/D1/UI；0.4 精确绑定 V5 runtime、workflow-v2 与 causal v5 | 0.4 当前映射为 `tests/runtime-profiles-v2.test.mjs`、`tests/kp-form-context-v3.test.mjs`、`tests/causal-action-rules-v3.test.mjs`、`tests/dynamic-environment-room-lowering-v3.test.ts`、`tests/viewer-narration-recovery-v3.test.ts` 及当前 item/ActorPlan runner；不从旧 workflow/env 组合推算通过数 | **当前实现与历史发布分账**：0.4 只认精确 `executeCausalActionProgram`/`actionLanguageRef`、Room 生成的 party/campaign capability 与 V5 闭包。此前 workflow-v2/env-v4 的定向、部署和线上数字仅作发布审计，不证明当前 0.4 源码门 |
| `SPEC 0016` 粗粒度 Form/冻结 Context/稀疏定义/Typed Claims | 隔离 vNext Stage3 Profile 接入 Room prepare/commit、Rules `step/project/replay` 与 Claims-only Narration；生产 Registry 仍为 V5 | `tests/kp-vnext-core.test.mjs`、`kp-vnext-claims.test.mjs`、`kp-vnext-world-interaction-rules.test.mjs`、`kp-vnext-hazard-actor-death-fold.test.mjs` 共 24/24；`kp-vnext-stage3-room.test.ts` 5/5；typecheck/diff-check 见执行日志 | **阶段三代表性纵切已完成、未切生产**：NPC 稀疏修订和通用 `world-interaction` 已闭环；opaque-ID 行为覆盖 Viewer 可操作直接目标、类型化空间角色、跨场景/跨 Form 拒绝，以及隐藏因果可由 Rules 使用但不进入无权 Claims。烧绳/试压板仍只验证泛化与观察边界；其余粗粒度 Form、生产采用、V5 删除、migration、部署与发布仍待 |

当前相关自主裁定为 DEC-035–047；其中 DEC-018/022 的 production ActionPlan/normalization 仅作历史审计，并由 DEC-046 在 0.4 current-only 范围内取代；DEC-047 冻结未来目标但不改变当前生产 Registry。

## 五项交叉审查摘要

本节记录的是**规格层审查结论**，不是代码或运行验证。所有“未发现冲突”都只表示当前规格文字已经明确责任归属；其成立仍必须由追踪矩阵所列真实责任 Interface 测试、架构检查、迁移与发布证据证明。

| 审查项 | 规格层结论 | 仍待实现 / 验证的证据 |
| --- | --- | --- |
| 跨规格矛盾 | 未发现需要修改 `SPEC 0001` 的冲突。0003 统一事务，0010 统一 Viewer/Audience，0013 固定 Profile，0014 拥有 Geometry；0015 保留当前 V5 与 RAG/发布语义，0016 只窄取代未来 Catalog、compound/环境模型并深化 Context/Claims seam | 阶段三两条代表性纵切已经取得开发期证据；当前生产仍以 V5 causal/world/item/combat/multiplayer/ActorPlan runner 映射。其余 Form、完整地图与最终门尚未取得证据 |
| 权限 | principal 仍来自可信会话；Form/LLM 不决定 actor、Audience、骰面、事件或 targets。0016 额外区分 KP 获准知道的 epistemic refs 与实际裁决 read set，NPC 继续按自身 Viewer；Claims 只输出获 grant 的 viewer refs | 阶段三已验证精确 read-set 冲突、NPC 知识隔离、隐藏 relation 整项裁剪与 FrozenRenderableClaims 重试；其余 Form 和真实 Provider/浏览器路径仍待 |
| 秘密 | 世界事实仍只有一份；动态 Room 状态不入静态 RAG；authority refs 可在 KP-only Claim basis 中使用但永不外发，Narration 只收目标 Viewer 冻结 Claims | 阶段三已验证隐藏 definition/relation/target 不进入无权 Claims 或 Narration，并验证恢复复用冻结材料；DOM、语音与生产 Provider 仍未覆盖 |
| 版本 | 当前 V5 genesis/Profile/hash 不变；0016 的 Catalog、Context、Definition、Relation、Bundle、Rules primitive 与 Claim vocabulary 必须发布新完整 manifest，未知组合 fail closed | 隔离 vNext Stage3 manifest/conformance 已建立但未进入生产 Registry；不迁移房间，完整 Catalog/Profile 仍待后续审查 |
| 第二权威 | Rules 外部仍只有 `step/project/replay`；Room DO 保存活跃状态和提交。Sparse revision 由服务器合成完整 next definition，模型 patch 不入 state；ProposalBundle/InteractionPlan/Claims 都是私有派生 Implementation | 阶段三已证明无 model DAG、JSON Patch、自由 damage/targets、committed-delta Narration 或第二随机路径；完整多合同 ProposalBundle 仍待，且阶段三不授权生产切换 |

## 审查结论与证据状态

1. 规格体系已经把 0002 的通用责任与纯战斗机械分配到 0003–0013，以 0014 固定战术空间/地图合同，以 0015 建立 V5 私有 Proposal/Context/RAG/叙述双状态，并由 0016 为未来 Profile 窄取代 Catalog、compound/DAG 和详细材料阈值；两次取代都不修改 0001。B01–B53 的每项处置仍以 [0002 逐项处置矩阵](./0002-disposition-matrix.md) 为准。
2. 自主产品/技术选择及其来源、玩家行为、权限/秘密、迁移和验收场景记录在 [决策登记册](./decision-register.md) 以及各规格的内嵌决策章节；状态“已裁定（本 Goal 授权）”不等于测试通过。
3. [总追踪矩阵](./traceability-matrix.md) 已为 P1–P13、A–O、B01–B53、P/A/G/T/F、TM01–TM14、KR01–KR16 与 FC01–FC09 标出责任 Interface、测试路径和完成门。KR/P12 保留 V5 实现与历史发布账本；FC/P13 的阶段三代表性纵切已有独立回执，但完整 Form 家族仍在实现中，不能借 feature 原型或 V5 证据抵扣。
4. 本索引只把已有实际命令/退出码的测试和已发生的远端事实写成证据；远端 D1 `0008–0011`、双视口五路径、既有 Worker 部署和非 force `cloudflare` 推送已经回填。完整门依用户豁免未运行；唯一三交互虽实际 3/3 live verified，原命令仍因已修复但未生产重跑的 evaluator 误判退出 1，不能写成绿色。
5. 当前不能把上述 V5 发布事实或阶段三开发期绿色扩张为完整线上质量 `COMPLETE`。Provider 指标、语音/TTS、完整战术地图、完整历史日志及其余 Form 纵切仍未覆盖；0016 当前明确不切生产、不删 V5、不 migration、不部署或发布。
