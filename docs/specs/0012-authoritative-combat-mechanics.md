# SPEC 0012：权威战斗机械

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 产品：烛帷
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0006`、`SPEC 0007`、`SPEC 0008`、`SPEC 0009`、`SPEC 0010`、`SPEC 0011`
- 适用规则：D&D 5e 2014 / SRD 5.1
- 取代范围：`SPEC 0002` 的纯战斗机械，以及 B07–B15、B17–B22、B29–B30、B35–B40、B49 和 B53 的战斗段；B16 通用恢复责任由 `SPEC 0003/0010/0011` 取代
- 范围：遭遇、参战者、空间、先攻、逐个突袭、轮与回合、行动授予、移动分段、反应时点、能力与施法、效果、伤害、专注、0 HP、死亡、非致命击倒和非歼灭结束

## 1. 继承关系与严格范围

本规格实现 `SPEC 0001` 在战斗中的玩家能动性、KP 叙事权威、规则机械权威、公正、NPC 有限知识和长期后果，不修改、缩小或取代 `SPEC 0001`。

战斗只是 Rules Module 的深 Implementation，不是第三个顶层 Module。生产调用者和行为测试仍只通过 `SPEC 0003` 的 `step / project / replay` Interface 推动或观察机械；自然语言意图仍只进入同一个 Room Action Module。

本规格明确不定义或复制：

- 根行动、澄清、幂等 ID、Receipt、作用域并发和待决恢复；这些由 `SPEC 0003` 定义；
- Principal、席位、角色控制权和虚构时间；这些只消费 `SPEC 0007` 的权威事实，不在本规格重定义；
- 权威随机数的生成、恢复和崩溃语义；这些由 `SPEC 0003/0011` 定义；
- 观察者投影、私人窗口送达、当前回应、ACK 和不可回看；这些由 `SPEC 0010` 定义；
- 更正权限、因果分支、归档重建和 Runtime 日志；这些由 `SPEC 0011` 定义；
- NPC 为何战斗、如何选择战术、投降或撤退；这些由 `SPEC 0006` 的有限知识 KP 提案决定；
- 故事是否结束、尾声和续篇；这些由 `SPEC 0009` 定义。

不得建立 `CombatCoordinator`、战斗专属 DO、战斗专属骰源、战斗专属 projector、D1 活跃战斗镜像或页面战斗状态机。Room Action Module 只把已经冻结并有权的战斗提案交给同一 `step`；Rules Module 不替玩家或 KP 选择目标、反应、战术或是否停止冲突。

## 2. Combat Profile 与版本锁定

每个新规则房间的 ruleset manifest 必须绑定一个 `CombatProfile`：

```ts
type CombatProfile = {
  id: "combat-srd51-2014-v1";
  rulesetVersion: string;
  eventSchemaVersion: string;
  geometry: ProfileRef;
  triggerOrdering: ProfileRef;
  combatTime: ProfileRef;
  abilityCompiler: ProfileRef;
  damageDeath: ProfileRef;
};
```

首个 Profile 引用固定为以下语义版本，实际目录项必须具有不可变内容哈希：

- `geometry-2d-feet-2014-v1`；
- `trigger-initiative-order-2014-v1`；
- `combat-round-six-seconds-2014-v1`；
- `ability-srd51-2014-v2`；
- `damage-death-srd51-2014-v1`。

事件必须保存所用 Profile/定义的稳定引用或哈希。`step`、`project` 和 `replay` 遇到规则集、事件 schema、Profile、编译器或定义哈希不匹配时必须显式拒绝，不能用部署时“最新”内容解释旧房间。

### 2.1 2014 版本护栏

本 Profile 明确禁止混入以下 2024/5.5e 语义：

- 突袭导致先攻劣势，而不是 2014 的逐个首回合限制；
- 每回合只能消耗一个法术位；
- 反制法术改为目标体质豁免或返还被反制法术的已承诺资源；
- 擒抱/推撞改为徒手攻击后的力量或敏捷豁免；
- Weapon Mastery、2024 Magic/Utilize/Influence/Study 动作；
- 固定 DC 15 躲藏并获得 Invisible 状态；
- 通用自愿失败豁免；
- 2024 疲乏或 Bloodied 通用状态。

版本化产品裁定必须明确标为产品规则，不能伪称 SRD 原文。

## 3. Encounter 与参战者

### 3.1 Encounter

`Encounter` 是 WorldState 中需要按结构化顺序处理威胁、冲突或危险的一段机械状态。它可以包含三个以上阵营、环境危险或没有传统敌人的冲突，但不等同于整个场景、章节或故事。

一个 Encounter 至少保存：

- Encounter ID、场景/地点、活动分支和 Combat Profile 引用；
- 参战者、控制主体引用、阵营和两两敌对关系；
- 规范空间、地形、屏障、危险、出口和可破坏环境引用；
- 先攻条目、共享组、平手顺序、轮数、当前回合和阶段；
- 每个参战者的动作授予、移动账本、反应、效果、专注、HP、临时 HP、资源和死亡状态；
- 当前战斗结算引用及可能的结束候选；
- 遭遇开始的虚构时刻、当前六秒轮窗口和结束原因。

遭遇不是第二个 genesis。它只能由房间 genesis 和连续 WorldEvent 重建。一个世界实体同一时点最多加入一个活跃 Encounter；同地点实体不会自动全部参战。

### 3.2 Combatant

参战者是已经加入 Encounter 的世界实体，至少引用：

- 稳定实体 ID、体型、空间占位、位置和移动方式；
- 控制者事实：玩家角色引用其 CharacterControl，NPC/世界实体引用 KP 控制；
- 阵营、敌对关系、可见/隐藏状态和逐个察觉依据；
- 版本化 AbilityDefinition、武器、法术、资源、感官和防御；
- 先攻条目、回合资源、效果、专注、伤势和死亡策略。

动态敌人、能力和危险的因果选择、有限知识和定义注册由 `SPEC 0005/0006` 先行固化；战斗只消费精确定义引用并验证战斗机械。数值远强于队伍不是机械非法理由。

### 3.3 多阵营与敌对关系

敌对关系是有方向或对称语义的结构化事实，不能简化为“玩家/所有非玩家”二分。投降、魅惑、停战、背叛、目标完成或 KP 有限知识决定可以经同一行动事务改变关系。

非敌对不等于不能被攻击；相应玩家仍可以明确攻击，其重大歧义由 `SPEC 0003` 澄清。关系变化必须成为事件并可回放，不能只改 AI Prompt 或页面颜色。

### 3.4 加入、离开与改变

增援、召唤、变形、阵营改变、地形破坏、危险出现和出口封闭必须引用已经固化的事实或能力定义并经 `step` 产生事件。

新参战者获得权威先攻条目。若其顺位在当前轮已经经过，默认从下一轮开始拥有回合；只有明确 2014 能力或已裁定产品能力可以授予立即行动。

离开 Encounter 不会使实体从世界消失。逃跑者、被传送者、俘虏和脱离者保留位置、伤势、资源、装备、知识、关系和仍有效的效果。

## 4. 唯一二维战场空间

### 4.1 Geometry Profile 是唯一空间真相

每个 Encounter 只允许一个 `BattlefieldGeometryProfileRef`。`geometry-2d-feet-2014-v1` 使用以尺为单位的二维水平空间和独立高度，至少表达：

- 实体体型、占位、触及和可穿越性；
- 有序移动路径及步行、攀爬、游泳、飞行等移动方式；
- 地形、门、屏障、困难地形、不可通行区域和可破坏环境；
- 视线、清晰路径、半掩护、四分之三掩护和全掩护；
- 球、柱、立方、锥、线等区域及其与占位的相交；
- 自主移动、动作/反应移动、强制移动、传送和坠落的来源；
- 固定坐标精度、边界包含规则、距离/取整、碰撞和遮蔽算法的内容哈希及 conformance table。

同一房间不得同时维护一维距离、距离段、页面坐标和服务端二维坐标等多套活跃真相。自然语言位置由 Adapter 形成提案；Rules Module 根据唯一 Profile 验证。多个解释会显著改变距离、危险、资源或不可逆结果时，Room Action Module 先取得玩家澄清。

Profile 的固定行为包括：

- 恰好位于范围或区域边界合法；超出 Profile 最小精度即非法；
- 实体按体型占据空间，不能自愿结束于另一实体占位；
- 经过可穿越生物空间视为困难地形；经过敌对生物空间还需满足至少相差两个体型等级；
- 挤入小一体型生物可占据的空间时，每移动 1 尺共花费 2 尺，攻击与敏捷豁免具有劣势，攻击该实体具有优势；
- 半掩护为 AC 和敏捷豁免提供 +2，四分之三掩护提供 +5，全掩护阻止直接指定目标；多个掩护只取最高；
- 区域原点首先服从清晰路径；指定不可见点且中途被墙阻挡时，原点落在墙的近侧；
- 区域默认不能穿过全掩护；能力定义明确声明绕角传播时才使用版本化特例，例如火球术仍不能穿透没有开口的封闭空间。

具体固定点精度、占位求交、距离和遮蔽采样算法属于 Profile 内容，不得在页面、AI Adapter 或战斗调用者中重写。Profile 发布门是 B08、B39 的 conformance table 全部通过。

### 4.2 区域目标

区域能力的调用者只提交定义允许的原点、方向、尺寸和封闭选择。实际受影响实体由 Rules Module 从权威空间计算；调用者不能提交一份可漏选或额外选择的完整 `targetIds` 作为区域真相。

同一输入、Profile 和事件状态必须在 `step` 与 `replay` 得到同一受影响集合。

## 5. 先攻、逐个突袭与轮

### 5.1 逐个突袭

本规则没有“突袭轮”。存在隐匿时，KP 先依据已固化位置、Stealth 结果、每个潜在对手的被动感知和感官，逐个确定其是否察觉任何威胁。

开战时没有察觉任何威胁的实体被突袭。被突袭者在自己第一回合不能移动、采取动作或附赠动作，并且在该回合结束前不能采取反应；第一回合结束后，即使仍是第一轮，也可在满足触发时使用反应。

突袭不能按阵营或队伍统一赋值。同一隐藏者面对感知不同的两名角色时，可以只突袭其中一人。

### 5.2 先攻

先攻是敏捷能力检定，应用合法加值和优势/劣势；自然 1/20 不自动决定结果。骰面请求和满足完全引用 `SPEC 0003`。

KP 为一组相同生物进行一次共享先攻检定并建立一个先攻条目；组内每个实体仍分别持有动作、反应、HP、资源、效果和死亡状态。

平手按 2014 权限处理：玩家控制角色之间由相应玩家决定顺序；KP 控制实体之间及玩家与 NPC 的平手由 KP 决定。需要选择时使用 `SPEC 0003/0007` 的私人 Pending Input，不依赖数组顺序或请求到达顺序。选定顺序在 Encounter 内冻结并可回放。

### 5.3 轮与虚构时间

`combat-round-six-seconds-2014-v1` 固定：一个战斗轮是同一六秒虚构时间窗口，包含该轮所有有效先攻条目的回合。单个回合、一次模型响应或现实等待不会各自推进六秒。

遭遇开始时记录当前分支虚构时间并打开轮窗口。最后一个有效先攻条目结清，或 Encounter 在本轮中途合法结束时，轮窗口关闭且该分支虚构时间只推进六秒一次。虚构时间与分头因果前沿继续服从 `SPEC 0007`。

持续效果优先保存“自身下回合开始/结束”“目标回合结束”等相位锚点，不仅保存秒数。Encounter 中途结束时，未到达相位按 Time Profile 转换为下一相应假想轮边界的绝对到期任务；到期只终止或触发效果，不授予新战斗动作，且只发生一次。

## 6. 回合状态机与行动授予

### 6.1 回合阶段

每个回合依次具有：

1. `turnStart`：恢复按 2014 在自身回合开始恢复的反应，结算开始时触发、死亡豁免和到期效果；
2. `turnActive`：使用动作授予、移动、附赠动作资格、物件互动及合法能力；
3. `turnEnd`：结算结束时触发、重复豁免、效果到期和回合记录，再移动先攻游标。

突袭对首回合反应的限制持续到该回合结束。失能实体可以自动跳过其不能采取的选择，但开始/结束触发仍须结算。

存在未结算移动、攻击、伤害、随机请求或 Pending Input 时不得结束回合。现实超时、掉线或模型失败不自动 `EndTurn` 或 `pass`。

### 6.2 行动授予

行动经济必须保存带来源和限制的 grants，而不是 `action: boolean`：

- 一个普通动作；
- 只有能力允许时才存在的附赠动作资格；
- 使用后在自身下一回合开始恢复的反应；
- 与移动或动作结合的一次免费物件互动；
- 动作如潮授予的额外普通动作；
- 加速术授予的受限额外动作；
- 本回合已经施放的法术、使用的攻击次数、移动距离和一次性资源。

动作如潮不刷新附赠动作、反应、移动或免费物件互动。加速术额外动作只能用于其 2014 列表；选择 Attack 时只能进行一次武器攻击，也不刷新附赠动作、反应或免费互动。来源允许时，额外动作仍可用于 Use an Object。

### 6.3 基础动作和多次攻击

Profile 至少支持 Attack、Cast a Spell、Dash、Disengage、Dodge、Help、Hide、Ready、Search、Use an Object、Grapple 和 Shove 的 2014 语义。

一次 Attack 动作、Extra Attack 和怪物 Multiattack 保留不同定义；不能归并为一个无来源计数器。含多次武器攻击的动作允许在各次攻击之间移动和更换目标；具体多射线法术只有定义明文允许时才能在射线之间移动。

2014 的 Grapple/Shove 是 Attack 动作中替代一次攻击的特殊近战攻击：目标不超过攻击者一个体型等级、位于触及内，攻击者 Athletics 对抗目标自行选择的 Athletics 或 Acrobatics。它们不是命中徒手攻击后的力量/敏捷豁免。Extra Attack 可以分别用于擒抱、推撞或武器攻击。

## 7. 移动分段与准确反应时点

### 7.1 分段移动

调用者提交有序路径和移动方式；Rules Module 计算距离、困难地形、速度预算、占位和每个潜在触发边界。路径不能原子预提交至终点。

每个可能打开反应、触发危险或改变后续合法性的边界先暂停。反应使实体倒地、速度变零、改变位置、失去移动方式或道路被封闭时，剩余路径不生效，决定权交回相应控制者重新规划。只有已经失能、死亡、超距或被规则明确取消的后续攻击才自动失效；系统不能替控制者选择新路径或目标。

不同移动方式分别保存速度和本回合使用量。站起、匍匐、攀爬、游泳、飞行、困难地形、Dash 和速度为零使用 2014 语义；多个困难地形来源不把同一尺反复倍增。飞行实体是否坠落由 hover、能力和状态决定。

### 7.2 借机攻击与强制移动

只有看得见的敌对生物使用自己的移动、动作或反应，即将实际离开反应者触及时，才在越界前打开可选借机攻击。

下列情况不打开借机攻击：

- 目标已采取 Disengage；
- 传送；
- 不使用目标自身移动、动作或反应的强制移动；
- 反应者看不见目标；
- 当前不是敌对关系；
- 能力明文禁止该触发。

借机攻击消耗反应并进行一次近战攻击。窗口、恢复和断线语义完全使用 `SPEC 0003/0010`，控制者事实只引用 `SPEC 0007`；本规格不另建窗口存储。

### 7.3 同时触发排序 Profile

`trigger-initiative-order-2014-v1` 在同一冻结因果点按以下顺序处理：

1. 能力或 2014 规则明确给定顺序时服从明文；
2. 同一控制者拥有多个同时触发项时，由该控制者通过一个私人排序选择冻结顺序；
3. 不同控制者同时合资格时，从当前回合实体的先攻条目开始，按 Encounter 已冻结的先攻/平手顺序轮转；当前回合实体不合资格时仍从其后继开始；
4. 同一共享先攻组内使用 Encounter 开始时冻结的组内顺序；无参战者控制者的环境触发排在所有参战者后，并按稳定 definition id、source entity id、trigger id 排序；
5. 每个窗口开启前重新验证其合法性；前项使后项失效时，以无资源消耗的关闭事件结清。

排序不能依赖对象遍历、网络延迟、模型响应速度或先到请求。嵌套反应保留原继续点并形成新的内部结算层；不采用把所有反应机械地统一为无条件 LIFO 的规则。

## 8. 预备、护盾术与反制法术

### 8.1 Ready

Ready 必须冻结一个可感知触发，以及一个动作或“移动至多自身速度”。触发完成后，控制者可以使用反应执行或明确放弃；未在自身下一回合开始前使用则失效。

只有施法时间为一个动作的法术可以预备。预备时法术已经施放并消耗法术位，以专注持有；触发后用反应释放。专注中断、未触发或选择放弃不会返还法术位。

### 8.2 Shield

Shield 窗口只在以下时点打开：

- 一次攻击已经判定命中该角色、伤害尚未请求或结算；
- 该角色成为 magic missile 的目标，法术效果尚未结算。

使用后获得定义中的 AC 加值，适用于触发攻击并持续到使用者下一回合开始；触发攻击按新有效 AC 重新确定是否命中。持续期内免疫 magic missile。窗口外不能追补使用，且只有有权控制者看到私人选项。

### 8.3 Counterspell

只有反应者看见 60 尺内生物正在施法，且目标法术尚未生效时才打开 Counterspell 窗口。只听见、看不见、超距或法术已生效均不打开。

目标法术等级不高于所用 counterspell 法术位等级时自动反制；否则进行使用者施法属性检定，DC 为 `10 + 目标法术等级`。它不是体质豁免。被反制法术已经承诺的动作、反应、法术位或其他成本不自动返还。

Counterspell 可以被另一个合法 Counterspell 反制；嵌套结算暂停并恢复原法术继续点，不能覆盖已提交资源或提前应用原效果。

## 9. Ability Definition 与施法生命周期

### 9.1 统一能力模型

武器、法术、职业特性、怪物动作、物件能力和环境危险都引用 `SPEC 0006` 已注册的版本化 AbilityDefinition，并通过同一个 `step` 结算。定义至少能够表达：

- 使用者、使用时点和 action/bonus action/reaction/movement 成本；
- 次数、充能、法术位、材料和其他资源；
- 目标、范围、区域、视线、清晰路径和封闭选择；
- 攻击、检定、豁免、派生值和优势/劣势；
- 伤害、治疗、临时 HP、移动、资源和效果；
- 持续、专注、重复豁免、触发和终止条件。

调用者只选择有权选择的目标、路径、区域原点/方向及定义允许的封闭选项。私有 MechanicOp、效果编译和 fold 仍是 Rules Module Implementation，不能从包入口导出，也不接受任意脚本、字段路径或状态补丁。

### 9.2 施法验证

施法必须验证：

- 已知/准备状态、法术来源和正确 Spellcasting Profile；
- 施法时间、动作授予和本回合施法账本；
- 法术位、次数、有价/消耗材料和成分；
- 当前状态是否允许言语、姿势和材料成分；
- 目标、射程、视线、清晰路径、区域和 Geometry Profile；
- 法术攻击、豁免 DC、持续和专注。

普通一动作、附赠动作或反应法术在合法开始施放时承诺动作和法术位；之后被 Counterspell 取消效果不返还。

### 9.3 2014 附赠动作法术限制

本回合一旦施放附赠动作法术，其他法术只能是施法时间为一个动作的戏法；先施放不符合该条件的法术也会阻止随后施放附赠动作法术。额外动作不能绕过该限制。

没有施放附赠动作法术时，2014 不存在“每回合只能消耗一个法术位”的通则；Action Surge 可以允许同回合施放两个施法时间为一个动作的非戏法法术，只要其他条件合法。

### 9.4 长施法、仪式和区域法术

施法时间长于一个动作的法术复用 `SPEC 0004` Activity：每回合投入动作并维持专注，完成时才消耗适用法术位；完成前中断使法术失败但不消耗该法术位。合法 ritual 在通常施法时间上增加十分钟，完成时不消耗法术位。

区域法术的受影响实体由 Geometry Profile 计算。同一个法术同时对多个目标造成伤害时，共享一次伤害骰；每个目标独立豁免并分别应用防御。能力明文要求独立攻击或独立伤害时才分别请求骰面。普通豁免的自然 20 不自动成功。

## 10. Effect、有效值与专注

### 10.1 EffectInstance

每个持续效果必须保存来源能力、来源实体、目标/区域、Profile/定义版本、开始时点、相位/时间到期、专注者、叠加规则、可见性和机械标签。

效果不能只存在于旁白字符串。AC、速度、感官、优势/劣势、攻击、豁免、免疫、抗性、易伤和资源的投影与机械必须读取同一有效值派生来源；不存在“页面 AC”和“命中 AC”两份真相。

### 10.2 专注

一个实体同一时刻只能专注一个效果，并可随时、无需动作主动结束专注。开始施放新的专注法术时，旧专注立即结束；新法术随后被反制也不会恢复旧效果。

每个独立伤害来源分别触发一次专注体质豁免，DC 为 `max(10, floor(damageTaken / 2))`。`damageTaken` 是免疫、抗性、易伤和其他减免后、分配给临时 HP 或 HP 前的该来源伤害；完全降为 0 时不触发。临时 HP 吸收伤害不取消已经发生的专注豁免。

失能或死亡结束专注。浪涛等环境扰动由 KP 在骰前冻结，默认触发 DC 10 体质豁免；只有能力明文允许时才直接结束专注。

## 11. Damage Packet 与结算顺序

一个 DamagePacket 对应一次机械伤害来源，可以包含多个伤害类型分量。一次攻击的多种伤害位于同一包；两次箭击、独立射线或不同时点持续伤害分别形成多个包，以保留反应、专注和 0 HP 触发次数。

结算固定顺序：

1. 固定命中、豁免或其他成立条件；
2. 按 `SPEC 0003` 请求并提交该包需要的伤害骰和暴击附加骰；
3. 对每个伤害分量先应用其他加减修正；免疫归零，否则同类抗性无论来源只减半一次，再让同类易伤无论来源只加倍一次，每次除法向下取整；
4. 合计得到该来源的 `damageTaken`；
5. 先扣临时 HP，再扣真实 HP，得到暂定 0 HP 结果，但尚不提交死亡；
6. 若近战攻击会把目标从正 HP 降到 0，打开攻击者专属非致命选择；
7. 按选择提交临时 HP、HP、0 HP、巨量伤害、昏迷、稳定或死亡；
8. 对该来源结算专注、0 HP 受伤、状态及其他伤害后触发；
9. 打开仍合法的后续窗口，再恢复原结算。

临时 HP 不叠加、不是治疗，也不因为吸收全部伤害而抹除已经发生的伤害来源。攻击自然 1/20 和暴击语义不能用于普通检定或豁免；暴击只增加明文伤害骰，不把固定加值翻倍。

## 12. 0 HP、死亡与非致命击倒

### 12.1 玩家角色和 deathSaves 实体

Profile 必须表达：

- 降到 0 HP、昏迷、稳定、恢复 HP 和死亡；
- 0 HP 受伤造成一次死亡豁免失败，暴击造成两次；
- 降至 0 后单次剩余伤害达到最大 HP 时立即死亡；
- 自己回合开始进行死亡豁免；三次成功稳定，三次失败死亡；
- 自然 1 计两次失败；自然 20 立即恢复 1 HP；
- 恢复 HP 或稳定重置累计成功与失败；
- DC 10 Wisdom (Medicine) 动作稳定 0 HP 生物；
- 稳定后再次受伤失去稳定；未治疗稳定实体在权威 `1d4` 小时后恢复 1 HP；
- 临时 HP 不恢复意识、真实 HP 或稳定状态。

稳定、死亡和 Encounter 结束不会自动清除位置、物品、知识、关系、伤势或仍应存在的世界效果。

### 12.2 NPC deathPolicy

每个 NPC/生物在死亡结果可知前已经固化 `deathPolicy`。普通 NPC 可以在 0 HP 死亡，重要 NPC 可以使用死亡豁免；KP 不能看见伤害、剧情价值或玩家选择后临时改变策略。

### 12.3 非致命击倒产品裁定

2014 允许近战攻击者在把目标降到 0 HP 的瞬间选择击昏。`damage-death-srd51-2014-v1` 明确采用以下版本化产品裁定：

- 只有近战攻击把目标从正 HP 降到 0 时提供选择；远程攻击和仅要求豁免的效果不提供；
- 选择窗口位于 0 HP/巨量伤害/NPC deathPolicy 提交前；
- 选择非致命后目标昏迷且稳定，即使剩余伤害达到其最大 HP，也不按本次伤害立即死亡；
- 选择、骰面和结果成为事件，重试和 replay 得到同一结果。

该优先级是对 SRD 未明确组合顺序的产品裁定，不是 2024 规则，也不能由 KP 在看见结果后改变。

## 13. 非歼灭结束与长期后果

“只剩一个存活阵营”只产生 Ending Candidate，不是唯一条件。Encounter 可以因以下事实停止使用先攻：

- 所有仍敌对实体死亡、失能、无法继续或已经离开；
- NPC 投降且每个相关玩家角色明确接受停止冲突；
- 玩家角色完成逃离；
- 各方接受停战、谈判或其他停止敌对结果；
- Encounter 目标完成且没有实体选择继续机械冲突；
- KP 依据已固化事实提议当前机械冲突已不需要先攻顺序。

玩家分别决定自己的角色是否投降、接受条件、停止追击或继续合法攻击；KP 决定 NPC/世界是否继续敌对。NPC 投降后玩家拒绝接受时，系统不能替玩家停手：未结束 Encounter 继续按新意图结算；已经合法结束后再次攻击则建立引用旧结果的新 Encounter。

结束提案只是一种战斗 Rules Input。`step` 必须验证：

- 没有未结清的伤害、移动、死亡、强制效果或自动继续；
- 没有尚待相应控制者回答的战斗选择；
- 退出者、俘虏、尸体、位置、装备、资源和持续效果已经成为事实；
- 结束不会清除或回滚任何合法后果；
- 未到期相位效果已经按 Combat Time Profile 转换。

Encounter 结束必须保留 HP、伤势、死亡/稳定、法术位、职业资源、弹药、物件、位置、俘虏、尸体、知识、关系、承诺、敌对关系、动态定义和持续效果，并按 `SPEC 0008` 跨场景/章节继续。

Encounter 结束不等于故事结束。它可以向 `SPEC 0009` 提供 Ending Candidate，但不能自动提交 Story/Chapter/Campaign conclusion。之后重新爆发敌对建立新的 Encounter，不能静默重新打开旧 Encounter。

## 14. 主要战斗事件

事件名称可以在实现中调整，但以下语义必须由 `step` 产生并可由 `replay` 重建：

- `EncounterStarted` / `CombatantJoined` / `CombatantDeparted` / `EncounterConcluded`；
- `HostilityChanged`；
- `SurpriseDetermined` / `InitiativeRequested` / `InitiativeEstablished` / `InitiativeTieOrdered`；
- `RoundStarted` / `TurnStarted` / `TurnEnded` / `RoundEnded`；
- `ActionGrantCreated` / `ActionGrantSpent` / `MovementSegmentCommitted`；
- `ReactionOpportunityOpened` / `ReactionAnswered` / `TriggerInvalidated`；
- `AbilityInvoked` / `SpellCastingStarted` / `SpellCountered` / `SpellResolved`；
- `EffectApplied` / `EffectEnded` / `ConcentrationStarted` / `ConcentrationEnded`；
- `DamagePacketResolved` / `TemporaryHpChanged` / `HitPointsChanged`；
- `KnockOutChoiceOpened` / `CreatureStabilized` / `DeathSaveResolved` / `CreatureDied`；
- `CombatPhaseAnchorScheduled` / `CombatPhaseAnchorExpired`。

这些事件使用 `SPEC 0003` 的同一连续房间序列、Receipt、作用域证明和回放，不建立战斗事件库或独立日志。

## 15. B 条款处置与验收场景

所有测试必须在责任 Interface 上建立真实状态：玩家/NPC 选择经 Room Action，机械经 `step`，观察经 `project`，回放经 `replay`。不得直接修改 EncounterState、骰面、窗口、HP、位置或内部事件伪造成功。

| 原条款 | 处置 | 战斗验收场景 |
| --- | --- | --- |
| B07 | 保留 | 三个以上阵营以不同敌对关系开战，一方中途停战；关系变化可回放，非玩家实体不被合并为同一敌方。 |
| B08 | 保留并绑定 Geometry Profile | 区域调用者只给原点/方向/尺寸，Rules 计算全部受影响实体，不可漏选或额外选择。 |
| B09 | 保留 | 多段自主移动在实际离开触及前打开借机攻击；反应改变速度/位置后剩余路径不提交并交回控制者。 |
| B10 | 保留 | 传送或不使用目标自身移动/动作/反应的强制移动离开触及，不打开借机攻击。 |
| B11 | 保留 | Extra Attack 角色攻击、移动、换目标、再攻击；每段可暂停，不能把许可泛化给所有多射线法术。 |
| B12 | 保留 | Action Surge 与 haste 分别产生普通/受限 grant；haste Attack 只有一次武器攻击，且不刷新附赠/反应/免费互动。 |
| B13 | 保留 | Shield 在命中后伤害前或成为 magic missile 目标时打开私人窗口，重新判断触发攻击并正确持续。 |
| B14 | 保留 | 看见 60 尺内施法才可 Counterspell；等级比较、属性检定、嵌套和不返还资源均符合 2014。 |
| B15 | 保留 | Ready 冻结可感知触发；触发后可用反应或放弃；预备法术在预备时耗位并专注。 |
| B16 | 拆出 | 断线与窗口恢复完全由 SPEC 0003/0010/0011 验收，本规格不复制。 |
| B17 | 保留 | 不同施法顺序都服从 2014 bonus-action spell 限制；无附赠动作法术时 Action Surge 可施放两个一动作非戏法。 |
| B18 | 保留 | Shield 等 AC 效果让投影和全部攻击路径读取同一有效 AC。 |
| B19 | 保留 | 一个/多个伤害来源、临时 HP、专注替换、主动结束及环境 DC 10 分别产生正确专注次数和结果。 |
| B20 | 保留 | 混合类型先处理其他修正，再单次抗性/易伤、临时 HP 和 HP；取整与 replay 一致。 |
| B21 | 保留 | 覆盖巨量伤害、0 HP 受伤、死亡豁免、自然 1/20、Medicine、稳定后受伤、1d4 小时恢复、治疗和临时 HP。 |
| B22 | 修订后保留 | 近战非致命窗口在死亡提交前；选择后即使满足巨量伤害也稳定昏迷；NPC deathPolicy 事前固化。 |
| B29 | 保留战斗段 | 投降接受或完成逃离后，在所有帧/窗口结清才结束；相位锚点转换且长期后果保留。 |
| B30 | 保留战斗段 | 玩家拒绝接受投降时系统不代停；按新意图继续旧 Encounter 或建立后续 Encounter。 |
| B35 | 保留 | 同一隐藏者可只突袭一个角色；首回合限制、反应恢复、Dex 先攻、共享组和平手权符合 2014。 |
| B36 | 保留 | Extra Attack 可分别 Grapple/Shove；目标选 Athletics/Acrobatics 对抗，不生成 2024 豁免。 |
| B37 | 保留 | 同一法术多目标共享明文伤害骰，各目标独立豁免/防御；自然 20 豁免不自动成功。 |
| B38 | 保留战斗段 | 长施法逐回合投入动作并专注，中断不耗位、完成才耗位；ritual 加十分钟不耗位，普通反制不返还。 |
| B39 | 保留并绑定 Geometry Profile | 精确范围边界、掩护、挤入、墙前区域原点、普通区域阻挡和绕角特例全部通过 conformance table。 |
| B40 | 保留 | 突袭、bonus-action spell、Grapple/Shove、Hide、疲乏和自愿失败豁免均拒绝 2024 污染。 |
| B49 | 修订后保留 | 两个控制者同因果点触发；排序不依赖网络/遍历，前项使后项失效时无成本关闭，重连/replay 顺序一致。 |
| B53 | 保留战斗垂直段 | 自然语言意图经 Room Action 进入多人 Encounter，覆盖动态环境引用、移动中断、玩家反应、NPC 提案、伤害/专注、非歼灭结束和长期后果；通用秘密/恢复由上位规格断言。 |

截至 2026-08-27，B 表责任已经由下列公开 Interface 测试建立定向映射；这里记录的是当前工作树已经运行通过的切片，不替代冻结源码上的全量门：

| 条款 | 责任测试映射 | 当前定向证据 |
| --- | --- | --- |
| B07 | `tests/combat-hostility-v2.test.mjs` | 2/2；三阵营敌对候选、事件化停战及 `project/replay`。 |
| B08–B10、B39 | `tests/combat-mechanics-v2.test.mjs`、`tests/chandelier-environment-rules-v3.test.mjs`、`tests/privacy-bypass-v2.test.mjs` | Geometry 的范围/区域/移动/中断与隐藏空间安全错误已通过公开 `step/project/replay` 定向场景。 |
| B11、B12、B17、B35–B37、B40 | `tests/combat-mechanics-v2.test.mjs` | grant、逐实体突袭、2014 Grapple/Shove、多目标结算与 2024 护栏纳入当前 45/45 组合。 |
| B13–B15、B18–B22、B29–B30 | `tests/combat-mechanics-v2.test.mjs` | 私人反应、伤害/专注/死亡、非致命和全体存活玩家结束同意纳入同一 45/45 组合。 |
| B38 | `tests/combat-long-casting-v2.test.mjs` | 8/8；长施法逐轮投入、中断、仪式与完成后反制。 |
| B49 | `tests/runtime-trigger-time-v2.test.mjs` | 同因果触发排序、失效、掉线保持与 replay 的定向组合已通过。 |
| B16（以及上位规格中的 B27/B50 恢复责任） | `tests/randomness-recovery-v2.test.ts`、`tests/contest-room-randomness-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/observer-projection-v2.test.mjs`、`tests/observer-delivery-v2.test.ts`、`tests/room-retry-v2.test.ts` | 恢复、观察者专属投影、增量归档和幂等重试走通用 Room Authority，没有战斗副本；最终随机/恢复/对抗组合 24/24、retry 3/3、archive resume 2/2 已记录通过。 |
| B53 | `tests/combat-vertical-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts` | 1/1 垂直段、11/11 Room 战斗随机/恢复和 3/3 战斗归档/更正切片已记录通过；与通用随机/对抗组合合计 24/24。 |

## 16. 自主裁定记录

以下裁定已回填当前定向证据；生产源码尚未冻结，最终 `module:check`、`typecheck`、`lint`、`npm test` 与部署门仍待执行，因此不据此宣称本规格已经完成。

### COM-D001：战斗的 Module seam

- 日期：2026-08-26
- 问题：战斗应拥有独立 Coordinator/Interface，还是作为 Rules Module 的内部机械。
- 来源类别：Goal 明确架构 + `SPEC 0001/0003` + Agent 自主组织裁定。
- 关联 `SPEC 0001`：§2 权威分配、§14 NPC 权限、§19 标准 KP 循环；验收 A、D、K、M。
- 候选方案：独立 CombatCoordinator；战斗独立公共 Module；Rules Module 内部 Encounter Implementation。
- 最终选择：战斗完全位于 Rules Module Implementation，只通过 `step/project/replay`；外层只存在 Room Action Module。
- 理由：同一自由意图可在非战斗与战斗间切换，独立协调器会复制身份、随机、待决、投影和恢复。
- 玩家可观察行为：玩家始终自由输入意图，进入战斗不会切换到另一套权威或让系统替其选择。
- 秘密与权限影响：控制权和私人窗口继续由统一 Viewer/Room Authority 保护；战斗包无 Principal 入口。
- 迁移/可逆性：旧战斗路径仅在 Legacy ruleset 后；新路径不能回退到 D1/页面 Coordinator。改变 seam 需新架构规格。
- 验收场景：B07–B15、B17–B22、B29–B30、B35–B40、B49、B53 的所有跨层入口检查；B16 只验证通用恢复引用没有被战斗层复制。
- 测试证据：B 表映射中的 Rules 测试已建立机械切片；`tests/combat-vertical-v2.test.ts` 1/1 还贯通自然语言 Room Action、动态 Encounter、伤害/专注多波随机、私人反应重连、逐玩家结束同意和长期后果。冻结全量门仍待执行。

### COM-D002：唯一二维 Geometry Profile

- 日期：2026-08-26
- 问题：数字战场采用距离段、多套坐标还是一个版本化二维规范空间。
- 来源类别：Goal 单一权威要求 + `SPEC 0002` 迁移证据 + Agent 自主机械裁定。
- 关联 `SPEC 0001`：§6 公正、§8 敌人/危险、§10 危险兑现；验收 C、D、G。
- 候选方案：抽象距离段；页面/服务端双坐标；一个二维+独立高度 Geometry Profile。
- 最终选择：每 Encounter 一个 `geometry-2d-feet-2014-v1` 引用；范围、路径、区域、掩护和占位全部由该 Profile 计算。
- 理由：准确反应和区域必须共享同一位置事实；双表示会造成目标与命中分歧。
- 玩家可观察行为：边界、掩护、强制移动、区域和中断在重试/replay 中一致；玩家仍可自然语言描述位置。
- 秘密与权限影响：隐藏位置只存在权威状态并经 0010 投影；候选/错误不泄漏坐标。
- 迁移/可逆性：旧全员零距离/距离段房间留在 Legacy Profile；没有确定映射不迁移。新算法必须新 Profile/hash。
- 验收场景：B08–B10、B39。
- 测试证据：`tests/combat-mechanics-v2.test.mjs`、`tests/chandelier-environment-rules-v3.test.mjs` 与 `tests/privacy-bypass-v2.test.mjs` 已从公开 Interface 建立 G01–G15/战斗空间定向证据；当前相关组合已记录通过，冻结全量门仍待执行。

### COM-D003：同时触发的确定排序

- 日期：2026-08-26
- 问题：不同控制者同时获得合法反应时如何排序。
- 来源类别：Goal 可恢复/公平要求 + `SPEC 0003/0007` + Agent 自主产品裁定。
- 关联 `SPEC 0001`：§6 公正、§14 NPC 行为、§15 玩家能动性；验收 K、M。
- 候选方案：网络先到先得；统一 LIFO；规则明文优先、其余按冻结先攻轮转并由各控制者排序自身触发。
- 最终选择：`trigger-initiative-order-2014-v1` 的五步排序，收集于同一冻结因果点，逐个私人窗口重验。
- 理由：与网络无关、可回放，并保留每个玩家只排序自己选择的权力。
- 玩家可观察行为：交换请求顺序、断线或重启不会改变窗口先后；失效后项不消耗资源。
- 秘密与权限影响：未轮到的私人选项不提前公开；KP 只为其 NPC/世界触发排序。
- 迁移/可逆性：排序写入 Profile/hash 和事件；改变需新规则版本，旧 Encounter 不重排。
- 验收场景：B09、B13–B15、B49。
- 测试证据：`tests/runtime-trigger-time-v2.test.mjs` 已记录通过 T01–T07 的排序、私人窗口、失效与 replay 切片；`tests/combat-mechanics-v2.test.mjs` 和 B53 Room 垂直段补充战斗反应/重连证据。冻结全量门仍待执行。

### COM-D004：非致命击倒与巨量伤害顺序

- 日期：2026-08-26
- 问题：同一近战攻击同时满足非致命选择与巨量伤害即死时的顺序。
- 来源类别：D&D 5e 2014/SRD 5.1 未明确组合顺序 + Goal 自主裁定授权。
- 关联 `SPEC 0001`：§6 骰前公正、§10 完整兑现、§14 NPC 权限；验收 C、G。
- 候选方案：先巨量伤害直接死亡；达到巨量伤害时禁止非致命；先向攻击者提供 2014 非致命选择。
- 最终选择：近战攻击者的非致命选择先于巨量伤害和 NPC deathPolicy 提交；选择后目标稳定昏迷。
- 理由：保留 2014 明确授予攻击者的即时选择，且在结果可知前由有权主体决定，不让 KP 事后保护/处决。
- 玩家可观察行为：合资格近战攻击在 0 HP 提交前出现选择；远程/豁免效果没有该选择。
- 秘密与权限影响：只有攻击控制者看到/回答；NPC 选择由有限知识 KP，死亡策略事前固化。
- 迁移/可逆性：绑定 `damage-death-srd51-2014-v1`；改变需新 Profile，旧事件按原顺序回放。
- 验收场景：B21、B22。
- 测试证据：`tests/combat-mechanics-v2.test.mjs` 当前 45/45 中包含巨量伤害、普通/重要 NPC、控制者私有非致命选择、死亡豁免、稳定恢复与 replay；冻结全量门仍待执行。

### COM-D005：非歼灭结束与相位转换

- 日期：2026-08-26
- 问题：Encounter 是否只能全灭结束，以及中途结束时回合锚点和长期状态如何处理。
- 来源类别：`SPEC 0001` 开放结果/长期连续性 + `SPEC 0007/0008/0009` + Agent 自主协议裁定。
- 关联 `SPEC 0001`：§13 有意义结果、§16 连续性、§18 收束；验收 I、O。
- 候选方案：最后存活阵营自动结束并清战斗状态；KP 无验证直接结束；事实依据提案且结清机械后结束。
- 最终选择：投降、逃离、停战、目标完成等可结束；`step` 验证无未结算项，转相位锚点并保留全部后果。
- 理由：战斗顺序可以结束而冲突后果继续存在；自动全灭既替玩家决定，也会丢失持续状态。
- 玩家可观察行为：可以接受/拒绝投降、逃跑或谈判；结束后伤势、资源、俘虏和效果进入后续场景。
- 秘密与权限影响：玩家分别决定自己的角色，KP 决定 NPC；结束候选不公开无权秘密。
- 迁移/可逆性：Encounter 一旦结束不可静默重开；再次敌对建立新 ID。相位转换事件可审计且回放一次。
- 验收场景：B29、B30、B53 战斗段。
- 测试证据：`tests/combat-mechanics-v2.test.mjs` 已覆盖投降、逃离、拒绝、未结算项阻断与相位转换；`tests/combat-vertical-v2.test.ts` 1/1 证明多人 Room 结束同意及长期状态保留。冻结全量门仍待执行。

## 17. 实现映射

| 责任 | 目标实现位置 | Interface/测试要求 |
| --- | --- | --- |
| Rules Module 唯一入口 | `app/_runtime/lib/rules/index.ts` | 只导出 `step/project/replay` |
| Encounter、先攻、回合和 grants | `app/_runtime/lib/rules/v2/combat-model.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/combat-events.ts` | 经 `step` 行为测试，不直接改状态 |
| Geometry Profile 与空间 | `app/_runtime/lib/rules/profiles/combat-geometry.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/spatial-visibility.ts` | B08/B39 conformance + replay |
| 结算层、移动和反应时点 | `app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/profiles/trigger-ordering.ts` | 仅私有 Implementation，不导出帧/队列 |
| Ability/Spell 编译与调用 | `app/_runtime/lib/rules/profiles/ability-compiler.ts`、`app/_runtime/lib/rules/v2/character-abilities.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts` | 引用已注册定义，不建平行 spell engine |
| Effect、伤害、专注和死亡 | `app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/combat-events.ts`、`app/_runtime/lib/rules/v2/damage.ts` | 同一有效值来源，确定 replay |
| 通用行动编排 | `app/_runtime/lib/room/action.ts` | 不新增 CombatCoordinator；只交 Rules Input |
| Room Authority | `app/_runtime/lib/room/durable-object.ts` | 随机、Receipt、待决、恢复均按 0003/0011 |
| 页面和语音 | `app/_runtime/components/play-table.tsx` 及现有语音 Adapter | 只提交 intent/answer、显示 0010 Read Model |
| 行为验收 | `tests/combat-mechanics-v2.test.mjs`、`tests/combat-hostility-v2.test.mjs`、`tests/combat-long-casting-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs`、`tests/combat-vertical-v2.test.ts`、`tests/combat-room-randomness-v2.test.ts`、`tests/randomness-recovery-v2.test.ts`、`tests/contest-room-randomness-v2.test.ts`、`tests/room-retry-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts` | B 表逐项映射，跨层走真实 seam |

新 Rules 包入口不得导出 fold/applyEvents、内部结算帧、MechanicOp、随机实现、有效值捷径或战斗状态补丁。旧战斗实现只可在明确 Legacy ruleset 分派后调用。

## 18. 五项交叉审查

### 18.1 跨规格矛盾审查

- `SPEC 0001`：玩家选择、KP/NPC 意图、危险公正、死亡兑现和长期连续性完整保留。
- `SPEC 0003`：战斗只作为一种 Rules Input/Implementation，不复制事务、随机、Receipt、恢复或 Outcome。
- `SPEC 0006/0007`：NPC 选择来自有限知识，控制权/窗口/虚构时间仍由通用规格拥有。
- `SPEC 0008/0009`：Encounter 结束保留长期后果且不自动等于故事收束。
- 结论：未发现需要修改 `SPEC 0001` 的冲突；原 `SPEC 0002` 的通用条款不再由战斗规格拥有。

### 18.2 权限审查

- Combatant 控制者只引用权威 CharacterControl/KP 控制事实，不能来自战斗请求体。
- 玩家只选择自己的目标、路径、反应、非致命、平手和是否停止；KP 只选择 NPC/世界。
- Rules Module 自动计算区域、合法性和强制效果，但不作可选战术决定。
- 结论：房主、队长、页面、模型和战斗 Implementation 均不能扩大控制权。

### 18.3 秘密审查

- 隐藏位置、未发现实体、秘密能力、NPC deathPolicy 和私人窗口统一由 `SPEC 0010 project` 保护。
- 战斗错误、候选、区域实际集合和反应排序不能旁路 projector。
- NPC 决策只使用 `SPEC 0006` 的 NPC Viewer，不能读取 KP 全知投影。
- 结论：本规格定义机械字段但不建立第二套字段脱敏或客户端战斗日志。

### 18.4 版本审查

- ruleset、事件 schema、Combat/Geometry/Trigger/Time/Ability/DamageDeath Profile 和动态定义全部哈希绑定。
- 2014 护栏阻止 2024/5.5e 混入；产品裁定明确标注。
- 前 0.4 房间、旧坐标和旧战斗事件直接拒绝进入当前解释器；不注册 Legacy Adapter，也不提供 migration 或 fallback。
- 结论：相同事件流不会因新目录、几何或伤害算法得到新解释。

### 18.5 第二权威审查

- 机械变化只来自 `step`，观察只来自 `project`，回放只来自 `replay`。
- Room DO 是活跃 Encounter/事件/待决唯一权威；D1 不保存活跃战斗镜像。
- 页面、Room Action、AI/NPC Adapter、Ability 目录和 Geometry Adapter 都不能掷骰或提交状态补丁。
- 没有 CombatCoordinator、独立 Encounter DO、独立 spell/damage engine 或独立战斗事件库。
- 结论：纯战斗 Implementation 位于一个深 Rules Module 内，删除该 Module 后复杂度不会散落到多个调用者。

## 19. 实施完成门

本规格只有在以下证据全部成立时才算实现完成：

- B07–B15、B17–B22、B29–B30、B35–B40、B49、B53 战斗段全部在表列责任 Interface 通过；B16 由 `SPEC 0003/0010/0011` 的恢复验收证明且战斗层没有副本；
- Geometry/Trigger/Time/Ability/DamageDeath Profile 均有固定 hash 和 conformance 测试；
- 代表性 Encounter 可以从建立运行到投降、逃离、胜利、非致命或死亡，并保留全部长期后果；
- 移动、反应、施法、伤害、专注和死亡在断线/重启后不重复，且 replay 状态相同；
- 玩家、NPC、KP 和无权观察者投影证明秘密没有从战斗字段、错误、候选或窗口侧漏；
- 新生产路径不存在 CombatCoordinator、D1 活跃战斗状态、客户端骰面/区域选人、自动 NPC 目标或平行 spell/damage engine；
- 旧 `ruleset_version` 回放不变，新事件不能被错误 Profile 解释；
- 验收和实现证据回填总追踪矩阵与决策记录；未执行项不得写成已验证。
