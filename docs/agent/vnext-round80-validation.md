# Round80：一句交谈第一次在时钟上留下了 12 秒

2026-09-07，源码 `fee45ef`（parser `kp-vnext2-proposal-parser-v43`：v42 的虚构时长合同 + 裸 `"none"` 统一解码）。正常注册建卡，初态核对通过。场景仍是 round70 三意图，gate 同 round79（新增 promise/plan 与行动者时间线的虚构增量，双向核对）。发送了两句。

## 首句：合同的执行半边有了真实证据

4 次调用，committed 且 published。模型在共享裁决上填：

```
"durationMicros": "12000000"
```

权威 `branch:main` 的 `nowMicros` 由 `0` 推进到 `12000000`。`FictionTimeAdvanced` 是本根的**第一条**事件，payload 带 `characterId`（行动者），落在行动者时间线，`visibility:scene-observers`；旁白请求里出现了 `fictionTimeAdvanced` 的 Claim。gate 声明 `fictionTimeMicros:"12000000"` 与快照增量核对通过。

round79 的模型填了 30 秒，这一批填了 12 秒——同一句请求「半分钟」，两次估计不同。这是 KP 判断，不是查表；两个值都落在指引给的「一句问答 5–15 秒 / 一段交谈 1–5 分钟」之间。

**第 2 层没有变化。** 瓦罗再次公开承诺（「敲账台两下，你再说话」），`consequences: []`（75/77/78/79/80 五批）。`addressedThreadRef` 这次写的是 `{kind:"none"}`——round79 撞上的裸 `"none"` 这次没出现，codec 修复未被触发。

## 第二句：一分钟，与 round78 逐字相同

选择 `["passTime", "observe"]`，填写只出 `passTime`；`observe` 被丢弃。`nowMicros` 12000000 → 72000000。`narration: notApplicable`，公开记录止于玩家自己那句话。到期时刻 `npcPlans`/`promises` 仍是 0。

两句合计：时钟走了 72 秒，其中 12 秒来自交谈本身——正常游玩里时间从此会走。

## 没有出现的东西

`mechanicalResult.fictionTime`（含 `crossedDeadlines`）**没有**进入 Room 的返回或遥测，只在 Rules 结果上。本批也没有任何计划可跨，所以即使出现也是空。这是实现回执里已标的「未验证」，现在确认为缺口。

## 收尾

6 次调用，¥0.368892（无未知 usage）。`services.py shutdown` 两角色 `verifiedAbsent=true`，端口复核无监听。replay `exactState=true`，stateVersion 10，10 条事件。321 项源码起止 `allEqual=true`。

[机器证据](vnext-round80-live-evidence.json)。私有证据在 `/tmp/zhuwei-round80-npc-preparation/evidence`。

## 未覆盖

第三句未发送；`crossedDeadlines` 无数据；补选仍零证据；codec 修复未被真实触发。
