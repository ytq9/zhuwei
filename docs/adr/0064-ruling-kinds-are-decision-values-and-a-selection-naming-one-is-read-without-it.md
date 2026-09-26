# ADR 0064：directSuccess/check/concealedCheck 是 decision.kind 的取值，选择里出现时按未选处理

- 状态：已接受
- 日期：2026-09-27
- 依据：round136 与 round142 第 2 次，模型在可补选的填写轮把 `concealedCheck` 写进 `requestedCapabilities`（一次还同时要了瓦罗的视图）。选择工具是 strict 模式、枚举 28 项不含它，模型仍返回了它。补选轮没有接住随之抛出的 `PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN`，异常逃到 Room 被归为 `PROPOSAL_PROVIDER_TIMEOUT`：两次都只有两次调用，第 2 次成功返回的同一毫秒内行动以“提供方超时”结束，玩家被告知稍后重试；两份回执当时把它记成“第 3 次调用超时”。用户就此裁定：这三个词是每张带步骤的表单都已提供的 `decision.kind` 取值，选择里出现时按“表单已含”处理，不多花调用，不加提示词。
- 当前规则：[SPEC 0016 §7.2](../specs/0016-part-c-compound-actions-and-claims.md)。
- 取代范围：§7.2 里“未知标识……继续拒绝”对这三个词的适用。指引 v58（`c45411d`）写明 `decision.kind` 用 `concealedCheck`，继续有效。

## 决定

1. **选择只认表单。** 选择与补选读取 `requestedCapabilities` 时，`directSuccess`、`check`、`concealedCheck` 按未选处理，其余所选照常按并集加载。首轮只选了它们仍是技术失败（`offer:ruling-kinds-select-no-type`，带路径）；补选剔除后没有新增时，与重复原选择的补选同样处理：不带选择工具再发一次同一张表单。
2. **补选读不出来时按本次调用的表单失败结束。** 补选里其他目录外的标识与首轮选择同样以 `PROPOSAL_FORM_INVALID` 结束，诊断带路径，不再作为提供方超时上报。Provider 与 Room 用同一函数从保存字节得到同一结论。
3. **不为此加提示词。** 选择阶段词表里的三个终结决定（`inWorldRefusal`、`knowledgeReview`、`passTime`）与这三个裁决种类同为 kind，模型偶尔混淆，由服务器按上述规则吸收。

## 后果

- 这类回复不再中断行动，也不再被记成技术失败；两份回执里“第 3 次调用超时”的记录已更正。
- 只剩裁决种类的首轮选择仍会失败，诊断说明原因。
- 门：`tests/kp/protocol/selection-amendment.test.mjs`。
