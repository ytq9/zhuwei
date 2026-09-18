# ADR 0028：放弃已持久化的 V5 私有 Form 房间及其验收套件

- 状态：已接受
- 日期：2026-09-18
- 依据：用户于 2026-09-18 要求只保留“在 SPEC 0001 中仍有用、与现役组件有生产消费关系且不冲突”的套件并删除其余，随后在两种读法之间明确选择“放弃 V5 房间”。
- 当前规则：[SPEC 0016 当前边界](../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)
- 取代范围：SPEC 0016 中“当前 V5 生产 Profile、Registry、房间和恢复路径保持不变”的边界表述；沿用 [ADR 0016](./0016-development-reset-of-pre-0.4-rooms.md) 的做法，不为被放弃的房间保留 Adapter、fallback、migration 或测试。

## 背景

2026-09-08 起 `RoomDurableObject` 默认使用 vNext 运行时与 Bundle 提案桥（`ce349be`），目录层只为新房选择 vNext Profile，V5 私有 Form Profile 只能由已持久化房间的精确绑定解析。为 V5 房间编写的 24 个 Room 套件共用 `tests/support/helpers/authoritative-proposal.ts` 构造 `privateFormProposal`，在默认 vNext 房间里被 `PROPOSAL_FORM_INVALID` 拒绝（2026-09-18 实测：用户点名的 10 个套件 58 失败/21 通过，其中通过的多数来自走 vNext 路径的三个套件；另 16 个同类套件 74 失败/3 通过）。把房间钉回 V5 manifest 后 `error-report` 立即通过，`combat-archive-correction` 只剩玩家自掷骰子的合同未跟上，说明失败来自套件与房间类型不匹配，而不是被测行为消失。

## 决定

1. 已持久化的 V5 私有 Form 房间不再是产品支持面。目录与归档数据可以保留在 D1，但产品不承诺回放、恢复或继续游玩它们。
2. 删除全部只能在 V5 房间里成立的 Room 套件（19 个文件）与 v3 提案 helper；`multiplayer.room`、`ending-reorientation.room`、`chapter-continuity-manifest.room`、`room-authority.room`、`authoritative-service-routing.room` 只保留不依赖 v3 提案且当前通过的用例。
3. 各 SPEC 的 `gates` 去掉被删文件，不为变绿补登任何未运行或未通过的门；因此失去 Room 级门的条款在下文列出。
4. 走 vNext 生产路径的 `stage3.room`、`archive-do-resume.room`、`authoritative-service-routing.room` 保留；它们的失败用例落后于玩家自掷骰子（社交扩展下由玩家手势授权）与先回复后提交（ADR 0026）等新合同，属于待更新，不属于本决定。

## 后果

- 失去 Room 级验收证据的条款：SPEC 0003 权威随机崩溃恢复、SPEC 0004 裁决先例、SPEC 0005 世界/战役纵切、SPEC 0008 死亡继任更正、SPEC 0009 结局与重新定向（只剩现实等待不推进时间一例）、SPEC 0010 O16 更正替换投递、SPEC 0011 §7 Room 级更正与受限 ErrorReport、SPEC 0012 战斗纵切与战斗随机、SPEC 0014 战术移动与环境破坏。Rules 级单测（`world-campaign`、`item-correction`、`rules-pending`、`frozen-choice` 等）仍覆盖其中的机械与更正规则。
- `errorReport`、`commitCorrection`、`exportAuthoritativeArchive`/`restoreAuthoritativeArchive` 与 V5 私有 Form 提案路径（`privateFormProposal`、`causal-action-program`、`private-form-policy`）在生产代码中保留但无 Room 级测试；其中归档导出/导入 RPC 本就没有生产调用方。是否删除 V5 提案路径另行决定。
- SPEC 0015 关于 V5 房间的条款从此只是历史，尚未逐条标注取代范围；`docs/agent/functional-acceptance.md` 中指向被删套件的证据改为删除线。
