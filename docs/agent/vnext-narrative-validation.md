# 叙述承诺、库存权威与真实模型验收

日期：2026-09-05。`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773`，保留并继续此前 V01–V03 未提交工作。用户已批准 [环境描写合同修订](narrative-detail-contract-proposal.md)。本次是能力实现和有界真实验证，未部署、push、远端 migration 或删除房间。

**以下保留 round3 的验收与失败证据。最新 [round4](vnext-round4-validation.md) 已首次真实提交库存及场景观察，但可用模型旁白仍未通过，vNext 尚不可据此替代生产 V3。**

## 能力合同与实现

KP 可以先创作非机械环境描写，经同一 Rules/Room 事件链保存原文、场景、受众与来源后，按 Viewer Claims 发布。承诺本身没有 Item、Ability、Geometry 或机械证据资格。玩家明确引用，或后续产生因果影响前，必须按原描述创建真实对象，并保存独立物化绑定；机械变更、权限及实际结果继续由 Rules/Room 决定。

- `NarrativeDetailCommitted` 保存不可变承诺，`NarrativeDetailMaterialized` 绑定真实对象；没有第二个叙事数据库或直接正史写口。
- 当前场景承诺完整进入冻结上下文；跨场景引用按注册的名称、原文和身份检索，绑定与当前对象状态分开读取。并列候选或截断不强选，决定性内容不按最近 N 条或零命中丢弃。
- 服务端冻结 `intent.narrativeMaterializationRefs`，lowerer、Room read-set bridge、Rules 原子预演和随机恢复共同校验；模型省略 basis、把物化放在因果使用之后或只放在成功分支都不能绕过。
- Item 与语义对象固化共享原文/场景/受众校验。实物转交、消耗、销毁和整堆合并保留连续性；完整合并仅按已验证的精确后继 ItemEntry 更新绑定，并保留原始身份和因果事件。
- 确定性校验保证原文、身份、受众、读取集和顺序；任意自然语言之间是否矛盾仍需 KP 依据冻结事实判断。没有物件名称分支、关键词物理规则或补造模型结果；本次在线失败不能证明模型已稳定遵守叙事合同。

