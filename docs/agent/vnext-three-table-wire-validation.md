# 三张平表：提案 wire 从一棵树改成 decision / steps / results

2026-09-08，基线 `0e6bf3e`。承接 round82/83 的教训：两批的长草稿都在最后几个字节多关了一层括号（一次 `]`、一次 `}`），round83 靠「完整根语法证据」救回来，round82 没有——损坏落在唯一的顶层成员 `decision` 内部，服务器什么都证明不了。用户裁定拆表：同一次调用里改成结构清晰的几张平表，不拆成多次调用。

## 线上形状（parser v48）

```
{
  "decision": { kind + 裁决字段 }                         // 或 terminal
  "steps":    [ { kind, …步骤字段, outcomeBinding } ]      // 不含结果
  "results":  [ { kind, step, branch, …结果字段 } ]        // 每条结果一行
}
```

- `decision` 只剩裁决（directSuccess/check）或 terminal，不再嵌 `steps`。
- `steps` 一行一步，每行都带 `outcomeBinding`（directSuccess 必须为 `always`）。
- `results` 每条结果一行：`kind` 必须等于对应 step 的 kind，`step` 是 steps 的下标，`branch ∈ result | success | failure`。social 的回应摊平为 `responseKind / responseText / responseMotive / responseBasis`；observe / worldInteraction 仍用 `entries` 列表。
- terminal 决定时 `steps` 与 `results` 都是 `[]`。只选了 terminal 的表单没有这两张表；只选了不产生结果的步骤时，`results` 只有一个任何行都取不到的占位形状（`kind: "none"`），模型必须发 `[]`。
- clarification 的 `choices[].continuation` 保持旧的嵌套写法（步骤内带 result 或 success/failure）：它已经在一层之下，少见，且改动面不值。

## 实现

- 全部在 `proposal-filling-interface.ts`：schema 生成多出 `steps` / `results` 两个 `$def`，根多两个成员；解码把 results 按 (step, branch) 装回步骤再交给原来的嵌套解码器，诊断路径重映射到 `steps[i]` / `results[j]`（记住模型实际写的行号）；编码反向拆表。域模型、lowering、Rules 一行未动。
- `socialSourceArgumentDiagnostics` 的主决定路径指向 `results[j].responseBasis[k]`；`proposal-repair-plan` 的数值 token 路径改到根 `steps[i]`。
- 指引改为三张表的写法；parser v48，合同键 `fillingLayout`。
- 严格 schema 校验：social、social+formActorPlan、observe+worldInteraction、materializeObject、纯 terminal 五种选择全部通过 `deepSeekStrictToolSchemaIssues`。

## 好处怎么兑现

一条结果坏了，`decision` 与 `steps` 两个顶层成员仍完整可证；结尾的关闭符从最多七个降到 `}]}`。round82 那种错在这个形状下会落在 `results` 里、且根成员完整——可证明。

## 本地证据

按名比对 `81c3b1e` 基线：node 与 vitest 均 0 新失败（见提交说明的数字）。改动的测试文件十七个，全是把 `wire.decision.steps[i].result…` 改成 `row(wire, i, 'result')`、把路径期望改到 `steps[i]` / `results[j]`，以及把手写 wire 改成三张表；新增 `tests/fixtures/vnext-wire-tables.mjs` 一个夹具助手。两个一直红的用例仍红（`selected schemas preserve exact full-contract variants…` 的 `basisRefs` 描述随选择变化；`wrong, partial, extended echoes…` 的冻结上下文缺 intent）。

## 未覆盖

真实模型还没见过这个形状。round84 用同一场景验：填写是否合法、长草稿的收尾是否还会多括号、多了的话是否落在 `results` 里被证明。

## 兜底：结尾多出的关闭括号现在可证明（同日）

`parseUniqueJson` 的根语法证据扩到嵌套层：当每个值都已完整、剩下的只有 `}` `]` 与空白时，每个未关闭的容器各取一个关闭符，不管形状对不对，多出来的算尾随内容，缺的按原来的「根未关闭」处理。结构是这些完整值唯一容许的那一个，所以是证据，不是猜测；关闭符之后还有内容的仍然拒绝。issue `json:nested-redundant-delimiters`，诊断指向第一个错位的关闭符。拿 round82 与 round83 的真实 arguments 回放：两份都得到完整结构（两条分支、后果数组原样），round82 的错位落在 2354/2359。用例：`kp-vnext-json-syntax-diagnostics`。

## round84 之后：continuation 也拆表，不留任何嵌套结果写法（同日）

round84 的模型把新表填对了，却又在步骤里塞了一份旧写法的 `result`，两份摘要还不一样——它能看到旧写法，因为 clarification 的 continuation 还保留着嵌套的 `directSteps / checkSteps`。现在：

- continuation 是同样的三张表再下一层：`{ ...裁决, steps, results }`；schema 里 `directSteps / checkSteps` 整个删掉，五种选择的 schema 文本里不再出现任何 `"result":{ / "success":{ / "failure":{`。全量 schema 从 120195 字节降到 77483。
- 步骤行里出现 `result / success / failure` 直接拒绝（`filling:result-in-step-row`），不折叠也不偏向任何一份。
- `{kind:"none"}` 带着另一分支的空字段（`""` / `[]`）解码为哨兵：空字段不携带信息（round84 的 `retryChange`）。带了非空字段的仍拒绝。
- 诊断路径按作用域重映射：根表 `steps[i] / results[j]`，continuation 表 `decision.choices[c].continuation.steps[i] / results[j]`。

本地：codec 组全部通过，Room 三套件（provider、abilityOperation、npc-plan-formation）56/56，node / vitest 按名比对基线 0 新失败。
