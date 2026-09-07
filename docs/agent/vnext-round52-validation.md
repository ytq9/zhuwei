# round52 正常 HTTP 连续行动验证

日期：2026-09-07。分支 `cloudflare`，HEAD `258caee404e0814405eb497653ee9f00d647b773`；继承未提交工作全部保留。使用真实 DeepSeek v4 Flash 的提案、生成与审核，正常 Cookie 注册、开房、建卡、开团与 `/api/game`。没有部署、push 或远端修改。

## 预设与实际结果

预设 3 新行动、最多 15 调用、870,000 输入、122,880 输出、¥3.8、15 分钟；每 HTTP 120 秒与最多 5 模型调用。第一项非 published/nonpending 结果或语义错误即停，不改词重采。

| 行动 | 实际结果 | 状态证据 |
| --- | --- | --- |
| 从背包取出一根火把放在身旁 | committed / published；正文“你从背包里取出一根火把，放在身旁。” | 库存 10→9，地面 0→1，1 event / 1 receipt |
| 原 submission 重复请求 | 同 Receipt、Delivery 和机械状态，0 新调用 | 5 项检查全部通过；独立比较快照相等 |
| 拾回刚放下的火把 | notCommitted / PROPOSAL_RULES_DIAGNOSTIC，停批 | 0 新 event / receipt；库存、HP、资源、时间及消息不变 |
| 用现有麻绳与餐具组装可拆拉绳组合并手动测试 | 未执行 | 不能算成功或失败 |

第二项原稿在 `operation.entryRef` 填入 ItemDefinition ID，尽管冻结请求和原稿 consumes 已有正确地面 ItemEntry ID。现役规则只接受物理实例；源码定位到 `planInventoryTransition` 的合并引用拒绝。历史原日志只剩 `unrecognized/other`，SQLite submission 的 result_json 为空且无 recovery/stage 行，不能声称已经读到精确持久化诊断。没有窄修订调用，也未替换目标改判。

## 封存证据

服务停止后复制本房间 SQLite，沿原 runtime.replay 核对：固定 Profile 相符，完整 state 精确一致。库存 9＋地面 1＝10，所有物品定义总量守恒；0 randomness batch。308 个源码文件起止 SHA、分支和 HEAD 一致。原始草稿与冻结上下文留在本地私有 capture/journal，未写入公开错误。

4 次实际调用，输入 61,823（缓存命中 23,552，未命中 38,271）、输出 1,489；逐调用与 telemetry 相符。按本批保存的官方空闲单价计算 ¥0.0652846，未核对账户账单。全部为开发验收费用。

[脱敏机器证据](vnext-round52-live-evidence.json)。完整本地封存 `/tmp/redacted/zhuwei-round52-closeout/`；Node 原 runtime.replay exit 0。source manifest SHA256 为 `c3388c9aae11b46f0352be944a6fb98e7dce725a15f4748d4d6b8b06036356e2`。

本批证明一次完整发布与重复提交幂等，也暴露了第二步实例/定义混填及诊断丢失。它没有证明连续游玩稳定、修复成功率提高或复杂行动通过；后续修复不能追溯改判本批。
