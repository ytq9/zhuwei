# 沙盒剧情接续与战斗交接：本地实施回执

日期：2026-10-06。分支：`cloudflare`。本回执对应源码 `d221a6a8ac1000c3ba97992f9cf66e6126215ab1`，范围和后续阶段见[实施方案](../proposals/sandbox-story-continuity-plan-20261006.md)。本次没有真实模型调用、push、部署或远端 migration；不是编号的真实模型验收批次。

## 已交付的本地改动

| 提交 | 改动及直接影响 |
| --- | --- |
| `f4041701` | 场景问题、回答及胜利／不可逆失败／明确放弃经现役选择、填写、Room、Rules 和观察者投影闭合。多人放弃只结束本人的参与；独立故事不互相阻塞。见 [ADR 0122](../../adr/0122-story-continuity-uses-the-current-atomic-proposal.md)。 |
| `9a8bd394` | 落实用户逐项裁定的五项战斗交接需求；同时修复同回合重规划后重复说话、非法计划重试缺诊断，以及承诺旁白材料。补齐隐蔽库存操作的选表说明。见 [ADR 0123](../../adr/0123-perceived-combat-continuity-and-own-decisions.md)。 |
| `ccd94c61` | 普通主持读取本场景实际计划、最近场景答案和结局；旧答案与结局保存在本人记忆并通过分层目录回读。公开／秘密调查产生不同的实际知识和计划。见 [ADR 0124](../../adr/0124-current-situation-reads-committed-consequences.md)。 |
| `d221a6a8` | 为“被饶过后再行动”和“部分敌人投降”准备固定开局及真实探针断言。开局的投降是披露的夹具历史，不算真实 NPC 决策样本。 |

前置 worktree 整合、改号和恢复引用只记在[整合回执](sandbox-worktree-integration-20261006.md)，原 Claude worktree 未删除。当前 runtime 为 `runtime-srd51-2014-authoritative-vnext-stage3-v5`；后续部署仍按 ADR 0120 处理旧 manifest 的开放房间退役，本次本地实施不影响线上房间。

## 验证证据

| 检查 | 实际结果 |
| --- | --- |
| `npm run gates:check` | 最终源码下 97 个已声明测试文件全绿；Worker 部分 284 项通过。规格错误、文档断链均为 0，没有扩大违规或失败基线。该命令不运行 3 个外部／工具门，不是全项目回归。 |
| `npm run typecheck` | exit 0。 |
| `tests/kp/stories/story-continuity.room.test.ts` | 10 项通过，包含现役 Room 组合行动、三种收束、多人和私密边界、陈旧／未决拒绝、下一问题、驱逐及归档恢复，以及相同开场的知识和计划差异。 |
| `tests/kp/knowledge/long-session-context.test.mjs` | 5 项通过。200 条历史场景答案／结局只读取最近六轮正文；旧记录仍在分层目录。1000 条一般记忆、版本变化拒绝及 NPC 本人读取边界继续通过。 |
| `tests/platform/evaluation/story-room-probe.test.mjs` | 15 项通过，验证用例登记、预算、来源冻结和探针断言合同。 |
| `combat-after-spared`、`combat-partial-surrender` 的 `--preflight` | 均通过。实际构建并重放开局、保留战斗记忆或部分敌对；两次均为 0 次模型调用。 |
| `git diff --check` | 通过。 |

首次加入历史答案测试时，上下文准备以 `availability:scope-constraints-incomplete` 失败：旧记忆虽然退出知识窗口，仍被作为场景事实整批读取。修复在原事实读取入口识别记忆持有者，两个知识渠道使用同一加载选择；原失败、普通长局和版本变更拒绝均通过。没有删掉历史记录来缩小请求。

临时日志：`/tmp/zhuwei-continuity-verified-gates-20261006.log`、`/tmp/zhuwei-continuity-verified-types-20261006.log`、`/tmp/zhuwei-situational-continuity-room-2-20261006.log`、`/tmp/zhuwei-scene-memory-bounds-green-20261006.log`、`/tmp/zhuwei-probe-case-contract-20261006.log`。这些本地临时文件不承担长期产品规则权威。

两个战斗开局的成功预检证据目录分别为 `/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-story-room-probe-gNFlj3` 和 `/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-story-room-probe-Lsqy0p`。首次预检发现夹具共享数组被 Rules 的非树形输入检查拒绝；修正夹具的独立集合后通过，失败与重跑都没有付费调用。

## 输入体积与成本边界

本次局势读取没有增加固定 prompt 或模型调用。一个通过真实 Rules 形成的本场景计划，在不点名 NPC 的普通选择上下文中增加约 536 token：4,028 → 4,564。这是该样本的上下文正文增量，不是所有场景的固定费用。计划数和正文长度会改变增量；仍使用现有 90k 输入门和工作预算。

最终请求体积门的 22 项选择与已接受基线持平，全部组合为 48,649 token。本轮较早的战斗交接增量已说明并接受：social 及组合 +129、inventory/authorItem 相关 +51、全部组合 +180；NPC 回合固定提示 +52。缺少目标 NPC 战斗属性时，主持准备固定材料约 1,360 token，加实际目标材料，额外一次调用、最多 4,000 输出 token；已有战斗定义不增加该调用。以上均是本地计量，没有真实 usage 或费用可报告。

## 尚未完成与待确认

- 第一轮真实路线 `sandbox-story-conclusion`：已准备并完成零调用预检，待用户确认最多 16 次调用、600,000 输入／32,000 输出 token、2 元、首次失败即停止的批次预算。授权不自动覆盖另外两条战斗用例。
- 剧本中的发展候选还没有接入 NPC 本人采纳流程。已提出逐候选、按已提交身份和知识冻结本人请求，让 NPC 采用、修改或放弃；新增一次本人调用的持续成本正在等待用户确认。当前实际计划接续的测试不能替代这一未实现环节。
- 多路线长期游玩、离开返回的持续差异、生成剧本的真实可用性／费用，以及 handoff §5.5 的后续战斗能力和段落摘要仍未完成。历史真实失败保持原结论。
- 未改机会身份算法，未清理模组正文；现有证据不能证明实际重复生成或材料偏航。

因此，这份回执确认本地实现和测试证据，不把整项沙盒能力、整个 handoff 或真实模型质量标为完成。
