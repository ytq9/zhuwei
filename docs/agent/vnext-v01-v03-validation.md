# V01–V03 本地验收记录

日期：2026-09-05。工作分支 `cloudflare`，起点 `258caee404e0814405eb497653ee9f00d647b773`。本次保留并继续前序未提交交接；不是生产发布或完整 SPEC 0001 A–O 验收。

状态：V02 危害与 V03 当前可执行机械的物品生命周期矩阵通过；V03 尚有未接入的效果原语，不能宣称全部魔法物品能力完备。V01 本地入口、预算/恢复/归档与 schema handshake 已接通，真实游戏成功提交链路尚未通过，不能把 V01 勾为全部完成。

后续用户批准的环境描写/按需固化、库存存量权威修复，以及 round2/round3 独立真实批次见 [叙述承诺与真实模型验收](vnext-narrative-validation.md)。本文的 10/12 次调用与旧 schema hash 保留为本批历史记录；最新轮两次正常 HTTP 仍未提交，不覆盖或混计此前结果。

## 能力与代表性矩阵

| 范围 | 本次闭合的通用能力 | 定向证据入口 |
| --- | --- | --- |
| V01 上下文 | 从真实模组、场景、权威候选、局部否定和结构化先例生成五态；所有创建验证版本化范围授权 | `kp-vnext-context-runtime`、`kp-vnext-materialization-authority` |
| V01 选取 | 保留完整角色、被选工具、费用及因果约束；按反应类型保留防御反应，避免全库存及同类实例逆向扩张 | `kp-vnext-context-inventory-scope`；同一真实 genesis 17,282 → 6,677 units，硬门仍 16k |
| V01 真实空间对象 | 仅从现役 Geometry 读取 feature；唯一目录定位、完整正文/hash、空间/可见性和闭包共用一条权威路径，扫描计预算 | `kp-vnext-context-geometry`：interactable/terrain 的冻结→lower→Rules→replay→Viewer；隐藏 barrier 仅 KP basis 可用；不存在、过期、删除、重复 ID、碰撞与静态锚点拒绝 |
| V01 请求/恢复 | 最终 DeepSeek body 预算门；同一模型、schema、parser、prompt、context；DO 私有请求/响应及一次窄修订票据 | `kp-vnext-provider-room`：落盘后驱逐、503 原请求续接、伪造/并发/越权拒绝、429 等待期和两个预算拒绝 |
| V01 归档 | 与活跃房间相同 runtime 贯穿导出、D1 检查点、增量 prefix、读取和恢复 | `archive-do-resume-v2` 的 vNext 恢复、既有 V3 恢复及 D1 篡改拒绝 |
| V01 模板 | 版本化通用默认结构、精确来源 hash、Profile 固定字段、工具默认继承、两个 lowerer 与 Rules 创建复验 | 模板定义不会进入世界实例索引，已存定义与历史事件不回查当前模板目录 |
| V02 危害 | 迹象→调查→开放方法解除→再次经过；区域目标的豁免/伤害/条件和持久环境变化；停用后的旧提案拒绝 | `kp-vnext-hazard-product-closure`，复用已有危害机械与 Room 随机/反应矩阵 |
| V03 物品 | 已有 NPC 装备/使用作者化物品；拆分堆叠；唯一来源销毁后仍不可再生；按人识别；转移/休整/章节/恢复续用 | `kp-vnext-item-product-closure`；未知实物、能力、资源、反应和 Claims 采用同一知识边界 |
| V03 拒绝原因 | Item 校验与 Ability 编译器诊断共用事实源，字段路径/安全原因贯穿 wire→validator→lower→单条/原子 Rules，包括早期规则版本拒绝 | `kp-vnext-authored-diagnostics` 4/4：六类错误、无提交、无私有值回显、summary 修订不扩权；合法自创物品及高数值能力不降级 |
| 标准建卡 | 组合装备按各自分量取数量，弹药类型来自武器定义；单独弹药与两件装备保持准确数量 | `standard-gear-catalog-v5`、`item-loadout-authority-v5` |

所有实现以类型、引用、范围授权、Item/Ability 定义和 Rules 事件决定行为。测试名称和场景物件名称没有进入生产派发条件。

## 真实链路与预算

本批最多 12 次 DeepSeek 请求，包含 handshake、首提案、修订、旁白和失败尝试；前序 handoff 的 9 次属于已记录的前一批。模拟玩家使用固定的正常自然语言输入，不额外调用模型生成玩家问题。

本地宿主为 `npm run dev:vnext`，普通 `/api/auth/register` 和 `/api/game`。D1/DO 使用 `.wrangler/vnext/state`；仅在该本地目录应用现有 migration。没有测试专用 HTTP endpoint、假身份或直接写最终 Rules 结果。

本批实际 **10/12** 次：三个源码阶段的 handshake 共 8 次（3＋2＋3），正常 HTTP 游戏提案两次。当前 v8 schema 的两项正向与生成前非法 schema 拒绝均通过；旧阶段结果仅作为过程证据。当前 schema hash 为 `sha256:6a17768ea358c01a7f0f41f4649845692f2b200d106b34c37b6eb9315439871c`。

首次普通行动的模型输出把旁白塞在裁定文字、`proposals=[]`；补清通用工具说明后的唯一对照产出类型化提案，但拼造了不存在的 `feature:wake:candles`。两次分别被 schema/domain 与 frozen-reference 校验拒绝。最后正常 `fetchTable` 核对 version=0、receipt=0、仅初始开场、HP 28/28，未伪造成功或补造物件。按照失败后一次对照的批次规则停止；其余 2 次额度未消耗。精确参数/hash、token 与结果见 [本批真实证据](vnext-v01-v03-live-evidence.json)。

预算口径为保守估算，不声称具有 DeepSeek 精确 tokenizer。完整请求预算包含工具 schema、系统提示、冻结 context 和修订草稿，真实 response.usage 单独对账。

失败定位后另补通用 Geometry 读取接缝，保留 `feature:wake:candles` 不存在时的拒绝；不会从静态锚点生成权威对象。该修改由确定性 Rules/Viewer 矩阵验证，未追加真实模型请求，不能把它记为失败案例在线复测成功。

最终诊断变更的直接旧组 22 项通过，物品生命周期 5 项因旧 fixture 未指定本次操作的物品而触发 readSet 拒绝。修正 fixture 的明确选择后，`kp-vnext-item-product-closure` 与 `kp-vnext-context-inventory-scope` 共 8/8 通过；没有恢复全库存展开或放宽读取集。最终 typecheck 与 diff 检查通过。

## 范围边界

- 两种通用模板只用于 sceneFeature/worldFact 的默认字段与可核验来源。KP 自主物品/能力通过 `materializeDefinition` 提交完整定义，由共享 Item 校验/Ability 编译接受合法内容、服务端计算定义 hash，再以 `materializeItem` 创建实物；无需从预置物品清单选择。新模板正文的注册是另一项能力，不是自主创造物品的前置条件；任意字符串不能冒充已登记模板的来源 hash。
- 自主效果当前支持攻击/豁免/伤害、治疗/临时 HP、状态授予/解除、专注及部分规则反应的组合。飞行/速度变更、瞬移、变形、被动抗性和通用装备加值等尚未接入作者化原语；这是实现缺口，不能称作世界中非法，也不能用推荐等级拒绝或削弱本来合法的物品。
- V04 的新 NPC 本体、动态地点/通路和局部否定的因果退役，V05 的高风险/重大澄清及后续独立职责家族仍按 TODO 推进。
- 本次不移除现役 V3 Form、切换生产、push、远端 migration 或删除用户房间/归档。
