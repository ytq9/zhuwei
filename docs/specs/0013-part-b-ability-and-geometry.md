---
kind: part
part_of: "0013"
title: "SPEC 0013 分册：AbilityDefinition 与战场几何 Profile"
clauses: "4-6"
---
# SPEC 0013 分册：AbilityDefinition 与战场几何 Profile

本文件是 [SPEC 0013](./0013-versioned-runtime-profiles.md) 的 §4–§6，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 4. AbilityDefinition 与受限 MechanicOp Compiler Profile

### 4.1 AbilityDefinition

`ability-srd51-2014-v2` 统一编译武器、法术、职业特性、怪物动作、物品能力和环境危险。规范定义至少包含：

- 稳定 definition id、revision、来源和 `rulesBasis`；
- 使用者/控制权要求、合法时点与 activation；
- 动作授予、附赠动作、反应、移动、次数、充能、法术位、材料、物件或其他成本；
- 目标 schema、数量、范围、区域、视线、清晰路径、体型与关系约束；
- 调用者有权选择的封闭选项；未授权或未选择项不能用数组第一项补齐；
- 攻击、检定、豁免、优势/劣势、派生值和随机式；
- 伤害、治疗、临时 HP、位置、资源、物件和 Effect 变化；
- 持续、专注、重复豁免、触发点、终止、叠加和可见性；
- 公开说明、秘密机械字段和裁定来源。自由说明文字本身不能执行机械。

`rulesBasis` 只允许 `srd5.1-2014` 或带已注册 ProfileRef 的 `zhuwei-product-ruling`。`dnd2024`、`5.5e`、`latest` 和无来源混合定义拒绝。

### 4.2 受限表达式

数值表达式只允许：常量、已声明的 self/target stat、熟练加值、等级/法术位等级、已提交资源、当前 resolution 值，以及 `add/subtract/multiply/floorDivide/min/max/clamp`。条件只允许封闭的比较、tag、Effect、资源、关系、距离、视线、时间与已提交事实谓词。

骰式不是普通表达式节点，而是产生 `RandomnessRequest` 的显式节点。表达式不能读取任意字段路径、枚举全世界后挑最低 HP/最近目标、访问 Prompt/系统时间/网络、循环、递归、执行脚本或调用外部函数。

### 4.3 私有 MechanicOp 集

编译器只可产生以下有类型的 op 家族；具体 discriminant 与字段属于 Rules Implementation：

| Op 家族 | 允许行为 | 禁止行为 |
| --- | --- | --- |
| Guard | 验证控制权引用、时点、资源、目标、距离、状态和定义前提 | 写状态、把秘密诊断直接返回玩家 |
| Choice | 打开属于正确控制者的封闭 Pending Input | 默认第一项、最低 HP、最近目标、超时自动选择 |
| Cost/Grant | 预留或消耗动作授予、法术位、次数、材料和资源 | 与效果分成非原子第二次写入 |
| Random | 请求攻击、检定、豁免、伤害等权威随机 | 接受调用者骰面、在编译或 replay 中掷骰 |
| Damage/Recovery | 伤害包、治疗、临时 HP、稳定和已定义死亡管线输入 | 直接改 HP 字段或跳过触发闭包 |
| Effect | 建立/终止 Effect、专注、状态和重复豁免 | 任意 tag 脚本或未注册规则回调 |
| Spatial | 路径移动、强制移动、传送、坠落和区域放置 | 调用者提交区域受影响者集合 |
| Item/Resource | 取得、转移、消耗、损坏和恢复已定义物品与资源 | 任意库存 patch 或 D1 同步作为提交 |
| Entity/Encounter | 从已注册定义实体化、加入/离开遭遇、改变已提交敌对关系 | 自动创造战术目标或自动接受投降 |
| Activity/Time | 开始、中断、完成 Activity 或建立到期任务 | 现实超时推进、未完成先落效果 |
| Evidence/Knowledge | 引用已固化证据产生有来源知识事件 | 把角色推断提升为隐藏真相 |
| Trigger | 注册已定义触发和准确时点 | 动态 `eval`、网络先到先得或无界递归 |

