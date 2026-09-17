# 旧终局旁白被误报为可重试：截图排查与修复

2026-09-18，用户提供 00:51:32、00:51:36、00:51:54 三张截图，反馈重试后要求刷新、刷新又显示回复格式错误。分支 `cloudflare`；保留此前未提交工作，本轮没有部署、push、远端数据写入或真实模型调用。

## 线上证据

从截图读取编号 `ZW-mu5rnstp-9a78c68b31864ad28b7177a731b17b4f`，执行 `npm run diagnose -- --reference ... --out .wrangler/retry-diagnosis-20260918/retry.json`，exit 0、`found`。关联窗口内同一 submission 有五次尝试，北京时间 00:50:35、00:50:46、00:51:11、00:51:34、00:51:44 均进入 `prepare → priorWork`，最终返回 `retryableFailure`。00:51:11 尝试包含四条旁白阶段记录。

四条阶段的 rootActionHash 与[前一事故](incident-mu5gokct-20260917.md)完全一致：`sha256:0e3ee020a5b120346f68529f067e5440de5eea7264840039f962a6633a256041`。阶段结果及 token 用量也逐项一致：生成成功、首审 `missingClaimFacts`、修稿成功、末次复审 `narrationSchema`；本次阶段耗时仅 88/105/111/111 ms。截图明确显示旧行动已经结算、`canRetry: false` 对应的不可恢复提示。

这些证据说明当前操作被同一条旧回复拦住，不是新自然语言旁白协议再次生成失败。`runNarrationInvocation` 对相同冻结身份的 completed 调用直接返回原保存响应，Adapter 会再次发出阶段结果遥测；不能把这四条遥测当作四次新物理调用或新增费用证据。本轮没有读取原始旁白、审核正文或独立查询供应商账单，不猜测具体错误字段。

第三张截图另一次人工转录编号查询未匹配，未将该空结果解释为没有执行。上述已匹配报告本身包含同 submission 的 00:51:44 尝试。

## 根因与边界

`RoomDurableObject` 已根据持久化调用账本给出旧回复 `canRetry: false`，但 `handleRoomActionInternal` 的前置工作编排忽略该字段，仍调用旧恢复；只要没发布成功就一律返回 `retryableFailure / narrationPredecessorPending`。桌面据此显示重试和刷新指引，刷新后的权威投影却显示终局格式失败，形成用户看到的循环。问题位于恢复状态的直接消费者，不是刷新动作让正文变坏。

修复遵守 SPEC 0015 §8.2：已知终局前置回复直接拒绝当前新提交并明确说明旧回复需修复；本次恢复刚耗尽允许阶段时，再读取同一 capability 的权威状态决定是否终止。活跃发布者的 `pending + canRetry:false` 保持等待，不误判为终局。可恢复前置回复仍能发布并继续准备当前新行动；旧事件、固定骰面和物理调用不重复。

该修复只消除无效恢复循环。旧行动早于新版“先回复、后提交”而已经结算，新取消机制不追溯撤销历史事件；旧终局回复本身仍需单独的、保留原证据的修复或审计更正。没有绕过审核、删除旧账本、改写原请求或将旧失败改判为成功。

## 实际验证

- 修复前：`npx vitest run tests/kp/narration/interrupted-publication.room.test.ts -t 'stops a new action behind the terminal legacy predecessor'` exit 1，3 项均精确复现“应为终局 rejected，实际是可重试 narrationPredecessorPending”。覆盖末次实质拒绝、末次结构失败和未知物理结果。
- 修复后：`npx vitest run tests/kp/narration/interrupted-publication.room.test.ts` exit 0，22/22。新增 6 项覆盖上述三个终局、本次恢复中新变终局、可恢复正常路径及活跃发布者边界；终局重复提交不调用 Proposal、不再次遍历 Narration，事件与物理调用保持。
- `npx tsx --test --test-name-pattern='terminal predecessor rejection' tests/product/rooms/table-server-outcome.structure.test.mjs` exit 0，1/1，验证实际公开 DTO 不携带可重试标志或刷新建议，不泄露私有错误正文。
- `npx tsx --test tests/platform/recovery/send-action-recovery.test.mjs` exit 0，7/7，验证直接客户端的终局释放与原提交恢复语义。
- `git diff --check` exit 0；`node tools/spec-trace.mjs --check` exit 0，0 错误、8 个既有警告。未改变公共签名、导出类型或 DTO 结构，未重复 typecheck；没有全量回归或生产构建。

工作前源码、脱敏查询、红绿测试日志保存在 `.wrangler/retry-diagnosis-20260918/`。修复仅在本地，线上版本仍为 `44da10f4-8bea-4fa7-92d5-cb9fb5550252` 的上次部署；本轮不声称旧房间已恢复可玩。
