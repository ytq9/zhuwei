# DiceFrame 与烛帷：物品生成、模型填表与可借鉴设计（2026-09-09）

## 调查边界

- DiceFrame：读取公开仓库 main 的固定提交 `3f5bb016e5aef14dd056ad33ec67b6d11df0311a`，源码副本位于 `/tmp/diceframe-research-20260909`。
- 烛帷：对照本地 cloudflare 分支 HEAD `75ab7d6da91f1b82d0ddaa8dc7ee1728f9bfce82` 及工作区现状。已有未提交修改保持原样。
- 这是源码调查；没有启动 DiceFrame、调用真实模型、运行两项目测试或核验线上部署。文档中的历史测试结果不当成本次实测证据。
- 以下比较以当前烛帷 vNext 填写和 Rules 实现为准，不沿用早期“vNext 尚未接线”的旧结论。

## 核心结论

两个项目同属自然语言多人 AI 跑团，但 DiceFrame 同时提供轻量叙事协议和 D&D 2024 权威运行时；不能把整个项目描述为“只靠模型改状态”。它能生成物品设定和库存条目，但这些路径不等于任意新魔法物品的完整机械生成、验证与执行。烛帷已经有“创作定义 → 物化实例 → 库存操作 → Ability 执行”的更细机械接口，因此应借鉴它的填写与内容管理体验，而非用其轻量状态协议替换现有权威链。[D1][D2][D3][D4][Z1][Z2]

## 产品与架构差异

| 维度 | DiceFrame 已读实现 | 烛帷当前合同与代码 | 对比较的意义 |
| --- | --- | --- | --- |
| 规则范围 | legacy 支持多类轻量规则；另注册 core:dnd2024，新冒险包默认要求后者 | SRD 5.1 / D&D 5e 2014，禁止混入 2024 机械 | 它的 2024 数据、法术和成长表不能直接替换烛帷规则 |
| 产品入口 | 自部署 Python 服务，WebUI、Bot、世界书编辑器；README 另列移动端、语音、生图 | Cloudflare Worker，Room/Rules 围绕玩家自由行动组织 | 它的内容编辑和多入口覆盖面值得分别考察，README 功能范围不代表质量实测 |
| 状态权威 | GameInstance 聚合；D&D 2024 有版本化 EventBatch、幂等与冲突校验；存档写本地 state.json/chatlog.jsonl | Rules step/project/replay，Room 保存活跃事实、随机、Receipt 与逐 Viewer 交付 | 双方都有服务端规则和状态权威，只是职责与持久化形式不同 |
| 自由创作 | 世界书、角色草稿和状态标签较自由；高级 planner 的特定路径只能挑已有冒险/遭遇 ID | 新物品/能力可提出结构化定义，但必须落入可执行机械并通过权威校验 | 不能从“能创作文本”推断“能自动执行任意机械” |
| 人工介入 | 高级 campaign 的物品/任务/事实记录有 GM 提案确认；经济支付另有付款人确认 | KP 在既有授权内裁决与创作；玩家在实质决策边界输入 | 不宜把它的每类 GM 确认原样搬成烛帷玩家点击流程 |
| 上下文 | 世界书关键词与递归匹配、概率激活、长期记忆召回 | RequiredContext 冻结实际裁决材料，引用/权限验证后交给 KP | 可借内容发现机制，不能用随机召回替代裁决必需材料 |

来源：[D1][D2][D5][D6][D7][D8][D23][Z1][Z3][Z4]。表中的产品定位是对已读入口的分析，不是全部功能优劣排名。

## 它的“填表”分三条路径

### 1. 普通 GM 回合：正文后写状态标签

`prompts/gm_system_zh.md` 要求先输出叙事，再写分隔符和逐行标签，例如：

```text
你找到一瓶回复药水。
---
LOOT:web_user:回复药水
```

使用时写 `USE:web_user:回复药水`，关键物品用 `KEY_ITEM`。标签主要填对象和名称；某些标签填写数值变化。程序再解析成内部状态变更，并交给各域处理。它不是要求模型每次提交与烛帷同等复杂的 ProposalBundle。[D3][D9]

这也不是“没有校验”：玩家更新有目标白名单，切换武器要检查持有，经济字段不能直接绕过经济事务。它的 parser 还会规范化标签格式、寻找漏写分隔符的尾部标签。[D4][D9]

但叙事和变更来自同一份回复，与烛帷“先提交权威事实，再按冻结 Claims 生成旁白”的机制不同。[D3][Z5]

