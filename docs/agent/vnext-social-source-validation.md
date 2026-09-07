# NPC 来源选择与诊断路径验收

日期：2026-09-07。开发期，主树 `cloudflare`；本变更不部署、不 push。以下是已集成源码的定向证据，不是完整 Goal 或真实模型成功率结论。

## 现有问题与能力合同

[round68](vnext-round68-validation.md) 的原响应在 NPC response 内出现 JSON_SYNTAX，offset 1210；2 次调用后停止，0 事件和状态差量。保留原失败。另行复制的标点诊断稿仍包含不存在的知识 producer 和不能作为来源引用的 `npc-decision:*` 包装项，不能借修订替换来源或补出裁决。原 schema 已提供 playerExpression，此证据不支持“缺少对话来源类型”的判断。

KP 从当前冻结上下文中按 NPC 归属列出的真实来源选择引用；服务器推导冗余来源类型与 holder，再交同一 validator、lowerer 和 Rules。新创作不要求已有同内容引用，NPC 台词允许真实、错误、夸张、过时和故意欺骗；台词内容、NPC 实际认知和世界事实分别保存。已有事实与新正史仍须相容，不能在发现矛盾后借修订追加撒谎动机。

## 实现与直接消费者

- parser `kp-vnext2-proposal-parser-v36`、context `zhuwei.proposal-context/vnext-4`、guidance `zhuwei.proposal-guidance/v7` 固定新的填写含义。
- 已有来源直接填写 `references.npcSourceChoices` 中属于 `step.npcRef` 的完整 ref 字符串；当次听到玩家发言填 `{ "kind": "playerExpression" }`；显式同束新来源填 `{ "worldFactRef": "prospective:..." }`。服务端从 responder 推导已有 npcContext 表示及新知识 holder，不要求模型重复选择。
- 来源目录只取冻结且验证过的 `npcDecisionContext`，复用 `npcDecisionEvidenceRef`。schema 使用本次已加载来源的并集；按 NPC 分组的目录和现有 lowerer 核对实际 holder。另一已加载 NPC 的私有知识、包装项和发明的引用均拒绝；错误的 expected 候选只列回应者本人获授权的引用，不附私有正文，不实时查询候选。
- 新 worldFact 引用填写分支只在所选 producer 表单存在时提供；实际新来源仍必须有同束显式、always 的 worldFact producer 和该 NPC 的 initialKnowledge。服务器不补造 producer、来源、动机或后果。
- 填写 codec 保留原始草稿，双向映射既有领域表示；领域 materializedKnowledge 的 holder 与 responder 不符时明确拒绝编码。旧 kind/ref 对象写法不保留 fallback。
- 缺失或畸形 source 数组、单项来源以及派生 prospective consumes 的错误，沿同一个诊断 mapper 回到实际 `response.basis` 下标或 `worldFactRef`。Provider 候选、private lowering、修订票据创建与校验共用该映射；直接 Rules 领域消费者保留领域路径。
- 选择与填写的 user 正文逐字相同并绑定同一冻结上下文，Room 重建精确 schema 和请求核对。此改动不建立第二套语义校验或活跃状态写入路径。

7 个生产文件是 `proposal-bundle-lowering.ts`、`proposal-context.ts`、`proposal-filling-interface.ts`、`proposal-guidance.ts`、`proposal-provider.ts`、`proposal-schema.ts` 和 Room `vnext-proposal-invocation.ts`；6 个直接测试文件见 [集成清单](vnext-social-source-integration.json)。社会互动、worldFact memory、填写接口、schema 检索、private diagnostics、结构化诊断、表示修订、Provider 和 NPC Room 消费者均纳入定向检查。

## 支持与拒绝的修订范围

继续仅允许已有票据证明等义的表示修订和获准的展示摘要路径；不能改变 NPC、已选来源、目标、裁决、DC、资源代价或成功失败后果。缺失或非法来源、缺 producer 不获得额外修订机会，不能将来源候选当成允许重新选择的修订清单。

