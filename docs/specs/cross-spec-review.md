# SPEC 0003–0013 跨规格五项审查

- 状态：**规格级交叉审查完成；实现与测试证据持续回填**
- 审查日期：2026-08-27
- 冻结上位准则：`SPEC 0001`（内容与批准状态均不得修改）
- 审查对象：`SPEC 0003`–`SPEC 0013`、`0002-disposition-matrix.md`、`decision-register.md`、`traceability-matrix.md`
- 审查维度：跨规格矛盾、权限、秘密、版本、第二权威

本文只记录已裁定规格之间的责任消解、实现护栏和测试映射，不新增产品原则，也不把验收设计、文件存在或静态检查冒充实现证据。标为“实际（有效/局部）”的结果均有 `refactor-log.md` 中的命令与退出码；标为“待实现”的测试只有经真实责任 Interface 执行、被测试运行器实际收集并留下对应源码状态的通过记录后，才可回填为有效证据。

## 1. 审查基准

### 1.1 唯一责任链

新规则版本只允许以下责任链：

```text
可信 Principal 的 intent / answer
  → Room Action Module
  → Room Authority prepare / observe / commit / acknowledge / commitCorrection
  → Rules Module step / project / replay
  → Room DO 原子保存世界事件、作用域版本、Receipt、Pending Input 与当前 Delivery 槽
```

- KP/LLM 调用在 DO 事务外，只能提出提案或基于已提交专属投影生成叙述。
- Room DO 是活跃世界、事件、随机结果、待决、幂等与当前投递的唯一权威。
- D1 只保存身份、目录、静态人物卡、ProfileRef 与可重建事件归档。
- 页面、语音、模型、日志、Profile Registry 和测试都不能形成第四条状态、机械、投影或回放路径。

### 1.2 审查状态词

| 状态 | 含义 |
| --- | --- |
| **规格已消解** | 两份规格的表述存在层级或精度差异，但已由更具体的已裁定规格或登记决策给出唯一解释。 |
| **实现护栏** | 规格结论明确，但生产代码必须落实的拒绝、原子性、版本或权限约束。 |
| **文档待回填** | 产品结论已有正式来源，但追踪矩阵或测试路径仍含旧文字；不得把旧文字当作未裁定产品问题。 |
| **待实现** | 尚无符合追踪矩阵证据口径的行为测试结果；本文不宣称通过。 |
| **实际（局部/有效）** | 已从规定责任 Interface 运行并有命令/退出码；只证明明确写出的场景，不自动扩张为整份规格或最终发布门。 |

## 2. 跨规格发现与正式消解

