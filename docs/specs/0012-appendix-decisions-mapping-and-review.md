---
kind: annex
role: appendix
title: "SPEC 0012 非规范附录：裁定记录、实现映射与审查"
annex_of: "0012"
---
# SPEC 0012 非规范附录

本文件收录原 SPEC 0012 中不规定产品行为的章节：自主裁定记录、实现映射、交叉审查与完成门。
它们是证据与历史，不是合同；规范条款仍在 [SPEC 0012](./0012-authoritative-combat-mechanics.md) 正文，编号未变。

<a id="16"></a>

## 16. 自主裁定记录

以下裁定已回填当前定向证据；生产源码尚未冻结，最终 `module:check`、`typecheck`、`lint`、`npm test` 与部署门仍待执行，因此不据此宣称本规格已经完成。

### COM-D001：战斗的 Module seam

- 日期：2026-08-26
- 问题：战斗应拥有独立 Coordinator/Interface，还是作为 Rules Module 的内部机械。
- 来源类别：Goal 明确架构 + `SPEC 0001/0003` + Agent 自主组织裁定。
- 关联 `SPEC 0001`：§2 权威分配、§14 NPC 权限、§19 标准 KP 循环；验收 A、D、K、M。
- 候选方案：独立 CombatCoordinator；战斗独立公共 Module；Rules Module 内部 Encounter Implementation。
- 最终选择：战斗完全位于 Rules Module Implementation，只通过 `step/project/replay`；外层只存在 Room Action Module。
- 理由：同一自由意图可在非战斗与战斗间切换，独立协调器会复制身份、随机、待决、投影和恢复。
- 玩家可观察行为：玩家始终自由输入意图，进入战斗不会切换到另一套权威或让系统替其选择。
- 秘密与权限影响：控制权和私人窗口继续由统一 Viewer/Room Authority 保护；战斗包无 Principal 入口。
- 迁移/可逆性：旧战斗路径仅在 Legacy ruleset 后；新路径不能回退到 D1/页面 Coordinator。改变 seam 需新架构规格。
- 验收场景：B07–B15、B17–B22、B29–B30、B35–B40、B49、B53 的所有跨层入口检查；B16 只验证通用恢复引用没有被战斗层复制。
- 测试证据：B 表映射中的 Rules 测试已建立机械切片；`tests/combat-vertical-v2.test.ts` 1/1 还贯通自然语言 Room Action、动态 Encounter、伤害/专注多波随机、私人反应重连、逐玩家结束同意和长期后果。冻结全量门仍待执行。

### COM-D002：唯一二维 Geometry Profile

- 日期：2026-08-26
- 问题：数字战场采用距离段、多套坐标还是一个版本化二维规范空间。
- 来源类别：Goal 单一权威要求 + `SPEC 0002` 迁移证据 + Agent 自主机械裁定。
- 关联 `SPEC 0001`：§6 公正、§8 敌人/危险、§10 危险兑现；验收 C、D、G。
- 候选方案：抽象距离段；页面/服务端双坐标；一个二维+独立高度 Geometry Profile。
- 最终选择：每 Encounter 一个 `geometry-2d-feet-2014-v1` 引用；范围、路径、区域、掩护和占位全部由该 Profile 计算。
- 理由：准确反应和区域必须共享同一位置事实；双表示会造成目标与命中分歧。
- 玩家可观察行为：边界、掩护、强制移动、区域和中断在重试/replay 中一致；玩家仍可自然语言描述位置。
- 秘密与权限影响：隐藏位置只存在权威状态并经 0010 投影；候选/错误不泄漏坐标。
- 迁移/可逆性：旧全员零距离/距离段房间留在 Legacy Profile；没有确定映射不迁移。新算法必须新 Profile/hash。
- 验收场景：B08–B10、B39。
- 测试证据：`tests/combat-mechanics-v2.test.mjs`、`tests/chandelier-environment-rules-v3.test.mjs` 与 `tests/privacy-bypass-v2.test.mjs` 已从公开 Interface 建立 G01–G15/战斗空间定向证据；当前相关组合已记录通过，冻结全量门仍待执行。

### COM-D003：同时触发的确定排序

- 日期：2026-08-26
- 问题：不同控制者同时获得合法反应时如何排序。
- 来源类别：Goal 可恢复/公平要求 + `SPEC 0003/0007` + Agent 自主产品裁定。
- 关联 `SPEC 0001`：§6 公正、§14 NPC 行为、§15 玩家能动性；验收 K、M。
- 候选方案：网络先到先得；统一 LIFO；规则明文优先、其余按冻结先攻轮转并由各控制者排序自身触发。
- 最终选择：`trigger-initiative-order-2014-v1` 的五步排序，收集于同一冻结因果点，逐个私人窗口重验。
- 理由：与网络无关、可回放，并保留每个玩家只排序自己选择的权力。
- 玩家可观察行为：交换请求顺序、断线或重启不会改变窗口先后；失效后项不消耗资源。
- 秘密与权限影响：未轮到的私人选项不提前公开；KP 只为其 NPC/世界触发排序。
- 迁移/可逆性：排序写入 Profile/hash 和事件；改变需新规则版本，旧 Encounter 不重排。
- 验收场景：B09、B13–B15、B49。
- 测试证据：`tests/runtime-trigger-time-v2.test.mjs` 已记录通过 T01–T07 的排序、私人窗口、失效与 replay 切片；`tests/combat-mechanics-v2.test.mjs` 和 B53 Room 垂直段补充战斗反应/重连证据。冻结全量门仍待执行。

