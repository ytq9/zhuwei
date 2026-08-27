# 分离叙事拍与虚构时间

- 状态：已接受

## 背景

固定把一拍换成分钟会同时破坏分头公平和 5e 持续时间。一次交谈、撬锁、旅行和长休不可能共享同一种叙事时长。

## 决策

Spotlight Beat 只调度分头镜头，领先最多三拍。Fiction Time 以秒保存并裁决 Activity、法术、短休、长休、NPC Plan 与 ScheduledEvent；Combat Round 固定六秒。不同分支通过 Causal Frontier 判断全局事件何时已经对所有分支成立，会合时再同步时间线。

现实离线时间、TurnTicket TTL 和 `kpBusy` 租约都不推进 Fiction Time。

## 后果

短休至少一小时、长休至少八小时，恢复不再由拍数触发。NPC 活动可以在精确时间点开始、中断或完成；尚未完成的效果不会提前写入世界。

## 验收场景

1. 一拍只改变镜头调度，不按固定比例增加虚构秒数；分支领先超过三拍时被拒绝。
2. 战斗轮、分钟级 Activity、短休和长休按各自的 2014 规则时长完成，未到期或被中断的效果不提前落地。
3. `kpBusy`、网络重试、离线时间和租约到期不推进 Fiction Time；到期 Activity 在同一 Rules 事务内先结算再裁决后续意图。

## 实现映射

- 时间与触发：`app/_runtime/lib/rules/profiles/fiction-time.ts`、`app/_runtime/lib/rules/profiles/trigger-ordering.ts`
- 权威时间线：`app/_runtime/lib/rules/v2/timeline.ts`、`app/_runtime/lib/rules/v2/compound-actions.ts`
- 休整：`app/_runtime/lib/rules/v2/character-rest.ts`
- 验收：`tests/runtime-trigger-time-v2.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/world-campaign-v2.test.mjs`
