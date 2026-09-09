# vNext 固定 Proposal 提示词核对

2026-09-09，开发期。本次检查对象是每轮固定的 system 指令、工具字段说明及其实际调用方式。以现役 schema、编解码器、Rules 和 Room 为实现证据，以 SPEC 0001 和直接补充规格为行为边界；不以某个玩家动作代表整体。

后续状态：本文保留 v11 静态核对与当时的精简测量。[真实模型测试](vnext-fixed-proposal-guidance-live-validation.md)随后发现错误步骤类型、遗漏定义/拾取和感官文字混入内部字段；v12 已澄清类型标题和感官说明，但物品复测仍失败。因此本文不能作为整体填写可靠或产品验收通过的结论。

## 覆盖范围

| 表单 | 核对的主要合同 | 结果 |
| --- | --- | --- |
| abilityOperation | 原生 decision、本人能力、目标类型、施法模式、continue/cancel、澄清分支 | 合并重复权限说明，保留实际填写边界 |
| materializeObject | 对象、worldFact、location、passage、模板、授权、几何和通行 | 精简；明确创建连接与实际通行分别提交 |
| observe | focusRefs、感官主体、entries、推断索引、已有知识和时间 | 修正旧字段路径与容易误解的免费推断说明 |
| formActorPlan | 本人已有依据、资源、timer、替代目标、未来痕迹 | 精简；保留形成计划与真实执行的区别 |
| social | 扁平回应、字符串来源、新事实来源、本人知识、承诺与改约 | 修正过时依赖字段说明；同步现役玩家承诺、分项、条件及改约字段 |
| worldInteraction | 实际对象/工具/受影响对象、共享检定、Ability、危险及通行 | 精简；保留触发条件、合法效果和 Activity 完成边界 |
| commitNarrativeDetail | 原文、受众、可见依据、非因果环境描写、后续物化 | 精简；保留连续性与权限 |
| authorAbility | 可执行定义、成本/效果/持续时间、服务器身份和编译 | 删除与公共权威重复的文字 |
| authorHazard | trigger、迹象、解除方法、环境后果、Ability、危险实例 | 精简；保留定义不等于执行 |
| authorItem | 定义与实物、普通物件的 none 字段、实际 Ability 依赖 | 精简；保留全部现有类型依赖 |
| materializeItem | definitionRef、handle、数量、所有权、唯一性 | 精简；保留真实定义与实例的区别 |
| inventoryOperation | 实际状态转换、entryRef、取放/转交/use、组装/拆解 | 修正“不创建对象”和“不推进时间”的笼统表述 |

三个独立终结表单 `knowledgeReview / passTime / inWorldRefusal` 均已核对，包括空目录、时间推进和技术缺失不能冒充世界拒绝。阶段检查包含首轮选择、可补选填写、补选后提交、澄清 continuation、空对象/非法 JSON 重发及窄修订。首轮仍能读取全部类型的填写边界；选表后按依赖提供完整表单。

直接调用检查包含主 Proposal Provider、Room 保存与重建请求、NPC 工作调用，以及履约复核工具。NPC 调用改用与固定指令一致的 `requiredContext` 模型资料和类型候选，保留本人有限知识，并使用一个 system 和一个 user 消息。额外加载的表单不扩大 NPC 运行时权限。履约复核当前的分项、条件与状态字段也经实际工具和解析器核对；其同期功能实现不归入本次提示词精简。

## 已修正的问题

- 社交新事实来源的说明仍要求已从模型接口删除的 `consumes`，并教旧的 `kind=npcContext` 包装。现改为实际 `responseBasis` 字符串或 `{worldFactRef}`，依赖由服务器派生。
- 感官字段仍引用旧 `observe.characterInferences` 路径，把独立描写步骤称为结果 entries。现说明实际的 `recordKind`、独立 step，以及仅对感官子序列计数的索引。
- 通用生产者文案把“没有模型 handle”说成“不创建任何对象”，与组装、计划和叙述承诺不符。现只说明哪些步骤填写 handle，并把公共生成规则集中一次。
- 组装说明声称不推进时间，未区分整个行动的冻结时长和单个库存操作的额外效果。现明确使用行动时长，不另附加操作级时间或机械效果。
- NPC 调用复用主提示词，却提交旧的 `context` 原始包且没有提供对应类型候选。现统一模型可见资料形状，声明 NPC 自身行动边界；绑定 hash 纳入公共提示词 policy。
- 核对期间现役社交 schema 新增玩家承诺和改约，固定说明与目录仍只介绍 NPC 承诺。已同步实际表达、主体权限、条件、分项及改约边界。新增 `parts.maxItems` 不属于当前严格工具支持的方言，移除该不支持的关键字并在字段说明保留最多 16 项；服务端 `promiseTermsConform` 的数量限制保持。
- 最终检查期间 NPC 调用新增延后/改计划工具，原 `type:null` 被实际严格接口拒绝。改为项目现用的精确 `{kind:"none"}` 表示，并在解析边界转换为 Rules 的 null；带多余字段的伪空值仍拒绝。同步说明两种工具互斥、绝对时间、等待消息及取消计划不解除承诺。