### COM-D004：非致命击倒与巨量伤害顺序

- 日期：2026-08-26
- 问题：同一近战攻击同时满足非致命选择与巨量伤害即死时的顺序。
- 来源类别：D&D 5e 2014/SRD 5.1 未明确组合顺序 + Goal 自主裁定授权。
- 关联 `SPEC 0001`：§6 骰前公正、§10 完整兑现、§14 NPC 权限；验收 C、G。
- 候选方案：先巨量伤害直接死亡；达到巨量伤害时禁止非致命；先向攻击者提供 2014 非致命选择。
- 最终选择：近战攻击者的非致命选择先于巨量伤害和 NPC deathPolicy 提交；选择后目标稳定昏迷。
- 理由：保留 2014 明确授予攻击者的即时选择，且在结果可知前由有权主体决定，不让 KP 事后保护/处决。
- 玩家可观察行为：合资格近战攻击在 0 HP 提交前出现选择；远程/豁免效果没有该选择。
- 秘密与权限影响：只有攻击控制者看到/回答；NPC 选择由有限知识 KP，死亡策略事前固化。
- 迁移/可逆性：绑定 `damage-death-srd51-2014-v1`；改变需新 Profile，旧事件按原顺序回放。
- 验收场景：B21、B22。
- 测试证据：`tests/combat-mechanics-v2.test.mjs` 当前 45/45 中包含巨量伤害、普通/重要 NPC、控制者私有非致命选择、死亡豁免、稳定恢复与 replay；冻结全量门仍待执行。

### COM-D005：非歼灭结束与相位转换

- 日期：2026-08-26
- 问题：Encounter 是否只能全灭结束，以及中途结束时回合锚点和长期状态如何处理。
- 来源类别：`SPEC 0001` 开放结果/长期连续性 + `SPEC 0007/0008/0009` + Agent 自主协议裁定。
- 关联 `SPEC 0001`：§13 有意义结果、§16 连续性、§18 收束；验收 I、O。
- 候选方案：最后存活阵营自动结束并清战斗状态；KP 无验证直接结束；事实依据提案且结清机械后结束。
- 最终选择：投降、逃离、停战、目标完成等可结束；`step` 验证无未结算项，转相位锚点并保留全部后果。
- 理由：战斗顺序可以结束而冲突后果继续存在；自动全灭既替玩家决定，也会丢失持续状态。
- 玩家可观察行为：可以接受/拒绝投降、逃跑或谈判；结束后伤势、资源、俘虏和效果进入后续场景。
- 秘密与权限影响：玩家分别决定自己的角色，KP 决定 NPC；结束候选不公开无权秘密。
- 迁移/可逆性：Encounter 一旦结束不可静默重开；再次敌对建立新 ID。相位转换事件可审计且回放一次。
- 验收场景：B29、B30、B53 战斗段。
- 测试证据：`tests/combat-mechanics-v2.test.mjs` 已覆盖投降、逃离、拒绝、未结算项阻断与相位转换；`tests/combat-vertical-v2.test.ts` 1/1 证明多人 Room 结束同意及长期状态保留。冻结全量门仍待执行。

<a id="17"></a>

## 17. 实现映射

