# 任务：深 Module 边界的 152 处违规需要裁定

写给接手的会话。这不是一个可以直接动手修的 bug，**需要用户先在三个方案里选一个**。

## 现状

```bash
npx tsx tools/check-modules.mjs
```

`assertImportBoundaries` 报 152 处违规：151 处 `private rules v2 import`，1 处 `non-literal dynamic import/require`。

分布：

```
70  app/_runtime/lib/kp/vnext
49  app/_runtime/lib/room
16  app/_runtime/lib/kp/vnext/context
 5  app/_runtime/lib/module
 4  app/_runtime/lib/room/story-history
 3  tools/lib
```

## 违反的是什么

`SPEC 0003：权威行动事务与深 Module Interface` 把 Rules 定义为深 Module，公共 Interface 是 `step` / `project` / `replay`。`tools/check-modules.mjs` 的 `assertImportBoundaries` 执行这条：`app/_runtime/lib/rules/v2/**` 和 `rules/v2-runtime` 是私有实现，只有 Rules 自身可以 import。

现在 `kp/` 和 `room/` 直接 import 了 `rules/v2/*` 的内部模块。

## 违规的性质分三层（这决定了方案选择）

对 `app/_runtime/lib/{kp,room,module}` 下单行 import 语句的统计：

| 形态 | 数量 | 例子 |
| --- | --- | --- |
| `import type {...}` | 34 | 只借类型 |
| 类型守卫 `isXxx` | 27 | `isFrozenPlayerChoicePlan`、`isSha256`、`isEnvironmentHazardDefinition` |
| 常量 / SCHEMA | 19 | `ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA` |
| 其他 | 87 | `createVersionedRulesRuntime`、`composeDefinition`、`createDefinitionSnapshot`、`compileAtomicWorldInteractionPlan`、`activeEncounter`、`authorityItemComposite` |

前三类是「借词汇」——KP 想知道一个合法形状长什么样。第四类不同：**KP 在构造 Rules 的对象、编译 Rules 的计划、直接读权威复合体**，这正是 SPEC 0003 的深 Module Interface 要防的。

## 三个方案

| 方案 | 内容 | 代价 |
| --- | --- | --- |
| (a) 边界仍然有效 | 152 处全部重构，改走 `step`/`project`/`replay` | 最大 |
| (b) 公开形状词汇 | 把 guards + schemas（约 46 处）正式公开为第二个受认可接口，`createVersionedRulesRuntime` 这类构造/编译入口仍禁止 | 重构量降到约 87 处 |
| (c) 承认现状 | 改 SPEC 0003 和 `check-modules` 的 allowlist | 最小，但放弃了单一裁决路径的保证 |

2026-09-11 的分析倾向 (b)：它保住 SPEC 0003 真正要保的（**只有 Rules 能改状态**），放开它其实没想禁的（**知道什么形状合法**）。但这是产品/架构裁定，**必须用户确认**，并且按 `AGENTS.md` 的「规格工作流」新建一份 ADR。

## 为什么会长到 152

`npm test` 是 `build + test:unit + test:worker`，**不含 `module:check`**；2026-09-11 之前仓库没有任何 CI。这个检查只在有人手敲的时候才跑。

现在它在棘轮里：`.gate-baseline.json` 的 `modules.assertImportBoundaries` 记着当前 152 条违规原文，**只能降不能升**。修好之后跑：

```bash
node tools/gate.mjs --with-tests --update
```

## 不要做的事

- 不要为了让检查变绿而扩 `check-modules` 的 allowlist——那等于选了 (c) 却没有裁定记录。
- 不要在 `.gate-baseline.json` 里登记新违规。`--update` 写交集，本来就不接受新增。