原始草稿、冻结上下文、票据绑定、允许路径与操作检查以及修订后的完整提案重验保持。普通小表单最多 2 次，实际含所选执行家族的复杂草稿最多 3 次且最多一次窄修订；闲置选择不增加预算，HTTP 上限保持。不重新掷骰，不重复扣资源。

## 代表性矩阵

| 变化维度 | 实际证据与结果 |
| --- | --- |
| 不同 NPC 与已有来源 | 两个结构不同的 NPC，self/本人持有知识共用冻结目录与原解析器，不按 NPC 名称分派 |
| 当前发言与新来源 | playerExpression 与显式 always worldFact/initialKnowledge 共用填写转换和既有领域验证 |
| 引用与权限拒绝 | 他人知识、包装项、虚构引用、旧 wire、缺 producer 拒绝；expected 不泄露私有正文 |
| 具体错误位置 | 缺失/畸形来源数组及派生消费错误返回真实模型字段路径，不要求模型修改服务器生成字段 |
| 最高风险修订 | 单次 correction 企图换 NPC 或来源拒绝，不能凭表面合法的候选改变原决策 |
| 本地真实 Room 与恢复 | 正常模组 NPC Lian 以本人持有的私有命令为依据明确说谎；提交一条原始玩家发言主张和一条 NPC 台词主张，正史及本人实际持有知识不变；驱逐/重复提交复用已保存的两次提案调用，0 新事件/骰子 |
| Room 错误闭合 | 同一路径使用目录包装项时 2 次调用后拒绝，无 correction、事件或私有正文泄露 |

## 主树定向验证

同一集成源码状态的最终结果如下；不累计隔离副本和先前重叠测试数量。

1. `npx tsx --test tests/kp-vnext-social-source-selection.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-world-fact-memory.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-ability-operation.test.mjs`：138/138，exit 0，`/tmp/zhuwei-social-source-root-node.log`。
2. `npx vitest run tests/kp-vnext-npc-plan-formation-room.test.ts tests/kp-vnext-provider-room.test.ts tests/kp-vnext-ability-operation-room.test.ts`：3 文件、55/55，exit 0，`/tmp/zhuwei-social-source-root-room.log`。日志中的 `interrupted:afterRandomnessCandidateCommit` 来自预期恢复注入，最终测试无失败。
3. `npm run typecheck`：exit 0，`/tmp/zhuwei-social-source-root-types.log`。

隔离交付的 121/121、最终 mapper 后重叠子集 35/35、Room 6/6 和独立来源测试 6/6 均保留在 `/tmp/zhuwei-kp-social-source-final-receipt.md`，不与主树结果相加。独立审查核对 7 个生产文件 hash，未发现可复现阻塞。

集成共 13 文件，0 冲突；基线是 `2bcd2e79208d33d30829b47488405c06e420594d` 加当时 dirty snapshot 及最终 Ability 共享/机械依赖，不能由该 commit 单独重建。6 个与 Ability 重叠文件逐一匹配其最终新 hash。最终 patch `/tmp/zhuwei-kp-social-source-final.patch`，SHA256 `dc5b8ebd98104ad71ae375d4087cb1a4ba1dac9df368d78813e2734c127eecd2`；备份 `/tmp/zhuwei-social-source-root-before`，逐文件 hash 见集成清单。

## 保留的失败与剩余缺口

隔离 Room 初始 fixture 曾错误自行填写 server-owned communication、漏 basisRefs，或使用当前不可寻址/未加载决策上下文的自设与退役 NPC；最终改用实际玩家意图明确提及的正常模组 NPC，没有放宽生产检查。早期日志保留在 `/tmp/zhuwei-social-source-room-{initial,second,third,fourth,fifth,sixth,seventh,eighth}.log`。本回执不证明任意自设/退役 NPC 的创建、寻址或完整上下文能力已经闭合。

未做本变更的真实模型来源选择对照测试，因此没有证据声称修复或填表成功率已经提高。round68 仍为真实失败；后续真实验证另记，不据离线标点稿改判。三整卡更正审计快照膨胀、完整多人连续行动和完整产品 Goal 仍独立待办。此来源变更没有真实 API、部署、push、远端 migration 或数据退役；Goal 保持 active。