| ID | 发现的问题 | 状态与正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| XR-01 | 世界结果先提交、叙述后生成；两个并发根行动的模型响应可能乱序，较旧叙述若晚到不能覆盖较新的当前帧。 | **规格已消解**：`SPEC 0003` §§1、3；`SPEC 0010` §§8.2、8.5；DEC-012。DeliveryFrame 必须是“当前”已提交绑定，而非按模型完成顺序排队。 | `publishDelivery` 校验活动分支、事件范围、projection hash、策略版本和当前槽因果头；晚到的旧绑定返回幂等 superseded/no-op，不能覆盖较新的槽。 | **实际（有效）**：`tests/observer-delivery-v2.test.ts` 4/4 覆盖迟到旧发布、单槽覆盖、ACK 与重连；冻结源码组合仍须重跑。 |
| XR-02 | 控制权撤销/换席可能发生在 Audience 冻结后、帧发布或读取前；相同 principal 后来重新获得控制也不能恢复旧帧。 | **规格已消解**：`SPEC 0007` §2；`SPEC 0010` §§4.2、8.4、O12；DEC-012。Audience 在提交时一次性冻结，之后只能因撤权收窄，不能扩大。 | 控制权撤销与旧 ViewerKey 槽失效原子提交；发布、observe、ACK 均重新鉴权。新控制者只看角色当前结构化知识，不取得旧正文。 | **实际（局部）**：`tests/multiplayer-room-v2.test.ts` 8/8、`tests/observer-projection-v2.test.mjs` 5/5、`tests/observer-delivery-v2.test.ts` 4/4；最终 HTTP 换席/请离旁路仍待发布态回归。 |
| XR-03 | `PendingInputReassigned` 与继任者零自动继承可能被误解为任何换席、死亡或退役后都能把旧选择交给新角色。 | **规格已消解**：`SPEC 0003` §5；`SPEC 0007` §2；`SPEC 0008` §§7–8；DEC-011。重分配只适用于语义仍属于同一世界主体且授权可转移的输入；继任角色是新实体。 | Pending Input 保存 owner kind、character/tenure、reassignability 与 continuation hash；死亡/退役的个人选择关闭或暂停，不能改 owner id 后继续。 | **实际（有效）**：`tests/multiplayer-room-v2.test.ts` 8/8、`tests/world-campaign-v2.test.mjs` 7/7 与 observer 5/5 覆盖 Pending 重绑、死亡/退役、继任默认零知识和 provenance 转移。 |
| XR-04 | `SPEC 0004` 的 `startedAtFictionSeconds: number`、`SPEC 0005` 的 `acquiredAtFictionSeconds: number` 与 `SPEC 0007` 的“虚构秒”是概念占位；`SPEC 0013` 要求整数微秒和规范十进制字符串。 | **规格已消解**：`SPEC 0013` §§2.2、7 是精确 Time Profile，填充 0004/0005/0007 的时间占位。 | 权威事件和状态统一使用 `fictionInstantMicros` 规范字符串；秒只用于显示或输入换算，不能作为并行存储或浮点计算来源。 | **实际（局部）**：runtime 10/10、Rules/Room multiplayer 各 8/8 已覆盖微秒、Activity、分支时间/因果与现实等待不推进；完整并发战斗时间组合仍待。 |
| XR-05 | `SPEC 0012` 定义了局部 `CombatProfile`，`SPEC 0013` 又定义完整 `RuntimeProfileManifest`；若两者分别持久化会产生两个版本事实。 | **规格已消解**：`SPEC 0013` 开头“与 0012 的关系”、§§1–3；RTP-D001。`CombatProfile` 只是完整 manifest 中战斗扩展引用的视图。 | Genesis、事件、Receipt 和归档只保存一个完整 manifest/hash 闭包；Encounter 复制引用用于局部完整性验证，不能选择或覆盖第二份 Profile。 | **实际（局部/有效）**：`tests/runtime-profiles-v2.test.mjs` 覆盖 P01–P08 的 manifest/历史 Adapter/fail-closed，`tests/combat-vertical-v2.test.ts` 已记录 1/1 贯通当前 manifest；冻结源码组合仍须重跑。 |
| XR-06 | `SPEC 0010` 要求 presentation/projection/delivery 三个策略版本进入房间 manifest，但 `SPEC 0013` 的首张固定表没有逐项列名。 | **规格已消解且实现清单已显式化**：`SPEC 0010` §11 是强制版本要求；`SPEC 0013` §2.1 的 `extensions` 是其正式容纳位置。 | 首个 conforming manifest 必须把三个策略各作为完整 `ProfileRef` 纳入 extensions/hash 闭包；缺任一项以 `invalidRuntimeManifest` 拒绝，不能使用部署默认值。 | **实际（有效）**：`tests/runtime-profiles-v2.test.mjs` 与 `tests/observer-projection-v2.test.mjs` 已记录联合绿色，覆盖策略缺失/错位/错 hash 与观察者投影；最终冻结门另计。 |
| XR-07 | 普通 Worker/DO 实例重启必须恢复同一 DeliveryFrame；从 D1 事件归档灾难重建的新空 DO 又明确不能恢复旧叙述。 | **规格已消解**：`SPEC 0010` §§8.3、11；`SPEC 0011` §6。前者恢复同一 DO 持久槽，后者只重建结构化正史并把槽置空。 | 恢复入口显式区分 instance restart 与 authorized disaster rebuild；后者不得读取 Prompt、messages 或事件生成旧正文，只可基于新投影发布新 deliveryId。 | **实际（有效）**：observer delivery 4/4 覆盖普通重启同帧；记录的 `archive-correction-v2` 5/5 覆盖授权空 DO 灾难重建且不恢复 Delivery 正文。 |
| XR-08 | 更正既要保留旧 Delivery 审计引用，又禁止恢复旧叙述；跨 Profile/epoch 的错误也不能用最新解释器修正。 | **规格已消解**：`SPEC 0003` §10；`SPEC 0005` §10；`SPEC 0010` §8.6；`SPEC 0011` §7；`SPEC 0013` §§3.4、12.4；DEC-013/015。 | 旧 Delivery 只保留非内容 tombstone/hash；更正上下文绑定受影响事件的精确 manifest。混合 epoch 无获批映射时拒绝，不把 latest Adapter 用于历史事件。 | **实际（有效）**：记录的 `tests/archive-correction-v2.test.ts` 5/5 覆盖篡改拒绝、前向补偿、正式后果触发因果分支、旧 Receipt/Delivery 审计与授权边界；冻结源码仍须重跑。 |
| XR-09 | 非战斗致命危险需要伤害/0 HP/死亡机械，而 `SPEC 0012` 是纯战斗规格；若另写 hazard damage 会形成第二机械管线。 | **规格已消解**：`SPEC 0004` §9；`SPEC 0012` §§10–12；`SPEC 0013` §4.3 Damage/Recovery op；处置矩阵 B21/B43。战斗规格拥有机械语义，Encounter 不是调用该机械的必要条件。 | 同一个 Rules Implementation 的 DamagePacket、Effect、专注、0 HP 与死亡管线同时接受战斗和非战斗提案；二者都只从 `step` 进入。 | **实际（有效）**：`tests/world-campaign-v2.test.mjs` 7/7 与 `tests/combat-mechanics-v2.test.mjs` 4/4 共同证明非战斗危险复用同一伤害/死亡语义。 |
| XR-10 | 多个 NPC 同时触发时，Trigger Profile 允许正确控制者排序，但 NPC 不得因同一 KP 模型而共享知识或获得自动战术。 | **规格已消解**：`SPEC 0006` §§4、7；`SPEC 0010` §7；`SPEC 0012` §7.3；`SPEC 0013` §6；DEC-008。Trigger 只冻结资格/顺序，NPC 意图仍逐 NPC Viewer 形成。 | 每个 NPC 决策调用只含该 NPC 投影；排序窗口不得夹带其他 NPC 的秘密知识，也不得生成新目标。失效项零成本关闭，不用最近/最低 HP 等默认。 | **实际（局部）**：module/NPC 4/4、Rules compound 18/18 与 production-validator 31/31 已覆盖逐 NPC 有限知识及无自动目标；完整多 NPC combat trigger 排序组合仍待。 |
| XR-11 | `SPEC 0012` 把 B16 通用恢复列给 0003/0010/0011，处置矩阵还列 0007。 | **规格已消解**：这不是责任冲突。0003/0010/0011 拥有事务、单槽与故障恢复；0007 拥有 Principal、控制权、掉线不推进时间。处置矩阵记录完整跨层组合，0012 只排除战斗副本。 | B16 垂直测试必须组合四份规格，战斗包不得实现自己的身份、时钟或窗口恢复。 | **实际（有效）**：记录的 Room 迁移组合 41/41（authority/randomness/multiplayer/service routing/delivery/archive/retry）覆盖恢复与权限组合；冻结源码仍须最终重跑。 |
| XR-12 | Profile/JCS/hash 需要构建期 golden 检查，但产品验收禁止绕过 `step/project/replay` 直接测试内部 fold/helper。 | **规格已消解**：`SPEC 0003` §2.1 与 `SPEC 0013` §§9、11。私有构建验证可证明目录完整性，但不能单独证明玩家行为。 | hash/Registry 校验器不从 Rules 包入口导出；P/A/G/T/F 行为向量仍经 Rules/Room 责任 Interface。静态检查只能作补充证据。 | **实际（有效/局部）**：P/A/G/T/F 已映射到 runtime/ability/combat/trigger-time/privacy 的公开 `step/project/replay` 场景，`module:check` 多次通过；生产源码冻结后的整组与结构门仍待。 |
| XR-13 | 若 production validator 已严格，但 authoritative-v2 DO 仍接受 compact kinds 或从 SQLite 恢复任意 `rulesInput`，首次提交与重启会形成两套机械协议。 | **规格已消解并实现护栏**：`SPEC 0003` §§3、10；`SPEC 0011` §§6、8；DEC-018/022。只有完整 production draft/精确 Pending capability 可归一化，恢复只允许 ActionPlan v1/同版本待决续接。 | DO 删除 compact proposal 分支；normalizer 复用 `validateProposal`；恢复重新校验载荷 allowlist 与 hash；旧命令只能由精确 Legacy ruleset 命中。 | **实际（有效/结构补充）**：KP Adapter 7/7；记录的 Room 恢复迁移组合 16/16；`module:check` 已加入源码护栏，最终冻结 SHA 仍须重跑。 |
| XR-14 | 非战斗豁免若只返回成功布尔，物品成本、HP/移动后果和职业熟练会分别落到 Room、技能系统或旁白。 | **规格已消解**：`SPEC 0004` §§3–6、9；`SPEC 0012` §§10–12；DEC-023。save 与 check 共用复合结算、统一 HP/伤害状态和 DO 骰源；修正来自 2014 class save proficiency。 | ActionPlan 骰前必须冻结 duration/cost/success/failure；continuation 不重复消费；客户端/KP 不能提交 modifier、骰面或 HP 结算。 | **实际（有效）**：Rules compound 18/18 覆盖物品成本、优势、当前六职业 save proficiency、成功/失败 HP/移动分支。 |
| XR-15 | `changeParty` 若按可选字段猜测邀请/离队，会让协调器替玩家选择；若拆成六个 DO 命令则形成多人旁路。 | **规格已消解**：`SPEC 0007` §5；DEC-024。production ActionPlan 显式冻结六种 `partyAction`，再进入同一 multiplayer Rules Module。 | 每种变体精确验证成员/Pending/领导权/目的地/耗时；整队移动逐控制者同意，个人移动可原子离队。 | **实际（有效）**：Rules compound 18/18 覆盖全部六值；Rules/Room multiplayer 各 8/8 覆盖真实控制权与 Pending。 |
| XR-16 | 管理/API 若只看到模型 ID 或字段形状，会把 authoritative-v2 错送 Legacy 服务；若读取 DO 活跃状态决定版本又会建立目录之外的路由副本。 | **规格已消解**：`SPEC 0013` §§1–3；DEC-015/025。D1 房间目录已有 `ruleset_version` 是精确 Adapter 选择事实，DO/事件仍是活跃状态权威。 | `getRoomManagement` 重新鉴权房主后返回 `ruleset_version`/`kp_model`；未知版本 fail closed，页面不解释 Profile payload 或事件。 | **实现已接线，冻结门待跑**：源码与 `tests/rendered-html.test.mjs` HTTP 断言已更新；最终 `npm test` 通过前不计完成门。 |

