# ADR 0112：新版 KP 结束战斗；敌人都倒下时由 Rules 向玩家提议结束

- 状态：已接受
- 日期：2026-10-05
- 依据：新版房间里的战斗结束不了。`EncounterConcluded` 只在玩家回答 `EncounterConclusionProposed` 时提交，而这个提议只有旧版 KP 的复合动作会发出。新版 KP 没有表单、Room 和 Rules 也不会发出；遭遇中又不能去别处（[SPEC 0014 §4](../specs/0014-observer-tactical-map-and-environment.md)）。敌人全部倒下后，玩家只能一直结束回合。投降、逃离、停战在新版里也没有入口。[SPEC 0012 §13](../specs/0012-part-b-abilities-damage-and-conclusion.md) 已规定这些结束方式，本 ADR 按原文补上入口，不改规则文本。
- 当前规则：[SPEC 0012 §§3.3、13](../specs/0012-part-b-abilities-damage-and-conclusion.md)；NPC 一方的决定见 [SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)。
- 取代范围：[ADR 0104](0104-combat-map-acts-commit-before-their-reply.md) 实现中把 `HostilityChanged`、`EncounterConclusionProposed` 列为不出说明的记录，改为说明（见决定 5）。

## 决定

1. **结束表单。** 新增按需加载的表单 `endCombat`，填写为 `decision.kind = "endCombat"`，只在行动者处于进行中的遭遇时提供（冻结上下文里行动者记录带 `encounter`）。
   - `outcome` 六选一，各对应一个结束理由：
     - `foesSurrender` 对手投降 → `npcSurrendered`；
     - `actorSurrenders` 行动者投降且对方接受 → `playersSurrendered`；
     - `truce` 双方同意停战 → `truceAgreed`；
     - `escaped` 行动者已脱离战斗 → `playersEscaped`；
     - `foesDefeated` 对手都已无力再战 → `hostilesDefeated`；
     - `conflictOver` 冲突已不必按先攻进行 → `conflictNoLongerNeeded`。
   - `stopFightingRefs` 只在前三种结果里填停手的 NPC 参战者，其余结果填 `[]`；`description` 一两句写这一刻。
   - 降级与 Rules 检查同一组条件：行动者在遭遇中；没有待选或待掷；停手者是遭遇里的 NPC、还能行动、正与玩家一方（行动者投降时是与行动者）为敌；其他结果不点名。
   - 表单不检定、不结算攻击。

2. **停手与结束提议。**
   - 停手：停手的 NPC 不再敌视玩家一方；行动者投降时只不再敌视行动者。行动者投降或停战时，行动者也不再敌视这些 NPC。都经已有的 `changeEncounterHostility`。
   - 停手之后仍有能战、仍敌视玩家一方的生物时，只记录停手，战斗继续（例如两个对手只有一个投降）。
   - 否则，以及其余三种结果，按已有的 `proposeEncounterConclusion` 把结束交给每名活着的玩家依次回答。都接受才 `EncounterConcluded`；有人拒绝，战斗继续，已发生的停手保留。这符合 §13"玩家分别决定自己的角色……KP 决定 NPC/世界是否继续敌对"。
   - 对手是否投降、是否接受投降或停战，由 KP 按该 NPC 的身份、目标和处境判断，与 ADR 0102 开战时由 KP 写敌对方向相同。

3. **逃离。** `escaped` 先登记一条公开事实 `encounterEscapeCompleted`（主体是活着的玩家角色），提议引用它，这是 `proposeEncounterConclusion` 原有的检查。只在行动者是遭遇里唯一活着的玩家角色时可用：一个角色的逃离不能替别人结束战斗（SPEC 0007）。结束之后，行动者照常用 `goTo` 去别处。

4. **Rules 自动提议。**
   - 时机：任何生物结束回合时（玩家的结束回合、NPC 回合计划的最后一步），在回合真正结束之前检查。
   - 条件：
     - 有活着的玩家角色；
     - 没有能战的非玩家参战者仍敌视活着的玩家角色或能战的生物；
     - 至少一名非玩家参战者已经不能战斗（死亡、昏迷、0 HP 或离开场景）；
     - 活着的玩家角色不再敌视任何能战的参战者。
   - "能战"指在遭遇场景中、活着、清醒、HP 不为 0；暂时失能的生物仍算能战，那种情况由 KP 用表单判断。
   - 满足时，以理由 `hostilesCannotContinue` 把结束交给玩家。接受则遭遇结束，这个回合不再结束；拒绝则回合照玩家原来的要求结束，战斗继续。
   - 提议之后，只有"能战的参战者"名单变了才会再次自动提议，拒绝不会每个回合重问。任何提议都记下当时的名单（`conclusionProposedWhileAble`）。
   - 为什么允许：§13 写明"只剩一个存活阵营只产生 Ending Candidate"，"所有仍敌对实体死亡、失能、无法继续或已经离开"是结束的事实之一。自动提议只是把候选交给玩家，结束仍由每名玩家决定。附录 COM-D005 否决的是"自动结束"，不是"提议"。
   - 只有环境危险、没有敌人的遭遇，玩家还在攻击能还手的生物，或对手都投降而站着，都不自动提议，由 KP 的表单处理。
   - 为什么在回合结束时：打倒最后一个敌人的那一下照常先讲出来，玩家这回合还可以做别的事。

5. **说明与旁白。**
   - `HostilityChanged` 改为说明："该生物不再与目标为敌。"
   - `EncounterConclusionProposed` 改为说明，内容是结束理由的固定句子；`EncounterConcluded` 仍是"战斗结束了。"
   - KP 的 `description` 带在第一条停手事件上；没有停手时带在提议上。
   - 含这两种事件的根按说明写旁白，所以玩家拒绝结束时，旁白也讲出谁停了手、为什么提议结束。
   - 玩家看到的提问也写出理由，例如"对手投降了。是否接受并结束这场战斗？"。

6. **回执主体。**
   - 被询问的玩家是 `EncounterConclusionProposed` 的主体。自动提议被接受时回合没有结束，这个根仍能投影给玩家并写旁白。
   - 原子行动在提交任何效果前停下来等玩家选择时，行动者是 `AtomicWorldInteractionSuspended` 的主体。玩家说"我投降"时立刻等待回答，旁白要讲出玩家这句话，需要回执里有行动者。

## 影响

- 请求体积（未接受，等用户决定）：
  - 新增 `endCombat` 选择 4663 token；
  - 全部选择 +571；
  - 遭遇中的选表请求 +340，遭遇外不变。
- 对手是否投降由主持 KP 依冻结上下文判断，不是该 NPC 本人的调用。这与 ADR 0102 一致，但 SPEC 0006 §7 写的是 NPC 依本人投影决定，是否要改为本人决定，留给用户。
- 没有做的：
  - 多人遭遇中单个角色离开（`CombatantDeparted`）；
  - 玩家一方全部倒下时的结束；
  - 投降或停战后某个 NPC 重新敌对；
  - NPC 回合计划里的投降步骤（ADR 0101 列为未做）；
  - 多名玩家依次回答 KP 表单的提议时，中间有别的行动会使原子续办冲突，需要重提。
- 本次没有真实调用验证。
