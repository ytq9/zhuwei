# vNext NPC 自身发言记忆与本人知识别名修复

日期：2026-09-06；`cloudflare/258caee404e0814405eb497653ee9f00d647b773`未提交树。沿SPEC0001 §§9、14及用户创作/假消息纠正继续开发，没有修改规格。

## 症状、根因与修改

NPC来源主张虽保存了私有动机、依据和时点，但`projectHeldSourceClaims`对本人NPC也裁掉这些字段，下一轮只知道自己说过什么。Rules projector现在传入已授权Viewer种类，仅原NPC说话者本人获得`ownOrigin`的sourceBasis、motive、formedAtFictionMicros。听者、转述者、玩家及其他NPC不获得该来源的私有缘由。持有正文、truthStatus=unresolved和公开Claims不变，仍不把谎言改成正史。NPC冻结Context复用原sourceClaim记录及完整权威hash，Room恢复后无需重猜动机。

round27下游引用错误来自guard与selector不一致：本人裸开场knowledgeRef已列为可引用，实际holder正文/hash齐全，selector能解析，guard却先报未绑定。`required-context-runtime.ts`现提供同源`requiredContextReadBindings`，两处共同消费。裸别名必须精确匹配行动者本人已加载的holder正文，最后锁定规范ref/hash；既有规范引用优先，别人的同名知识不能替代，仅有目录不能通过。没有填满context.binding.readSet，没有改写模型原引用或放宽NPC私有引用。

## 验证与直接消费者

- 故意撒谎、误信二手假消息、正常回应：追加下一轮私有缘由断言后原路径exit1，修复后3/3 exit0；正史/本人原知识、听者主张身份、来源事件、私有动机、精确replay均核验。
- 本人裸knowledgeRef与规范holder ref：原路径exit1，修复后同样选中精确readSet，两种写法均经Rules/project/replay成功；删除本人正文后仍拒绝，即使NPC保有同裸ID。提案原文不同可以产生不同hash/ID，不伪造相同提案。
- Node直接组：`npx tsx --test tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-source-claims.test.mjs tests/kp-vnext-npc-decision-context.test.mjs tests/kp-vnext-proposal-bundle.test.mjs tests/kp-vnext-nullable-reference-wire.test.mjs`，45/46通过。唯一旧测试要求完整根缺闭合符必须throw，与已有JSON窄修订合同不一致；改为locallyRejected/PROPOSAL_JSON_INVALID、保留原文且不自动接受后，仅该项1/1 exit0。源码未新增JSON修复路径。
- Room：`npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'executes social Form'`，3/3 exit0（31跳过）。直接/成功/失败均在驱逐和duplicate后再次真实prepare，本人sourceClaim仍有原私有motive，玩家observe不泄露；没有新增Provider调用。
- `npm run typecheck` exit0；没有全量/Lint/build。独立只读内存探针确认规范引用不被alias覆盖、伪造holder/path不产生alias、原NPC本人才能取得ownOrigin、听者保留自己的正文层级，exit0。

日志为 `/tmp/zhuwei-npc-own-source-red.log`、`/tmp/zhuwei-actor-knowledge-alias-red.log`、`/tmp/zhuwei-npc-memory-alias-node.log`、`/tmp/zhuwei-npc-memory-alias-stale-test-final.log`、`/tmp/zhuwei-npc-memory-alias-room.log`、`/tmp/zhuwei-npc-memory-alias-types.log`。测试早期root夹具缺绑定、比较两份不同原文整提案的错误预期均已修正，不把夹具问题当产品根因。

## 原批次诊断与未完成边界

round27非法JSON仅在离线副本补原已定位闭合符，全部原basisRefs保持；新lowering接受，裸alias映射到原精确holder/hash。原未改JSON仍拒绝，context.binding.readSet仍为空，未执行Rules或提交Room、Provider=0。原批次保持失败；见round27脱敏证据postBatchBindingFix及 `/tmp/zhuwei-vnext-round27-binding-fix-evidence.json`。

本轮另按[DeepSeek官方Tool Calls文档](https://api-docs.deepseek.com/guides/tool_calls/)与[API参数](https://api-docs.deepseek.com/api/create-chat-completion)只读核对strict/beta/thinking/tool_choice及schema：没有发现确定的配置冲突；单数$def/$ref/anyOf有官方支持，当前schema本地诊断无问题。两批非法arguments的finish_reason=tool_calls且输出未耗尽上限；与Provider约束异常相容，但根因未证明。先前400原因仍未知，不推断不支持思考；未追加付费对照。

本轮只证明本人发言缘由可取回和引用接缝修复，不证明模型下一轮必然正确维持、放弃或承认谎言。新经历正史→参与者记忆→同束social与提交前语义一致性仍待；普通/复杂真实链、双玩家20+、Activity与故事闭合、部署/生产退役继续。归档等待原答复，Goal active。
