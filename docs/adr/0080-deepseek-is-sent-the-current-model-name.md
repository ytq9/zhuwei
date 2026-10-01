# ADR 0080：发给 DeepSeek 的模型名用现名 deepseek-flash

- 状态：已接受
- 日期：2026-10-02
- 依据：DeepSeek 的模型页把 `deepseek-v4-flash` 列为已退役的旧名，仍然接受，2026-09-10 起临时转到 DeepSeek-V4.1-Flash；现名是 `deepseek-flash`。用户要求“顺便把模型名字改对”。
- 当前规则：[SPEC 0011 §3](../specs/0011-reliability-correction-observability-and-evaluation.md)（公开模型 Profile 仍是 `deepseek-v4-flash`，房间创建后固定所用模型；条款不变）
- 取代范围：发往 DeepSeek 的请求体里，`model` 原来直接用 Profile 的 `modelId`。

## 决定

1. 两个 DeepSeek 绑定（普通端点与 beta 严格端点）发请求时，把 Profile 的 `modelId` 换成 DeepSeek 现在的名字：`deepseek-v4-flash` 发作 `deepseek-flash`。对照表和换算在 `deepseek.ts` 的 `deepSeekTransportBody`；表外的 id 原样发送。
2. 房间、模型目录、Profile、工作流 hash、Room 保存的请求及其 hash 都继续用 `deepseek-v4-flash`。房间按 Profile 逐字核对（[ADR 0046](0046-a-room-keeps-its-model-while-the-workflow-version-follows-the-deploy.md)），改 Profile 会让已有房间进不去；SPEC 0011 §3 也用这个 id 命名公开模型。
3. 探针工具按绑定实际发出的字节核对和保存请求，同样用新名字。

## 影响

- 已有房间照常进入；工作流 hash 不变，未冻结的工作不需要重问。
- Room 保存的请求与实际发出的字节只在 `model` 一项不同。这一项由传输层确定地换算，和选择 beta 或普通端点一样属于传输细节。
- `modelRevision: "deepseek-v4-flash-0731"` 与界面上的“DeepSeek V4 Flash”没有改：前者属于 Profile，后者是展示文字；实际提供服务的是 DeepSeek-V4.1-Flash。若要连 id 一起改名，需要修改 SPEC 0011 §3，并为已有房间做兼容。
- 2026-10-02 的严格模式实验直接以 `deepseek-flash` 调用 14 次，全部正常（[回执](../agent/receipts/deepseek-strict-mode-probe-20261002.md)）。本次改动之后没有再做真实调用。