不存在 `set(path, value)`、`mergeState`、JSON Patch、SQL、回调函数名、任意事件 payload 或通用 `emit` op。新增 op 家族会改变可表达机械，必须使用新 Compiler、Ruleset 与 EventSchema Profile。

### 4.4 编译流程与限制

编译固定为：规范化 → schema 验证 → 引用解析 → 2014 护栏 → 权限/秘密标注 → 有限图编译 → 终止与成本检查 → stable op id 分配 → compiled hash。stable op id 从 `definitionHash + 规范节点路径` 派生，不能来自对象遍历或随机 UUID。

首个 Profile 的定义复杂度上限固定为：规范字节 65,536；resolution 节点 256；单个封闭选择分支 32；单表达式节点 128；静态触发边 64；嵌套结算深度 32；单骰式 terms 32、每 term 最多 1,000 颗骰。超限返回 `definitionComplexityExceeded` 和可修订诊断，不把“太强”当作理由，也不自动降数值。运行时实体/区域集合使用 Durable continuation 分段工作，不因对象数量改变集合或顺序。

编译器必须拒绝循环触发图、可绕过定义中已声明必付成本而到达效果的非法路径、未绑定 choice、未注册引用、越权 viewer 字段和不受支持的 2024 词义。没有成本的合法能力不因此被拒绝。合法的高 AC、高 HP、高伤害或致死危险不能按队伍等级、当前 HP 或期望胜率缩放。

调用者只能提交 `MechanicalProposal` 或已注册 `AbilityRef` 及自己有权选择的参数。`DefinitionRegistered` 由 Rules Module 生成规范定义与编译图事件；普通客户端、LLM、Room Action 和 D1 无权上传 compiled graph 或 `MechanicOp[]`。

## 5. BattlefieldGeometry Profile

### 5.1 坐标、精度与规范空间

`geometry-2d-feet-2014-v1` 使用局部二维水平坐标 `x/y` 和独立 `elevation/height`。产品与规则文字以尺展示；权威基础单位为 **1 英寸，即 1/12 尺**：

- 基础坐标和尺寸是带符号整数英寸，事件中使用规范十进制字符串；输入不能静默舍入到一英寸。
- 基础坐标限制在有符号 32 位英寸范围，平方、点积和交点使用 BigInt/精确有理数，不能使用浮点近似决定边界。
- 派生交点使用约分后的 `numerator/denominator` 英寸；分母恒正、零只写 `0/1`。
- 位置、路径、屏障和区域均属于 Room DO WorldState；页面坐标和自然语言只是提案。
- 范围或区域边界包含；超出一英寸最小输入精度即不在边界内。

地形水平轮廓是无自交简单多边形，顶点按固定绕向并从字典序最小顶点开始规范化；屏障是轮廓加 `[elevation, elevation + height]` 的棱柱。相邻占位只接触边界不算重叠；正体积内部相交才构成碰撞。

### 5.2 体型与占位

默认方形 footprint 为：Tiny 30 英寸、Small/Medium 60、Large 120、Huge 180、Gargantuan 至少 240。Gargantuan 或非方形实体可以在定义中给出更大宽/深。每个实体还必须有 body height；缺省等于 footprint 最大边，这是数字产品默认值而非 SRD 生物真实身高。

实体 occupancy 是以 `x/y` 中心、`elevation` 为底的轴对齐棱柱。体型空间用于碰撞、区域和掩护，不把实体缩成点。

- 实体不能自愿结束于其他实体或不可通行实体的正体积占位内。
- 穿过可穿越生物空间时该段视为困难地形。
- 穿过敌对生物空间还要求移动者至少比对方大两个体型等级或小两个体型等级。
- 挤入只在净空至少容纳小一个体型等级时合法；每移动 1 尺额外花费 1 尺，并应用 `SPEC 0012` 的攻防影响。
- 传送忽略中间路径与移动触发，但目的地仍须合法；强制移动、坠落和穿墙只能由能力明文覆盖相应约束。

