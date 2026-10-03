# ADR 0086：会抵抗的生物用对抗检定；战斗外的擒抱、推倒与挣脱

- 状态：已接受
- 日期：2026-10-03
- 依据：用户 2026-10-03 开的对抗检定专项。`claude/kp-battle` 分支上的填写表单小测回执（`docs/agent/receipts/kp-refusal-form-mini-test-20261003.md`）里，"把奈斯拦腰抱起，扛到炉边"两次被判做不到，其中一次的理由是"他会反抗、没人制住他"；现状的另一选择是固定 DC 检定，体现不了对方的抵抗。Rules 已有战斗里的擒抱、推撞对抗，但 vNext KP 路径用不到，玩家的行动也改不了 NPC 的擒抱状态。范围由用户选定：对抗骰加擒抱/推倒，挣脱一起做。两处条款的写法由用户确认（"按此修改"）；确认稿里 Acrobatics 写作"体操"，入规格时按游戏内技能名改为"特技"，含义不变。
- 当前规则：[SPEC 0004 §4](../specs/0004-kp-and-noncombat-mechanics.md)、[SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)
- 取代范围：无。SPEC 0004 §4 原句"对抗检定双方各有权威随机请求；平手维持现状"扩写为两条；SPEC 0006 §7 新增"被擒抱后的当场反应"一段。

## 决定

1. **表单。** decision 多一种 `contest`：行动者的 ability、skill、mode，`opponentRef`（检定步骤的 directTargetRefs 之一），`opponentChecks`（对方可用来抵抗的一到两项），risk、成败结果和时长，不填 DC。它只能决定 worldInteraction 步骤，所以只在加载了 worldInteraction 的表单里出现。解码后是 check 加 `opposition`，与 concealedCheck 的做法相同；[ADR 0064](0064-ruling-kinds-are-decision-values-and-a-selection-naming-one-is-read-without-it.md) 对裁决种类的处理同样适用于它。
2. **冻结与掷骰。** 降级时按对方属性块取所列较高的一项：NPC 属性块里有该技能加值就用加值，否则用能力调整值加熟练（并列取先列的），冻结为 `FrozenCheck.opposition`（对方、所列选项、选中项、调整值、对方的优劣势），这样的检定没有 DC。Rules 重算选择和调整值，不同就拒绝。对方的优劣势来自它自己的状态。同一个随机请求里先是行动者的 d20，后是对方的 d20；对方的骰子由 Room 掷，不等对方玩家确认。行动者总值高于对方才成功，平手算失败。`WorldInteractionResolved.check` 带双方骰面与总值（`opposition`），不带 dc；裁定先例记 `opposition`，dc 为 null；旁白材料和骰子显示带对方总值。
3. **擒抱、推倒、放手、挣脱是 worldInteraction 的效果。** `grapple`、`knockProne`、`escapeGrapple` 只能出现在对抗的成功分支，对象是对抗的对方。`grapple`、`knockProne` 只限玩家角色对 NPC：行动者力量（运动）对 [力量（运动）、敏捷（特技）]，NPC 体型不超过行动者一级（按 footprint，与战斗擒抱共用一个函数）；`grapple` 还要求成功分支里有被擒抱者本人的感知。`escapeGrapple`：行动者运动或特技对擒抱者 [力量（运动）]。`releaseGrapple`：放开自己擒抱的人，任何裁决都可以。行动者或对方在遭遇中时都拒绝，战斗中按 SPEC 0012 §6.3。一个结果里只能有一个这类效果。状态写在对方战斗实体的 conditions（`grappledBy`、`prone`），与战斗擒抱相同，由 `ConditionChanged` 提交。
4. **解除与站起。** 擒抱者离开场景时，移动事件本身清除他擒住的人和他自己身上的擒抱：所有移动都经过 `applyMovement`。擒抱者失能或死亡时，状态后续事件（与专注结束同一处）为每个被擒者提交一条 `ConditionChanged`。战斗外倒地的角色下次自己行动时，在该行动的结果之前提交一条站起的 `ConditionChanged`；该行动的检定按站起后的状态冻结。旁白材料把 `grappledBy` 读作"擒抱"（战斗擒抱以前漏掉了这一项）。
5. **被擒抱的 NPC 当场反应。** 擒抱成立且该 NPC 能立即行动时，在它的感知之后开一条 `NpcReactionOpened`，走 [ADR 0059](0059-bystanders-notice-by-passive-perception-and-react-by-their-own-view.md)、[ADR 0060](0060-bystander-reactions-run-on-the-spot-and-lapse-on-failure.md) 的反应流程。反应表单含 contest 和 `escapeGrapple`，NPC 可以当场挣脱，也可以不反应或做别的；被擒抱时走开（moveNpc）照旧被拒。
6. **Room：反应里需要掷骰的行动。** 修复一个已有缺陷：NPC 反应的行动需要掷骰时（检定、隐蔽检定或对抗），Room 提交不了。随机请求入账后，回放头越过了反应冻结的上下文，读集核对以 `dueDecisionContextChanged` 拒绝，随后的 lapse 又撞上已记下的提案 hash，反应一直挂起；就算越过这一步，恢复记录也不接受 `resolveNpcReaction`。现在反应的骰子入账后，读集核对与 ActorPlan 决定一样交给已验证的 Rules 续办，入账之前仍逐字核对；恢复记录接受 `resolveNpcReaction` 的行动形式。NPC 工作里需要掷骰的行动有同类问题（Rules 在骰后也不补 `NpcWorkStarted`），不在本次范围。
7. **指引 v71（与 ADR 0085 合并后为 v72）。** worldInteraction 段加两句：什么时候用 contest、平手怎么算；战斗外的擒抱、推倒、挣脱、放手怎么写。字段含义只写在表单里，不重复。按 [ADR 0057](0057-request-size-may-grow-for-a-feature-the-user-was-told-about.md) 告知后接受请求体积：加载 worldInteraction 的选择约多 1,036–1,041 个估算 token，其他选择不变。

## 影响

- 工作流 hash 变化，尚未冻结的方案按 [ADR 0038](0038-reask-unfinished-work-after-a-version-change.md) 重问。
- 已有房间回放不变：此前生产里没有任何途径写入 `grappledBy`（战斗擒抱只有原始 Rules 输入能触发），旧事件里也没有对抗和擒抱效果，所以移动时清除擒抱不会改变旧房间的状态。
- 战斗中的擒抱、推撞仍没有生产入口（只有原始 Rules 输入和预备动作能用）；战斗里没有挣脱和站起，战斗外成立的擒抱、倒地进入战斗后会一直保持。
- "扛到炉边"的位置没有移动：战斗外的裁决不改变任何人在场景内的位置，场景内移动由另一个会话处理。擒抱成立后，旁白可以写抱起，位置不变。
- NPC 擒抱玩家角色、玩家之间的擒抱没有开放；对抗本身不限对象，NPC 挣脱时的对方就是玩家角色。
- KP 是否会在合适的时候选 contest、NPC 是否会尝试挣脱，没有真实模型调用验证。
