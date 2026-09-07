# vNext 非行动知识回顾与到期子阶段实施接缝

日期：2026-09-06。承接 round17–20 的只读源码审查，知识回顾已完成本地实现、定向验收及 round22 真实机械/replay 纵切，真实旁白审核仍失败；到期 Activity 已按本页后半的“持久尾阶段”方向进入实施，当前结果见[到期验收](vnext-due-activity-validation.md)。本页原预备方案保留决策审计用途。见[知识回顾验收](vnext-knowledge-validation.md)与[round21/22 实测](vnext-round22-validation.md)。无需调整 SPEC 0001 的产品合同。

## 非行动知识回顾

能力合同：获认证玩家以自然语言回顾自己角色已经持有的知识，总览或针对问题选择相关记录；KP 选择既有记录，Rules 校验持有权、读取版本与来源，Room 保存回执、按本人 Viewer 冻结 Claims，再沿现有旁白发布/恢复。查询不取得新知识、不推进虚构时间、不扣资源、不产生随机或危险。保留 sensoryEvidence/sourceClaim/characterInference/canonicalFact 及 hint/partial/full 的原有区别。

已实现纵切是 observe 家族的终止型 knowledgeReview：模型仅填写 inquiry、scope、knowledgeRefs；allKnown 要求模型 refs 为空，由服务器从完整冻结目录全选，relevantKnown 由 KP 选择本人已有记录。模型不填写自由答案、Audience、状态、成本或检定。保留现有自然语言入口和同一 step/project/replay 路径，无新增 HTTP 入口或 D1 表。它不能与物化、实际调查、世界效果混束。

实测收口：round21根basisRefs多填导致1调用后拒绝，无世界提交；补充既有约束的wire说明后，round22用3调用完成合法总览提案、私有KnowledgeReviewed提交、正文生成，实际事件replay与存储精确相等且无机械变化。review/v4因原文中完整双破折号间隙被拒，未发布旁白。之后完整分隔span修复39/39仅为合成证据；旧真实失败保留、未再调用API。两批4调用41,554输入/6,228输出，详见[脱敏证据](vnext-round22-live-evidence.json)。

以下为原接缝清单，其知识回顾实现与验证结果以[验收记录](vnext-knowledge-validation.md)为准；Activity 部分仍待执行：

- `kp/vnext/proposal-schema.ts`、`proposal-validator.ts`、`proposal-guidance.ts`：增加始终可用的闭合 terminal；真实模型仍选择能力，不按“知道/回忆”词语分类。现有 strict tool 只有 inWorldRefusal terminal，不能只加领域类型而漏模型 schema。
- `kp/vnext/context/index.ts` 已沿 actor 义务纳入本人知识并授予 Viewer 引用，但选中记录的 hash 不能证明目录完整。需冻结完整角色知识集合的派生目录/hash，知识为空同样有完整读取凭证；准备后新增/改变知识也应冲突。
- `context/reference-index.ts`、`authority-records.ts`、`coverage.ts` 与 Rules `authority-bindings.ts` 共用目录含义。不能根据 knowledgeRef 再读完整 canonicalFact/sourceClaims 填答案，尤其不能泄露 hint/partial 之外的真相或 sourceClaims 的 motive/sourceBasis。
- Rules 内集中投影知识内容。`KnowledgeRecord.content` 当前是 unknown：生产写入既有纯文本，也有 module publicOpening、characterPremise、活动状态等结构；不能只处理开场 description。应逐一核对所有现役写入形状，保留已有信息含义与来源；未知形状明确技术失败，不能略去后声称“没有知识”。是否保留 typed JSON 或转换成表达事实，要以这些实际生产者为依据。
- `proposal-bundle-lowering.ts` 当前拒绝带 narrativeMaterializationRefs 的全部 terminal。typed review 仅回顾已持有记录，可以不执行实际使用对象的物化义务；实际观察/操作仍保留物化要求。必须按类型与无副作用合同区分，不能关键词豁免。
- Rules 新增只产生私有回顾凭证的事务与 knowledgeReview Claim，接入 actions/model/events/claims/Profile。Room 的 `committedRangeUsesFrozenRenderableClaims` 加入新事件，复用原 Delivery/Claims/context 保存和恢复；不能将旧感知说成刚刚看见。

代表性矩阵：开场总览；纯文本来源主张与结构化前提；本人partial知识且底层有完整秘密；完整空目录与Context失败的区别；另一玩家猜ref；准备后知识变化；同submission重试及旁白失败恢复；实际观察同对象仍走取得证据的原路径。至少一条穿过真实本地 Room Action 接口。适当集中在一个Node用例组、现有provider-room与一次typecheck。

## 到期 Activity

已有公共 Rules 红灯：私有 `/tmp/zhuwei-due-audit.afSiHY/due-activity-red.mjs`，长休→经过8小时→vNext worldInteraction 后仍active/HP10；同状态原输入先提交独立due root并恢复HP20。根因是 `actions.ts` 的vNext早返回在共用到期预检之前。本轮未改相关源码；以下其他风险来自直接源码审查，不能冒称均已行为复现。

**未决协调边界（2026-09-06 补充）：**下述第3项若对所有 intent 在首次 Provider 前无条件结算到期 Activity，会违反已实现 knowledgeReview 的非行动合同，使查询触发恢复、随机或危险。因此不能直接照此执行；knowledgeReview 仍须在 Rules 到期调度前返回，无关键词分类的阶段协调接缝待另行设计。另已核对旧表退役清理 `clearAllRowsForDeletion` 只执行 DELETE，不会重建主键或 CHECK；删除旧行后再次 `CREATE TABLE IF NOT EXISTS` 不等于完成阶段表结构升级。这两项仍未实现，不能以数据退役授权冒称技术迁移已闭合。

