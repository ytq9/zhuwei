# Round84：三张表第一次见真实模型，模型把旧的嵌套结果也一起写了

2026-09-08 下午，源码 `d48400a`（parser v48：三张平表；结尾错位括号可证明）。场景同 round82/83。正常注册建卡，初态核对通过。只发了第一句，**2 次调用后停批**，¥0.158439。

## 发生了什么

填写返回的是合法 JSON，根上正是三张表：`decision`（directSuccess，`duration: "5min"`）、`steps`（一个 social 步骤，`outcomeBinding: "always"`）、`results`（一行：`kind: social, step: 0, branch: result`，回应已摊平成 `responseKind / responseText / responseMotive / responseBasis`，`consequences: []`）。到这里为止，新形状模型是会写的。

但同一份草稿里还有两处旧形状的残留：

1. `steps[0]` 里**又**放了一个旧写法的 `result` 对象（summary / response / consequences），而且它的 summary 和 `results[0]` 的不一样。
2. `retryChange` 写成 `{kind:"none", priorThreadRef:"", basisRefs:[], explanation:""}`——把两个 anyOf 分支揉在了一起。

解码器在 `results[0]` 上发现该步骤已经带了 `result`，以 `filling:result-duplicate-row`（CONSTRAINT_CONFLICT，不可修订）拒绝。没有花修订调用。

## 责任在哪

模型能在 schema 里看到嵌套的 `result` 写法：clarification 的 `choices[].continuation` 还保留着旧的嵌套 steps（`$def/directSteps`、`$def/checkSteps`）。我在拆表时把 continuation 留成旧样子是为了少改；结果是同一份 schema 里两种结果写法并存，模型把两种都写了。**修法只有一个：continuation 也用三张表，让 schema 里不再存在任何嵌套的 `result / success / failure`。**

顺带记两点：DeepSeek 的 strict 模式没有拦住 anyOf 对象分支里多出来的属性（`steps[0].result`）和 `retryChange` 的混合体——它并不按 `additionalProperties: false` 逐字段约束解码，这和 round74/82/83 的语法错误是同一条证据。`{kind:"none"}` 带着一堆空字段的写法可以在解码时当作哨兵归一（空字符串和空数组不携带任何信息），另立小合同做掉。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，0 事件。323 项源码起止 `allEqual=true`。

[机器证据](vnext-round84-live-evidence.json)。私有证据在 `/tmp/zhuwei-round84-npc-preparation/evidence`。

## 未覆盖

结尾错位括号的兜底没被触发（这批 JSON 是合法的）；承诺合同第 2、3 层仍无真实证据；后两句未发。