| 责任 | 目标实现位置 | Interface/测试要求 |
| --- | --- | --- |
| Rules Module 唯一入口 | `app/_runtime/lib/rules/index.ts` | 只导出 `step/project/replay` |
| Encounter、先攻、回合和 grants | `app/_runtime/lib/rules/v2/combat-model.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/combat-events.ts` | 经 `step` 行为测试，不直接改状态 |
| Geometry Profile 与空间 | `app/_runtime/lib/rules/profiles/combat-geometry.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/spatial-visibility.ts` | B08/B39 conformance + replay |
| 结算层、移动和反应时点 | `app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/profiles/trigger-ordering.ts` | 仅私有 Implementation，不导出帧/队列 |
| Ability/Spell 编译与调用 | `app/_runtime/lib/rules/profiles/ability-compiler.ts`、`app/_runtime/lib/rules/v2/character-abilities.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts` | 引用已注册定义，不建平行 spell engine |
| Effect、伤害、专注和死亡 | `app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/combat-events.ts`、`app/_runtime/lib/rules/v2/damage.ts` | 同一有效值来源，确定 replay |
| 通用行动编排 | `app/_runtime/lib/room/action.ts` | 不新增 CombatCoordinator；只交 Rules Input |
| Room Authority | `app/_runtime/lib/room/durable-object.ts` | 随机、Receipt、待决、恢复均按 0003/0011 |
| 页面和语音 | `app/_runtime/components/play-table.tsx` 及现有语音 Adapter | 只提交 intent/answer、显示 0010 Read Model |
| 行为验收 | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/combat-vertical-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/randomness-recovery-v2.test.ts`、`tests/contest-room-randomness-v2.test.ts`、`tests/room-retry-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts` | B 表逐项映射，跨层走真实 seam |

新 Rules 包入口不得导出 fold/applyEvents、内部结算帧、MechanicOp、随机实现、有效值捷径或战斗状态补丁。旧战斗实现只可在明确 Legacy ruleset 分派后调用。

<a id="18"></a>

## 18. 五项交叉审查

### 18.1 跨规格矛盾审查

- `SPEC 0001`：玩家选择、KP/NPC 意图、危险公正、死亡兑现和长期连续性完整保留。
- `SPEC 0003`：战斗只作为一种 Rules Input/Implementation，不复制事务、随机、Receipt、恢复或 Outcome。
- `SPEC 0006/0007`：NPC 选择来自有限知识，控制权/窗口/虚构时间仍由通用规格拥有。
- `SPEC 0008/0009`：Encounter 结束保留长期后果且不自动等于故事收束。
- 结论：未发现需要修改 `SPEC 0001` 的冲突；原 `SPEC 0002` 的通用条款不再由战斗规格拥有。

### 18.2 权限审查

- Combatant 控制者只引用权威 CharacterControl/KP 控制事实，不能来自战斗请求体。
- 玩家只选择自己的目标、路径、反应、非致命、平手和是否停止；KP 只选择 NPC/世界。
- Rules Module 自动计算区域、合法性和强制效果，但不作可选战术决定。
- 结论：房主、队长、页面、模型和战斗 Implementation 均不能扩大控制权。

### 18.3 秘密审查

- 隐藏位置、未发现实体、秘密能力、NPC deathPolicy 和私人窗口统一由 `SPEC 0010 project` 保护。
- 战斗错误、候选、区域实际集合和反应排序不能旁路 projector。
- NPC 决策只使用 `SPEC 0006` 的 NPC Viewer，不能读取 KP 全知投影。
- 结论：本规格定义机械字段但不建立第二套字段脱敏或客户端战斗日志。

### 18.4 版本审查

- ruleset、事件 schema、Combat/Geometry/Trigger/Time/Ability/DamageDeath Profile 和动态定义全部哈希绑定。
- 2014 护栏阻止 2024/5.5e 混入；产品裁定明确标注。
- 前 0.4 房间、旧坐标和旧战斗事件直接拒绝进入当前解释器；不注册 Legacy Adapter，也不提供 migration 或 fallback。
- 结论：相同事件流不会因新目录、几何或伤害算法得到新解释。

### 18.5 第二权威审查

- 机械变化只来自 `step`，观察只来自 `project`，回放只来自 `replay`。
- Room DO 是活跃 Encounter/事件/待决唯一权威；D1 不保存活跃战斗镜像。
- 页面、Room Action、AI/NPC Adapter、Ability 目录和 Geometry Adapter 都不能掷骰或提交状态补丁。
- 没有 CombatCoordinator、独立 Encounter DO、独立 spell/damage engine 或独立战斗事件库。
- 结论：纯战斗 Implementation 位于一个深 Rules Module 内，删除该 Module 后复杂度不会散落到多个调用者。

<a id="19"></a>

## 19. 实施完成门

本规格只有在以下证据全部成立时才算实现完成：

- B07–B15、B17–B22、B29–B30、B35–B40、B49、B53 战斗段全部在表列责任 Interface 通过；B16 由 `SPEC 0003/0010/0011` 的恢复验收证明且战斗层没有副本；
- Geometry/Trigger/Time/Ability/DamageDeath Profile 均有固定 hash 和 conformance 测试；
- 代表性 Encounter 可以从建立运行到投降、逃离、胜利、非致命或死亡，并保留全部长期后果；
- 移动、反应、施法、伤害、专注和死亡在断线/重启后不重复，且 replay 状态相同；
- 玩家、NPC、KP 和无权观察者投影证明秘密没有从战斗字段、错误、候选或窗口侧漏；
- 新生产路径不存在 CombatCoordinator、D1 活跃战斗状态、客户端骰面/区域选人、自动 NPC 目标或平行 spell/damage engine；
- 旧 `ruleset_version` 回放不变，新事件不能被错误 Profile 解释；
- 验收和实现证据回填总追踪矩阵与决策记录；未执行项不得写成已验证。
