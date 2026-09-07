# 虚构时长落地：本地定向验证与合同偏差

2026-09-07。实现 [能力合同](vnext-fiction-time-contract-proposal.md)（用户裁定：字段落在共享裁决、即时推进到期尾随、KP 自定时长）。源码基线 `c35a064`，parser `kp-vnext2-proposal-parser-v42`。**尚无真实模型证据**；round79 待跑。

## 做了什么

| 层 | 改动 |
| --- | --- |
| 线上 schema | `decision.durationMicros`（`^(0|[1-9][0-9]*)$`）加进 `directSuccess` 与 `check` 两个共享裁决变体，带校准锚点描述。strict 子集无 `maxLength`，位数由校验器限制 16。 |
| 候选校验 | `proposal-validator.ts` 两个 exactKeys 加 `durationMicros` 与形式校验。 |
| lowering | 束级 `executionCosts: { costs: [{ kind: "fictionTime", durationMicros }], readSet: [actor, character-timeline:actor] }`，仅当时长 > 0。角色行动而时长为 0 → `bundle2:duration-required-for-in-world-act`；纯创作而时长 > 0 → `bundle2:duration-forbidden-for-pure-authoring`。 |
| Rules 类型 | `AtomicWorldInteractionExecutionCosts.costs` 解除对 `fictionTime` 的 `Exclude`；新增 `atomicWorldInteractionFictionTimeMicros`、`IN_WORLD_ACT_FORM_IDS`。 |
| Rules 执行 | 复用 `applyAttemptCosts` 的 `fictionTime` 分支：一条 `FictionTimeAdvanced`，`reason` 为共享成本 purpose，**payload 新增 `characterId`**，公开给场景观察者，先于所有 step 结果。 |
| 成本证明 | `expectedWorldInteractionCostEvent` 统一三类成本的期望事件；前缀证明把冻结时长记到**行动者时间线**上的每一个绑定（NPC 同场景时也在其上）。 |
| 跨越记录 | `scheduledDeadlinesWithin(state, actor, D)` 扫描活动 / NPC 计划 / 长施法 / 世界效果，落在 `(now, now+D]` 的记入 `mechanicalResult.fictionTime.crossedDeadlines`。不拒绝。 |
| Room 桥 | vnext-1 `atomicRulesSteps` 命令与桥转发 `executionCosts`。 |
| 指引与目录 | `planRuling` 加时长规则与锚点；`social` 目录描述与填写指引删去「即时口头交谈」。 |
| 合同版本 | parser v42，新增 `actionDuration` 字段；workflow hash 随之变。 |

## 与合同的四处偏差，都记在这里

1. **Rules 只裁一半。** 合同 §4.3 说 Rules 两向拒绝。实现里 Rules 只拒「纯创作束花了时间」；「角色行动必须声明时长」留在 vnext-2 lowering。原因：vnext-1 旧线（`atomicRulesSteps`）没有时长字段，Rules 分不清生产者；stage3 的四个旧线 Room 测试证明了这一点。产品后果：旧线的行动仍不耗时；这是旧线的问题，不是本合同的。
2. **单条角色行动改走原子路径。** lowering 原来把单条目束短路成裸 `rulesStep`，裸步骤没有地方花时长。现在只有**纯创作**的单条目还走短路；任何单条 `social` / `observe` / `worldInteraction` / `inventoryOperation` 都成为一步原子束。round78 那种「一句对话」正是这条路。测试面为此迁移了 24 处读取单步形状的断言（`soleStep` / `soleInput` 助手）。
3. **推进事件点名行动者。** `FictionTimeAdvanced` 无 activityId 时原本按 receipt 的 subject 或分支挑时间线；`fact-source-context` 的 npcTrace 夹具暴露出它会落到别人的时间线上。现在成本推进的 payload 带 `characterId`，`eventFictionTimelineId` 据此选行动者时间线。
4. **没有给 observe / worldInteraction 的 step 单独加 `character-timeline:` 读集。** 束级 `executionCosts.readSet` 已绑定行动者时间线，执行前核对，别人推进了同一时间线就过期重冻——这就是多人一致性的全部机制，step 级重复没有必要。

另：`abilityOperation`（`combat.vnext-1`）明确不在角色行动集合内——施法时间取注册定义，不由 KP 声明。

## 本地证据

基线取 `c35a064` 的独立 worktree，同一命令同一集合，按测试名逐一比对。

| 集合 | 基线 | 现在 | 差 |
| --- | --- | --- | --- |
| `npx tsx --test tests/kp-vnext-*.test.mjs tests/inventory-operations-vnext.test.mjs tests/item-assemblies-vnext.test.mjs` | 693 / 90 红 | 694 / 90 红 | 基线红之外 **0** 新失败；1 个基线红转绿 |
| `npx vitest run tests/kp-vnext-*.test.ts` | 97 / 18 红 | 97 / 18 红 | 逐名相同，**0** 新失败 |
| `npm run typecheck` | 0 | 0 | — |

基线红（90 + 18）全部是接手时就存在的失败（`authorityBasisRefs is not iterable`、`character:alice`、context-index 预算等），本次未碰。

新增测试：`tests/kp-vnext-atomic-input.test.mjs` 「an act pays its frozen duration once, ahead of its results, on the actor timeline」——lowering 的两向诊断、成本先于结果、行动者时间线精确 +D、`mechanicalResult.fictionTime`、replay `exactState`。原「immediate fiction time 必须拒绝」的用例改为「未绑定时间线的时长拒绝」。

夹具：`tests/fixtures/vnext-action-duration.mjs` —— `actDuration(proposals)` 按提案类型给 `"6000000"` 或 `"0"`；`withActDuration(bundle)` 让共享夹具在 proposals 被 pop / push / 替换之后仍读到正确的时长；`soleStep` / `soleInput` / `rebundle` / `mergeExecutionCosts` 供迁移。

## 真实证据的空缺

- 模型是否会填 `durationMicros`、填多长：无。
- `crossedDeadlines` 是否在真实批次里出现过：无（round78 的第二句若在本实现下重跑，NPC 计划 due 在 30 秒时会被记到）。
- Room 是否把 `mechanicalResult.fictionTime` 带进遥测/回执：**未验证**，只确认 Rules 结果上有。

下一步是 round79：同一三句，首句 `nowMicros > 0` 是本合同的直接证据。
