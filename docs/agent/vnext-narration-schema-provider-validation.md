# 旁白空审核 schema 与 Provider 误报修复

2026-09-07，cloudflare/258caee 的继承开发树；本次无部署、push 或 commit。

round58 的知识回顾已提交，但审核服务失败被公开成 NARRATION_BODY_INVALID，原失败响应缺少准确 HTTP 正文。[round59](vnext-round59-validation.md) 对冻结原审核请求仅作一次真实诊断，HTTP400 明确报告空 properties 不受支持；无机械结果的 resultChecks 是唯一空对象。本地 vendor validator 错误允许其外呼，Room 又把 modelPermanent 泛化为正文格式错误。

由同一冻结 mechanicalResults 生成 schema、Prompt 与解码：零组省略 resultChecks，非零组严格完整校验。固定五维审核、具体矛盾诊断、Viewer权限和 NPC 来源归属继续保持，新创作不填旧引用证明表。单一供应商校验器在发送前报告空 properties 的准确路径，原错误作为不可枚举 cause 留在私有边界。公开错误使用 NARRATION_PROVIDER_REJECTED，正文格式、语义拒绝和限流保持各自分类；Room保存、Viewer恢复、Table文案及telemetry直接消费者同步。

两隔离交付逐文件核对 baseline/new SHA、备份后串行集成，共13文件，0冲突：

- [Provider集成清单](vnext-narration-provider-error-integration.json)。
- [schema集成清单](vnext-narration-review-schema-integration.json)，review v11/policy v9。

代表性验证：知识回顾、NPC来源主张和普通场景无机械组共用省略路径；物品转交的非空组保持完整性；空对象在物理调用前拒绝；真实Adapter受控400经Room/Viewer/Table保持服务拒绝；格式错误、grounding和429仍区分，恢复只发布原冻结结果，不重做Proposal/提交。

主树实际运行：

- `npx tsx --test tests/narration-provider-failure.test.mjs tests/table-server-outcome-v2.test.mjs tests/structured-telemetry-v3.test.mjs tests/kp-vnext-narration.test.mjs tests/kp-vnext-knowledge-review.test.mjs tests/deepseek-strict-tool-provider.test.mjs`：70/70，exit0，日志 `/tmp/zhuwei-narration-integrated-node.log`。
- `npm run typecheck`：exit0，日志 `/tmp/zhuwei-narration-integrated-types.log`。
- `git diff --check`：exit0。

未增加调用、重试、第二套规则或改变冻结机械结果。原round58/59失败记录保留；本地受控测试不是DeepSeek稳定性证据，最终效果交由原三句round60真实HTTP链路验证。样本不足时不声称成功率提高。

实际[round60](vnext-round60-validation.md)已验证零/非零组schema均被真实DeepSeek接受；第一句完整通过，第二句另因可执行时间接口缺口失败停批。模型对已提交文本的审核通过未发现时间矛盾，整个游戏批次不通过。