同时修正实物存量权威：结构化装备包生成真实 Items；资源投影从获授权且已识别的库存汇总，职业资源仍独立。零弹药不能从旧装备文字补发，隐藏物品不通过资源计数泄漏。装备包按官方 [SRD 5.1 Equipment Packs](https://media.wizards.com/2016/downloads/DND/SRD-OGL_V5.1.pdf) 第 70 页核对；目录及依赖 Profile hash 同步变更，不重解释既有房间数据。

## 代表性矩阵与定向证据

| 变化维度 | 证据 |
| --- | --- |
| 陈设与空间外观 | 两种结构经真实 wire → lower → Rules → Viewer Claims → replay，最初不生成机械对象 |
| 明确引用后固化 | 冻结原承诺 → 单个/多个物化 → 实际交互；单项原子计划经过真实 Room read-set bridge |
| 检定与恢复 | 成功和失败分支均保留骰前事实，随机等待/恢复不重建另一套环境 |
| 长期检索与身份 | 70 条旧承诺全部保留、跨场景回取、多对象引用、并列/截断不猜测、同名不合并身份 |
| 物品与受众 | 两类物品、actorOnly、定义及实物不扩大受众、获取/转交/释放/合并、双方上下文和完整 replay |
| 拒绝边界 | 改写原文、遗漏来源/读取集、重复物化、秘密 focus、未固化承诺授权机械知识、错误顺序/条件绑定 |

实际运行的检查：

- Narrative details 7/7；narrative context 与直接 context/Geometry/库存范围/closure/index/ambiguity 40/40；narrative Item 与 inventory operations 26/26，退出均 0。
- 直接 Rules 消费者 `materialization-and-feasibility / world-interaction-rules / Claims / atomic-input` 81/81，退出 0。库存权威/装备包 13/13，两个直接 NPC 用例与 Registry hash 校验通过。各组存在重叠，不相加为全项目通过数。
- 最终 `npx tsx --test tests/deepseek-strict-schema-compaction.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-nullable-reference-wire.test.mjs` 37/37，退出 0；`npm run typecheck` 退出 0；`git diff --check` 退出 0。初次 typecheck 的三处事件/内容联合类型收窄错误已修正后通过。

## 正常 HTTP 到真实 DeepSeek

使用普通注册、开房、建卡、开团、ACK、`sendAction` 和 `fetchTable`，服务端 Cookie 身份派生 actor。没有测试专用 endpoint、注入 Rules 结果、模型响应补括号或直接写在线状态。宿主是本地 `dev:vnext`，模型请求直达 DeepSeek beta strict endpoint；不是已部署的 vNext 生产环境。

本批上限 3 个根行动 / 12 次模型调用，360,000 输入 / 32,000 输出 tokens，单 HTTP 最多 4 次。首个明确失败后仅做一次能区分复杂观察与简单库存操作的对照。实际 **2 次调用，53,131 输入 / 1,725 输出 tokens**；其中缓存输入 12,032，非缓存输入 41,099。没有旁白或修订调用。

| 普通玩家输入 | 真实结果 | 首个失败边界 |
| --- | --- | --- |
| 我环顾大厅，仔细看看近旁的陈设和表面细节。 | `PROPOSAL_FORM_INVALID`，未提交 | Provider 返回非法 JSON；输出 1,077/4,000，`finish_reason=tool_calls`，无截断证据。还把新描写放进感知文本，不能只修括号就当成功 |
| 我从背包里取出一支弩矢，轻轻放在脚边的地上。 | `PROPOSAL_RULES_DIAGNOSTIC`，未提交 | parse/lower 合法，但模型多写了 `use` 作为意图确认。真实 Item `use=null`，Rules 拒绝 `inventoryUseUnavailable` |

第二次行动后的正常 `fetchTable` 确认 stateVersion=0、receipt=0、HP 28/28、弩矢 20、箭 0、火把 10、口粮 10、金币 10；职业资源正常，未出现新叙述，库存与资源未变。DO 请求/响应 journal、事件为空和 Viewer 结果相符。脱敏数据见 [本批证据](vnext-narrative-live-evidence.json)。

捕获数据的**离线**对照仅删除模型多写的 `use`，保留原始 `release`：正式 Rules 提交一个 `InventoryOperationApplied`，持有 20→19、地面新增 1，genesis replay 精确一致。这证明正确操作的组件路径可执行，不计为在线成功。

本批后补清了通用操作语义：每项操作必须是真实转换，`release` 自身完成从库存取出并放下，`use` 只执行实际注册的物品能力；感知字段明确将新非机械描写交给独立承诺。最终 schema 定向检查通过，未追加模型调用。schema/Profile hash 改变后旧本地测试房拒绝新 Profile；最后同 Profile 的观察证据是第二次行动之后，下一批使用新建测试房。测试服务已停止。

## 预算与剩余工作

无损 schema 去重使用 DeepSeek 文档的 `$def`，保留类型分支、字段、描述和约束；展开等价经过测试。此次在线 schema 约 48.5 KB，压缩前约 80.9 KB。完整请求仍实际消耗约 25.9k/27.2k 输入 tokens，未达到 V11 的简单 Proposal p95≤8k、全体≤16k 采用门。RequiredContext 的 16k units 硬门与完整请求窗口预算是不同口径，不能混称。

前一 round2 独立批次为 2 次请求、61,840 输入 / 2,092 输出 tokens，同样没有成功提交；更早 handoff 9/12 和 V01–V03 10/12 分别保留在原报告，不混为当前批次成功率。

下一步仍是 V01：查明完整 strict schema 下的生成可靠性，必要时对等价传输结构做泛化简化，并用完整工具和普通玩家输入复验环境描写 → 引用固化 → 真实交互及库存/动作资源。不得删能力分支、按名词裁 schema、放宽 Rules 或循环调用碰运气。成功链、可用旁白、跨回合恢复和 token 采用门均未通过前，不切换生产 V3。