公共权威、填写规则和各表单重复内容已压缩；字段、来源、权限、失败边界与必要示例仍保留。一次并集补选、原意图与冻结上下文、严格解析、窄修订、骰前冻结和 `authorItem → authorAbility` 等依赖未削弱。

## 精简测量

使用固定 user 消息 `bound` 和固定候选参数生成 30 种请求：12 种能力分别可补选/不可补选、三个独立 terminal、首轮选择、修订及全部类型组合。数值是 UTF-8 字节，不是模型 tokens。

工作区同期有承诺功能扩展。为不把新增字段的体积混入精简效果，对照源保留同一份当前 schema，只恢复本次之前的固定文案。展开工具引用后，仅移除字符串 description 元数据进行比较，30 组工具约束、user 消息和传输设置均完全一致。以下数据因此是相同表单下的固定文案比较，而非不同时点整个工作区的净大小。

| 固定 system 说明 | 精简前字节 | 精简后字节 | 减少 |
| --- | ---: | ---: | ---: |
| 首轮选择 | 14,483 | 12,648 | 12.67% |
| abilityOperation | 4,783 | 3,507 | 26.68% |
| materializeObject | 8,068 | 6,875 | 14.79% |
| observe | 7,645 | 6,438 | 15.79% |
| formActorPlan | 7,328 | 6,265 | 14.51% |
| social | 9,345 | 8,937 | 4.37% |
| worldInteraction | 8,060 | 6,703 | 16.84% |
| commitNarrativeDetail | 6,990 | 5,970 | 14.59% |
| authorAbility | 6,966 | 5,907 | 15.20% |
| authorHazard | 10,683 | 8,623 | 19.28% |
| authorItem | 9,605 | 7,568 | 21.21% |
| materializeItem | 7,164 | 5,986 | 16.44% |
| inventoryOperation | 7,432 | 6,306 | 15.15% |
| knowledgeReview | 5,048 | 3,984 | 21.08% |
| passTime | 4,854 | 3,790 | 21.92% |
| inWorldRefusal | 4,355 | 3,291 | 24.43% |
| 全部类型与 terminal | 21,476 | 18,004 | 16.17% |
| 窄修订 | 872 | 872 | 不变 |

能力单项行使用不可补选阶段；三个独立 terminal 与全部类型行使用可补选阶段，前后模式一致。全部类型的工具 JSON 为 93,886 → 91,285 字节；system 加工具的固定内容为 **115,362 → 109,289 字节，减少 5.26%**。修订指令上一轮已统一，本轮未再删减。

## 验证与边界

- 新增的四项旧字段/时间/生产者/NPC 请求回归在修复前均失败；修复后连同直接消费者，Node 定向组 **64/64，exit 0**。随后新增的 NPC 工具空值另被合同测试复现；修正后仅复跑受影响的提示词合同文件，**9/9，exit 0**，含正确空值/绝对时间与非法值拒绝。64 项与最终 9 项为分次证据，不声称完整组在之后的全部同期源码变更上重跑。
- Room 原持久化与恢复用例最初按旧 user.schema 区分 NPC 请求，更新测试接收端为实际工具名后继续核验；同期新 `maxItems` 曾导致工具加载失败，修正后 **2/2，另 2 项未运行，exit 0**。覆盖响应已保存后的恢复、没有重复调用/交付，以及响应丢失后的拒绝重发。失败路径的 transport 日志为用例刻意触发。
- `npm run typecheck` 最终 exit 0。首轮曾在同期改动的 `promise-lifecycle.ts` 遇到事件联合类型错误；共享树改变后复验通过，没有把未解释的首轮结果写为通过或据此改动无关 Rules。
- 30 组实际严格工具请求构造及同 schema 对比 exit 0；`git diff --check` exit 0。

这证明所检查固定说明与当前接口、定向规则和恢复边界相符，不证明真实模型成功率、推理耗尽、耗时或 token 成本已经改善。未做真实 API 调用、完整回归、build、部署、push 或远端数据操作；不涵盖全部旁白、创剧及旧代 KP 的固定提示词。上一轮已隔离的 `historyCoverage` 旧夹具失败未在本次扩展修复。

定向命令：

```sh
npx tsx --test tests/kp-vnext-prompt-contract.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-selection-amendment.test.mjs tests/kp-vnext-social-source-selection.test.mjs tests/kp-vnext-unparsed-reemit.test.mjs tests/kp-vnext-plan-confirmation.test.mjs tests/kp-vnext-npc-plan-formation.test.mjs tests/kp-vnext-promise-lifecycle.test.mjs
npx vitest run tests/kp-vnext-promise-lifecycle-room.test.ts -t 'Room resumes saved NPC|an unknown dispatched NPC response'
npm run typecheck
git diff --check
```

本机对照源码、30 组请求、尺寸记录及可重跑测量脚本位于 `/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-fixed-proposal-guidance-20260909-y751q584/`，最终数据为 `final-comparison.json`。
