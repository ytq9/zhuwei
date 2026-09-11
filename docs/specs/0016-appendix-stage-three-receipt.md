---
kind: annex
role: appendix
title: "SPEC 0016 非规范附录：裁定记录、实现映射与审查"
annex_of: "0016"
---
# SPEC 0016 非规范附录

本文件收录原 SPEC 0016 中不规定产品行为的章节：自主裁定记录、实现映射、交叉审查与完成门。
它们是证据与历史，不是合同；规范条款仍在 [SPEC 0016](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) 正文，编号未变。

<a id="14"></a>

## 14. 阶段三开发期实现回执（2026-09-02）

阶段三已经在隔离的 `runtime-srd51-2014-authoritative-vnext-stage3` Profile 下完成两条代表性纵切。生产默认 Registry、当前 V5 房间与恢复路径均未改变。

- 动态 NPC 修订从现役自然语言行动入口冻结 RequiredContext，经严格 Proposal 校验、exact base/template 合成、Rules `step`、Room DO 原子提交、`project`、Typed Claims、Claims-only Narration 与 `replay` 闭环；旧字段保留，过期 base/hash、越权知识与未知字段 fail closed。
- `world-interaction` 从自然语言“用枪打吊灯”闭合 Ability、Geometry、行动经济、弹药、权威随机、关系修订、注册 Hazard、Rules 解析的真实区域目标、伤害、死亡、感官知识、逐 Viewer Claims、失败分支、幂等、驱逐恢复与 replay。
- “烧断绳索使重物坠落”和“扔石头试陷阱”只作为结构不同的通用性与观察边界样例；另以完全不透明 ID 穿过 `step → project → replay`，证明生产路径不识别样例名称、对象 ID、材料词或测试数值。InteractionPlan 只保存注册 Hazard 引用，不保存最终 targets/amount；行动者若真实位于权威区域内也由同一关系解析成为目标。
- 直接目标与完整因果引用已经分离：`directTargetRefs` 必须同时属于冻结 Viewer evidence、具有 `entity / itemEntry / sceneFeature` 之一的权威空间角色、位于行动者当前场景并通过相同 Viewer 可见性解释器；KP-only 对象、隐藏 Tactical Feature、无场景绑定或跨场景对象不能成为玩家直接目标。`targetRefs/basisRefs` 仍可引用获授权的隐藏关系和真实区域因果，Rules 可以据此影响隐藏实体，但这些引用和由其派生的 Claim 不得进入无权 Viewer。
- `world-interaction` 的写入边界由 Proposal lowering 与 Rules 双重重验：definition revision 只能修改当前场景的 `sceneFeature` 稀疏语义，relation transition 的两个端点必须都是当前场景的类型化空间节点，registered Hazard 的 source/zone 也必须是当前场景空间对象。NPC 定义、Item 生命周期、Objective/Story/continuity 和跨场景事实不能借 `world-interaction` 改写，继续由各自 Form 与生命周期合同负责。
- RequiredContext 在 prepare 时保留完整授权正文而保持空事务 read set；Proposal lowering 只从实际 actor、scene、Ability、物品、basis、关系、效果与区域依赖生成精确 read set。角色持有物、同场 NPC 持有物及直接位于场景中的物品都进入相应权威切片；无关同场变化不冲突，真实依赖变化在首次 step 与随机结算前 fail closed。
- `project(viewer, committedRange)` 是 vNext 结果到 Narration 的唯一材料 seam；独立 `SensoryEvidenceAcquired` 事件避免嵌入证据重复，隐藏 relation/target/authority basis 不进入无权 Viewer，Narration 重试复用同一 Receipt、projectionHash、claimsHash 与 Claims。

开发期定向证据：

- `npx tsx --test tests/kp-vnext-core.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-world-interaction-rules.test.mjs tests/kp-vnext-hazard-actor-death-fold.test.mjs`：24/24，退出 0；
- `npx vitest run tests/kp-vnext-stage3-room.test.ts`：5/5，退出 0；
- `npm run typecheck`：退出 0；`git diff --check` 见最终执行日志。

本回执只证明阶段三代表性能力纵切及其直接边界。clarification、in-world refusal、独立 observe/social、完整 materialization create、inventory/objective/story/combat 等其余粗粒度 Form 的完整产品纵切，开放世界全部物品生命周期、持续燃烧 Activity、完整地图/浏览器/真实 Provider、生产采用、V5 删除、migration、部署与 Git push 均不在本次完成范围。
