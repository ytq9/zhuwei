# vNext round4：真实提交、库存旁白与观察范围

日期：2026-09-05。继续 `cloudflare` / `258caee404e0814405eb497653ee9f00d647b773` 的未提交工作。本轮属于开发期与已授权的有界 DeepSeek 验证；没有 push、部署、远端 migration、生产切换或删除数据。

**正常认证 HTTP 到真实 DeepSeek 的机械提交首次成功，但可用且准确的模型旁白尚未验收，V01 仍未完成。** [脱敏证据](vnext-round4-live-evidence.json) 单独记录本批；[round3](vnext-narrative-validation.md) 的失败证据继续保留。

## 合同与修复

玩家通过正常自然语言行动操纵物品、观察当前环境；Rules/Room 原子提交真实移动与观察证据，按每个 Viewer 的既有授权投影充分结果。当前场景可以作为感官范围，不能因此替代机械对象、授予隐藏子对象或省略冻结读取集。玩家已提及的叙述承诺仍必须先固化，即使后续观察指向场景而不直接消费新对象的 handle。

| 实际缺口 | 根因与通用修复 | 直接消费者与拒绝边界 |
| --- | --- | --- |
| 物品已放下，旁白只说“行动已提交” | `InventoryOperationApplied` 是内部事务事件；其 `inventoryOutcome` 错误继承内部 envelope，遭 Viewer 过滤。结果 Claims 使用自己的 Item 与参与角色授权，不输出内部事务或上下文 | `claims.ts` → `observer-delta` → 冻结 DeliveryPlan → 旁白。继续使用正式提交前后 Viewer grants，不扩大权限 |
| 部分转交/合并后发送者看不到结果 | source 与 target 分别作为独立授权锚点，只描述本次移动量；相同引用去重 | 发送者不获接收者新栈身份或总量；源栈已删除时仍由本次提交前的授权支持结果；部分放下不把剩余持有栈标为“已放下” |
| 普通“环顾四周”没有合法直接目标 | 新增共享 `authorityWorldInteractionTargetVisibleTo`：当前实际场景仅在无 Ability、两分支无机械 effects 时作为感官范围；具体对象保持原空间和可见性检查 | Proposal lowering 与 Rules 共用谓词。Rules 明确验证范围/证据读取集；场景感知的具体 subject 另验实际观察者可见性。裸能力检定、既有对象和自身目标正常路径保留 |
| 必须固化的旧描写，使合法场景观察在 Rules 被拒 | lowerer 添加服务端义务依赖，原子 compiler 与持久计划 validator 却只接受 typed consumes 依赖。两者现共用义务物化者推导，要求唯一、无条件、顺序正确 | `world-interaction-model.ts` / `world-interactions.ts` → 提交和 replay。无需让模型伪造无实际消费的 prospective；遗漏依赖、条件物化、错误顺序仍拒绝 |
| 旁白错误码无法定位具体校验门 | 增加闭合 `groundingReason`，从初次/替换校验错误进入调用回执，再由日志白名单输出 | 只在 narration / modelPermanent / narrationGrounding 下输出固定原因。正文、私密 Claim、引用与任意错误字符串不进入日志；公开错误码不变 |

本轮没有对象名称派发、提示词关键词机械规则、响应补括号、自动删模型步骤或构造在线成功。场景范围不等同于完整感官规则系统；任意文字是否符合场景事实与连续性仍需模型遵守冻结合同。

## 定向验证

- 库存 20/20：公开/私有持有栈、不同结构物品、opaque 定义、部分释放、分批转交、完整合并与源条目删除；双方 Claims 与完整 replay 通过。
- 世界交互 17/17：普通视察、无语义对象的环境听取、真实 freeze → lower → Room read-set bridge → Rules → Viewer Claims → replay；机械 scope、隐藏/异场景 subject、遗漏读取集拒绝，裸检定和自身观察正常。现役场景仍使用合法 Geometry，本轮未更改 Geometry 初始化合同。
- 叙述义务相关组 `narrative-details / narrative-item / atomic-input` 共 31 项；首次 30 通过、1 项旧断言仍要求晚期错误文案，已改为验证提前原子拒绝。最终 narrative-details 8/8；其余 23 项在同一功能源码下通过。场景范围与无 prospective 的物化义务新增用例可提交并精确 replay。
- Claims 17/17；旁白与安全日志目标用例 9/9。旁白旧成功 fixture 补上已存在的目标事实，避免用遗漏 Claims 的正文冒充合法回复。
- `npm run typecheck`、`git diff --check` 退出 0。各检查组有重叠，不相加为全项目通过数；未运行全量测试、全项目 Lint 或 production build。

