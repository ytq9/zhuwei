# ADR 0036：把 Rules 形状词汇发布为第二个受认可 Interface

- 状态：已接受
- 日期：2026-09-20
- 依据：用户于 2026-09-20 在三个方案里裁定 (b)「公开形状词汇」。
- 当前规则：[SPEC 0003 §2.1 Rules Module](../specs/0003-authoritative-action-transaction.md)
- 取代范围：不取代任何规则。SPEC 0003 §2.1 原先只承认 `step` / `project` / `replay` 一个 Interface；本决定在其旁边加第二个，并收窄「Implementation」的含义到构造与读取，不含形状判定。

## 背景

`tools/check-modules.mjs` 的 `assertImportBoundaries` 长期报 148 处违规，`kp/` 与 `room/` 直接 import 了 `rules/v2/*` 的内部模块。这个检查不在 `npm test` 里，2026-09-11 之前仓库也没有 CI，所以它只在有人手敲时才跑。

2026-09-20 按「公开形状词汇之后这条 import 能不能清掉」重新分类：

| 形态 | 数量 |
| --- | --- |
| 仅类型（编译期擦除） | 31 |
| 仅守卫 / 冻结常量 | 35 |
| **够到 Rules 实现** | **80** |
| 命名空间 import、非字面量 dynamic import | 2 |

那 80 条借的是 `authorityEntityComposite`、`authorityCharacterTimeline`、`dueActivityDescriptors`、`hashWorldState`、`freezeNpcDecisionEntry` 这类东西——KP 在构造 Rules 的对象、编译 Rules 的计划、直接读权威复合体。这正是深 Module Interface 要防的，任何方案都要重构。

## 决定

1. 新增 `app/_runtime/lib/rules/shapes.ts`，与 `rules/index.ts` 并列为第二个受认可 Interface。它只再导出类型守卫（`isX` / `matchesX`）、冻结词汇与 schema 常量及其类型，共 18 个 `v2/` 模块的 36 个符号。
2. 把 35 条词汇类 import 改指该 Interface。**不扩 `check-modules` 的 allowlist**：那些 import 不再指向 `rules/v2/`，违规自然消失。扩 allowlist 等于选了方案 (c) 却没有裁定记录。
3. 新增 `assertRulesShapeVocabulary`，进 `tools/gate.mjs` 的模块检查集合。它断言两件事：该文件只含再导出（没有声明、没有逻辑），且每个运行时导出名都匹配守卫或全大写常量。没有这道检查，(b) 会随时间漂移成 (c)。
4. 「够到实现」的 80 条不在本决定范围内，仍是违规，仍在棘轮里。

## 后果

- `modules.assertImportBoundaries` 从 148 降到 115：清掉 33 条（35 条词汇 import 中有两条是同一语句的重复计数）。棘轮相应收紧，只降不升。
- 剩余 115 条的构成：80 条够到实现、31 条仅类型、2 条杂项、2 条重复计。仅类型的 31 条运行时零耦合，本决定不动它们——是否把纯类型 import 移出边界检查是另一个问题，未裁定。
- SPEC 0003 §2.1 现在写明：知道一个形状合法不等于获得行动许可，Rules 对收到的每份输入重新完整校验。这一句是本 Interface 的安全前提。
- `PROMISE_DUE_TIERS` 与 `IN_WORLD_ACT_FORM_IDS` 两个全大写常量判为词汇而非策略：前者只公开合法层级字符串，对应时长表 `FIXED_TIERS` 仍在 `v2/` 私有；后者是冻结的闭合集合，KP 只读不定义。
- 顺带修正 SPEC 0003 §14 的实现映射：它仍指着 ADR 0034 删除的 `causal-actions.ts`、`form-catalog.ts`、`private-form-policy.ts`、`causal-action-program.ts`。
- 已验证两条逃逸路径都被 `assertRulesShapeVocabulary` 拦住：往该文件加 `activeEncounter` 这类读取器被拒，加任何声明或逻辑也被拒。