### 5.3 距离

每个占位生成一个 **measurement core**：从 footprint 和高度的每个面向内缩 30 英寸；若某维不足 60 英寸，则该维缩到中点。该 core 等价于占位内可用于量距的五尺空间中心集合。

两个实体的机械距离是两个 measurement core 之间的最短三维欧氏距离；实体到点的距离是 core 到该点的最短欧氏距离；点到点使用普通三维欧氏距离。令各轴闭区间间隔为 `dx/dy/dz`，则合法范围 `R` 只比较：

```text
dx² + dy² + dz² <= R²
```

比较使用英寸有理数和 BigInt，不求浮点平方根、不先显示取整。自己到自己距离为零。显示层可以舍入，但显示值不能回流机械。

因此相邻两个 Medium measurement core 相距 60 英寸，即 5 尺；中间隔一个完整 5 尺空间时为 10 尺。斜向使用欧氏距离，不使用页面方格数量或 2024 规则；这是本 Profile 的产品裁定。

### 5.4 路径与移动成本

移动输入是有序三维 waypoint 序列和移动方式。重复点及同方向共线中间点先规范删除；其他 waypoint 保持玩家/KP 冻结顺序。

每段长度以 milli-inch 计算：

```text
segmentMilliInches = ceilIntegerSqrt((dx² + dy² + dz²) * 1_000_000)
```

各段相加后与速度预算的 milli-inch 比较。困难地形、挤入、匍匐、没有对应速度的攀爬/游泳分别是“每 1 尺再花 1 尺”的独立成本来源；多个困难地形来源本身只计一次，不用重复乘法放大。不同移动方式分别记账。

Rules Module 对移动占位做连续 swept-volume 碰撞，并在每个反应、危险、移动方式变化或合法性边界暂停。尚未通过的后续路径不写入事件。增加非共线 waypoint 可以真实增加路径，网络分片和对象遍历不能改变已经规范化的路径成本。

### 5.5 清晰路径、视线与掩护

每个实体定义 sight origin；缺省为 footprint 水平中心、`elevation + 4/5 bodyHeight`。目标占位生成 64 个固定采样点：每个轴取 `1/8、3/8、5/8、7/8`，形成 `4 × 4 × 4` 笛卡尔积。

从 sight origin 到每个采样点作精确线段测试：

- 开线段在到达采样点前与不透明屏障正体积相交，该点为 hard-blocked；只擦碰边界或一个切点不阻挡。
- 与第三方生物占位相交，该点为 soft-blocked；来源和目标自身忽略。
- hard-blocked 64 个点为全掩护，阻止直接指定目标。
- hard-blocked 至少 48 但少于 64 为四分之三掩护。
- hard 与 soft 的并集至少 32 为半掩护；生物 soft cover 单独最多提供半掩护。
- 其他情况无机械掩护。多个掩护不会叠加 AC/豁免数值，只采用该算法得出的最高等级。

半掩护为 AC 与敏捷豁免 +2，四分之三为 +5，全掩护阻止直接目标，遵循 2014 语义。可见性还需要感官、光照、隐藏和角色知识；Geometry 只产生内部空间证据，不能自行向玩家公开隐藏屏障或实体。

### 5.6 区域确定

首个 Profile 支持以下闭合体，边界均包含：

- sphere：三维球，使用点到中心平方距离；
- cylinder：垂直圆柱，分别验证水平半径和高度区间；
- cube：由原点、边长和规范方向基底形成的定向棱柱；
- cone：轴向长度为 `L`、远端直径为 `L` 的直圆锥；用点积与平方不等式判断，不调用浮点三角函数；
- line：长度 `L`、方形截面宽度 `W` 的定向棱柱。

方向由非零整数向量规范为符号与最大公约数约分形式。cube/line 的侧轴由方向与世界 up 向量确定；方向平行 up 时固定使用世界 x 轴作为首侧轴。所有 membership 比较使用点积、平方量和有理数。

