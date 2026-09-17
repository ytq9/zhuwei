# 旁白测试

原集中测试的断言已按职责拆开，共用准备代码在 [narration.mjs](../../support/fixtures/narration.mjs)。这些测试中的正文与模型响应为受控材料；中文自然度仍按 [KP-H01–H10](../../../docs/agent/functional-acceptance.md) 的真实材料评价方法验收。

| 功能 | 测试文件 | 覆盖边界 |
| --- | --- | --- |
| 生成与玩家决定权 | [generation](generation.test.mjs) | 非思考严格工具仅提交 body、一次独立审核、正文原样返回、输入上限、截断/非法尾部/重复键/混合输出拒绝 |
| 实际传输选择 | [kp-narration-transport](kp-narration-transport.room.test.ts) | 使用真实生成/审核请求，分别验证严格工具 endpoint 与非思考参数 |
| NPC 声口材料与私有信息 | [social-context](social-context.test.mjs) | 同名身份、空/非空社交记录、隐藏承诺、已说出的义务 |
| 冻结输入与权限 | [frozen-input](frozen-input.test.mjs) | 有权获取的材料、容量、异步调用前快照 |
| 结果完整与审核拒绝 | [review](review.test.mjs) | 机械组完整性、事实/来源/秘密/玩家决定权等坏例、错误审核报告 |
| 跨轮连续性与行动归属 | [continuity](continuity.test.mjs) | 已听对话、旧请求不重做、冻结原行动来源 |
| 世界内表达、不出戏 | [presentation](presentation.test.mjs) | 实际台词/后果与检定记账分离 |
| 失败重试 | [recovery](recovery.test.mjs)、[narration-provider-failure](narration-provider-failure.test.mjs) | 相同冻结材料、失败分类与既有发布/恢复入口 |

物品叙述承诺、Claims、到期结果等直接消费者也在本目录，运行 `npm run test:unit -- --feature kp/narration` 可选择整组。只检查一个子功能时用 `--file`。完整目录可能保留已登记旧失败，原断言没有被放宽。

真实恢复样例复用现有 [Room 评测入口](../stories/story-live-room.eval.mts)：`npm run test:eval -- --case narration-recovery` 默认只检查配置；显式 `--preflight` 验证本地身份与房间，仍为零模型调用。带预算的真实运行见[总说明](../../README.md)。该样例注入一次明确标记的空正文截断故障，随后真实调用生成和审核，并通过正常 `retryNarration` 发布；它不统计自然故障发生率，也不把注入故障算作真实模型响应。

本次[严格生成验收](../../../docs/agent/receipts/narration-strict-generation-20260914.md)证明了原冻结材料生成/审核及单受众恢复、重复提交边界；实际正文仍有语病，不能据此宣称自然度或所有 KP 功能已验收。