## 3. 文档与测试映射差异

这些差异不改变已裁定产品行为，但必须在证据回填时消除，不能让旧文字覆盖新规格。

| ID | 差异 | 正式来源与当前解释 | 后续护栏 |
| --- | --- | --- | --- |
| DOC-01 | `traceability-matrix.md` 的 C/D/G 仍写“替代战斗规格待裁定”，完成门也写 B 处置待回填。 | `SPEC 0012/0013` 和 `0002-disposition-matrix.md` 已正式裁定并完整分配 B01–B53。 | **文档待回填**：矩阵下次维护时引用 0012/0013 和本审查；在此之前这些旧句不能被解释为产品未裁定。 |
| DOC-02 | 追踪矩阵 P10 仍写故障分类/SLO/免费额度预算“尚待规格化”。 | `SPEC 0011` §§1–3 已正式规格化；实现与生产遥测证据仍待实现。 | **文档待回填**：把“规格缺失”和“实现无证据”分开，不能因已有规格而宣称 SLO 已实现。 |
| DOC-03 | 旧文档曾使用不存在的单文件战斗、timing 和 `.mjs` vertical 占位。 | **已回填**：战斗/Profile 的真实 runner 是 `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs` 与 `tests/combat-vertical-v2.test.ts`。 | 路径存在性检查必须失败于任何再次引入的占位路径；测试声明规模与已执行绿色分别记账。 |
| DOC-04 | 旧文档曾并列不存在的 Room Action eval 与 `.mjs` canonical KP eval 占位。 | **已回填**：唯一 canonical 连续评测路径为 runner 实际收集的 `tests/kp-multiturn-eval.test.ts`；`SPEC 0011` §9 的 20+ 交互与 18/20 阈值仍是正式验收语义。 | 同一轨迹只计一次；脚本 fixture 不能替代真实 Workers AI。 |
| DOC-05 | `SPEC 0010` 头部只列 0001 为依赖，但正文实际与 0003/0005/0007/0008/0011 互相约束。 | `SPEC 0010` §§17–18、其他规格的上位/交叉审查以及 DEC-006/011/012/013 已建立正式关系。 | 索引与实现依赖图必须包含这些边；不能因头部元数据简写而独立实现投递。 |

### 3.1 审查后回填

2026-08-27 已按上述正式来源回填 DOC-01–DOC-05：追踪矩阵现引用 `SPEC 0012/0013`、把可靠性明确区分为“规格已固定/实现待证”、使用 runner 实际收集的拆分战斗/Profile 路径；连续评测统一为 `tests/kp-multiturn-eval.test.ts` 和 20+ 交互；`SPEC 0010` 头部补齐协作规格。路径修正本身不代表冻结源码全量通过。

### 3.2 本轮生产语义回填

- DEC-018/DEC-020 的 production ActionPlan 已使用判别式 `resolveDirectConsequences` 与 `advanceCampaignLifecycle`；知识、关系、承诺、虚构时间、结局候选、故事收束、玩家尾声和续篇均映射到 `rules/v2` typed events，而不是 Room/叙述补丁。
- DEC-021 固定 authoritative-v2 的 Arcane Recovery 为 `arcaneRecoverySlotLevels` 多槽选择；UI 只根据专属 Read Model 冻结合法选择，Rules/Room Authority 在短休 Activity 完成点验证和结算。旧 `arcane` scalar 只属于 Legacy Adapter。
- DEC-022–025 进一步固定严格 production normalization/恢复 allowlist、复合非战斗 save、六种 typed partyAction 与房主管理版本读取。authoritative-v2 DO 已删除 compact proposal 可达分支；`resolveNoncombatSave` 冻结成本/后果并使用 2014 职业豁免熟练；`getRoomManagement` 显式返回目录规则版本。
- 证据为 Rules compound 18/18、KP Adapter 7/7、production Room compound 1/1、world/campaign 7/7、Rules multiplayer 8/8、Room multiplayer 8/8、observer projection 5/5、authoritative table 10/10，以及记录的 Room 迁移组合 41/41。31 次评测逐轮通过 production `validateProposal` 与 projection-bound；这些结果不替代冻结源码全量/真实 Workers AI/迁移部署门。

## 4. 逐规格五项审查

### 4.1 SPEC 0003：权威行动事务与深 Module Interface

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 通用事务与 0010 的提交后投递、0011 的恢复、0013 的精确 Profile 是抽象层与具体层关系；`observe` 不能因此成为第二 projector。 | 0003 §§1–3、11；0010 §§7、12；0011 §§6–7；0013 §§1–3；DEC-001/002/018/020/022。 | `observe` 只组合 `project` 输出与 DO 当前槽；Room Action 不解释事件、不计算可见性。 | **实际（有效）**：authoritative action 7/7、Rules compound 18/18、production compound 1/1、记录的 Room 迁移组合 41/41；最终冻结全量门另计。 |
| 权限 | Principal 只来自认证上下文；玩家、KP/NPC、内部 continuation 与更正入口互不代用。 | 0003 §§2.2、3、5；0007 §1；DEC-003/008/013。 | 请求 schema 拒绝 principal/actor、骰面、事件、状态补丁和内部 capability；每次重试重新鉴权。 | **待实现**：伪造 actor、替答、普通 commit 调 correction 的拒绝测试。 |
| 秘密 | Receipt、Pending、错误、候选与增量都必须经同一 `project`；缓存 Receipt 不能顺带返回旧私人投影。 | 0003 §§5、8、11；0010 §§7–10；DEC-006/012。 | 幂等结果缓存分离公共 Receipt 与每次重新投影；错误码按 Viewer 脱敏。 | **待实现**：`tests/observer-projection-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`。 |
| 版本 | `ruleset_version` 字符串不足以执行；完整 manifest、事件 schema、定义与 Profile hash 由 0013 填充。 | 0003 §§4、10；0013 §§1–3；DEC-015、RTP-D001。 | prepare/commit/replay 精确匹配完整 ProfileRef；未知或错 hash fail closed。 | **实际（有效）**：`tests/runtime-profiles-v2.test.mjs` 覆盖 P03–P08、错 hash/state pin、历史 replay 与显式 Legacy；冻结源码重跑仍待。 |
| 第二权威 | 两个深 Module 与 Room Authority seam 已明确；fold/applyEvents、随机、机械原语均是私有 Implementation。 | 0003 §2、§14；DEC-002/014/017/022。 | Rules 包入口只导出 `step/project/replay`；页面、D1、AI 和测试不能调用内部捷径；authoritative-v2 DO 无 compact proposal 分支。 | **实际（局部）**：`module:check` 多次通过且 KP Adapter 7/7/Room 41/41 经真实 seam；最终冻结 SHA 的结构门与全量行为测试仍须重跑。 |

