# 旁白行动来源、历史边界与审核诊断保留：定向验收回执

2026-09-13。基线 `c101986`，工作树 `narration-origin-fix`。本回执只覆盖旁白来源纵切；分组步骤的语义调度由主任务另行验收。未 push、未部署。

## 修复提交与合同

- `78ad6bfe841fdecb05f0dfd2bc582d77dc246506`：旁白原意图沿实际发起 Submission、持久化消息、RootAction 与 Activity 来源传递；历史对话保留来源；当前回执结果与历史材料分开。
- `d1a3aec0bd5f12a3c04da8d9602d6e15d81c6403`：审核报告逐条检查并保留独立验证合法的拒绝理由；其他条目非法时整份报告仍拒绝发布。

合同依据是 SPEC 0016 §8.3 与 ADR 0018 的同一冻结表达材料及事实边界。原意图只约束表达，不证明行动已完成。来源必须可追溯到本次发起者或完成中的实际 Activity；没有精确来源时不从最近一条聊天、触发 due work 的玩家或相邻 root 猜测。

这两个提交没有修改 Proposal 的分组 wire、结果内挂、一次汇总诊断、JSON Patch 修订、稳定前缀、三轮预算、无效补丁继续与重复错误停止、补选类型继承或首个完整工具调用规则。旁白生成与独立审核仍最多两次调用。来源字段和旁白约束增加了表达输入，未据此声称旁白 token 更少，也未重新测量 Proposal 修订缓存性能。

## 根因与直接影响

round 122 精确回放确认，原始玩家意图已持久化，但 Activity 完成 Delivery 的 `actorIntent` 为 null。完成路径在独立 child root 上运行，旧接缝只看当前调用携带的玩家消息；原始请求还混入 `recentDialogue`，并丢失 message、receipt 与事件来源。通用 `actionCommitted` 与步骤结算状态也没有标明只证明回执或步骤状态。旧正文因此能把上一回合拿蜡烛写成本轮动作，旧审核未拒绝。当前 Claims 与真实库存没有重复蜡烛。旁白断点是本轮暴露的既有缺陷，不是分组 wire 源码新增的旁白分支。

新来源查询按 due work 的 activityId 查实际 ActivityStarted / RestStarted，再定位发起 root 的唯一非 answer Submission 与精确玩家消息；校验 principal、character、root、messageId 和 receiptId。clarification answer 复用 root，归档恢复插入顺序不决定发起者。多个发起者显式拒绝。主动 stop 的新 root 和 NPC 自身 due root 不继承触发者的旧请求；别的 Viewer 不能取得私有原文。

同一 root 多阶段的直接消费者 `storyAdmissionPreparation` 也改为取实际发起 Submission，修复 clarification answer 后被 `submissionByRoot` 的唯一行假设误拒为 `STORY_IDENTITY_CONFLICT`。当前 Submission 自带准备包仍优先，hash、权限与 admission 绑定未放松。

审核反例另暴露报告原子解析的问题：一条合法的 `RESULT_CHANGED /payloads/4` 后面跟着 occurrence 越界条目，旧 decoder 抛裸 `ModelOutputValidationError`，合法拒绝理由一起丢失。新 decoder 保留合法条目的诊断，同时将错误条目和缺少有效支撑的检查项记为报告问题，维持 `narrationSchema` 失败；不修 quote、occurrence 或删错后当成功。

## 定向命令与结果

以下命令在本工作树运行；明确标出的原始回放除外。红测试后修改对应源码才重跑，没有扩大到全量套件。

| 命令 | 结果与边界 |
| --- | --- |
| `npx tsx .wrangler/grouped-wire-validation/diagnose-narration.mjs`（原始 `local-preview-changes-8206cb` 工作树） | exit 1，原症状复现；generationInputExact、reviewInputExact、rulesProjectionExact、frozenExpressionExact 均为 true；真实完成意图为 null，旧请求混入对话，无本轮蜡烛结果 |
| `npx tsx --test --test-name-pattern='a wait freezes\|previous raw action' tests/kp-vnext-narration.test.mjs` | 修复前 0/2，预期红；暴露原始请求混入对话 |
| `npx tsx --test tests/kp-vnext-narration.test.mjs tests/narration-provider-failure.test.mjs tests/kp-vnext-knowledge-review.test.mjs tests/story-archive-host.test.mjs` | 来源提交 62/62，exit 0；包括冻结请求及 proof 的归档恢复、私密材料、原请求审核恢复 |
| `npx vitest run tests/kp-vnext-time-passage-room.test.ts tests/room-due-work-store.test.ts -t 'a plain wait uses\|a one minute wait stops\|player dice: a general check\|an explicit stop\|root origins survive'` | 5 passed / 19 skipped，exit 0；等待、NPC 与玩家来源隔离、玩家显式掷骰、主动停止、倒序恢复与越权/歧义拒绝 |
| `npx tsx --test --test-name-pattern='malformed issue locations' tests/kp-vnext-narration.test.mjs` | decoder 修改前红，缺失合法 diagnostics；修改后通过；补充 failureStage 和仅有非法 issue 的 Adapter 断言后同一目标再次 exit 0 |
| `npx tsx --test tests/kp-vnext-narration.test.mjs tests/narration-provider-failure.test.mjs` | decoder 提交 45/45，exit 0；合法重复 quote 的 occurrence=1 仍定位第二处，不将它一概归零 |
| `npx tsx .wrangler/narration-origin/rebuild-round122.mjs` | exit 0；重放真实事件/投影，按 SQLite 中实际来源重建 v2 输入，原 Claims 不变；生成与审核冻结材料一致，只有两条已听对话，没有把旧原始请求当发言 |
| `npx vitest run tests/kp-vnext-time-passage-room.test.ts -t 'a clarification answer'` | session 66352，exit 0，1 passed / 16 skipped；实际 intent → clarification answer → Activity → 玩家 roll → Delivery → eviction/重复提交，无重复玩家消息、事件、随机或模型调用 |
| `git diff --check` | 两个源码提交前均通过；回执提交前再次检查 |

