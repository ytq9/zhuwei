# ZW-munycxry：NPC 第二次作答格式不合法，行动技术失败

- 日期：2026-09-30；本地预览 `localhost:3000`（`vinext dev`，由 Codex 在主工作区启动）。
- 故障编号：`ZW-munycxry-37235b56f27d4160b3bb0d4ba2d63e1b`，请求时间 `2026-09-30T10:18:32.830Z`（北京时间 18:18:32）。
- 代码状态：主工作区 `cloudflare`，基点 `b6fac1f`，含未提交的 NPC 回答审核（[ADR 0076](../../adr/0076-review-npc-replies-and-admit-experiences-with-knowledge.md)，审核策略 `zhuwei.npc-reply-review/v5`，`npc-reply-review.ts` 最后修改于 14:11）。
- 排查没有调用模型、没有改动房间数据；读取的数据库均先复制到临时目录。修复见文末，按用户选择实施，同样没有调用模型。

## 证据来源

- 本地 Worker 的控制台日志按请求存在 `.wrangler/state/v3/observability/miniflare-wobs-trace-store/<hash>.sqlite`（表 `spans`、`logs`）。按故障编号里的时间找到这次 HTTP 请求（开始于编号时间后 20 毫秒，耗时 19 秒）。
- 房间状态与每次模型调用的请求、响应在 `.wrangler/state/v3/do/zhuwei-RoomDurableObject/2e46fd28….sqlite`（`authority_vnext_stage_proofs`、`story_creation_invocations`）。

## 这次行动

`sendAction`，行动 `prepared-action:d7a8c2f7-…`，调用顺序：

| 序号 | 用途 | 结果 |
| --- | --- | --- |
| 1 | 选择 | 完成 |
| 2 | 裁决填写 | 完成，交谈判为检定 |
| 11 | 莉安作答（成功、失败两份） | 完成，格式合法 |
| 139 | 回答审核 | `revise`：成功分支的台词和新承诺与裁决的成功摘要不一致（`inconsistentConsequence`） |
| 12 | 莉安第二次作答 | 格式不合法，见下 |

行动以 `needsKp / PROPOSAL_REPAIR_EXHAUSTED` 结束，诊断 `JSON_SYNTAX`，位置 `arguments`，没有提交任何事件。

## 直接原因

莉安第二次作答的参数里，`success` 和 `failure` 两个分支各把 `newPromises`、`promiseChanges`、`newDebts`、`relationshipChanges`、`introducedContent` 写了两遍；`failure` 里还多了一个表单没有的 `text2`。这次请求声明了 strict 表单，两个分支都是 `additionalProperties: false`、九个字段全部必填，服务商仍返回了这样的参数。

解析器拒绝重复字段（`json:duplicate-object-member`），这是规格要求。这已经是该回答的第二次请求，按 SPEC 0016 §7.2 不能再问，行动按技术失败结束。

用保存的票据和回复离线重放结算，得到同样的失败：`npc-reply:arguments-unreadable`。

## 同一房间前一次行动（10:17:40）

同一玩家前一次行动（`prepared-action:755f447a-…`）也失败了，原因不同：

- 审核 139 退回莉安的第一次回答；莉安第二次作答登记了两条新内容，`attitude` 都写成 `reported`（她自己看到的事）。
- 审核 140 对这两条给了 `approve`。代码只允许批准 `believed` 的条目，整份审核被判无效（`NPC_REVIEW_INVALID`），审核次数已用完，行动失败。
- 离线重放：把 140 的两个结论改成 `claim` 后结算通过，失败只由这一条造成。
- 作答表单和提示词都没有说明四个 `attitude` 值各是什么意思。

## strict 表单的实际遵守情况

对本地所有保存的 strict 工具调用（9 月 22 日至今，含探针目录），逐次检查参数是否符合当次请求声明的表单：

| 工具 | 调用 | 不符合表单 |
| --- | ---: | ---: |
| `offer_kp_proposal_bundle`（选择） | 55 | 0 |
| `review_frozen_narration`（旁白审核） | 35 | 0 |
| `correct_kp_proposal_bundle`（修订，正文在字符串字段里） | 16 | 0 |
| `submit_kp_proposal_bundle`（裁决填写） | 48 | 17（35%） |
| `reply_as_npc`（NPC 作答） | 18 | 2（11%） |
| `review_npc_replies`（回答审核） | 11 | 1（9%） |

