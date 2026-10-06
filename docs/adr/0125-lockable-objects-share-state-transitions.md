# ADR 0125：场景物件共用开关与锁定状态规则

- 状态：已接受
- 日期：2026-10-06
- 依据：用户要求把开锁做成通用规则，而不是仅针对门。沿用 [SPEC 0001 §§5、7](../specs/0001-llm-kp-responsibility-contract.md) 的自由方法与创作边界、[SPEC 0014 §§2.3、4](../specs/0014-observer-tactical-map-and-environment.md) 的有限状态及权威几何和 [SPEC 0015 §11.1](../specs/0015-part-c-adoption-and-observability.md) 的骰前固化。
- 取代范围：[ADR 0114](0114-a-door-of-a-new-place-is-completed-on-first-use.md) 中按 portal 类别选择机械补全与开锁操作的实现。地图和通路继续使用既有环境事件和投影。

## 决定与实现边界

`operateObject` 与 `objectStateTransition` 以原对象引用、当前状态和有限状态图为输入，支持 open、close、lock、unlock。对象名称和地图类别不选择专用逻辑；门、固定箱柜、格栅等共用 `objectOperationPlan`。预写的其他状态名同样沿其声明的转换执行。KP 保留方法、属性、工具、DC、耗时及成败后果的裁定权。

可上锁预设将解锁落到 closed，打开是下一条转换。明确打开上锁对象的裁决可组合两条事件；单独解锁不能声称已经打开，直接点地图打开不能绕过锁。打开箱盖不代替取物，也不代替解除绑定或角色条件。

首次需要机制的可见场景物件由同束 `completeObject` 在随机之前补全，仍保留原身份。已有状态图或耐久不通过这条入口重写。补全明确选择空间后果：`opensPassage=true` 使用门洞开闭预设，false 保持各操作状态的既有占位、视线和掩护；特殊空间行为沿已有的显式状态图。初始开着的门洞关闭后采用阻断状态，不能从初始可通行状态复制出永远可通行的“关门”。已明确的 open／closed／locked 状态不能借补全改变。

转换结果继续写 `EnvironmentFeatureStateChanged`，补全继续写 `EnvironmentFeatureCompleted`，没有新的存储事实源。状态、几何、另一侧连接、旁白主张、重放和更正共用现有事件链。规则语义与事件意图清单绑定当前新 manifest，旧房间处理沿 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md)，本任务没有部署授权。

## 验收边界

- 门：成功与失败的撬锁／强行打开、工具熟练、地图不能越过锁、两侧状态和通路一致。
- 结构不同的对象：固定铜箱解锁仍关闭，开关和上锁保留占位、掩护及库存；非 portal 格栅使用自定义状态名。
- 拒绝与恢复：不覆盖既有定义或已明确状态，隐藏／不可达／陈旧图拒绝；初始打开的门、事件重放与可审计更正。
- 本地 Room：新建地点、进入、补全和解锁、同提交重试、驱逐后继续操作、地图可见结果、归档恢复。使用脚本化模型回复，不能视为真实模型验收。

定向测试为 `tests/kp/world/door-completion.test.mjs`、`tests/kp/adjudication/common-actions.test.mjs`、`tests/kp/adjudication/common-action-effects.test.mjs` 和 `tests/kp/world/object-mechanics.room.test.ts`。既有描述补全由 `tests/kp/world/object-completion.test.mjs` 保证。

## 待裁定范围

库存实物属于另一持久化领域。现行 [SPEC 0016 §7.2](../specs/0016-part-c-compound-actions-and-claims.md) 明确把 `completeObject` 限定为场景对象定义；已向用户提出最小扩展确认，尚未收到答复。可携带物品的机制补全与随转交保存状态的草稿因此未接入当前代码，本 ADR 不宣称其完成。容器内部库存、束缚绑定以及新增战斗动作也不在本次验收范围。

本实现不新增模型调用或外部服务。固定说明和表单的体积按 ADR 0057 测量并告知用户，不使用实际付费调用测量。