最后一条 Room 用例依赖主任务提供的 `claims-action-start.patch`：该补丁仅在验证工作树中应用，**不在上述两个提交中**。它把 FrozenPlayerChoicePrepared、PlayerChoiceRequested、PendingInputAnswered 等输入记账与实际执行事件分开，避免合法澄清前缀令尚未结算的 ActivityStarted 抛 `VNEXT_CLAIMS_INSUFFICIENT`。其他执行事件仍走闭合 Claims 校验。Rules 源码由主任务负责审阅、提交和集成。

Worker 日志包含用例刻意注入的 checkpoint exception / actor transport exception；上述成功命令的最终 exit 均为 0。另有一个既有用例通过命令 `npx vitest run tests/kp-vnext-time-passage-room.test.ts -t 'timed checks and frozen choices recover'` 得到 exit 1：没有玩家点击掷骰时旧断言期待 committed，现役行为为 awaitingPlayerRoll。此旧用例未修改、未作为通过证据；本次新增用例实际执行了玩家 roll。

主动 stop 的闭合 UI 没有自由文本，并仍走已有 observer-projection 旁白路径。该回归先经真实 stop 取得 Receipt/Submission，再直接调用同一来源 seam 证明不继承旧 Activity 意图；不将这项证据描述为已迁移 stop 的旁白路由。

## 有界真实调用与离线复验

主任务使用重建的 round 122 冻结材料，以默认 `deepseek-v4-flash` 完成三次调用后停止。本子任务未另发外部请求。三次是一个生成/审核对及一个旧正文反例审核，生产单次旁白上限仍为两次。

| 调用 | 输入 token | 输出 token | 缓存命中输入 | 未命中输入 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 新正文生成 | 3,419 | 797 | 256 | 3,163 | 没有追加旧蜡烛动作 |
| 新正文审核 | 4,791 | 141 | 128 | 4,663 | 五项 pass，issues 为空 |
| 原坏正文审核 | 4,783 | 381 | 1,408 | 3,375 | 指出了额外动作；第二条 occurrence 填错，报告非法 |

真实批次的 `report.json` 保持原始 `status=failed`，因为其反例验收要求得到一份可解码的具体拒绝报告，实际得到裸 `ModelOutputValidationError`。不将这次外部模型反例审核记为格式合格，也没有重采样挑成功。

使用新 decoder 对同一份保存报告离线复验后仍为 `ModelOutputValidationError`，但保留 `{code: RESULT_CHANGED, occurrence: 0, constraintRef: /payloads/4}`，报告问题为 `issues[1].occurrence` 与 `checks.continuity`。这证明本地 decoder 的诊断保留修复；不能据此声称模型在新一次真实调用中自行改对了报告。

## 版本、证据位置与未覆盖范围

- 冻结表达 schema 为 `zhuwei.frozen-narration-context/v2`，生成 schema 为 `zhuwei.natural-narration/v2`，审核 schema 为 `zhuwei.narration-review/v13`，policy 为 `kp-vnext-narration-policy-v13`。旧 v1 冻结上下文显式拒绝；workflow / manifest 隔离由主任务集成核对。
- 本地 `.wrangler/narration-origin/` 保存重建脚本、`round122-request-v2.json` 和 `round122-material-v2.json`。原始工作树 `.wrangler/grouped-wire-validation/narration-origin-live/report.json` 保存真实三次调用报告。它们是忽略的本地材料，不承诺跨机器可用；session cookie 未输出或提交。
- 真实验证使用历史 round 122 的实际事件和当前来源绑定重建旁白输入，没有重新从新房完整跑 Proposal → Rules → Room；后者中的来源变化由定向 Room 回归验证。
- 未运行全量 Node/Vitest、gate、production build、全项目 lint、远端 migration 或统计可靠性验收。集成 typecheck 和语义调度及 Claims 补丁的验证由主任务汇总；本回执不代替其结果。
