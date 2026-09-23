# round105：莉安问答，第三次调用被探针表面检查挡下

2026-09-23。源码 `8cf5042`，工作区无未提交改动，源码清单 `sha256:d6e18ea5…`，起止一致。

## 为什么跑这一批

用户在线上房间问莉安关于黑橡叶的事（洞察检定失败），觉得她“一股脑全说了”，而且旁白用“她说……她还说……”的转述。[ADR 0037](../../adr/0037-branch-bound-outcomes-and-quoted-npc-lines.md) 改了提示：检定分支不越过自己的摘要，NPC 台词用直接引语。用户同意跑一次真实批次确认效果。授权依据是[生产替换 TODO](../vnext-production-todo.md#用户已确认的执行边界2026-09-05)的有界真实 API 测试。

## 参数

```bash
node --env-file=$PWD/.dev.vars --import tsx tools/run-story-room-probe.mjs --live --case daily-investigation --max-calls 8 --action $'问一下关于叶子\nlian她还知道些什么吗'
```

真实注册、Cookie、`POST /api/game sendAction`，黑橡模组开场，真实 `deepseek-v4-flash`。行动原话与线上一致。

## 结果：停在第三次调用之前

| 调用 | 用途 | prompt tokens | 输出 |
| --- | --- | --- | --- |
| 1 | offer（选 social，点名莉安） | 22,399 | 75 |
| 2 | 填写提案 | 32,543 | 727 |
| 3 | 冻结旁白生成 | 未发出 | — |

第 3 次调用被探针的请求表面检查拒绝（`PROBE_ORDINARY_SURFACE_INVALID`），没有发给模型。Room 按设计把行动留在 `notCommitted / retryableFailure`，0 个世界事件。

**原因是探针与现役合同不一致，不是产品故障**：现役房间的旁白走 `plainText-v1` 策略（`narration-text.ts`），请求不带工具、也不带 `response_format`；探针只接受 JSON 模式的普通请求。

**顺带发现产品问题**：ADR 0037 的直接引语规则只写进了旧式冻结叙述 `narration-vnext.ts`，现役房间的 `narration-text.ts` 根本没收到。两处都在 `a06d863` 修正，由 round106 验证。

## 提案本身

模型这次裁成 `directSuccess`（不检定），没有走检定分支，所以“失败分支不越过摘要”没被检验到。成功分支里，莉安的台词提到“去问瓦罗”，这件事写在 `successOutcome`，但成功分支的 `summary` 里没有，算一处轻微越界。

## 收尾

未部署、未 push、未做远端 migration、未改 Secrets。私有证据在 `/var/folders/lc/…/zhuwei-story-room-probe-z9Q6zf`，重启即失。
