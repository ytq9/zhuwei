# 当前 KP 回应使用观察者专属单槽投递

- 状态：已接受（本 Goal 授权）
- 日期：2026-08-26
- 关联规格：SPEC 0005、SPEC 0007、SPEC 0010

## 背景

完整消息历史会把缺席、换席或后来加入者原本无权观察的旁白变成可补看的聊天记录；仅隐藏页面区域无法阻止轮询、错误、语音、转写或重连旁路。

## 决策

每个 `ViewerKey` 在 Room DO 中最多保存一个未确认的 `DeliveryFrame`。Audience 在世界事件提交时冻结；刷新、轮询、断线和 Worker/DO 重启返回同一 frame id 与正文。ACK、被新帧覆盖或观察资格撤销后，正文不可再由任何产品接口读取，DO 仅保留无正文 tombstone 和可审计哈希。

个人线索默认无限期保持角色私有，直到角色通过已提交的世界内交流行动分享。分享收件人在提交时冻结，只传播结构化知识，不追溯分享旧旁白，也不授予过去 DeliveryFrame。玩家界面不提供完整 KP 旁白历史；结构化事实、角色知识、Receipt 与更正仍永久权威保存。

快照、增量、重连、候选、错误、日志摘要、语音与转写只能消费同一个 `project(viewer)` 与当前 DeliveryFrame capability。未授权、从未存在和已经不可回看的 frame 必须返回不可区分的脱敏结果。

## 后果

消息表不再是新规则房间的旁白权威或历史接口。可靠送达只覆盖当前未确认帧，而不是会话回放；跨章节连续性依赖结构化知识与事实，不依赖聊天文本。

## 验收场景

1. 同一 Viewer 在轮询、刷新、重连和 DO 驱逐后收到相同未确认 frame id；ACK、覆盖或资格撤销后所有接口只返回不可区分的无正文结果。
2. 缺席者、后来加入者、换席者和其他地点的角色不能从快照、增量、错误、候选、日志、语音或转写补看无权观察的旁白。
3. 分享个人线索只传播本次事件冻结的结构化知识，不追溯授权旧旁白；更正会撤销因果后代投递。

## 实现映射

- Viewer 投影：`app/_runtime/lib/rules/v2/projector.ts`
- Delivery Authority：`app/_runtime/lib/room/durable-object.ts`、`app/_runtime/lib/room/authority-store.ts`
- 页面/消息投影：`app/_runtime/lib/table/message-projection.ts`
- 验收：`tests/observer-delivery-v2.test.ts`、`tests/observer-http-privacy-v2.test.mjs`、`tests/observer-projection-v2.test.mjs`、`tests/voice-delivery-race-v2.test.mjs`