### 4.2 SPEC 0004：KP 裁决与非战斗机械

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | Activity 秒字段由 0013 微秒 Profile 精化；非战斗致命危险复用 0012/0013 伤害死亡机械，不另建 hazard engine。 | 0004 §§8–9；0012 §§10–12；0013 §§4.3、7；XR-04/XR-09/XR-14。 | Activity 与危险只是同一 Rules 输入种类；完成、save、伤害、资源与时间仍由一次 `step` 事件组提交。 | **实际（有效）**：world/campaign 7/7 与 Rules compound 18/18 覆盖可中断 Activity、统一伤害/死亡、typed direct consequences 及复合非战斗 save。 |
| 权限 | KP 选择五类可行性和风险；Rules 验机械；玩家只回答自己的澄清、资源、休整和方法选择。 | 0004 §§2–4、6–8；0003 §5；DEC-003/021。 | 重大歧义先开指定玩家 Pending；Rules 不以剧情/强弱改判，KP 不替玩家选资源；短休上限、资格与奥术恢复预算由 Rules projector 产生，页面只消费候选。 | **实际（有效）**：Rules multiplayer 8/8、Room multiplayer 8/8、world/campaign 的 `restRecoveryOptions` projector 场景和 table 10/10 覆盖个人/整队休整、Arcane Recovery 选择与可信 Pending；浏览器发布态仍待。 |
| 秘密 | 隐藏 DC、危险依据和先例秘密部分可留 KP Viewer，但可感知预兆、成本和失败局面必须诚实投影。 | 0004 §§3、9、11；0005 §§5–7；0010 §7。 | 提案分别保存公开与秘密依据引用；错误和候选统一 projector。 | **待实现**：C/G、`tests/observer-projection-v2.test.mjs`。 |
| 版本 | 检定、休整、Activity、危险和裁定先例都绑定 Rules/Time/Ability Profile；旧事件不按新公式重算。 | 0004 §§3、7–11；0013 §§2、4、7。 | 先例指纹和动态定义保存 ProfileRef/hash；秒输入规范转微秒后提交。 | **实际（有效）**：A07、F03/F04/F08 与非战斗 replay 映射 `ability-profile-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs`、`world-campaign-v2.test.mjs`。 |
| 第二权威 | 物品页、D1 人物卡、现实计时器、骰子 UI 与独立 Activity scheduler 均不能写效果。 | 0004 §§6–8、15；0003 §1；DEC-014/021。 | 所有资源、物件、休整和 Activity 变化只来自 `step`；DO 保存唯一待决/到期；到期完成的随机 journal 只按 Rules 导出的 canonical due root 严格恢复。 | **实际（有效）**：table 10/10 证明 UI 只选择，world/campaign 7/7、F04 与 Room multiplayer 8/8 证明完成点、独立到期根和随机由 Rules/DO 结算。 |

### 4.3 SPEC 0005：世界事实、因果与角色知识

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 个人知识的分享/投递由 0010 细化；分支更正由 0011 执行；时间字段服从 0013 微秒。没有事实副本。 | 0005 §§7、9–10；0010 §§5–8；0011 §7；0013 §7；DEC-006/013。 | CanonicalFact 与 CharacterKnowledge 分离；KnowledgeShare 新建接收者取得事件，不修改真相或复制旧 Frame。 | **实际（有效）**：world/campaign 7/7、observer projection 5/5，覆盖世界媒介分享、来源链、非追溯和继任边界。 |
| 权限 | 知识属于角色/NPC，不属于 principal 账户；当前控制者只能读取所控主体当前知识。 | 0005 §§5–9；0007 §1；0010 §§3、5；DEC-006/011。 | Viewer 由服务端控制关系构造；房主/队长/原控制者没有额外读取权。 | **待实现**：多 Viewer、换席、继任默认无知识。 |
| 秘密 | 单一事实可为隐藏，证据/主张/推断分层；未选候选、因果依据与秘密定义不出普通投影。 | 0005 §§4–7；0010 §§7、10。 | VisibilityPolicy 只保存引用；原始事件、候选集和隐藏定义无玩家/D1 原始读取入口。 | **待实现**：E/F/K、猜测 ID 与错误等价测试。 |
| 版本 | WorldEvent、定义、编译器、分支和可见性都必须精确绑定 manifest；当前目录不能重编译旧定义。 | 0005 §§3–4、10；0013 §§2–4；RTP-D001/002。 | `DefinitionRegistered` 保存规范定义、compiled hash 与引用闭包；replay 只折叠事件中图。 | **实际（有效）**：A01–A09 与 P04/P05/P07 分别由 ability + combat A06 和 runtime Profile runner 公开验证；冻结组合仍待。 |
| 第二权威 | Prompt、消息、D1 flags、每玩家事实副本和 NPC Adapter 都不能定义世界或知识。 | 0005 §§1、3、5；DEC-006/014。 | Room DO 事件流一份；投影按 Viewer 计算，不持久化多份已脱敏状态。 | **待实现**：同一状态多 Viewer hash、D1/Prompt 旁路扫描。 |

