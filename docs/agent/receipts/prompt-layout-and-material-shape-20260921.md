# 提示词布局与材料形状：2026-09-21 的真实批次

源码状态 `0ac8a91` 加探针的用量记录改动，工作区其余无未提交改动。

## 为什么跑这一批

本轮做了三件改动中的两件，都改了模型实际收到的东西：

1. `4348271` 旁白审核不再把同一批 policy 文本发两遍。
2. `832dae7` 提案请求把与行动无关的规则移到冻结上下文之前，三条消息。
3. `0ac8a91` 两份旁白提示词按材料形状逐段装配。

2 和 3 都动了 `VNEXT_KP_WORKFLOW_HASH`（→ `sha256:412199ba`），用户于 2026-09-21 明确授权移动该钉子。本地全绿不算工作，按 2026-09-05 的[有界授权](../vnext-production-todo.md#用户已确认的执行边界2026-09-05)跑一次真实链路。

## 批次参数

```bash
node --import tsx tools/run-deepseek-vnext2-authored-probe.mjs --live --env-file .dev.vars --max-calls 4
```

| | |
| --- | --- |
| 模型 | `deepseek-v4-flash` |
| 用例 | 2（hazard、item） |
| 调用预算 | 4 |
| 实际调用 | **4** |
| schemaHash | `sha256:501e3c94c3d4300b006cc7d6f04202b0930bfed536447dd1123cbf6aae0df23a` |

schemaHash 与 round104 相同：本轮改动没有碰提案 schema 本身。

## 结果：两例全通过

九个阶段逐个为真：`schema / fixture / provider / parser / lowering / rules / replay / projection / nextContext`。两例都用了一次真实修订（`repairUsed: true`），三消息布局在首稿、修订和 Room 恢复校验上都成立。

## 用量

| 用例 | 调用 | prompt | completion | 命中缓存 | 未命中 |
| --- | --- | --- | --- | --- | --- |
| hazard | 首稿 | 49,001 | 1,037 | 48,768 | 233 |
| hazard | 修订 | 48,793 | 160 | 46,592 | 2,201 |
| item | 首稿 | 49,006 | 1,104 | 48,768 | 238 |
| item | 修订 | 48,735 | 132 | 46,592 | 2,143 |
| **合计** | **4** | **195,535** | **2,433** | **190,720** | **4,815** |

探针此前只记 prompt/completion/total；本轮加记 `prompt_cache_hit_tokens` 与 `prompt_cache_miss_tokens`，因为布局改动的收益正是这两个数。

## 一个有效对照

hazard 首稿 49,001、item 首稿 49,006，与 [round104](./vnext-round104-validation.md) 改动前记录的 49,001 / 49,006 **逐 token 相同**。这证实重排只搬位置，没有增删任何文字——与离线核对一致（拆分后拼回的 stage instructions 与原文逐字节相同）。

## 这一批不能证明的

- **重排的缓存收益**。97.5% 的命中率不可用：本次是同一批次参数的第二次运行，第一次已把完全相同的请求喂进缓存，所以测到的是「同一请求重发」，不是「不同行动共享前缀」。干净的测量需要冷缓存下跑两个不同上下文、同一能力选择；探针的两个用例正是该形状，但须等缓存过期后一次冷跑。**重排收益目前是结构推断，不是实测。**
- **旁白改动**。probe 不经过旁白阶段，`4348271` 和 `0ac8a91` 的真实效果本批未覆盖。两者的离线证据是：门全开时两份提示词与原文逐字节一致（`tests/kp/narration/material-shape.test.mjs` 双向断言），普通物品转交下生成 ~4,474→3,138、审核 ~5,417→4,094 input tokens。
- **生产形状的请求**。probe 不做能力选择，直接发全 16 能力，约 49,000 prompt tokens；生产 `VNEXT_PROPOSAL_BUDGET` 只允许 26,000，`assemble.ts` 会挡下这个形状。
- **准确度**。两例一次通过不代表成功率；本批未重采样，也没有为「去掉无关约束是否减少审核误判」设计对照。

## 结论

真实模型路径在三消息布局与逐段装配的提示词下仍然贯通，请求体积与改动前逐 token 相同。本批未部署、未 push、未做远端 migration、未改 Secrets。