## 真实在线结果

宿主是独立本地 `dev:vnext`，经普通注册、开房、建卡、开团、ACK、`sendAction`、`fetchTable` 调用真实 DeepSeek beta strict。不是已部署的 vNext 生产环境。schema/Profile 变更后的对照使用新测试房，不重解释原房间绑定。

| 样例 | 实际模型与权威结果 | 旁白与验收 |
| --- | --- | --- |
| 小 schema 传输对照 | 同一真实 binding，嵌套 `anyOf` / `$def` 工具输出合法；607 输入 / 105 输出 | 只定位传输能力，不计游戏通过 |
| 从背包取出 1 支弩矢放在脚边 | 模型只提出正式 release，未多写 use；`InventoryOperationApplied` 提交。持有 20→19、场景新增 1，version=1、receipt=1 | 发布“本次行动已经由权威状态提交。你接下来怎么做？”；缺少实际结果，质量失败。完全重复请求返回同 receipt/状态/投递，增加 0 次模型调用 |
| 同一库存操作后原地环顾四周 | 修复后真实模型提出 release + worldInteraction，当前场景为直接观察范围。5 个事件原子提交，持有 20→19、场景新增 1；感官证据保存，version=5、receipt=1 | 初次旁白与一次替换均 `NARRATION_GROUNDING_REJECTED`，没有发布新 KP 正文。停止追加调用 |

两房 HP 均保持 28/28，其他库存与职业资源未被意外修改；这只证明无成本行动不误扣资源，不证明攻击/职业能力的真实扣费链已经通过。两房 DO 副本的 genesis + 全部事件 replay 与实际存储状态精确一致。

对照的持久 DeliveryPlan 已包含 2 条独立库存锚点、感官证据、互动结果与提交事实，证明库存材料丢失已修。多句感官文本已在 Claims 中分句；把冻结事实忠实串接成正文的离线检验通过，未证明当前 guard 必然不可满足。**两条真实被拒旁白原文没有持久化，仅有响应哈希、用量与统一拒绝码，因此不能追认其具体错误原因。** 新原因码只对以后调用生效。离线串接不计模型输出或在线成功。

本批总计 **2 个根行动，6 次模型调用，61,518 输入 / 1,807 输出 tokens**：

| 调用 | 输入 tokens | 输出 tokens |
| --- | ---: | ---: |
| 传输对照 | 607 | 105 |
| 首次库存 Proposal | 27,541 | 436 |
| 首次库存旁白 | 1,140 | 50 |
| 组合行动 Proposal | 27,598 | 904 |
| 组合行动初次旁白 | 2,365 | 156 |
| 组合行动旁白替换 | 2,267 | 156 |

预算为最多 3 根/12 次、360k 输入/32k 输出，每 HTTP 最多 4 次；首次质量失败后只执行一次有区分价值的修复对照。本批未用尽预算，不为碰成功继续重跑。约 27.5k 的简单 Proposal 输入仍超过 TODO 的模型采用目标，不能据一次成功声称 token 预算优化完成。未混入此前各独立批次成本。

## 尚未通过的门

下一步先用安全原因码定位模型旁白的新增断言、遗漏、玩家能动性或旧 grounding guard 等具体失败门，完成有用正文后，再验环境承诺 → 后续引用固化 → 实际交互与动作/职业资源消耗。原子义务依赖与原因码为本次真实对照之后的本地修改，仅有定向证据，尚无新的在线通过记录。

环境叙述连续游戏、模型生成物品的完整在线生命周期、世界内拒绝、动作资源实际消耗、长时上下文与 token p95 采用门仍未完成。V01–V03 不作生产替换验收；生产 V3 保持现状。本批测试宿主结束时已停止，私密响应、Cookie 与能力凭证仅留在权限受限的本地临时证据中。