### 4.4 SPEC 0006：模组、动态实体、NPC 与势力协议

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 0006 提出动态定义，0013 编译并注册，0012 只消费战斗能力；到期计划服从 0003/0007/0013 时间链。 | 0006 §§3、6–8；0003 §4；0012 §9；0013 §§4、7；DEC-007/008。 | 定义流程固定为 KP 提案 → Rules 编译诊断 → Room DO 原子注册/实体化；NPC 计划到期是独立根行动。 | **实际（局部/有效）**：module/NPC、Rules compound、production compound 与 production-validator 已覆盖动态定义/有限知识 NPC；A01–A09 另由 ability + combat A06 公开向量覆盖。真实模型仍待。 |
| 权限 | KP 只控制 NPC/世界，且 NPC 决策只能依据该 NPC Viewer；玩家始终控制玩家角色。 | 0006 §§4–7；0007 §1；0010 §7；DEC-008。 | 每个 NPC 单独 project；AI Adapter 任务类型不能把 KP 全知投影传给 NPC 决策；无自动目标/pass。 | **待实现**：K、B23/B24/B31、XR-10。 |
| 秘密 | Module truth、NPC/Faction 计划、错误倾向和未公开定义只在相应内部 Viewer；势力成员不自动共享知识。 | 0006 §§1、4–6；0005 §§7–9；0010 §§7、10。 | NPC/Faction knowledge 有来源传播；日志/错误不含计划、候选定义或秘密能力。 | **待实现**：无知识不反制/获知后反应对照、日志捕获。 |
| 版本 | ModuleBible、module hash、动态定义/compiler 与 Legacy Adapter 均精确固定；章节可换兼容模块但不能改 Runtime manifest。 | 0006 §§2、9；0008 §§2–3；0013 §§2–3；DEC-007/015。 | 初始 moduleRef 与当前 Chapter module binding 分开；升级产生事件并验证 manifest 兼容，未知组合拒绝。 | **部分实现**：P05/P08 的旧 Adapter/历史解释已由 runtime Profile runner 验证；旧 DSL replay 与新章 `ModuleVersionMigrated` 组合仍待。 |
| 第二权威 | 封闭 DSL、Prompt、目录、自动战术函数和 D1 `game_states` 都不能成为新规则裁决/状态路径。 | 0006 §§1、9、14；DEC-007/014。 | Legacy 分派先精确命中旧版本；新房自由行动不能先查 Interaction 白名单。 | **待实现**：A、B41、Legacy 隔离与无 D1 活跃写入检查。 |

### 4.5 SPEC 0007：多人房间、控制权、虚构时间与聚光灯

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 并发用 0003 scopeProof；具体时间用 0013 微秒；控制转移不得转移 0010 Frame 或 0008 继任者选择。 | 0007 §§2、4、6–7；0010 §4.2；0013 §7；XR-02–XR-04/XR-15。 | scope 细分控制/知识/时间/投递；控制事件与 Pending/Frame 处置原子提交；事件序列不作为全局锁。 | **实际（有效）**：Rules/Room multiplayer 各 8/8、Rules compound 18/18 与记录的 Room 迁移组合覆盖控制转移、六种队伍语义、分支时间、O12/O17 核心边界；最终 HTTP 仍待。 |
| 权限 | Seat、CharacterControl、Host、leader、KP 和成员身份相互独立；队长只能组织提案。 | 0007 §§1、5、9；DEC-004/009。 | 服务端从 auth_sessions 取 Principal；整队提案逐控制者同意，个人行动可原子离队。 | **待实现**：伪造身份、整队缺一人、个人离队/休整。 |
| 秘密 | 分支未来、私人窗口、安全原因和其他角色知识不能因房主/队长/在线状态而公开。 | 0007 §§3、7、9–10；0010 §§4、10。 | 无权 Viewer 的响应形状与对象不存在不可区分；CausalFrontier 先验证再投影。 | **待实现**：M、`tests/privacy-bypass-v2.test.mjs`。 |
| 版本 | 时间、聚光灯、控制权与因果 Profile 随 epoch 固定；Beat 不进入 Time Profile 机械。 | 0007 §§6–8；0013 §7；DEC-009/RTP-D005。 | Spotlight policy 与 Time Profile 分离引用；现实时间、ACK、TTL 永不转为 fictionInstant。 | **实际（有效）**：F01–F07 由 `runtime-trigger-time-v2.test.mjs`，Spotlight≤3 与现实等待护栏由 Rules/Room multiplayer 公开测试覆盖；冻结组合仍待。 |
| 第二权威 | D1 `where/clocks/squad`、客户端组队、UX 在线状态和 Room Action 自有时钟不能成为活跃事实。 | 0007 §§2、4–8、13；DEC-014。 | Room DO 保存唯一控制/时间/账本；Rules 产生世界时间事件，Room Action 只调度镜头。 | **待实现**：重启/分队/会合 replay 与静态架构检查。 |

### 4.6 SPEC 0008：长团成长、章节连续性与继任角色

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | Story/Encounter 结束不等于 Chapter/Campaign 结束；继任者是新实体，不取得前任 Pending/Frame/知识。 | 0008 §§2–8；0009 §§8–9；0010 O17；0012 §13；DEC-010/011/020。 | Chapter transition 先结清必答/机械并保存连续性清单；Successor 使用新 entity/tenure/ViewerKey；控制结束后的 `successorRequired` 由可信 lifecycle Viewer 经同一 Rules projector 产生。 | **实际（有效）**：world/campaign、Room multiplayer 与 observer 覆盖章节、死亡/退役、统一 lifecycle 投影、继任及真实 sequel boundary。 |
| 权限 | 成长选择、退役、继任与是否继续 Campaign 属于各玩家；转 NPC 需同意，此后才由 KP 控制。 | 0008 §§3、5–8；0006 §§4、7。 | 资格只开 Pending，不自动选职业/HP/继任；房主/KP不能代退休或转 NPC。 | **待实现**：成长重启一次、退役同意、继任选择越权。 |
| 秘密 | 私人知识、旧叙述、关系和未分享线索不按账户继承；内容安全偏好可在玩家层持续。 | 0008 §§4、7；0010 §§5、6、O17；DEC-011/012。 | 每项继承必须有独立世界事件/来源；章节回顾只概括当前 Viewer 可见结构化事实。 | **待实现**：合法/非法继承矩阵、章节无聊天历史。 |
| 版本 | Campaign 固定 AdvancementProfile 与版本链；Chapter module 必须兼容当前 Runtime manifest；旧章不重算。 | 0008 §§2、5、9；0006 §2；0013 §§2–3。 | 成长策略或 runtime epoch 变化必须显式迁移事件；静态卡同步不改变活跃版本。 | **部分实现**：`milestone | srdXp2014` genesis、累计阈值、Profile 互斥和 `ExperienceAwarded` replay/project/correction 已由 world 9/9 + compound 19/19 验证；module upgrade、P05/F08 与冻结源码组合仍待。 |
| 第二权威 | D1 静态人物卡、章节 UI、回顾消息和模块目录不能保存第二份活跃成长/连续性。 | 0008 §§5、9、13；DEC-014。 | Room DO 事件可重建任期、成长和继承；D1 异步失败不回滚或替代 DO。 | **待实现**：D1 同步失败、归档重建后 campaign hash。 |

