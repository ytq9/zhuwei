# 任务：深 Module 边界剩余 115 处违规

**2026-09-20 已裁定方案 (b) 并实施**，见 [ADR 0036](../adr/0036-publish-the-rules-shape-vocabulary.md)：
`app/_runtime/lib/rules/shapes.ts` 成为第二个受认可 Interface，35 条词汇类 import 改指它，棘轮从 148 降到 115。

剩下的 115 条**不需要新裁定**，方向已定：80 条够到 Rules 实现，按 SPEC 0003 §2.1 改走 `step` / `project` / `replay`。本文件保留为那份分类和剩余工作的记录。

## 现状（2026-09-20，方案 (b) 实施后）

```bash
node tools/gate.mjs
```

`modules.assertImportBoundaries` 报 115 处。实施前是 148 处。

分布：

```
68  app/_runtime/lib/kp/vnext
49  app/_runtime/lib/room
16  app/_runtime/lib/kp/vnext/context
 5  app/_runtime/lib/module
 4  app/_runtime/lib/room/story-history
 3  tools/lib
 3  tools/run-deepseek-*.mjs
```

上一版任务书记的是 152，四类拆分是 34/27/19/87。ADR 0034 的 37,402 行删除只让 `kp/vnext` 从 70 降到 68，其余分布未动。

## 违反的是什么

`SPEC 0003：权威行动事务与深 Module Interface` 把 Rules 定义为深 Module，公共 Interface 是 `step` / `project` / `replay`。`tools/check-modules.mjs` 的 `assertImportBoundaries` 执行这条：`app/_runtime/lib/rules/v2/**` 和 `rules/v2-runtime` 是私有实现，只有 Rules 自身可以 import。

现在 `kp/` 和 `room/` 直接 import 了 `rules/v2/*` 的内部模块。

## 按「方案 (b) 能否清掉这一条」分类

口径是每条违规（文件 + 被 import 的模块）看它实际借走的运行时符号。一条 import 同时借守卫和常量仍算可清；只要有一个符号是真函数或读取器就算够到实现。

| 形态 | 数量 | 说明 |
| --- | --- | --- |
| 仅类型（`import type` 或全部 inline `type`） | 31 | 编译期擦除，运行时零耦合 |
| 仅守卫 / 常量 | 35 | `isAtomicWorldInteractionStepsPlan`、`ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA`、`IN_WORLD_ACT_FORM_IDS` 这类 |
| **够到 Rules 实现** | **80** | 涉及 87 个不同符号 |
| 命名空间 / 副作用 import | 1 | |
| 非字面量 dynamic import | 1 | `tools/run-deepseek-strict-tool-handshake.mjs` |

那 80 条借的是这类东西：`narrativeDetailVisibleTo`、`authorityEntityComposite`、`authorityKnowledgeCatalog`、`authorityCharacterTimeline`、`storedSemanticDefinition`、`actionActivityCompletionRoot`、`dueActivityDescriptors`、`hashWorldState`、`freezeNpcDecisionEntry`、`combatPendingAnswerOptions`。被够得最多的模块是 `authority-bindings`(6)、`narrative-commitments`(5)、`world-interaction-model`(5)、`npc-decision-context`(4)、`world-facts`(4)、`semantic-definitions`(4)、`due-activities`(4)。

**KP 在构造 Rules 的对象、编译 Rules 的计划、直接读权威复合体**——这正是 SPEC 0003 的深 Module Interface 要防的。这 80 条在归档前后都是 80，没有变化。

## 已实施的 (b)

`app/_runtime/lib/rules/shapes.ts` 只再导出守卫、冻结词汇与 schema 常量及其类型（18 个 `v2/` 模块的 36 个符号）。**没有扩 `check-modules` 的 allowlist**——那些 import 不再指向 `rules/v2/`，违规自然消失；扩 allowlist 等于选了 (c) 却没有裁定记录。

`assertRulesShapeVocabulary` 守着这个接口不变质：它只能含再导出，每个运行时导出名必须是守卫或全大写常量。已验证往里加 `activeEncounter` 这类读取器会被拒，加任何逻辑也会被拒。没有这道检查，(b) 会随时间漂移成 (c)。

## 剩余 115 处的构成

| 形态 | 数量 | 说明 |
| --- | --- | --- |
| **够到 Rules 实现** | **80** | 按 SPEC 0003 §2.1 必须重构，方向已定，不需要新裁定 |
| 仅类型 | 31 | 编译期擦除，运行时零耦合 |
| 命名空间 import、非字面量 dynamic import | 2 | |
| 同一语句的重复计数 | 2 | |

那 80 条借的是：`narrativeDetailVisibleTo`、`authorityEntityComposite`、`authorityKnowledgeCatalog`、`authorityCharacterTimeline`、`storedSemanticDefinition`、`actionActivityCompletionRoot`、`dueActivityDescriptors`、`hashWorldState`、`freezeNpcDecisionEntry`、`combatPendingAnswerOptions`。被够得最多的模块是 `authority-bindings`(6)、`narrative-commitments`(5)、`world-interaction-model`(5)、`npc-decision-context`(4)、`world-facts`(4)、`semantic-definitions`(4)、`due-activities`(4)。

**仅类型的 31 条未裁定**：它们运行时零耦合，是否把纯类型 import 移出边界检查是一个独立问题，ADR 0036 没有决定。

## 为什么会长到这个数

`npm test` 是 `build + test:unit + test:worker`，**不含 `module:check`**；2026-09-11 之前仓库没有任何 CI。这个检查只在有人手敲的时候才跑。

现在它在棘轮里：`.gate-baseline.json` 的 `modules.assertImportBoundaries` 记着当前 148 条违规原文，**只能降不能升**。修好之后跑：

```bash
node tools/gate.mjs --with-tests --update
```

## 不要做的事

- 不要为了让检查变绿而扩 `check-modules` 的 allowlist——那等于选了 (c) 却没有裁定记录。
- 不要在 `.gate-baseline.json` 里登记新违规。`--update` 写交集，本来就不接受新增。
