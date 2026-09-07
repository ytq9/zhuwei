# vNext social Form、NPC 回应与原子恢复验证

日期：2026-09-06。源码为 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 加保留的未提交开发树。本文证明即时口头社交的本地纵切，V06 与完整 Goal 仍未完成；没有真实 API、生产部署或旧房退役。

## 能力合同与代表性矩阵

玩家原始表达由服务器从冻结 intent 取得；KP 依据指定 NPC 自身 Viewer 的完整快照，冻结回应、沉默及 NPC 权限内关系/承诺/债务。Rules 在首随机前核验两分支，复用唯一原子执行器提交实际发言、取得知识和后果；Room 持久化后，按 Viewer 提供来源主张及 Typed Claims。承诺保留方向与条件，不提前执行物理效果。恢复沿同一冻结计划、骰面及正式事件来源链继续。

| 变化维度 | 实际本地证据 |
| --- | --- |
| 已持有消息的直接回答 | strict social Form → parser → lowering → Rules → 来源主张/知识 → Claims；原玩家表达未被模型改写 |
| NPC 有条件承诺 | 守门人承诺核实介绍信后开侧门；真实 Room 莉安答应核对签字；物理实体、库存、场景及世界事实不提前改变 |
| 共享检定成功/失败 | social 是唯一 owner；同束物理后果依分支执行；不多掷骰，不把直接后果称为第二次检定成功 |
| 私有知识及表达 | NPC/玩家同一裸 knowledgeRef 持有不同正文；只接受指定 NPC 命名空间依据；NPC 看不到玩家未说出的 goal/method、其他玩家知识；旁白不含 NPC 私有 motive |
| 听见、沉默与条件 | participants / sceneListeners 由服务器选实际同场、同 timeline、能听见者；沉默不生成 NPC SourceClaim；失聪/无法发言拒绝，魅惑者保留 SRD 社交优势 |
| 恢复与幂等 | Rules 骰前待决重放；social 前缀后的 Item 等待击昏选择及恢复骰，整束候选仍未发布；恢复正式 eventSeq 改变后，Knowledge provenance 指向实际发言事件 |
| 精确结算与更正 | 正常 replay；删子事件、改引用/骰面/总值、删 marker 或把失败改为直接成功拒绝；更正恢复知识、对话、承诺和已有关系 |

Node 新增 12 个用例覆盖上表。Room 新增三路径（直接、骰面 1、骰面 20），穿过 `handleRoomAction → prepare → deterministic KP → commit → Rules → private delivery`，随后 DO eviction、replay 和重复 submission 保持状态与调用次数。它是实际本地 Room API/DO 证据；不是正常登录/Cookie HTTP 或真实 DeepSeek 证据。

## 实现与直接消费者

- `rules/v2/npc-decision-context.ts` 承担原 KP 快照核心；KP 文件仅适配 RequiredContext 类型。closed snapshot guard 与 reader 共用，畸形 JSON/非 NFC/不完整目录安全拒绝；权威 preflight 重新计算真实 NPC projection。结算恢复只比较域记录和 holder 绑定，不比较已经变化的 projection metadata。
- 独立 `social.vnext-1` 接入 `proposal-schema/capabilities/guidance/validator/check-owner/graph/correction` 与 lowering。schema 明确只提供当前可执行的即时口头面；没有模型可写的 actor/root/thread IDs、listeners 或 state patch。正文不扫描为 prospective 引用。
- lowering 使用已核验 NPC snapshot 内的 records/knowledge 版本绑定，目录和 timeline 不必复制成顶层 Context entries；actor timeline 与额外依赖仍来自本次冻结 Context。不会以当前状态重新填补缺失模型上下文。
- `social-interaction.ts` 统一 typed plan、主体/知识/听者/后果校验、稳定身份、领域 draft 生成、结算审计及 conversation。全部分支在随机前检查。通过原 `WorldInteractionResolutionPlan` 扩展复用 shared check/atomic tape；空间 effects 为空，同束独立操作承担物理后果。
- `SourceClaimCreated → KnowledgeAcquired` 只保存实际说出的内容；promise/debt 的义务方固定为 NPC，不替玩家承诺。关系更新沿现有身份，不标作 creates。不能把来源主张的完整层级当成世界真相。
- `WorldInteractionResolved.social` 携带自足私有计划。fold 对齐内嵌计划与全部外层标量/引用数组，逐条匹配本子步骤真实领域事件的类型、顺序及 payloadHash。correction audit 保留非空 `resolutionId`；缺 marker 检查从实际未结算 SourceClaim audit 推导，不能通过改外层 resolution/outcome 绕过。
- DiceRolled 在私有 continuation 保存正式 eventId/payload；社交结算对照真实 audit、root、branch、时序、请求、骰面和选择值，总值使用冻结 modifier。删除 social、把检定失败降格为直接成功也拒绝。
- `finishAtomicExecution` 核验候选 Knowledge provenance 确实由本 suffix 的 source 产生，然后绑定到正式已提交 holder 链；不是清洗模型输出。新增原子暂停用例确实经过玩家选择及后续随机，不用仅初次 awaitingRandomness 冒充序号偏移恢复。
- conversation 使用独立 vNext 记录，状态校验、旧社交 lookup 收窄、authority binding、projector、correction 同步。NPC 投影不包含玩家隐含 goal/method。Claims 新 social 类型只表达实际交谈与检定，不复制 KP summary/motive。
- `social-primitives.ts` 提取旧社交纯共处及 fingerprint helpers；不载入旧 Program/DC/固定回应机制。Profile 规范内容同步新语义，历史真实测试 manifest 保持原样。

