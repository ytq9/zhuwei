# ADR 0032：内容安全暂停移出产品

- 状态：已接受
- 日期：2026-09-19
- 依据：用户于 2026-09-19 决定「删掉安全暂停功能及相关测试」，并在看到冲突条款与影响后确认。
- 当前规则：[SPEC 0007 §9 世界内角色冲突与桌外分歧](../specs/0007-multiplayer-room-and-fiction-time.md)、[SPEC 0009 §12 验收场景](../specs/0009-failure-pacing-conclusion-and-interaction.md)、[SPEC 0010 §1.1](../specs/0010-observer-specific-presentation.md)
- 取代范围：SPEC 0007 §3 与 §9 中关于安全暂停的句子和验收场景 8，SPEC 0009 验收场景 7，SPEC 0010 §1.1 中把安全暂停列为旁路的表述；SPEC 0002 B46 的处置行从此只是历史。

## 背景

内容安全暂停让玩家随时私密地暂停、淡化或避开现实敏感内容：呈现冻结在最近稳定点，机械与虚构时间保持，只有请求者能调整并恢复，进行中的旁白能力作废。它在产品里以两个 API 命令、桌面上的恢复按钮、Rules 的 `safety` 步骤和 Room 里二十余处守卫存在。唯一的 Room 级测试还停在 V5 私有 Form 提案桩上，红了；Rules 级单测虽绿，但从未有真实批次验过这条路径。

## 决定

1. 删除入口与行为：`requestSafetyPause`、`adjustSafetyPresentation` 命令，桌面的暂停面板与恢复按钮，Room Action 的 `safetyPause`/`safetyAdjust` 输入，Rules 的暂停与调整步骤，Room 中所有「暂停时呈现不可用」的守卫，以及投影中的 `safetyPresentation` 字段。
2. 保留回放兼容：世界状态里的 `safetyPresentations` 槽、两类历史事件的校验与折叠、Profile 清单里的描述串原样保留。已持久化房间的 genesis 哈希、状态哈希和 Profile 哈希因此不变；没有任何路径再产生这些事件。
3. 删除只为该功能存在的测试，并从其他测试里去掉暂停步骤。

## 后果

- 玩家不再有桌内的内容安全出口；内容边界仍由 SPEC 0001 的叙述边界与 KP-I06 的表达调整覆盖。
- 房间不再因暂停而停下到期工作或闹钟。
- 若将来恢复该能力，须作为新能力重新经规格工作流进入，而不是还原本次删除的代码。