### 2. 世界、角色、物品设定生成：JSON 示例与 JSON Mode

世界书生成 Prompt 给出 `entries` 数组，包含：

```json
{
  "name": "物品名",
  "type": "item",
  "keywords": ["触发词", "别名"],
  "content": "叙事用途、关系和细节",
  "tier": "background",
  "unreliable": false,
  "visibility": "secret"
}
```

这是对字段的示意，非运行产生的新物品。这里的 `content` 是设定正文，不是伤害、消耗、持续时间等可执行机械。[D10]

调用时 `json_mode=True`，OpenAI-compatible transport 实际发 `response_format: {"type":"json_object"}`；没有在这条路径传入用于约束全部业务字段的 strict JSON Schema。Prompt 写“严格 JSON”不等于 API strict schema。[D11][D18]

解析走候选 JSON 提取和语法修复；仍失败且有返回文本时，再请模型修复一次。角色生成另外还有字段默认、超限属性缩放和装备品质清洗。后者是角色草稿路径，不能扩大成“任何物品都会被自动降级”。[D11][D19]

### 3. 高级规则 planner：小型 function calling

D&D 2024 的 planner 工具分别负责冒险选项匹配和遭遇预设匹配。以遭遇选择为例，模型填写：

- `encounter_preset_id`
- `confidence`
- `reason`

候选列表来自服务端，模型被明确禁止编造敌人、数量、HP、AC 或攻击。返回后服务端检查 ID 是否在允许集合中，以及置信度阈值；这条路径的职责是目录匹配。[D13]

这些工具定义没有声明 `strict: true`。通用 `call_tools` 优先原生工具；特定 tool_choice 拒绝时尝试 auto，失败后可以将 schema 串进 Prompt，改用 JSON Mode 模拟工具参数，也可以走配置的备用供应商。它是一套兼容不同模型的传输策略，不能据此断言其首次合法率更高。[D12][D13]

## 它生成的物品能做到哪一步

### 世界书物品

能创建带名称、关键词、正文和可见性的 item 条目，供后续上下文使用。它提供内容组织和叙事召回，不自动证明该条目已成为某角色持有的、带可执行效果的实物。[D10]

### 轻量库存物品

`LOOT` 解析出玩家 ID 与物品名，名称后缀可识别数量；库存行保存 `name/qty/effect/quality`。正常按名称授予时 `effect` 默认是空字符串。普通库存按名称/类别合并，装备属性还有名称关键词与固定表推导。[D2][D14]

通用 `USE` 实现寻找同名且数量大于零的物品，扣一份数量；若 `effect` 包含 `HP`，提取第一个数字进行治疗。例如效果文本中的 `2d4+2 HP` 不能据此解释为真正的 2d4+2 骰式执行。这是从代码推得的边界，没有实测该输入。[D4]

因此，本次没有找到“上述轻量物品生成接口可自动表达并执行任意新附魔效果”的证据。不能把这个结论扩大为“DiceFrame 完全没有机械引擎”：其 D&D 2024 和通用效果系统另有正式实现。[D1][D6]

### 高级 campaign 的 item 记录

`campaign.propose` 可选 item 等实体类型，填写 title、summary、visibility、target_id，经 GM 确认产生战役记录。该结构没有任意新物品效果程序；`item` 作为战役记录类别不等于完整库存物品规则定义。[D7]

### 新旧运行时仍有共享路径

不能将上述三类接口误读为互不相交的产品：主回合在 runtime 过滤后仍调用共用 state applier；D&D 2024 当前的该过滤方法只在活动冒险步骤屏蔽场景标签，没有在此方法中屏蔽其余全部叙事状态字段。因此未能证明整个项目已统一成同一事件提案链。另一方面，新 D&D 角色构建器从 canonical item_ref 生成起始装备/库存投影，不能把旧生成器的名称推导规则概括成所有新版角色行为。[D20][D21][D22]

### 烛帷当前接口

当前能力目录明确拆分：

1. `authorItem`：新物品定义。
2. `authorAbility`：物品需要的新可执行机械；已有能力可复用。
3. `materializeItem`：从定义生成实物实例，提交数量与所有权。
4. `inventoryOperation`：取得、转交、装备、使用、损坏、修复、毁坏等。

相关 Rules 定义有 quantityCost、chargeCost、durabilityCost、chargesMaximum、durabilityMaximum，并将 Ability 编译、实例唯一性和权威 ID 派生留在服务端。当前填写接口已经由同一领域 schema 派生“裁决、步骤、结果”表，剔除模型无需填写的服务端字段。[Z1][Z2][Z6]

