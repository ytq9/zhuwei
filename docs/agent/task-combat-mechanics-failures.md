# 任务：0012 战斗机械的单测失败

写给接手的会话。根因已定位到单次提交，三类失败里两类已有确切诊断，一类需要用户裁定。

## 现状

单测基线 98 个失败用例名记在 `.gate-baseline.json` 的 `tests.unitFailures`。主体是战斗：

```bash
npx tsx --test tests/combat-mechanics-v2.test.mjs      # 45 项：28 过 / 17 失败
npx tsx --test tests/combat-long-casting-v2.test.mjs   #  8 项：6 过 / 2 失败
```

这两个文件是 `SPEC 0012` 和 `SPEC 0013` 声明的验收门。

## 根因：一次 507 文件的 checkpoint 提交

二分结果：

```
225c6b2  2026-08-31  combat-mechanics 45/45   long-casting 8/8
1fa33f0  2026-08-31  45/45   8/8
dde6146  2026-09-03  45/45   8/8
72201ea  2026-09-07  19/45   1/8    ← 就是它
3cf49f0  2026-09-08  19/45   1/8
```

`72201ea` 是 `chore: checkpoint the uncommitted vNext working tree`，**507 个文件、+85087 / −4361 行**。所有失败都出自它，后续提交一个都没加。当时没有 CI，`module:check` 也不在 `npm test` 里，所以没人知道。

## 已修复：玩家资源不变量（14 个）

`72201ea` 在 `spendCosts`（`app/_runtime/lib/rules/v2/combat-actions.ts`）加了一条：玩家的战斗资源池必须由角色档案上唯一同名键背书，且 current/maximum 一致。

两个夹具只设了战斗实体的池，角色档案 `resources` 为空，于是每次玩家花费资源都判 `insufficientResource`。提交 `15ac8ff` 和 `a656b34` 从夹具已声明的池推导出角色档案的 `resources`/`resourceMaximums`，恢复 14 个用例。参照形状见绿着的 `tests/causal-action-rules-v3.test.mjs`（`resources: { "spellSlot:1": 2 }` + 匹配 maximums）。

## 剩余三类

### 一、几何（8 个）——产品缺陷，需要裁定

`areaTargets`（`combat-actions.ts:2656`）把场景内**所有**实体当作区域候选：

```ts
const candidates = Object.values(state.combatRuntime.entities)
  .filter((entity) => entity.sceneId === source.sceneId);
```

场景里有 `environment:burning-mill`（`kind: "environment"`），它**按设计没有 position**。于是 `combat-geometry.ts:51` 抛 `TypeError: combat entity lacks a canonical position`，被上层 catch 吞成没有信息的 `invalidRulesInput: "The authoritative area geometry could not be completed for this proposal."`。

这不是夹具过时：环境实体是一等公民，`combat-actions.ts:1799` 和 `profiles/trigger-ordering.ts:61` 都明确按 `kind === "environment"` 分支。**任何包含环境实体的场景，区域法术都会挂。**

两个方向，需要用户选：

- **(a)** 区域候选过滤掉没有 position 的实体。一行，但等于规定「区域永远打不到环境」。
- **(b)** 环境实体也参与区域几何，给它们 position/footprint。符合 `SPEC 0014` 的「环境要素与有限状态」，工作量大得多。

顺带一个独立问题：那个 catch 把真实异常吞了，错误信息不含任何可行动内容。诊断时是往产品代码插 `console.log` 才查出来的。

### 二、并发与反应（5 个）——行为有意改变，测试期望过时

两处：

1. **并发保存的随机改成同轮批量请求。** 原先攻击一轮、并发保存再一轮；现在第一轮就请求 `attack:` / `damage:` / `save:concentration:` 三个用途键。保存仍然消耗权威随机（`ConcentrationTested` 事件带真实 roll），只是少了一次往返。测试对「第二轮 `awaitingRandomness`」的期望过时。

2. **反制法术资格改为只认冻结注册操作。** 判定从 `definitionId.endsWith("counterspell")` 改成
   `frozenRegisteredAbilityOperation(definition, "Effect", "/effect")?.input.kind === key`，
   要求定义带 `compiledHash`/`compilerProfile`/`definitionHash`/`mechanicGraph`/`referenceClosure`。夹具里的 `spell:counterspell` 是手写原始对象，只有 `mechanicalKey: "counterspell"`，而新代码在 counterspell 分支提前 return，**根本不看 `mechanicalKey`**。

   收紧方向和 `SPEC 0013` 的能力编译器、`SPEC 0001` 的「KP 不得自撰机械」一致，看起来是有意的。但有两个后果要裁定：所有手写定义的夹具作废；`mechanicalKey` 在 shield/counterspell 上变成死字段，应该从这两类定义里删掉，否则下一个人还会写它并以为生效。

### 三、其余（4 个）——未诊断

`action economy derives advantage/disadvantage…`、`B17 bonus-action spell limits…`、`A06 player and KP choices stay pending…`、`B21 Medicine stabilizes at DC 10…`

## 关键约束

`AGENTS.md` 的「规格工作流」：**已有行为偏离已裁定 SPEC 时默认是 Bug，不是规格过时。** 第二类的两处行为变更没有任何 SPEC 修订或 ADR 记录，处于「既不是 bug 也不是规格」的悬空态。改测试去迎合它们之前，必须先按流程确认这些变更是有意的，并补 ADR + 修订对应条款。

## 修好之后

```bash
node tools/gate.mjs --with-tests --update
```

棘轮记的是失败用例名不是数量，`--update` 写交集，只删不增。
