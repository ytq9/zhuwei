# ADR 0042：检定裁决写明它决定哪一步

- 状态：已接受
- 日期：2026-09-24
- 依据：[round121](../agent/receipts/vnext-round120-validation.md) 的首稿写了检定裁决，却把 `check` 留空，交谈放在 `steps` 里只写了一个结果，多花一次 42,638 输入 token 的修订。用户要求让首稿就对：“在检定裁决里加必填字段，写明检定决定的是哪一步。”
- 当前规则：[SPEC 0016 §7.3 模型只提交一份 decision](../specs/0016-part-c-compound-actions-and-claims.md)（条款不变，本决定改的是它在填写表单上的实现）
- 取代范围：[ADR 0041](0041-the-check-step-gets-its-own-group.md) 第 1 条的版本号（fillingLayout v5、parser v71），以及第 5 条中检定时 `check` 为空的诊断路径。其余不变。

## 决定

1. 填写表单的 check 裁决多一个必填字段 `checkStep`，取值是本次已加载的 observe/social/worldInteraction 中 `check` 的键。它排在 decision 的最后，紧挨 `check` 对象之前，让模型先写定检定决定哪一类步骤，再写那一行。
2. 依据是 `check` 里的那一行，`checkStep` 只用来指向：`check` 恰好一行时忽略它，名字和行所在的键不一致也不报错；`check` 为空时，诊断路径指向它写的键（例如 `check.social`），没写或写了表单没有的键时指向 `check`。
3. 解码器在生成领域草稿前去掉 `checkStep`，领域草稿、校验器、lowering 和 Rules 不变。directSuccess 带 `checkStep` 时报 `filling:check-step-needs-a-check`。编码器按检定步骤的类型写出它。
4. 新字段让带检定的选择各多约 74–85 个估算 token。为抵消它，删去 clarification 续写里 `check`、`steps` 两处与共享指引重复的说明（指引已写明每个续写带自己的 steps），并缩短根 `check` 的说明。按能力的请求体积全部低于原基线，棘轮随之收紧（[ADR 0035](0035-ratchet-the-vnext-proposal-request-size.md)）。
5. fillingLayout v6，parser v72。

## 后果

- `checkStep` 在 decision 的 anyOf 分支里，DeepSeek 严格模式不校验 anyOf 分支内部的约束（rounds 85/86），所以不能保证它一定出现；它的作用是让模型在写 `check` 之前先写出这个判断。首稿放对检定步骤的比例需要真实批次确认。
- 线格式改变，工作流 hash 变化，部署后未完成的工作按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。