违规包括缺必填字段、多余字段、枚举外的值、类型不符和重复字段。所有保存的响应里模型名都是 `deepseek-flash`；各天的违规比例没有在今天突然升高。结论：DeepSeek 的 strict 模式对简单表单守得住，对复杂表单不保证遵守，而且从现有证据最早的一天起就是这样。

裁决填写有三轮修订兜底，所以以前不显眼。NPC 作答只有一次重问，回答审核格式错误直接技术失败。审核每次退回都会触发一次 NPC 第二次作答，而第二次作答格式出错就没有补救。

## 这个房间里带交谈的行动

| 开始时间（UTC） | 调用 | 审核结果 | 结局 |
| --- | --- | --- | --- |
| 09-29 17:43 | 1–4, 11, 12, 139, 140 | pass, pass | 未提交 |
| 09-30 04:24 | 1–5, 11, 139, 140 | pass, pass | 未提交 |
| 09-30 09:46 | 1–4, 11, 12, 139, 140 | revise, pass | 提交 |
| 09-30 10:15 | 1–3, 11, 12, 139 | pass | 提交 |
| 09-30 10:17 | 1, 2, 11, 12, 139, 140 | revise, pass | 未提交（`reported` 被批准） |
| 09-30 10:18 | 1, 2, 11, 12, 139 | revise | 未提交（本故障） |

前两次发生在审核代码的早期版本上，本次没有分析。14:11 之后的 4 次里提交 2 次、失败 2 次。

## 修复

用户选择“同一请求重发一次”，并决定由 Claude 在主工作区修改（[ADR 0077](../../adr/0077-an-unreadable-review-or-second-reply-is-sent-once-more.md)，SPEC 0016 §7.2 两处就地改写）：

- NPC 第二次作答读不出或不合作答表单时，同一请求重发一次，票据加 `resend` 标记；再读不出才技术失败。读出来但在其他方面不合格的第二次作答不重发。
- 审核回复不可用时，同一请求重发一次，不算审核阶段；再不可用才技术失败。审核序号改为 139–154，已有 1–138、1–146 的表在 Durable Object 启动时原地重建。
- 作答表单写明四个 `attitude` 的含义；审核请求为每条条目列出可选结论，只有 `believed` 可以 `approve`。
- NPC 作答策略 `zhuwei.npc-reply/v3`，审核策略 `zhuwei.npc-reply-review/v6`；未冻结的方案按 §9.2 在新版本下重问。

## 修复后的验证

- 用新代码重放这两次行动的保存数据：10:17 那次在第二次审核后改为“同一请求重发审核”，10:18 这次在莉安第二次作答后改为“同一请求重发作答”，都不再直接失败。
- 新增的 Room 测试按事故重现：审核退回、NPC 第二次作答带重复字段、重发后读出，行动提交；重发的请求与原请求相同；两次都读不出时不提交、不发第三次。审核批准 `reported` 条目时同一请求重发，重发给出 `claim` 后提交，条目不成为事实。
- 阶段记录表从 1–138 和 1–146 升级到 1–154 的测试：记录保留，154 可写、155 被拒。
- 规格门里的 `promise-lifecycle.room.test.ts` 按新规则改为：作答、重问、重发，仍残缺才结束。
- 另修了 `filling-interface.test.mjs` 里一条过期断言：A 段给作答表单加了 `introducedContent`，这条测试没有同步（它不是规格门，之前没被运行）。
- 本地预览在改动后 `/hall`、`/api/auth/session` 返回 200。

## 没有覆盖的

- 服务商为什么在 strict 模式下仍返回不合表单的参数，本地证据回答不了。
- 本次审核判定“台词与裁决的成功摘要不一致”是否合理：莉安的作答调用按 ADR 0073 读不到裁决摘要，她只知道这番话“起了作用”。这一点没有改。
- 修复没有经过真实模型调用；重发能否在真实回复里读出、失败率实际降到多少，需要有预算的真实批次。
- 没有替用户重新提交这两次行动。
