# 任务：提案请求体积超出离线评测的承诺

写给接手的会话。这不是测试过时，是当前提案请求的体积超出了评测当初的承诺；用户于 2026-09-18 裁定保留这道红门作为成本信号，不改阈值。

## 现状

`tools/run-kp-v3-eval.mjs`（`tests/platform/evaluation/kp-v3-eval.test.mjs` 的门）的结构硬门里有四项红：

| 门 | 当前 | 阈值 |
| --- | --- | --- |
| schema-median-reduction | −73% | ≥ 60% |
| input-median-reduction | 37% | ≥ 50% |
| simple-input-p95-estimate | 17,430 token | ≤ 8,000 |
| overall-input-p95-estimate | 17,430 token | ≤ 16,000 |

其余门（引用召回、表单合法性、路由覆盖、故障回退）全部通过。token 数是字节估算，不是供应商分词。

## 该做什么

按需求路由走「能力开发闭环」：先从 SPEC 0015 §6.1 与 [请求前缀缓存日志](../refactor-log/2026-09.md)（2026-09-11 条目）找出请求由哪几段构成，再决定压缩哪一段。已知的量级：system 提示词约 28%、工具表单 schema 约 13%、冻结上下文约 58%。

## 不该做什么

- 不改阈值让门变绿。
- 不在这项任务里放宽 `PROPOSAL_INPUT_BUDGET_EXCEEDED` 的 58k 上限。
