# 支线和故事测试

原故事准备测试的断言按下表拆分，共用 [story-preparation-harness](../../support/fixtures/story-preparation-harness.mjs)。各故事种类仍调用同一准备和评审接口。

| 功能 | 测试入口 |
| --- | --- |
| 动态创建不同结构的支线 | [creation](creation.test.mjs)：地方冲突、新 NPC 调查、长线个人关注 |
| 独立评审与有界修订 | [preparation-review](preparation-review.test.mjs) |
| 上下文、版本与触发条件 | [preparation-context](preparation-context.test.mjs) |
| 线索、NPC 与知识来源 | [prepared-content](prepared-content.test.mjs) |
| 严格模型传输 | [preparation-transport](preparation-transport.test.mjs) |
| 已保存响应、未知调用与恢复 | [preparation-recovery](preparation-recovery.test.mjs) |
| Room/SQLite 保存与预算 | [story-creation-store](story-creation-store.room.test.ts) |
| 接入世界并继续行动 | [story-action](story-action.room.test.ts)、[story-world-event](story-world-event.room.test.ts) |
| 失败、放弃与收束 | [ending-reorientation](ending-reorientation.room.test.ts) |

[真实 Room 评测](story-live-room.eval.mts)通过 `npm run test:eval` 的独立探针入口管理，默认 dry-run。普通测试不会导入它。已有真实批次未触发故事创建，因此不能据此宣称真实动态支线生成已通过；完整边界见 [KP-C01–C09](../../../docs/agent/functional-acceptance.md)。