### 4.7 SPEC 0009：失败、节奏、收束与交互协议

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | Scene、Encounter、Story、Chapter 与 Campaign 是不同结束层级；EndingPredicate 只提候选，玩家明确继续才开续篇。 | 0009 §§1、8–9；0008 §§2–3；0012 §13；DEC-003/010/020。 | 结束 input 由 `step` 验证未结机械；Story/Chapter/Campaign ID 不复用；不自动生成新敌人撤销结局。 | **实际（有效）**：Rules compound 18/18、world/campaign 7/7 与 production-validator 31/31 连续评测覆盖候选、收束、尾声和显式续篇。 |
| 权限 | 玩家分别决定接受投降、继续追击、尾声和续篇；KP 决定 NPC/世界；安全暂停不需房主批准。 | 0009 §§8–10；0007 §9；0012 §13。 | 结局候选不能自动代答；私人安全请求停在稳定点且不变角色意图。 | **部分实现**：O 与 B29/B30 的拒绝/逐人接受、尾声/续篇已由 combat/world/compound/vertical 公开测试覆盖；生产安全暂停路径仍待最终验收。 |
| 秘密 | 叙述、失败代价、尾声和安全原因按 Viewer 隔离；模型重试不能跨 Viewer/branch 复用文本。 | 0009 §§6–7、10；0010 §§7–10。 | narration key 绑定 event range、branch、ViewerKey、projectionHash 和 policy；不保存历史。 | **待实现**：O15/O18、不同 Viewer 叙述隔离。 |
| 版本 | 叙述政策、结局 Profile、章节和活动分支均固定；模型升级不改已提交事实。 | 0009 §§6、8–9、14；0010 §11；0011 §4；0013 §2 extensions。 | presentation/narration policy 进入 Profile 闭包；模型 Profile 独立审计并显式迁移。 | **待实现**：XR-06、模型切换不重做机械。 |
| 第二权威 | SceneQuestion、EndingPredicate、UI、模型和势力调度器只能提出候选，不能直接改世界。 | 0009 §§1、5、8、14；0003 §1；DEC-020。 | 失败、势力推进、收束与续篇全经 `step` 和 DO commit；聊天文本不决定状态。 | **实际（局部）**：Rules compound 18/18、production compound 1/1、production-validator 31/31 连续评测；真实模型/线上收束仍待发布证据。 |

### 4.8 SPEC 0010：观察者专属呈现与当前回应投递

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 单槽需同时处理并发叙述、控制转移、继任、更正、普通重启与灾难重建；XR-01/02/07/08 给出唯一组合语义。 | 0010 §§4、8、11–12；0007 §2；0008 §7；0011 §§6–7；DEC-012/013。 | 槽按 ViewerKey 单一持久；发布拒绝过期绑定；撤权/更正原子失效；灾难重建不伪造旧帧。 | **待实现**：O07–O12、O15–O18。 |
| 权限 | ViewerKey、Audience、ACK 和内部 publish capability 都不能由客户端自报；Audience 冻结不抵消后来撤权。 | 0010 §§3–4、8.4、12、17.2。 | AuthenticatedViewer 判别式由服务端构造；页面仅 observe/intent/answer/ACK。 | **待实现**：O01/O12/O14、伪造 Viewer/Audience/projectionHash。 |
| 秘密 | 个人线索无限期私有；世界内分享范围冻结且不追溯；语音、错误、候选、日志、历史均无旁路。 | 0010 §§5–10、14–15；DEC-006/011/012。 | 一个内部 projector 服务所有领域内容，包括 `successorRequired` lifecycle 与 Rules 派生的恢复候选；telemetry 仅固定非内容白名单；ACK/覆盖删除正文。 | **实际（局部/有效）**：world/campaign、Room multiplayer 与 authoritative table 已覆盖新增统一读取；O01–O18 的错误、日志和线上媒体旁路仍按完成门单列。 |
| 版本 | Frame 绑定 branch、projection hash 与呈现政策；三个呈现协议 ProfileRef 必须进入 0013 extensions。 | 0010 §§8、11、17.4；0013 §2.1；XR-06。 | manifest 缺呈现策略即拒绝；旧 projector 不静默扩大旧房可见性。当前 Projection Policy 为 1.2.0 / `sha256:9312f68960f1c53f79b5c95bfd8c95ab87aec903603796f455a6c1d2d4514d8c`，完整 manifest 为 `sha256:2f7af76e9a7262675210c18528ca9c6bead5c676aecc71113304eaf01f42dbe9`，canonical genesis golden 为 `sha256:7e858e340283252d67779ddb1ae773fb5ac5a98d3859fdcef467c58a34935355`。 | **实际（有效）**：P03–P05 + O15/O16 的 runtime Profile/observer 联合场景已记录绿色；冻结源码组合仍待。 |
| 第二权威 | DeliveryFrame 非正史、不回放；`observe` 只组合 project 与槽；D1/客户端/语音不得保留历史。 | 0010 §§1、7–13、17.5；0003 §2。 | 无消息表、队列、localStorage 历史或媒体永久 URL；结构化知识与 Frame 分开。 | **待实现**：静态存储检查 + O09/O10/O18 行为测试。 |

### 4.9 SPEC 0011：可靠性、更正、可观测性与多轮评测

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | instance restart 与 archive disaster rebuild 不同；旧 Delivery 审计只保留非内容引用；连续评测必须穿过 production validator。 | 0011 §§6–9；0010 §§8.3、11；XR-07/XR-08/XR-13；DOC-04。 | 恢复模式显式授权；Archive 不含 Frame；到期 Activity 的随机恢复须从冻结参数导出 canonical due root 并严格核对持久事件前缀；canonical 20+ eval 生成完整 draft 并逐轮执行 production validator/projection-bound。 | **实际（有效）**：记录的 Room 恢复迁移组合 16/16（含 archive/correction 5/5）、F04 与 production-validator 31/31 已通过；真实 Workers AI/冻结门另计。 |
| 权限 | 普通玩家只能报告错误；更正、灾难恢复、内部随机 continuation 和 KP/NPC 重试均有独立 capability。 | 0011 §§1、6–8；0003 §§3、5、10；DEC-013。 | `commitCorrection`/restore 重新鉴权并由 DO 构造上下文；请求体不能提供状态或分支图。 | **待实现**：普通 commit 调 correction、未授权 restore、重试换载荷。 |
| 秘密 | 错误、日志、ModelInvocationReceipt 与归档不得保存 Prompt、原文、私人叙述、候选或原始身份。 | 0011 §§1、4–7；0010 §10。 | telemetry schema 白名单 + 唯一 redactor；任何 console 只能接收 redacted record。 | **实际（局部）**：`tests/structured-telemetry-v2.test.mjs` 当前声明 7 项，已有 serializer/receipt 局部绿色；全部生产日志禁止字段扫描及线上日志仍待。 |
| 版本 | 规则/事件/定义/Profile/分支由 0013 精确 manifest；模型与 Prompt policy 独立绑定并留脱敏调用 Receipt。 | 0011 §§4、6–7；0013 §§2–3；DEC-015/016。 | 模型升级不改 manifest 所解释的已提交事件；更正和重建按历史 Adapter，未知组合 fail closed。 | **部分实现**：P04–P08 与 archive hash/篡改拒绝已有 runtime/archive 公开证据；真实模型切换/额度失败仍待阶段 4/5。 |
| 第二权威 | 日志、D1 archive、模型缓存、Delivery 缓存、SLO 监控与 fixture 都不能提交世界或重解释事件。 | 0011 §§2–9、12；DEC-014/017/022。 | Archive adapter 只幂等复制事件；fixture 仅位于 KP/熵/时钟/外故障 seam；恢复输入有版本 allowlist。 | **实际（有效/局部）**：四阶段随机恢复 4/4、archive/correction 5/5、production-validator 31/31；增量 D1 archive、真实模型与线上日志/配额仍待最终组合。 |