## 检查与失败处置

同一最终生产源码状态：

1. Node 十个直接目标文件：103 用例，首次 102 通过、1 个旧 schema 能力枚举失败；清单增加 social 后，仅失败目标重跑 1/1 exit 0。原日志 `/tmp/zhuwei-social-form-node-final.log`，补验 `/tmp/zhuwei-social-form-schema-final.log`。目标为 social-plan、npc-decision-context、social-commitments、observe、shared-check、atomic-input、world-condition-input、proposal-schema、proposal-bundle、schema-retrieval。
2. 旧直接消费者：`social boundaries|facts and knowledge drive|growth and chapter transition`，3/3 exit 0，`/tmp/zhuwei-social-form-legacy-final.log`。
3. Room：`npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'executes social Form|applies direct sibling consequences'`，5/5 exit 0，28 个无关用例跳过；`/tmp/zhuwei-social-form-room-final.log`。
4. `npm run typecheck` exit 0，`/tmp/zhuwei-social-form-types-final.log`。最终 `git diff --check` exit 0；未跑全量测试、Lint 或 build。

实施中先修 legacy conversation union 类型，再定位状态校验器只接旧 conversation 导致合法提交后 projection 拒绝；补独立 vNext guard。Form 初次还缺 NPC 内嵌 catalog/timeline 的 readSet 消费、direct 占位分支独立数据副本及持久 AtomicPlan 的 social form 白名单，逐项补齐。最初“药剂恢复”用例只有初次随机，不能证明后续暂停；改成真实玩家击昏选择与恢复骰后通过。只读审查确认检定结果/marker 缺口，尤其失败→直接成功的组合篡改，随后补审计 resolution 及动态测试。

重放负例会重签 payloadHash/eventHash，要求 `invalidEventEnvelope`，排除仅 stateHashAfter 不符；对 shape 合法的篡改，还从真实 prefix state 调正式 `createEventTransition` 证明领域 fold 拒绝。畸形快照另验证公开 replay 不抛异常。

## 仍待完成

- retry 当前只有已地址化/相同规范化表达和目标的失败基线、方法 fingerprint 与具体变更引用检查。尚未完成不同措辞下的同一目标判定、方法实质性模型审查、成本重试及同束时间/成本的最终基线；不能把这些有限检查当成完整防重骰合同。
- Activity/虚构时间/成本与占用行动、玩家主动承诺/交易、非口头通信、完整 NPC plan/objective/story 生命周期仍待接入。即时 spokenConversation 不代表全部社交能力。
- 自然语言回应是否蕴含于 NPC 所知、承诺是否超出人物真实权限、风险/代价是否有意义，仍需有界真实模型验证；引用合法性和 deterministic KP fixture 不证明这些判断。
- 正常 HTTP 普通/复杂模型主链、双玩家 20+ 连续链、A–O、实际构建部署/生产版本核对及旧房/旧路径退役均继续。归档合同等待原有答复，不重复询问。120 金标和长期 SLO 后置。

本批 API 0、模型费用 0；没有 commit/push、部署、远端 migration、Secrets、资源创建或退役。已授权范围和整桌 ¥20–30 软目标保持，Goal active。
