# 任务：深 Module 边界的 148 处违规需要裁定

写给接手的会话。这不是一个可以直接动手修的 bug，**需要用户先在三个方案里选一个**。

## 现状（2026-09-20 重测）

```bash
node tools/gate.mjs
```

`modules.assertImportBoundaries` 报 148 处：147 处 `private rules v2 import`，1 处 `non-literal dynamic import/require`。

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

## 三个方案

| 方案 | 内容 | 重构后剩余 |
| --- | --- | --- |
| (a) 边界仍然有效 | 148 处全部改走 `step`/`project`/`replay` | 0 |
| (b) 公开形状词汇 | 守卫 + schema 常量（35 处）正式公开为第二个受认可接口；`createVersionedRulesRuntime` 这类构造/编译入口仍禁止 | 82（80 够到实现 + 2 杂项）；若同时认定仅类型 import 无需受限，棘轮数立即再降 31 |
| (c) 承认现状 | 改 SPEC 0003 和 `check-modules` 的 allowlist | 0，但放弃了单一裁决路径的保证 |

2026-09-11 的分析倾向 (b)：它保住 SPEC 0003 真正要保的（**只有 Rules 能改状态**），放开它其实没想禁的（**知道什么形状合法**）。重测后这个判断不变，但要注意 (b) 的收益比上一版任务书写的小——上一版按 46 处估算词汇类，实际是 35 处，而真正要重构的 80 处一条没少。

这是产品/架构裁定，**必须用户确认**，并且按 `AGENTS.md` 的「规格工作流」新建一份 ADR。

## 为什么会长到这个数

`npm test` 是 `build + test:unit + test:worker`，**不含 `module:check`**；2026-09-11 之前仓库没有任何 CI。这个检查只在有人手敲的时候才跑。

现在它在棘轮里：`.gate-baseline.json` 的 `modules.assertImportBoundaries` 记着当前 148 条违规原文，**只能降不能升**。修好之后跑：

```bash
node tools/gate.mjs --with-tests --update
```

## 不要做的事

- 不要为了让检查变绿而扩 `check-modules` 的 allowlist——那等于选了 (c) 却没有裁定记录。
- 不要在 `.gate-baseline.json` 里登记新违规。`--update` 写交集，本来就不接受新增。