### 4.10 SPEC 0012：权威战斗机械

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | CombatProfile 由 0013 manifest 填充；B16 通用恢复不在战斗；非战斗危险复用相同 damage/death；Encounter 结束不等于故事结束。 | 0012 §§1–2、10–13、15；0013 §§1–8；XR-05/XR-09/XR-11。 | 战斗只是 Rules Implementation；不要求进入 Encounter 才能调用通用伤害死亡原语；结束只产生相应事实/候选。 | **实际（局部/有效）**：`tests/combat-mechanics-v2.test.mjs`、`combat-hostility-v2.test.mjs`、`combat-long-casting-v2.test.mjs` 与 `combat-vertical-v2.test.ts` 已存在；日志已记录 B07、B38、伤害/死亡定向场景和 B53 垂直链绿色。冻结源码整组仍须重跑。 |
| 权限 | 玩家选择自己的目标、路径、反应、非致命和平手；KP 只为有限知识 NPC/环境选择；Rules 只算强制结果。 | 0012 §§3、5–9、12–13、18.2；0006 §7；0007 §1。 | Combat input 不含 actor/principal；区域集合、触发资格和强制移动由 Rules，封闭选择开正确 Pending。 | **实际（局部/有效）**：B07–B15、B17–B22、B29/B30 与 B49 的玩家/NPC/私人 Pending 由 `combat-mechanics-v2.test.mjs`、`rules-compound-action-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs` 和 `combat-vertical-v2.test.ts` 公开 seam 覆盖；最终 HTTP 越权回归仍待。 |
| 秘密 | 隐藏位置、实体、能力、deathPolicy、区域集合、反应和排序全部经 0010 projector；NPC Viewer 不得换 KP Viewer。 | 0012 §§3、7–8、12、18.3；0010 §§7、10。 | 战斗错误不区分隐藏目标不存在/无权；页面不保存战斗日志或自行算有效 AC。 | **实际（局部/有效）**：`tests/observer-projection-v2.test.mjs`、`privacy-bypass-v2.test.mjs` 与 `combat-vertical-v2.test.ts` 覆盖 G15 空间秘密、玩家私有反应及不同 Viewer 投影；生产 HTTP/日志/语音旁路仍待。 |
| 版本 | 2014 语义、Geometry/Trigger/Time/Ability/DamageDeath 均由 0013 id+hash 固定；产品裁定不冒充 SRD。 | 0012 §2、§§4–12、18.4；0013 §§2、4–8；RTP-D001–D005。 | Encounter 只引用当前 epoch manifest；2024/5.5e 语义拒绝；旧房精确旧 Adapter。 | **实际（有效）**：B35–B40 与关联 P/A/G/T/F 由 `runtime-profiles-v2.test.mjs`、`ability-profile-v2.test.mjs`、`combat-mechanics-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs` 验证；日志已记录当前 canonical hash 链和 Profile 组合绿色，冻结门另计。 |
| 第二权威 | 无 CombatCoordinator、战斗 DO、战斗骰源、战斗 projector、D1 镜像、客户端区域选人或平行 spell/damage engine。 | 0012 §§1、14、17–18；DEC-002/014。 | 包入口不导出 combat helper/MechanicOp/fold；Room Action 只交 Rules Input。 | **实际（局部/有效）**：`module:check` 已记录通过；当前随机/恢复/对抗组合 24/24、retry 3/3、archive resume 2/2、`tests/combat-vertical-v2.test.ts` 1/1，均走 Room DO→Rules→Viewer。生产源码尚未冻结。 |

### 4.11 SPEC 0013：版本化运行时 Profiles 与确定性 Conformance

| 审查项 | 发现与结论 | 正式消解来源 | 实现护栏 | 测试映射 / 证据 |
| --- | --- | --- | --- | --- |
| 跨规格矛盾 | 本规格是 0004/0005/0007 时间占位和 0012 Profile 占位的精确填充；呈现策略必须经 extensions 补齐；构建测试不能替代行为验收。 | 0013 §§1–3、9、11–12；XR-04–XR-06/XR-12。 | 一个完整 manifest；规范微秒；Projection Policy 1.2.0 固定统一 lifecycle/恢复候选读取；到期 Activity 用可严格恢复的 canonical root；内部 validator 不导出，行为向量走公开 seam。 | **实际（有效）**：P01–P08 由 `tests/runtime-profiles-v2.test.mjs`，F01–F09 由 `tests/runtime-trigger-time-v2.test.mjs`，O15/O16 组合由 runtime + observer 公开 seam 覆盖；冻结 SHA 仍须整组重跑。 |
| 权限 | 客户端、LLM、房主、队长和普通 Room Action 无权选择 manifest、上传 MechanicOp、覆盖区域集合或决定触发/时间。 | 0013 §§1、3–7、12.2；0003 §2.2。 | Genesis/epoch 由权威创建；只接受 AbilityRef/有权封闭参数；内部 continuation opaque。 | **实际（有效）**：A06/A09、G11/G15、T02/T06、F02 分别映射 `ability-profile-v2.test.mjs` + `combat-mechanics-v2.test.mjs`、`privacy-bypass-v2.test.mjs` 与 `runtime-trigger-time-v2.test.mjs`；玩家/KP 不能提供 MechanicOp、target set、时间或自动选择。 |
| 秘密 | Profile 规范/hash 可公开，但实例坐标、隐藏屏障、定义、TriggerBatch 和未来到期仍是秘密领域数据。 | 0013 §§3、4、5.5–5.6、6、12.3；0010 §§7、10。 | 所有诊断带秘密级别并经 project；Registry/log 只记录 ProfileRef/hash/公开错误码。 | **实际（局部/有效）**：G15 在 `tests/privacy-bypass-v2.test.mjs`，T02/F07 在 `runtime-trigger-time-v2.test.mjs`，并与 observer projector 共用公开 seam；生产日志与 HTTP 旁路仍待阶段 5。 |
| 版本 | ID+hash、JCS、SHA-256、Registry 精确匹配、旧 Adapter 保留和 unknown fail closed 构成唯一版本合同。 | 0013 §§1–3、8、12.4；DEC-015、RTP-D001。 | 同 ID 不同 hash 构建失败；禁止 latest/semver fallback；当前 projection/manifest/genesis 三元指纹精确匹配；部署前扫描活跃/归档引用。 | **实际（有效）**：P01–P08、A01/A02/A07 和 F08 分别由 `runtime-profiles-v2.test.mjs`、`ability-profile-v2.test.mjs`、`runtime-trigger-time-v2.test.mjs` 公开 `step/project/replay` 验证；部署前活跃/归档引用扫描仍待。 |
| 第二权威 | Registry、Compiler、Geometry、Trigger、Time 和 hash helper 都是 Rules 私有 Implementation；D1 只复制引用/归档。 | 0013 §§1、4、11–12.5；0003 §2.1。 | Rules 包入口仍只有 `step/project/replay`；页面/AI/D1/测试不能计算坐标、顺序、倒计时或 compiled graph。 | **实际（局部/有效）**：`module:check` 与 A09/G11/T01/F02 的公开 Interface 测试已有记录；最终冻结源码的 `module:check`、`typecheck`、`lint`、`npm test` 仍未执行。 |

