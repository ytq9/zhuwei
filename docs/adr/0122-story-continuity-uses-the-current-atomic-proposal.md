# ADR 0122：场景问题与故事收束接入现役原子提案

- 状态：已接受
- 日期：2026-10-06
- 依据：用户批准沙盒接续方案的 review 和实施；[SPEC 0009 §§1、8](../specs/0009-failure-pacing-conclusion-and-interaction.md) 已裁定，但 [ADR 0034](0034-remove-the-v5-private-form-proposal-path.md) 退役旧入口后，现役选择与填写没有对应路径。
- 产品规则：[SPEC 0001 §§15、16、18](../specs/0001-llm-kp-responsibility-contract.md)、[SPEC 0009 §§1、8、9](../specs/0009-failure-pacing-conclusion-and-interaction.md)。本次恢复 §§1、8 的入口，不改写产品条款，也不声称尾声和跨章续篇入口已完成。
- 取代范围：现役 `objective-continuity.vnext-1` 只能形成 NPC 计划、不能记录场景问题或收束的实现缺口；不恢复 V5 私有 Form transport。

## 决定

1. 增加可组合的 `storyContinuity` 填写能力，沿现有 Bundle → 原子 Rules → 事件 → Viewer Claims 链运行。打开问题、回答问题、形成结局候选并收束均为类型化步骤，可与实际玩家行动组合。记录问题不替代观察、移动、交谈或资源结算。
2. 复用 `sceneQuestions`、`endingCandidates`、`stories`；读取绑定已冻结的权威版本，拒绝草稿/未成立引用。玩家原始意图由 Room 的冻结上下文提供，不由 KP 重写。收束检查实际参与者和依据涉及主体的待决输入、遭遇、活动和未结随机结果。
3. 故事按参与者关联，不按创建者占有。放弃只结束行动者本人的参与；其他参与者仍可继续。事实所支持的胜利或不可逆失败记录共同结果，不执行任何角色的离开、接受投降或其他个人行动。
4. 事件固化知情受众。公开投影仅提供该角色有权知道的问题及结果，不带内部依据、其他人的原话或未结秘密。离场不撤销已经获知的结局。原子结算后的记账事件不把回执从 `concluded` 改回 `committed`。
5. 普通冻结上下文读取开放记录和本人的最近结局，集合只带版本见证；可公开给参与者的结局另存其本人知识。历史正文走现有近期窗口、分层目录与回读，避免把所有完成记录塞进每轮请求。
6. 按 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md) 更新为 `runtime-srd51-2014-authoritative-vnext-stage3-v3`，新 manifest 不与旧版并存。仅本地实施；部署仍须单独授权。

## 验收与范围

现役 Room 用例位于 `tests/kp/stories/story-continuity.room.test.ts`。它覆盖复合观察、胜利/不可逆失败/明确放弃、同一提交重试、多人分别放弃、私密投影、相关机械阻塞、独立活动不阻塞、陈旧依据拒绝、DO 驱逐与完整归档恢复。测试使用脚本模型，不构成真实模型质量或费用证据。

本次不把剧本的未来发展变成既成事实，不修改故事机会身份算法，不改写模组材料。NPC 后续接续和 handoff 的战斗能力按同一任务继续实施。
