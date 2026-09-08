# Round87：填写调用回了一个空的 `{}`

2026-09-08 下午，源码 `b7c682f`（parser v49：`responseBasis` 的枚举移到平的数组项上）。场景同 round82–86。正常注册建卡，初态核对通过。只发了第一句，**2 次调用后停批**，¥0.142251。

## 发生了什么

offer 正常（`["social"]`）。填写调用返回的是 `submit_kp_proposal_bundle`，arguments 为 `{}`：25 个输出 token，`finish_reason: tool_calls`，content 为空，没有 reasoning。解码器在 `arguments.decision` 报 `FIELD_MISSING`；`{}` 是合法 JSON，不是「未解析重发」的对象，也没有可修订的地方，`PROPOSAL_FORM_INVALID`。

请求本身核过：走的是 beta 严格端点（`createDeepSeekStrictToolBinding`），两个工具都 `strict: true`，本地严格子集检查 0 问题，schema 根上 `required: [decision, results, steps]`。同一模型、同一 `system_fingerprint`。也就是说，严格模式这次连根上的 `required` 都没有执行——文档说的是「要么符合 schema，要么返回错误」。

与 round86 请求的唯一差别：`responseBasis` 的数组项从 anyOf 变成了一个平的枚举字符串（10 个 NPC 引用 + `playerExpression`），提升为 `$def/field1`。同样形状的「数组项 = 单个枚举字符串」在 `basisRefs` 上一直存在（`basisArray` 单变体时就是这样），所以不能从形状上直接推出因果。

## 判断

一个样本分不清是形状还是这次采样的问题。同源再跑一批：再空一次，就把平枚举撤回 anyOf（回到 round86 的问题，另找路）；不空，就继续验第三句。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 0。323 项源码起止 `allEqual=true`。[机器证据](vnext-round87-live-evidence.json)。私有证据在 `/tmp/zhuwei-round87-npc-preparation/evidence`。
