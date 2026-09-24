# ADR 0041：检定决定的那一步单独成组，成功和失败同样必填

- 状态：已接受
- 日期：2026-09-24
- 依据：rounds 116、118、119 的首稿都把交谈步骤的失败写成 `{kind:"none"}`，每次要多花一次约 5 万输入 token 的修订调用。用户比较过“骰后再写实际那一边”和“改表单结构”后选定后者，并要求：“成功和失败的比重对于模型来说应该是一样的。”
- 当前规则：[SPEC 0016 §7.3 模型只提交一份 decision](../specs/0016-part-c-compound-actions-and-claims.md)（条款不变，本决定改的是它在填写表单上的实现）
- 取代范围：取代 2026-09-12 分组步骤线格式（[回执](../agent/receipts/vnext-grouped-steps-wire-validation.md)，fillingLayout v4）中“observe/social/worldInteraction 每个步骤都自带 success 与 failure、失败可填 `{kind:"none"}`”这一做法。其余分组方式不变。

## 决定

1. 填写表单的根对象改为 `decision`、`check`、`steps`（fillingLayout v5，parser v71，指引 v42）。
2. `check` 按已加载的 observe/social/worldInteraction 分组。检定时恰好一行：检定决定其结果的那一步。它有 `success` 和 `failure` 两个必填结果，二者是同一个表单，都没有单独的说明，也没有 `outcomeBinding`。directSuccess 和 terminal 时 `check` 各组为 `[]`。
3. `steps` 里的其他步骤各写一个 `result`（有结果字段的类型），并用 `outcomeBinding` 说明它在哪种结果下发生。
4. 行放在普通对象数组里，不放进 decision 的 anyOf：rounds 85/86 证明 DeepSeek 严格模式不校验 anyOf 分支内部的约束，放在这里失败结果才能真正被强制填写。
5. 解码器在进入领域校验前报告结构错误：检定时 `check` 为空（`filling:check-step-required`）或多于一行（`filling:one-check-step`），directSuccess 时写了检定步骤（`filling:check-step-needs-a-check`），`steps` 里的步骤写两个结果（`filling:two-results-only-in-check`）。
6. 为抵消多出的检定行形状，删去与共享指引重复的字段说明（`outcomeBinding`、`abilityRef`、各组说明），按能力的请求体积仍全部低于棘轮基线（[ADR 0035](0035-ratchet-the-vnext-proposal-request-size.md)）。

## 后果

- 领域草稿、校验器、lowering 和 Rules 不变；解码后仍是“唯一检定步骤写完整 success/failure，其余步骤声明 outcome binding”。
- 解码顺序中，一组的检定行排在该组 steps 行之前。执行顺序由类型化依赖决定，不受影响。
- 严格模式能保证检定行有两个结果，保证不了模型把检定步骤放进 `check` 而不是 `steps`；后者由解码诊断和一轮修订处理，需要真实批次确认比例。
- 线格式改变，工作流 hash 变化，部署后未完成的工作按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。
