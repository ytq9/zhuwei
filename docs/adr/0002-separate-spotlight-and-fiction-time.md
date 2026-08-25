# 分离叙事拍与虚构时间

- 状态：已接受

## 背景

固定把一拍换成分钟会同时破坏分头公平和 5e 持续时间。一次交谈、撬锁、旅行和长休不可能共享同一种叙事时长。

## 决策

Spotlight Beat 只调度分头镜头，领先最多三拍。Fiction Time 以秒保存并裁决 Activity、法术、短休、长休、NPC Plan 与 ScheduledEvent；Combat Round 固定六秒。不同分支通过 Causal Frontier 判断全局事件何时已经对所有分支成立，会合时再同步时间线。

现实离线时间、TurnTicket TTL 和 `kpBusy` 租约都不推进 Fiction Time。

## 后果

短休至少一小时、长休至少八小时，恢复不再由拍数触发。NPC 活动可以在精确时间点开始、中断或完成；尚未完成的效果不会提前写入世界。