区域对每个实体使用 64 个占位采样点再加 occupancy 中心，共 65 点。至少一个点同时满足形状 membership 和传播规则时，该实体受影响；这个固定采样规则是数字产品裁定。实际集合按权威 `entityOrdinal + entityId` 排序，调用者提供的 `targetIds` 对区域集合没有权威性。

传播模式是 Compiler Profile 的封闭枚举：

- `straight`：原点到采样点的开线段不得穿过不透明屏障正体积；
- `aroundCorners`：仅能力明文允许。以 12 英寸立方 voxel 构造形状内自由空间，屏障相交 voxel 不可通行，使用六邻接和固定 `x/y/z` 字典序 BFS；最短传播成本不得超过定义的 spread budget。工作量超出单次 CPU 预算时保存 opaque Durable continuation，不能改变 voxel 集合、顺序或结果。

一般区域不能穿过全掩护。`aroundCorners` 可以绕过有开口的墙角，但封闭屏障没有自由 voxel 通路，因此不能穿透。voxel 映射对负坐标使用数学 floor，不使用语言默认截断。

区域原点先做 clear-path 测试。请求点被屏障挡住时，Profile 使用精确线段/棱柱首次交点，返回来源一侧的规范有理数边界点作为冻结原点；不能由调用者在墙后保留原点，也不能在看见受影响集合后换原点。

## 6. TriggerOrdering Profile

### 6.1 冻结合资格集合

每个准确机械时点建立 `TriggerBatch`。Rules Module 只根据该因果点的提交前状态、已注册定义和 Profile 收集全部合资格项，并冻结：

- `triggerBatchId`、causation event/phase、resolution continuation；
- 每项稳定 `triggerInstanceId`、source、controller、AbilityRef、timing、mandatory/optional、秘密级别；
- Encounter 先攻/平手顺序 hash，或非战斗 `entityOrdinal` 基线；
- 合资格集合规范 hash 和相关 scope proof。

网络到达、对象遍历、模型响应、在线状态和数组插入顺序不能增加、删除或重排该集合。批次打开后新产生的触发属于子 `TriggerBatch`，先完成子批次再恢复父 continuation；不能插入父批次前部。

### 6.2 确定排序

`trigger-initiative-order-2014-v1` 固定：

1. 能力或 2014 规则明文给定先后时，建立显式依赖边并先拓扑排序；循环依赖是机械诊断，不猜顺序。
2. 同一控制者具有多个仍同时且次序可能改变结果的触发时，打开一个该控制者专属排序 Pending Input；已由编译器证明交换律的项可按 stable trigger id 排序而不打扰玩家。
3. Encounter 中不同控制者同时合资格时，从当前回合实体的已提交先攻条目开始，沿冻结先攻/平手顺序循环；当前实体不合资格也不改变起点。
4. 共享先攻组使用 Encounter 开始时已冻结的组内实体顺序。无参战者控制者的环境项排在参战者后，并按 definition id、source entity id、trigger id 排序。
5. Encounter 外先处理直接因果行动者拥有的合资格项，再按实体首次 `EntityMaterialized` 时提交的 `entityOrdinal`、entity id、definition id、trigger id 排序；环境项最后。

`entityOrdinal` 是世界事件分配的稳定序号，不是当前数组位置、显示排序或网络到达时间。同一 genesis 批量实体化时先按规范 entity id 分配。

### 6.3 逐项窗口、失效与嵌套

排序后一次只公开当前控制者有权看到的窗口。响应只在该窗口为当前项时接受；抢先提交后项、替他人回答或复用旧 continuation 均拒绝且不泄漏候选。

每项打开前以父批次冻结引用重新验证当前合法性。前项使后项目标消失、反应已耗、距离改变或触发条件不再成立时，追加 `TriggerInvalidated`，不消耗资源、不自动换目标。掉线、模型失败或现实超时保持当前窗口，不视为放弃。

嵌套反应使用显式父子 resolution stack；不是把所有情况抽象为无条件 LIFO。Compiler 必须证明触发图有限；同一 `(sourceEffect, triggerId, causationId)` 不能在同一因果链重复进入，除非定义具有明确新事件和有限 repeat policy。