仓库中还有物品转交/使用/损坏/修复/重放、唯一来源重物化拒绝、鉴定与角色知识等行为测试；本次只读其覆盖内容，未重新运行，不能宣称本次验证通过。[Z7]

## 建议借鉴及优先级

### 优先：减轻填写负担，保留现有语义

它的小工具有明确任务和少量输出字段。烛帷已有按需 schema、现有定义引用和三张表，应该沿这些机制继续减少重复陈述：复用已验证定义只提交精确引用，真正缺失时才创作新定义。既有候选找不到不能禁止 KP 创造合理新对象。[D13][Z1][Z6]

这属于改进现有填写体验，不是增加第二套宽松解析器。是否改善成本与合法率，需要同一代表性场景的有界真实模型比较。

### 优先：内容能力标记

DiceFrame Bundle 实体强制填写 `automation_level`，区分 deterministic、guided、reference；前端选择卡实际展示此字段。可为烛帷的内容管理/开发诊断界面表达“已定义并能执行、只有叙事设定、机械尚未闭合”，防止把有描述误当成可使用。[D15][D16]

不应把技术未覆盖伪装成世界中“不存在”，也不应给普通玩家每一步展示内部错误术语。

### 优先：按角色预览秘密

它的世界书检查器提供 GM、全队、具体角色视角，显示条目的公开、角色专属、GM 秘密状态；前端读取后端投影，不另算权限。烛帷可借鉴此类管理界面，把已经存在的 Viewer/Knowledge 机制变得可检查，便于发现“谁提前知道了什么”。[D17][Z3]

### 后续：内容编辑和入门体验

借鉴世界书集中编辑、AI 生成入口、预制角色/冒险的组织方式。烛帷的故事锚点与开放留白合同不支持把预制故事节点强制变成唯一行动选项；可选入门内容与通用自由行动应分别验收。[D5][D13][Z3]

### 不照搬

- 不将正文尾部标签变成权威世界事实的旁路。
- 不靠补括号、修正字段、品质清洗或自动换模型把非法裁决算成成功。
- 不用物品名称关键词/效果文案解析替代 Ability、ItemDefinition 和 ItemEntry。
- 不直接接入 D&D 2024 数据改变当前 2014 规则语义。

这些结论来自烛帷已批准合同与当前边界，并非声称 DiceFrame 的选择不适合其自身产品。[D2][D4][D11][D12][Z1][Z3][Z4]

## 来源

所有 DiceFrame 链接均固定到本次读取的 commit；烛帷链接指向本地当前源码/规格。

[D1]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/docs/ARCHITECTURE_CN.md
[D2]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/commands/state_items.py#L67-L191
[D3]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/prompts/gm_system_zh.md#L18-L53
[D4]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/commands/player_state_applier.py#L39-L140
[D5]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/README.md
[D6]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/builtin.py#L10-L25
[D7]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/dnd2024/campaign/engine.py#L378-L517
[D8]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/lorebook/matcher.py#L17-L129
[D9]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/parser.py#L88-L144
[D10]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/generation/creator.py#L140-L169
[D11]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/generation/creator.py#L406-L497
[D12]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/client.py#L149-L248
[D13]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/dnd2024/director/planner.py#L11-L174
[D14]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/commands/world_tag_handlers.py#L60-L81
[D15]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/bundle.py#L198-L217
[D16]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/frontend-v2/src/features/rulesets/shared/ChoiceGrid.vue#L16-L27
[D17]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/frontend-v2/src/features/lorebook/LorePerspectiveInspector.vue#L31-L84
[D18]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/llm/client.py#L620-L687
[D19]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/generation/creator.py#L861-L952
[D20]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/commands/round_processor.py#L637-L726
[D21]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/dnd2024/runtime.py#L920-L936
[D22]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/rulesets/dnd2024/character/builder.py#L371-L412
[D23]: https://github.com/diceframe/diceframe/blob/3f5bb016e5aef14dd056ad33ec67b6d11df0311a/src/engine/persistence.py#L33-L73
[Z1]: ../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts
[Z2]: ../../app/_runtime/lib/rules/v2/authored-materialization.ts
[Z3]: ../specs/0001-llm-kp-responsibility-contract.md
[Z4]: ../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md
[Z5]: ../../app/_runtime/lib/kp/narration-vnext.ts
[Z6]: ../../app/_runtime/lib/kp/vnext/proposal-filling-interface.ts
[Z7]: ../../tests/kp-vnext-item-product-closure.test.mjs