## 5. 组合验收切片

以下组合测试是跨规格一致性的最低证据。它们必须从真实责任 Interface 驱动；表中目标保持不变，已覆盖的局部证据在 §5.1 单独列出，未覆盖部分不得因同文件其他测试绿色而自动满足。

| ID | 组合场景 | 覆盖规格 | 目标测试 |
| --- | --- | --- | --- |
| CS-01 | 两个并发根行动先后提交但模型响应逆序；同一 Viewer 最终只保留因果更新的当前帧，旧发布无效。 | 0003、0007、0010、0011 | `tests/observer-delivery-v2.test.ts` |
| CS-02 | Audience 内玩家断线并普通重启后恢复同 ID；D1 灾难重建则只有结构化状态和新帧，无旧正文。 | 0003、0010、0011、0013 | observer delivery + archive rebuild |
| CS-03 | NPC A 不知道玩家计划、NPC B 知道；两者同时有反应时，排序稳定且 A 不借 B/KP 知识改变目标。 | 0005、0006、0010、0012、0013 | `tests/module-npc-v2.test.mjs` + `tests/runtime-trigger-time-v2.test.mjs` + `tests/rules-compound-action-v2.test.mjs` |
| CS-04 | 两地并发 Activity 与一场 Encounter 使用同一微秒 Time Profile；现实掉线不推进，因果前沿前不泄漏他处到期。 | 0003、0004、0007、0011、0012、0013 | `tests/rules-multiplayer-v2.test.mjs` + `tests/multiplayer-room-v2.test.ts` + `tests/runtime-trigger-time-v2.test.mjs` |
| CS-05 | 角色取得私人线索、跨章持续、死亡、建立继任者；继任者没有旧知识/帧，只经遗嘱或实际交流取得部分内容。 | 0005、0007、0008、0010、0011 | campaign + world knowledge + observer delivery |
| CS-06 | 非战斗炸药危险经同一 Ability/Damage/Death 管线致死，随后建立继任者；无 hazard 或 campaign 第二机械路径。 | 0003、0004、0008、0012、0013 | noncombat + combat mechanics + campaign |
| CS-07 | 动态强敌定义先被 Compiler 诊断，KP 依据 NPC Viewer 修订；合法高数值不削弱，注册后目录升级仍按旧图回放。 | 0003、0005、0006、0011、0012、0013 | `tests/ability-profile-v2.test.mjs` + `tests/module-npc-v2.test.mjs` + `tests/runtime-profiles-v2.test.mjs` |
| CS-08 | 已 ACK 私人结果发生因果更正；旧正文不恢复，旧事件/骰面/Receipt 可审计，新分支按原 Profile 产生专属说明。 | 0003、0005、0010、0011、0013 | correction archive + observer delivery |
| CS-09 | NPC 投降，部分玩家拒绝停止；Encounter 不自动结束。所有相关玩家接受后结束机械，但 Story/Chapter 只在后续明确事务收束。 | 0006、0007、0008、0009、0012 | `tests/combat-mechanics-v2.test.mjs` + `tests/combat-vertical-v2.test.ts` + `tests/world-campaign-v2.test.mjs` |
| CS-10 | 20+ 连续意图/回答覆盖秘密、分头、动态危险、NPC 有限知识、失败、战斗、章节、模型失败和真实收束，并满足 18/20 与硬门。 | 0003–0013 | `tests/kp-multiturn-eval.test.ts` |

### 5.1 已回填的组合证据

- CS-02 **有效**：observer delivery 4/4 证明普通实例重启恢复同一当前帧；`archive-correction-v2` 5/5 证明授权空 DO 灾难重建只恢复结构化权威状态、不会恢复旧 Delivery 正文。
- CS-04 **局部有效**：Rules multiplayer 8/8、Room multiplayer 8/8 已证明个人/整队休整、分地虚构时间、因果前沿与 Spotlight；“同时并发 Encounter”的完整组合仍待。
- CS-05 **局部有效**：world/campaign 7/7、observer projection 5/5、Room multiplayer 8/8 已证明私人知识跨章、死亡/退役、继任默认零继承和 provenance；与灾难归档重建的组合仍待。
- CS-06 **局部有效**：world/campaign 7/7 已通过非战斗危险共用伤害/死亡及后续继任；生产 Room 复合危险链仍待。
- CS-08 **有效**：`archive-correction-v2` 5/5 已覆盖 ACK/失效 Delivery、旧 Receipt/骰面审计、前向补偿与正式后果触发因果分支，并保持 Viewer 秘密边界。
- CS-09 **局部有效**：`tests/combat-mechanics-v2.test.mjs` 已覆盖任一存活玩家拒绝后 Encounter 保持活跃及全员接受，`tests/combat-vertical-v2.test.ts` 已记录 1/1 贯通自然语言投降、逐人同意、机械结束而故事仍活跃；线上真实 KP/HTTP 仍待。
- CS-10 **数量、production validator 与脚本阈值有效**：`tests/kp-multiturn-eval.test.ts` 单场景 31/31，逐轮经过 `validateProposal` 与 projection-bound；真实 Workers AI 与线上 table/API 闭环仍待。

## 6. 审查结论

1. 未发现需要修改、缩小或绕过 `SPEC 0001` 才能解决的产品冲突。
2. `SPEC 0003` 的通用事务、`SPEC 0010` 的单槽投递、`SPEC 0011` 的恢复/更正、`SPEC 0012` 的纯战斗机械与 `SPEC 0013` 的精确 Profile 可以组成同一条权威责任链；不得分别实现 Coordinator、投影、骰源、时间或状态副本。
3. NPC 权限、虚构时间/并发、继任角色和恢复语义均已有正式消解来源；实现必须按本文组合护栏验证，不能只让各规格孤立单测变绿。
4. DOC-01–DOC-05 所列五处过期或欠完整表述已按 §3.1 回填；§3.2 与 §5.1 只升级实际执行过的行为证据，并明确标注后续源码演进后的冻结重跑责任，没有因文档一致而升级其他场景。
5. `decision-register.md` 的证据已按当前实际命令逐项回填；仍写“待实现/局部”的条目不得被解释为整份规格或发布完成。
6. 在 CS-01–CS-10、各规格 Interface 测试、全量验证、迁移与发布证据实际完成前，本审查不能用于宣告 Goal `COMPLETE`。
