# 每个房间使用一个 Durable Object

- 状态：已接受
- 平台：现有 Cloudflare Worker `zhuwei`

## 背景

同一房间的位置、唯一物品、队伍、休息与时间线需要共同原子提交。按地点加分布式锁无法覆盖跨地点因果，也不能防止两个地点同时取得同一件唯一物品。

## 决策

每个房间使用一个 SQLite Durable Object 保存活跃 WorldState、WorldEvent、幂等命令结果、TurnTicket 和短期 UX 租约。AI 调用永远位于 DO 事务之外：DO `prepare` 签发带 TTL 的投影与作用域版本，Worker 解释动作，再由 DO `commit` 重验并原子提交。

D1 保存身份、房间目录、静态人物卡、模组/规则版本，以及 `room_event_archive` 中已提交事件的不可变副本。D1 归档可从 DO 重建，不参与活跃裁决。

## 后果

同一 `commandId` 只产生一次结果，过期票据不能覆盖新状态，相关作用域冲突会要求重新解释。不同地点的无关动作仍可并发。`kpBusy` 只是带 TTL 的界面状态；AI 失败不会遗留规则锁。部署需要 Wrangler SQLite DO migration 与 `ROOMS` binding，但本决策不授权远程创建或发布。