原预备方案的接缝清单（第3项由下文修订方向取代，其余不变量保留）：

1. Rules `campaign-actions.ts` 提取共用 earliestDueActivity 与 canonical child root，供 step preflight 和私有 project query 使用。描述含 activityId、owner、timeline、start+duration的完成时间、activityHash与受影响scene；保留 actorPlan/longSpellcasting 特殊路由和原子 continuation bypass。Safety、frozen answers/randomness、complete/interrupt/correction不能插入另一项到期结算。
2. `authority_action_stages` 按 child root 保存历史，父prepared id非唯一，partial unique确保一个活跃child；读写区分activeStage与byChildRoot。每个旧child outcome和random journal保留，不能第二项due覆盖第一项结果。DO SQLite旧表主键/CHECK不会由CREATE IF NOT EXISTS更新，必须明确实际epoch及已授权退役范围，不能误认为只改建表文本就升级成功。
3. 父submission使用preparing状态：保存原canonical input与固定actor→选due→持久/执行/恢复child→提交child→再次选due→全部完成后重验父actor、scene、权限并冻结RequiredContext→第一次Provider。统一支持intent、gear、restStart等新输入。不能用上限2跳过剩余Activity，防护耗尽时保留可恢复阶段；无进展的重复child明确失败。
4. 复用commitAuthoritative及random journal，新增不经过KP的commitDueActivity。子阶段单独receipt，不改为父root或提前完成父输入。将completeActivity加入canonical recovery validator，驱逐后才能恢复。
5. 短休骰owner可能不是父actor。只有匹配持久child、权威请求与当前可信owner的recovery能完成child；之后独立重验父权限，不能放宽普通提交。旧骰按钮重复请求按child历史返回原结果。
6. 阶段scope保护owner、父场景、完成移动目的地及共享timeline；异timeline可保留原并发。最终step/project/append前核对head或置于无await同步提交段。晚处理的短休randomness绑定canonical start+duration，不能用处理时now代替due时刻。
7. 父首次Provider之后若并发又产生due，明确context/read-set conflict；不清空invocation、换快照继续旧Proposal或增加第四阶段。正常fresh prepare仅发生在父第一次Provider之前。
8. 到期结果必须经正确Viewer交付，不能仅作为父KP私有context。独立NPC计划保留既有decision，而一般Activity不新增模型调用。

### 修订方向：真实触发提交的持久尾阶段（待实施）

将 due obligation 绑定到此前使活动真正到期的权威提交，并与该次 append/state/receipt 在同一 Room 事务持久保存。随后逐项处理或恢复；每个 due 仍用独立 canonical child root、Receipt 与同一 `step → commit → project`，不改写此前 Receipt，不将“我知道些什么”视为新的调度原因。依据是 SPEC 0013 的到期 root 与恢复合同，以及 SPEC 0016 的冻结与冲突边界；这是一项实现方向，尚无行为验证。

- `knowledgeReview` 保持到期调度前返回，可回顾本人已持有且已提交的知识；不新增关键词识别或分类模型调用。
- 在相关 due 未完成期间，后续真实行动不能越过。未分类自然语言复用现有 Proposal 的类型分支；知识 terminal 可提交，真实动作在 commit 边界明确 pending/conflict。已冻结请求不清空 invocation、不换快照重选 Bundle、不增加第四阶段。如何让原输入在合法新准备后继续，仍须闭合恢复合同，不能伪装成功。
- 尾阶段不能只存在于内存或 `waitUntil`。逐 child 提交、驱逐、丢响应与其他玩家骰子等待后都必须可恢复，并与现有归档/删除 alarm 协调。当前 alarm 没有 due runner；这些仍待实现。
- 使用新内部 child-stage 表及明确 storage schema 标记；随机 `runtimeEpochId` 不能充当 storage 版本。constructor 不能因旧房直接抛错而封死退役入口。只在新建/已验证新协议恢复时写新标记，旧房拒绝新游玩而保留已授权管理退役通道。新表须加入空库判定与退役清理，旧表只清理、不迁移或兼容回填。未来新协议归档必须保存未完成的 obligation。

实现前的余项限于持久尾阶段恢复、未分类输入的查询/真实动作对偶边界及 storage/退役入口；不要再按已被否定的“所有 intent 首次 Provider 前无条件 drain”方案实施。

代表性矩阵：3项due逐项结算后父仅一次；晚处理canonical时刻；另一玩家短休骰owner；骰后驱逐与丢响应重试；同timeline异scene与异timeline对偶；完成移动后父scene/权限重验；旧child重试；父Proposal后新due冲突。可复用 `runtime-trigger-time-v2.test.mjs`、`actor-plan-due-room-v2.test.ts`、`randomness-recovery-v2.test.ts`、`social-room-randomness-v5.test.ts` 的fixture，主纵切集中在 `kp-vnext-provider-room.test.ts`，不要无差别全量运行。

## 保留的其他阻断项

后续直接修复：[review/v5 固定覆盖键](vnext-review-v5-validation.md)已用全部冻结 fact 决定必填对象键，普通非 strict 传输保持，Node40/40、Room11/11、typecheck通过。v5 尚未做真实 Provider 验证，不能映射旧错误响应为成功或声称输出完整性已由 Provider 强制。

[round20审核](vnext-round20-validation.md)曾漏完整factCoverage，其真实失败保持。round22已补真实知识回顾机械证据，修复后的真实完整旁白仍待验证。动态人物/地点/通路、澄清/高风险继续、独立其他Form、RootAction累计预算、20+双玩家链、A–O、构建/部署与旧房退役继续按总TODO推进。
