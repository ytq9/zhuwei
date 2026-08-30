# SPEC 0013：版本化运行时 Profiles 与确定性 Conformance

- 状态：**已裁定；0.4 开发重置修订已获用户明确确认**
- 裁定日期：2026-08-26
- 0.4 修订日期：2026-08-31
- 产品：烛帷
- 适用规则：D&D 5e 2014 / SRD 5.1
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0004`、`SPEC 0005`、`SPEC 0006`、`SPEC 0007`、`SPEC 0010`、`SPEC 0011`、`SPEC 0012`
- 取代范围：`SPEC 0002` 第 9、10、14、20.2、23、26 节中尚未裁定的 Profile 精确算法，以及 B39、B49、B52 的 Profile conformance 细节
- 与 `SPEC 0012` 的关系：本规格填充其 `Ruleset manifest`、Geometry、Trigger、Time 与 Ability compiler 占位；不改变其已经裁定的战斗行为

### 0.4 开发重置的取代范围

用户已明确确认当前仍处开发阶段、放弃全部 0.4 以前的房间，并把当前应用版本定义为 `0.4.0`。因此，本规格自本修订起只规范 0.4 新房和当前完整 Profile 闭包；不提供前 0.4 房间、事件、归档、模型、工作流或模组的 Adapter、迁移、恢复与回放承诺。旧引用必须稳定拒绝，不能落入当前解释器。未来兼容策略必须另行裁定，不能从本规格推定。

这项修订只窄取代下列文档中“必须保留、迁移或恢复前 0.4 房间/历史 Adapter”的条款；其机械、权限、秘密、单一权威和 fail-closed 行为继续有效：

| 文档 | 被窄取代的旧房保留范围 |
| --- | --- |
| SPEC 0003 | §15 |
| SPEC 0006 | §2、§9、§12.7、§14 |
| SPEC 0010 | §11、OBS-D001、OBS-D005 的迁移段、§17.4 |
| SPEC 0011 | §3、§7 中的历史恢复要求 |
| SPEC 0012 | §2、COM-D001、COM-D002、§18.4、§19 中的旧规则保留门 |
| SPEC 0014 | §2.1、§10、§13 中的旧环境 Profile 保留要求 |
| SPEC 0015 | §1、§3.3、§16、§19.13 中的“仅新房并保留旧 Adapter”要求 |
| ADR 0006 | 原第 24 行的旧状态迁移要求 |
| ADR 0008 | 原第 15、23、29 行的历史 Profile 保留要求 |
| ADR 0012 | 原第 19、31 行的旧协议保留要求 |
| ADR 0014 | 原第 73、75 行的旧 publication/profile 保留要求 |

## 1. 目的与不变量

本规格把散落在通用事务、战斗、模组、多人和回放规格中的运行时 Profile 收束为一份可实现、可哈希、可注册和可验收的确定性合同。它不重新讨论 `SPEC 0001` 的产品原则，只裁定同一事实如何被同一版本的 Rules Module 稳定解释。

固定不变量如下：

1. 一个运行时 epoch 绑定一个且仅一个 `RuntimeProfileManifest`；同一 epoch 内不得混用新旧算法。
2. Profile 的身份是完整的 `profileId + profileHash`，只有 ID 或只有版本字符串均不足以解释事件。
3. 房间 genesis 和每个权威事件都逻辑绑定同一组 Profile 引用；快照、Receipt 和 D1 归档只能复制引用，不能替换引用。
4. `step`、`project`、`replay` 只使用与事件精确匹配的当前 0.4 Profile Adapter。不存在“latest”、兼容猜测、未知版本回退或“非当前版本即 Legacy”的分派。
5. 前 0.4 房间已经退役，不进入当前回放。未知或已退役 manifest 显式返回 `unsupportedProfile` 或相应房间退役结果，不能换用当前解释器。
6. `AbilityDefinition` 是受信提案的结构化定义；私有 `MechanicOp` 是 Rules Module Implementation，调用者不能提交、读取或执行它。
7. 距离、占位、路径、掩护、区域集合、触发顺序和虚构时间均只有本规格固定的 Profile 算法；页面、AI Adapter、Room Action、D1 和测试不得各算一份。
8. 本规格只采用 D&D 5e 2014 / SRD 5.1。数字空间、并发排序和微秒表示是烛帷的版本化产品裁定，不伪称 SRD 明文。

原 `dnd5e-2014-srd5.1-v1` 及此前注册过的 runtime manifest 只保留文档和 Git 审计意义，不再是 0.4 生产输入。当前 Ruleset ID 仍是 `dnd5e-2014-srd5.1-authoritative-v2`；应用版本变化不得把它原地改名，也不得用它解释已退役旧事件。

## 2. Profile 身份、规范字节与 Registry

### 2.1 ProfileRef

```ts
type ProfileRef = {
  profileId: string;
  profileHash: `sha256:${string}`;
};

type RuntimeProfileManifest = {
  manifest: ProfileRef;
  ruleset: ProfileRef;
  eventSchema: ProfileRef;
  abilityCompiler: ProfileRef;
  geometry: ProfileRef;
  triggerOrdering: ProfileRef;
  fictionCombatTime: ProfileRef;
  extensions: ProfileRef[];
};
```

首个 conforming manifest 的语义 ID 固定如下。每个实际目录项还必须在生产启用前生成非占位内容哈希：

| Profile kind | `profileId` | 责任 |
| --- | --- | --- |
| Runtime manifest | `runtime-srd51-2014-authoritative-environment-v5` | 固定 0.4 的全部 Profile 引用与扩展闭包 |
| Ruleset | `dnd5e-2014-srd5.1-authoritative-v2` | 2014 规则语义、公共 Interface 与解释器选择 |
| Event schema | `room-world-events-v2-npc-items-v1` | 事件 envelope、类型版本、完整性、NPC/物品与分支字段 |
| Ability compiler | `ability-srd51-2014-v1` | `AbilityDefinition` 到受限 `MechanicOp` 图 |
| Battlefield geometry | `geometry-2d-feet-2014-v1` | 二维水平空间、独立高度及全部空间算法 |
| Trigger ordering | `trigger-initiative-order-2014-v1` | 同一因果点的合资格冻结与确定排序 |
| Fiction/combat time | `combat-round-six-seconds-2014-v1` | 分支虚构时间、Activity、六秒轮与相位转换 |
| Combat mechanics extension | `combat-srd51-2014-v1` | 引用 `SPEC 0012` 的战斗机械 |
| Damage/death extension | `damage-death-srd51-2014-v1` | 引用 `SPEC 0012` 的伤害与死亡顺序 |

`ruleset_version` 保存 Ruleset `profileId`，用于目录层 fail-closed 路由；它不是第二份版本事实。任何执行或回放仍必须取得完整 manifest 和所有 hash。

0.4 当前完整 manifest hash 为 `sha256:93b7cb93e07a0311f181b2001214af4366b4e93fecfb7b2bf417a52e8d074b71`；事件 schema hash 为 `sha256:db98e3812f60c3818f162bdc9f1322bb7d0c75943a3bf724bcdf89d8b1fb52e2`；Projection Policy `projection-observer-safe-v1` hash 为 `sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91`；当前模组引用 `module:black-oak-will:social-resolution-v1` hash 为 `sha256:93c6ffe40f7db7e8661b189774dc8b5017a74434635c11d16a6336334622c618`。KP 工作流精确绑定 `authoritative-kp-private-form-narrow-tools-workflow-v1`，其 Proposal protocol hash 为 `fnv1a64:8754253b2593e263`、workflow hash 为 `fnv1a64:076a3f9a1e2e2330`。这些 v1/v2/v3/v5 名称分别描述协议自身，不等于产品 V3 或应用 0.4。

### 2.2 规范化与哈希

每个 Profile 具有机器可读规范文档，固定字段为 `schema`、`profileKind`、`profileId`、`semanticVersion` 和 `normativePayload`。`profileHash` 本身、注释、文件路径、构建时间和人类说明不进入哈希。

规范字节按以下唯一流程生成：

1. 所有字符串必须是 Unicode NFC；非 NFC 输入拒绝，不静默改写。
2. 禁止 `undefined`、稀疏数组、`NaN`、无穷值、负零、函数、日期对象和二进制对象。
3. 会参与机械的 64 位整数、坐标、时间和有理数使用规范十进制字符串；不得依赖 JavaScript 浮点序列化。
4. 声明为集合的数组按 Profile 指定稳定键排序并去重；声明为序列的数组保持顺序，交换两项必须改变哈希。
5. 使用 RFC 8785 JSON Canonicalization Scheme 生成 UTF-8 字节。
6. 使用 SHA-256，输出 `sha256:` 加 64 个小写十六进制字符。

同一 `profileId` 不允许注册两个不同 hash。规范内容发生任何会影响解释、权限、可见性或错误语义的变化时，必须同时产生新 `profileId` 与新 hash。纯实现优化只有在 conformance 向量完全相同且规范字节不变时才可沿用引用。

### 2.3 Registry 与部署门

Rules Module 内部 Registry 以完整 `(profileId, profileHash)` 查找 Adapter：

- 未知 ID：`unsupportedProfile`；
- 已知 ID、hash 不同：`profileIntegrityMismatch`；
- manifest 子引用缺失或重复：`invalidRuntimeManifest`；
- Adapter 自报 conformance hash 与目录不同：构建或启动检查失败；
- 不允许通过前缀、semver 范围、最近版本或默认分支匹配。

0.4 生产 Registry 是“当前完整 manifest → 当前 interpreter”的单项精确注册表，不是 latest/semver 选择器。`initializeAuthoritativeWorld` 只用该项创建 genesis；`replay` 必须先以 genesis manifest 选 interpreter，`step/project` 则必须同时验证调用方携带的完整 manifest 与权威 state 中缓存的 `runtimeManifestRef`。缓存引用只用于快速 fail-closed；genesis 仍是版本事实源。二者未知、已退役或不一致时返回稳定拒绝，不产生事件或投影。

测试可以构造错误 ID/hash 证明精确拒绝，但不得把合成或退役 manifest 注入 production Registry。未来加入第二个 manifest 前，必须先明确裁定 0.4 房间的保留、迁移或退役策略；当前不预留兼容分支。

0.4 重置 migration 会在实际执行时清空迁移前的房间目录、成员、角色和权威归档，因此当前部署不以迁移旧引用为前提。该 migration 尚未获得远端执行授权；源码中的退役决定不应被误报为远端数据已经删除。

## 3. Genesis、事件与 EventSchema Profile

### 3.1 Genesis 固定

`RoomGenesis` 至少保存：

```ts
type RuntimeGenesis = {
  runtimeEpochId: string;
  profiles: RuntimeProfileManifest;
  moduleRef: ProfileRef;
  initialDefinitionCatalogRef: ProfileRef;
  initialStateHash: string;
  genesisHash: string;
};
```

Genesis 创建后不可改写。Room DO 的缓存行可以另存当前 manifest hash 以快速拒绝错误请求，但缓存不是第二份版本事实。新 Encounter、Chapter 或动态定义继承当前 epoch 的 manifest，不能由调用者另选 Geometry、Compiler 或 Time Profile。

### 3.2 事件 envelope

每个 `WorldEvent` 的逻辑 envelope 至少包含：

- `eventId`、房间内连续 `eventSeq`、`roomId`、`runtimeEpochId`；
- `branchId`、父事件/因果引用、可选 `rootActionId` 与 `resolutionId`；
- `eventType`、该类型的 `eventTypeVersion`；
- 完整 `RuntimeProfileManifest` 的所有 `profileId + profileHash` 引用；存储实现可以按 manifest hash 去重，但导入、导出和审计语义不能丢失子引用；
- `fictionInstantMicros`，战斗事件还可带 `CombatMoment`；
- 规范 payload、payload hash、前一事件 hash、前后状态 hash、scope proof hash；
- visibility policy 引用和秘密级别；
- 非机械审计时间 `committedAt`。该现实时间不能参与规则、排序、到期或 NPC 决策。

`room-world-events-v2` 维护封闭的 `eventType → eventTypeVersion → payload schema` 表。未知事件类型、缺失必填字段、额外机械字段、错误枚举、非规范 ID 或 Profile 不匹配均显式拒绝。事件 payload 不接受任意状态路径、JSON Patch、函数名或调用者生成的 `MechanicOp`。

### 3.3 Definition 与 Profile 特定事件

- `DefinitionRegistered` 保存规范 `AbilityDefinition`、definition hash、Compiler ProfileRef、编译后的私有图、compiled hash 和引用闭包；之后继续使用该已提交图，不查询最新目录或重新编译。
- `EncounterStarted` 保存 Combat、Geometry、Trigger、Time 与 Damage/Death ProfileRef。
- `TriggerBatchOpened` 保存冻结合资格集合的承诺 hash、排序依据和当前公开安全摘要。
- `FictionTimeAdvanced`、`CombatRoundClosed` 与相位转换事件保存 Time ProfileRef。
- 每个事件仍携带完整 manifest；上述字段用于局部完整性验证，不允许覆盖 manifest。

### 3.4 回放与显式迁移

`replay` 先验证 genesis，再逐项验证连续 envelope、hash 链、ProfileRef、分支图和状态 hash。回放只折叠已提交事件，不执行编译器、不重新选目标、不重新计算 NPC 决策、不重新掷骰。

前 0.4 房间不迁移，当前产品也不恢复它们；重置 migration 直接删除其目录与归档。若未来对 0.4 之后的某个版本批准确定性迁移，仍必须先新增明确产品决定，再用旧 Profile 可解释的 `RuntimeEpochMigrated` 关闭旧 epoch，并追加新 epoch genesis、迁移 ProfileRef、源/目标状态 hash、逐作用域映射与回滚说明。没有该决定与完整映射时显式拒绝，不能由新 Adapter 猜测解释旧事件。

## 4. AbilityDefinition 与受限 MechanicOp Compiler Profile

### 4.1 AbilityDefinition

`ability-srd51-2014-v1` 统一编译武器、法术、职业特性、怪物动作、物件能力和环境危险。规范定义至少包含：

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
| Artifact/Resource | 取得、转移、消耗、损坏和恢复已定义对象 | 任意库存 patch 或 D1 同步作为提交 |
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

## 7. Fiction/Combat Time Profile

### 7.1 表示与分支

`combat-round-six-seconds-2014-v1` 同时拥有非战斗虚构时间与战斗相位。权威单位为整数微秒，事件中以十进制字符串 `fictionInstantMicros` 保存：

- 1 秒 = 1,000,000 微秒；1 分钟 = 60 秒；1 小时 = 3,600 秒；1 日 = 86,400 秒；
- 短休最少 3,600 秒，长休最少 28,800 秒并遵守 2014 的中断与每 24 小时限制；
- 每个分头地点/因果分支拥有自己的 `FictionTimeline`；不存在房间单一最大时间自动覆盖所有分支；
- 普通动作、旅行、谈话、调查、施法和危险耗时由 KP/定义在结果前冻结，再由 Rules 验证；
- Spotlight Beat、现实时间、HTTP/DO/模型延迟、掉线、刷新、ACK、票据/租约 TTL 和部署时间均没有虚构时长。

同一虚构时刻的事件仍按因果依赖、Trigger Profile 和连续 `eventSeq` 排序；不能用现实毫秒打破平手。

### 7.2 Activity 与到期

Activity 保存 start、冻结 duration、due instant、投入资源、可中断条件和完成效果。时间线尚未到 due 时，完成效果不能提前写入；中断只保留已经真实发生的成本和迹象。处理一个开始时刻不早于 due 的新行动前，先把已经到期的 Activity/NPC 计划作为独立根行动经同一 `step → commit → project` 提交，再重新投影原意图。

到期 Activity 的根必须从冻结的 `activityId + completionFictionMicros` 唯一规范化为 `activity-due:<activityId>:<completionFictionMicros>`。若完成效果需要权威随机，Room randomness journal 恢复时只能从冻结参数重新导出该根，并验证 request events 全属同一根、randomness ID 绑定该根、以及事件序列和字节与权威存储中的连续前缀完全一致；任一项不符即 fail closed。恢复只继续这一 canonical due root，原调用者 root 保持未提交并在重新投影后重试。

仅“等待”或其他明确玩家/KP 世界行动可以合法推进时间；现实沉默不会生成等待。跨分支传播还要满足 `SPEC 0007` 的因果前沿和世界内媒介速度。

### 7.3 六秒轮与 CombatMoment

一个战斗轮是固定 6,000,000 微秒窗口。Encounter 开始记录 `roundWindowStartMicros`；单个回合、攻击、反应或模型调用不分别推进分支时间。最后一个有效先攻条目结清，或 Encounter 在轮中合法结束时，当前轮只关闭一次并把该分支时间推进 6,000,000 微秒。

`CombatMoment` 保存 `roundIndex`、冻结 initiative order hash、`slotIndex` 和 `turnStart/turnEnd` edge。若有 `N` 个先攻条目，`N` 最大为 4096；更多同类实体必须使用共享先攻条目。用于相位到期的确定偏移为：

```text
turnStartOffset(i, N) = floor(6_000_000 * i / N)
turnEndOffset(i, N)   = floor(6_000_000 * (i + 1) / N)
```

这些偏移只定位相位，不表示各角色行动真的依次占用等长现实时间，也不在回合之间推进 `FictionTimeline`。

### 7.4 相位锚点与 Encounter 中途结束

“直到自身下回合开始”“目标回合结束”等持续保存目标 entity、edge、目标 round、initiative order hash 和创建因果点，而不是预先换成粗略秒数。

Encounter 中途结束时：

1. 先结清强制伤害、移动、死亡和已经打开的 Pending Input；未结清时结束提案拒绝。
2. 关闭当前六秒轮并把分支时间推进一次 6,000,000 微秒。
3. 目标相位原本位于已关闭轮剩余部分的，在关闭提交内按原 initiative 顺序到期。
4. 位于未来轮的，使用保存的 `N/slotIndex/edge` 映射到关闭后连续的假想六秒窗口；多轮持续再加整轮 6,000,000 微秒。
5. 相同绝对微秒的残余相位使用保存的 initiative order、edge ordinal 和 effect id 排序。
6. 到期任务只触发/终止 Effect，不授予动作、移动、反应恢复或新的战斗回合，并且幂等发生一次。

更正改变 initiative 或结束因果时，按 `SPEC 0011` 打开分支并在新分支重建相位任务；旧分支任务保留审计但不在活动分支执行。

## 8. 2014 与非 2024 护栏

Ruleset 与 Compiler conformance 必须同时拒绝：

- 以先攻劣势取代 2014 的逐实体突袭首回合限制；
- “每回合只能消耗一个法术位”，从而错误阻止没有附赠动作法术时的 Action Surge 双一动作法术；
- 把 Counterspell 改成目标体质豁免，或返还已承诺的法术位/动作；
- 把 Grapple/Shove 改成徒手命中后的力量/敏捷豁免；
- Weapon Mastery、每次攻击自由装备/卸下武器、2024 Magic/Utilize/Influence/Study 动作；
- 固定 DC 15 Hide 后授予 Invisible 状态；
- 没有能力明文的通用自愿失败豁免；
- 2024 每级 D20 Test -2 的 Exhaustion 或通用 Bloodied 状态。

定义目录必须标注规则来源；发现禁用词只是初筛，最终 conformance 检查机械图语义，不能通过改名把 2024 行为混入。Geometry 的欧氏量距、64/65 点采样、around-corner voxel，Trigger 的跨控制者排序，以及 Time 的微秒/相位映射均是版本化产品规则，不声称来自 SRD。

## 9. Conformance 与验收向量

所有向量都从公开责任 Interface 驱动：Rules 行为经 `step/project/replay`，Room 版本和恢复经 Room Authority；测试不得直接调用 fold、注入事件、改坐标缓存或指定生产骰面。以下是最低集合，不限制增加边界测试。

### 9.1 Manifest 与 EventSchema

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| P01 | 同一规范对象仅交换 JSON key 顺序 | JCS 字节和 hash 相同 |
| P02 | 交换声明为有序的 op 节点 | hash 不同；旧引用不能接受 |
| P03 | 同一 `profileId` 注册不同 hash | Registry 构建失败或 `profileIntegrityMismatch` |
| P04 | 事件缺少一个 ProfileRef、event type version 或前一事件 hash | `replay` 显式拒绝，不尝试退役/latest 路径 |
| P05 | 当前 0.4 genesis/event archive 在实例重启后回放 | 精确选择唯一当前 Adapter，状态与原 state hash 相同 |
| P06 | 旧 manifest、未知 manifest 或当前 ID/错 hash 进入 Registry | 分别稳定拒绝；不注册兼容项、不回退当前默认值 |
| P07 | D1 归档事件顺序交换、断序或 payload 被改一字节 | hash 链/连续序号失败，不能重建快照 |
| P08 | 前 0.4/Legacy 房间进入 0.4 页面、API 或 Room 服务 | 显式标记已退役/不支持；房主只能删除可见目录行，绝不落入当前 authoritative-v2 |

### 9.2 Ability compiler

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| A01 | 同一定义只交换声明为集合的 tag/alias 顺序 | definition/compiled hash 相同 |
| A02 | 交换“先扣资源、后伤害”的有序节点 | compiled hash 不同，不能视为等价 |
| A03 | 定义含 `setPath`、JSON Patch、脚本、回调或任意事件 | `unsupportedMechanicPrimitive`，无半注册事件 |
| A04 | 触发图有环、choice 未绑定或超复杂度上限 | 逐项诊断，返回 `needsKp`，不掷骰、不削弱定义 |
| A05 | 合法动态敌人具有极高 AC/HP/伤害但在复杂度内 | 接受并注册，不按队伍/当前 HP 缩放 |
| A06 | 能力有多个合法目标且控制者未选择 | `awaitingInput`；不选第一项、最近或最低 HP |
| A07 | 0.4 房间注册动态能力后更新部署目录/Compiler | 该房间继续使用事件中的 compiled graph/hash，不重新编译 |
| A08 | 目录以改名字段表达 Weapon Mastery 或每回合法术位上限 | 语义护栏拒绝，不只做词面检查 |
| A09 | 普通客户端、LLM 或 Room Action 提交 `MechanicOp[]` | Interface/schema 拒绝，且错误不泄漏私有 op |

### 9.3 Geometry

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| G01 | 输入 5 尺与 60 英寸 | 规范坐标相同；非整数英寸输入不静默舍入 |
| G02 | 两个 Medium 占位边界相接 | measurement core 距离 60 英寸，5 尺 reach 合法 |
| G03 | 两个 Medium 中间隔完整 5 尺 | 距离 120 英寸；5 尺非法、10 尺边界合法 |
| G04 | 水平 core 重叠、垂直 core 相隔 60 英寸 | 三维距离 5 尺，高度不能被二维距离忽略 |
| G05 | 斜向 measurement core 分别相隔 120/120 英寸 | 10 尺范围非法；欧氏边界而非页面格数决定 |
| G06 | 点/实体恰好在射程边界与边界外 1 英寸 | 前者合法、后者非法；显示舍入不影响 |
| G07 | waypoint 差为 36/48/0 英寸 | 段长恰为 60 英寸；分片重试结果相同 |
| G08 | 同体型敌对实体空间、相差两个体型敌对空间、盟友空间 | 依次为不可穿、可穿但困难、可穿但困难；均不可自愿停留重叠 |
| G09 | 净空只容纳小一体型 | 允许挤入、移动成本加一倍并应用 2014 攻防；更窄则拒绝 |
| G10 | 同一墙分别 hard-block 31/32/48/64 个 cover samples | 依次为无、半、四分之三、全掩护；soft-only 最高半掩护 |
| G11 | 20 尺 sphere 的一个 area sample 恰在边界/外 1 英寸 | 前者在集合、后者不在；调用者删改 `targetIds` 不改变集合 |
| G12 | 区域请求点在墙后 | 原点冻结为首次交点来源侧；不能在见到集合后换点 |
| G13 | `straight` 被墙阻挡；`aroundCorners` 有开放 voxel 通路/完全封闭 | 依次阻挡、可绕、不可穿透；遍历顺序不改变集合 |
| G14 | 移动在中段打开反应并被降为速度 0 | 只提交已通过路径，后续 waypoint 不提前落地 |
| G15 | 隐藏墙或实体导致目标非法 | 玩家错误只给公开安全原因；KP/internal projection 保留空间证据 |

### 9.4 Trigger ordering

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| T01 | 同一批次交换 map 插入、请求到达和模型完成顺序 | `TriggerBatch` hash、窗口顺序和事件结果相同 |
| T02 | 同一玩家有两个不交换的同时触发 | 只向该玩家打开排序 Pending Input；其他人看不到数量 |
| T03 | 三个不同控制者同时合资格 | 从当前先攻条目按冻结顺序轮转，断线不改变顺位 |
| T04 | 第一项响应使第二项失效 | 第二项 `TriggerInvalidated`，零资源消耗、无自动换目标 |
| T05 | 第一项产生新的合法触发 | 建立子批次，完成后恢复父 continuation，不插队父剩余项 |
| T06 | 当前窗口控制者掉线/现实超时 | 保持等待，不 pass、不推进回合或时间 |
| T07 | 非战斗两个实体与一个环境项同时触发 | 因果行动者优先，其余按 entity ordinal，环境最后；replay 相同 |

### 9.5 Fiction/combat time

| ID | 输入/扰动 | 预期 |
| --- | --- | --- |
| F01 | 一轮含 1、4 或共享组先攻条目 | 每轮都只推进 6,000,000 微秒一次，单回合不另加时间 |
| F02 | 页面关闭、模型 45 秒超时、掉线一天、ACK/租约到期 | 虚构时间和 CombatMoment 均不变，无自动 pass |
| F03 | 短休 3,599/3,600 秒，长休 28,799/28,800 秒 | 只有达到最低时长且其他 2014 条件满足者完成 |
| F04 | Activity 到期前中断/到期后处理下一意图，且到期完成需要权威随机 | 前者不落完成效果；后者先按 canonical due root 提交并可从严格校验的 randomness journal 恢复，再重投影原意图 |
| F05 | Encounter 中途结束，Effect 锚定后续 turn start/end | 按保存 initiative 映射为一次残余到期，不授予新战斗动作 |
| F06 | 多个残余 Effect 同一微秒到期 | 按 initiative、edge、effect id 固定顺序，不按对象遍历 |
| F07 | 两个地点分支时间不同，另一处分支到期 | 未跨因果前沿前不影响本分支，会合不粗暴取全房最大值 |
| F08 | Time Profile 部署新实现后回放旧事件 | 旧 ProfileRef 得到相同 instant、phase task 和 state hash |
| F09 | 超过 4096 个个体需加入同一 Encounter | 使用有机械依据的共享先攻条目或返回可修订诊断，不截断数组 |

## 10. 自主裁定记录

以下裁定已回填当前工作树的公开 Interface 定向证据；生产源码尚未冻结，最终 `module:check`、`typecheck`、`lint`、`npm test` 与部署门仍待执行，因此不把定向通过写成规格完成。

### RTP-D001：Profile manifest、规范哈希与精确解释器

- 日期：2026-08-26
- 问题：版本字符串、目录最新项或完整 Profile manifest 中，何者决定事件解释。
- 来源类别：Goal 明确版本要求 + `SPEC 0001` 连续性 + `SPEC 0003/0011` 回放约束 + Agent 自主协议裁定。
- 关联 `SPEC 0001`：§6 公正、§16 连续性、§17 错误更正、§19 标准循环；验收 N。
- 候选方案：只存 `ruleset_version`；部署时使用 latest；固定 ID/hash manifest 并保留旧 Adapter；0.4 开发重置后只注册当前完整 manifest。
- 最终选择：JCS/SHA-256 的完整 `id + hash` manifest 固定于 genesis 与事件，Registry 只做精确匹配。2026-08-31 的 0.4 修订进一步退役全部更早房间与 Adapter，当前生产 Registry 只有 V5 runtime manifest；这一修订不放宽精确 hash、事件完整性或 fail-closed 要求。
- 理由：版本名不能证明内容未漂移，latest 会静默改历史；完整闭包同时约束规则、事件、定义、空间、排序和时间。
- 玩家可观察行为：0.4 新房稳定使用同一套距离、资源、骰面、窗口与到期规则；前 0.4 房间显示为已退役并可由房主删除，不能继续游玩或被换规则打开。
- 秘密与权限影响：ProfileRef 可公开，规范目录不包含模组真相、Prompt 或私人状态；客户端不能选择房间解释器。
- 迁移/可逆性：前 0.4 房间和归档由一次性重置 migration 删除，不提供数据级回滚；Git 历史仅保留源码审计。未来版本兼容需要新决定，不能原地覆盖当前 manifest。
- 验收场景：P01–P08、A07、F08、`SPEC 0002` B52。
- 测试证据：`tests/runtime-profiles-v2.test.mjs` 已改为覆盖 0.4 精确初始化、回放、投影、错 hash/退役 manifest 拒绝、事件 envelope 完整性与 2024 护栏；实际通过数只在对应源码状态运行后回填。

### RTP-D002：AbilityDefinition 与受限 MechanicOp compiler

- 日期：2026-08-26
- 问题：动态能力采用任意脚本、巨大封闭目录还是受限可编译定义。
- 来源类别：Goal 动态定义/单一机械权威 + `SPEC 0001` §8 + `SPEC 0006/0012` + Agent 自主机械裁定。
- 关联 `SPEC 0001`：§5 玩家行动、§7 骰前固化、§8 动态敌人/危险、§14 NPC 权限；验收 A、D、G、K。
- 候选方案：任意脚本/状态 patch；只允许预写白名单；结构化 AbilityDefinition 编译为私有有限 op 图。
- 最终选择：版本化 `ability-srd51-2014-v1`；调用者只交定义提案/AbilityRef，Compiler 生成并持久化受限图和 hash。
- 理由：同时支持开放动态内容、确定回放和机械安全；不把 AbilityRef 退化成玩家行动白名单。
- 玩家可观察行为：合理新能力可被验证和使用；非法项明确要求 KP 修订；系统不因危险强而自动削弱，也不替控制者选目标。
- 秘密与权限影响：MechanicOp、隐藏定义和诊断细节只在 Rules/KP Viewer；普通调用者不能提交 op 或探测秘密候选。
- 迁移/可逆性：前 0.4 DSL 不再进入产品；新增 op 家族必须新 Compiler/Ruleset/EventSchema，并先裁定当时现役房间策略。当前房已注册定义继续使用事件内图。
- 验收场景：A01–A09、`SPEC 0002` B41–B43/B52、`SPEC 0012` B11–B22。
- 测试证据：`tests/ability-profile-v2.test.mjs` 当前 8/8 覆盖 A01–A05/A07–A09 的 canonical 编译、诊断、冻结图与私有 op 拒绝；A06 的运行时多目标集合在 `tests/combat-mechanics-v2.test.mjs`，`tests/rules-compound-action-v2.test.mjs` 另补动态定义经 Room/Rules 使用的定向证据。冻结全量门仍待执行。

### RTP-D003：整数英寸二维+高度 Geometry

- 日期：2026-08-26
- 问题：如何精确决定距离、占位、斜向、掩护和区域，同时避免客户端/服务端双空间。
- 来源类别：Goal 单一权威 + `SPEC 0001` 公正/危险 + `SPEC 0012` Geometry 占位 + Agent 自主数字空间裁定。
- 关联 `SPEC 0001`：§6 公正、§8 动态危险、§10 危险兑现；验收 C、D、G。
- 候选方案：抽象距离段；5 尺方格/页面坐标；整数英寸连续欧氏空间、独立高度和固定采样。
- 最终选择：`geometry-2d-feet-2014-v1`，以整数英寸保存 x/y/elevation，使用 measurement core 欧氏量距、swept path、64 点 cover 和 65 点 area。
- 理由：边界可用整数/有理数确定比较，体型仍有真实占位；固定采样比 LLM/页面目测更可回放且成本有界。
- 玩家可观察行为：边界、斜向、高度、掩护、区域和移动中断在重试/回放中一致；玩家仍可自然语言描述位置，重大歧义先澄清。
- 秘密与权限影响：完整坐标、隐藏屏障和实际区域集合经 `project`；玩家错误不能证明隐藏目标或机关存在。
- 迁移/可逆性：前 0.4 零距离/距离段状态不猜坐标并显式拒绝。改变精度、采样、欧氏或 voxel 算法必须新 Geometry hash，并先裁定当前房间策略。
- 验收场景：G01–G15、`SPEC 0002/0012` B08–B10/B39。
- 测试证据：`tests/combat-mechanics-v2.test.mjs`、`tests/rules-compound-action-v2.test.mjs` 与 `tests/privacy-bypass-v2.test.mjs` 已从公开 `step/project/replay` 建立 G01–G15 的范围、占位、区域、连续移动和 Viewer 安全错误证据；冻结全量门仍待执行。

### RTP-D004：冻结全集后的确定 Trigger 排序

- 日期：2026-08-26
- 问题：多个控制者在同一因果点获得触发时，资格与顺序是否受网络/遍历影响。
- 来源类别：Goal 并发/恢复要求 + `SPEC 0001` 玩家能动性 + `SPEC 0007/0012` + Agent 自主排序裁定。
- 关联 `SPEC 0001`：§6 公正、§14 NPC 权限、§15 多人聚光灯；验收 K、M。
- 候选方案：先请求先处理；统一 LIFO；冻结全集后按明文、控制者选择、先攻/实体序逐项处理。
- 最终选择：`trigger-initiative-order-2014-v1`；先冻结合资格集合与基线，排序与网络无关，后项打开前重验，新增触发进入子批次。
- 理由：保证断线、重启和 replay 一致，并保留各控制者对自己非交换项的决定权。
- 玩家可观察行为：更换请求到达顺序不改变窗口；前项令后项失效时不扣资源；掉线不会默认放弃。
- 秘密与权限影响：只公开当前控制者窗口；其他合资格者、数量和失效原因按 Viewer 脱敏；KP 只排序 NPC/环境项。
- 迁移/可逆性：排序依据与批次 hash 固定在事件；改变起点、实体序或嵌套规则需要新 Profile，旧批次不重排。
- 验收场景：T01–T07、`SPEC 0002/0012` B09/B13–B15/B49。
- 测试证据：`tests/runtime-trigger-time-v2.test.mjs` 已记录通过 T01–T07 的控制者排序、插入/到达顺序扰动、掉线保持、子批次/失效和 replay 定向组合；冻结全量门仍待执行。

### RTP-D005：分支虚构微秒、六秒轮与相位转换

- 日期：2026-08-26
- 问题：非战斗耗时、战斗轮和回合锚点如何共享时间而不把现实等待或每个回合重复计时。
- 来源类别：Goal 虚构时间要求 + `SPEC 0001` §11/§16 + `SPEC 0004/0007/0012` + Agent 自主时间裁定。
- 关联 `SPEC 0001`：§11 势力推进、§13 失败、§16 连续性、§19 标准循环；验收 I、J、M。
- 候选方案：现实时间驱动；每回合加六秒；分支微秒时间线、每轮只加六秒并保存 CombatMoment。
- 最终选择：`combat-round-six-seconds-2014-v1` 同时承载 Activity 与战斗；整数微秒、分支因果前沿、轮级推进、相位锚点确定转换。
- 理由：既保留 2014 六秒轮，又让分头、休整、长期 Activity 和战斗后持续效果使用同一因果时间。
- 玩家可观察行为：思考/掉线不受惩罚；一轮无论参与者数量都只过六秒；战斗结束不清空或永久遗留回合效果。
- 秘密与权限影响：未来到期事件只进入有权 KP/Internal 投影；玩家不能从轮询时间推断他处计划，Spotlight 不改变时间。
- 迁移/可逆性：前 0.4 beat/clock 不猜测为微秒并显式拒绝。改变六秒、slot 映射或到期顺序需新 Time/Ruleset hash，并先裁定当前房间策略。
- 验收场景：F01–F09、`SPEC 0002/0012` B29/B39/B53 时间段。
- 测试证据：`tests/runtime-trigger-time-v2.test.mjs` 已记录通过 F01–F09，`tests/combat-long-casting-v2.test.mjs` 8/8 与 `tests/combat-mechanics-v2.test.mjs` 补充 Activity、轮级时间和战斗结束相位转换；冻结全量门仍待执行。

## 11. 实现映射

| 责任 | 目标位置 | 完成证据 |
| --- | --- | --- |
| 机器可读 Profile 与期望 hash | `app/_runtime/lib/rules/profiles/manifests.ts` | Projection Policy 1.2.0、完整 manifest 与 genesis 三元 golden；构建时 JCS/hash tests，禁止占位 hash |
| 当前单项精确 Registry | `app/_runtime/lib/rules/profiles/registry.ts`、`app/_runtime/lib/rules/v2-runtime.ts` | 只注册 0.4 V5 manifest；P01–P08，未知/退役/错 hash/state pin 不 fallback |
| EventSchema/envelope | `app/_runtime/lib/rules/v2/events.ts`、`app/_runtime/lib/rules/v2/combat-events.ts`、`app/_runtime/lib/rules/v2/campaign-events.ts` | 连续事件、payload/hash、ProfileRef 与分支完整性 |
| Ability schema/compiler | `app/_runtime/lib/rules/profiles/ability-compiler.ts`、`app/_runtime/lib/rules/v2/campaign-actions.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts` | A01–A09；MechanicOp 不从包入口导出 |
| Geometry Profile/Implementation | `app/_runtime/lib/rules/profiles/combat-geometry.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts`、`app/_runtime/lib/rules/v2/spatial-visibility.ts` | G01–G15 和 `SPEC 0012` B08/B39 |
| Trigger Profile/Implementation | `app/_runtime/lib/rules/profiles/trigger-ordering.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts` | T01–T07、私人窗口与 replay |
| Fiction/combat time | `app/_runtime/lib/rules/profiles/fiction-time.ts`、`app/_runtime/lib/rules/v2/timeline.ts`、`app/_runtime/lib/rules/v2/campaign-actions.ts`、`app/_runtime/lib/rules/v2/combat-actions.ts` | F01–F09、Activity/canonical due root/分支/相位测试 |
| Genesis、Receipt 与权威事件提交 | `app/_runtime/lib/room/durable-object.ts` | 原子固定 manifest、拒绝调用者覆盖、严格核对 canonical due-root randomness journal 后重启恢复 |
| Room Action 与可信 Adapter | `app/_runtime/lib/room/action.ts`、`app/_runtime/lib/room/server.ts`、`app/_runtime/lib/table/server.ts#getRoomManagement` | 只提交 intent/answer/提案，不提交 Profile/op/骰面；房主管理 Read Model 显式返回目录 `ruleset_version`，服务端按精确版本路由而不按模型/字段猜测 |
| D1 目录、当前归档与 0.4 重置 | `db/schema.ts`、`drizzle/0012_fluffy_hulk.sql`、`drizzle/0013_reset_pre_0_4_rooms.sql`、`drizzle/0014_private_form_tools.sql` | 删除旧状态表；迁移执行时清空前 0.4 房间/归档；最后固定窄工具模型 Profile 默认值；以后只保存当前可重建 ProfileRef/归档，不保存第二份活跃解释器状态 |
| Interface 行为测试 | `tests/runtime-profiles-v2.test.mjs`、`tests/ability-profile-v2.test.mjs`、`tests/combat-mechanics-v2.test.mjs`、`tests/rules-compound-action-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`、`tests/runtime-trigger-time-v2.test.mjs` | 本规格 P/A/G/T/F 全向量映射 |

Rules 包入口仍只允许 `step/project/replay`。Profile Registry、Compiler、Geometry helpers、Trigger queue、fold、MechanicOp、时间换算和 hash 实现均是内部 Implementation，不成为第四条生产或测试路径。

当前源码的 `getRoomManagement` 已在重新鉴权并确认房主后，从 D1 房间目录读取并返回 `ruleset_version` 与 `kp_model`；普通成员仍得到管理权限拒绝。`tests/rendered-html.test.mjs` 已加入精确 authoritative-v2 版本断言，但只有冻结源码上的实际 HTTP 测试/`npm test` 通过后才计入最终完成门。

## 12. 五项交叉审查

### 12.1 跨规格矛盾审查

- 与 `SPEC 0001`：动态敌人/危险仍由 KP 在故事锚点内提出，玩家仍控制玩家角色；Profile 只确定机械解释，不选择故事、目标或风险。
- 与 `SPEC 0003`：所有能力、空间、触发和时间变化只经同一 `step`；骰面只由 Room DO；`project/replay` 仍是唯一观察/回放 Interface。
- 与 `SPEC 0004/0006`：自由行动和动态定义不受目录白名单限制；编译器只拒绝机械不可执行或复杂度，不以强弱/剧情需要拒绝。
- 与 `SPEC 0007/0010`：分支时间、私人窗口、隐藏位置和错误统一走现有控制权与 Viewer 协议；排序不借 Spotlight 改机械。
- 与 `SPEC 0011/0012`：当前 0.4 房间的恢复、更正、战斗状态机和 2014 护栏保持；只有前 0.4 房间/历史 Adapter 的保留要求被本修订窄取代。
- 结论：未发现需要修改 `SPEC 0001` 的冲突；`SPEC 0002` 仍是被替代的未批准草案，本规格不伪称其已获用户逐条批准。

### 12.2 权限审查

- Runtime manifest 由房间 genesis/epoch 决定，客户端、LLM、房主、队长和普通 Room Action 无权切换。
- Ability 调用者只能提交自己有权选择的参数；MechanicOp、区域集合、触发资格和时间推进由 Rules 决定。
- Trigger 的排序/反应只由正确控制者回答；NPC/环境选择来自 KP 有限知识，不使用玩家或网络默认。
- Geometry 自主计算强制结果不等于替玩家选择路径；重大自然语言空间歧义先澄清。
- 结论：身份、控制权、Profile 选择和内部 continuation 均没有请求体自报路径。

### 12.3 秘密审查

- Profile 规范和 hash 不含房间秘密；定义实例、隐藏位置、完整触发批次和区域集合仍可为秘密权威数据。
- Geometry/Compiler/Trigger 诊断带秘密级别，只能经 `project` 产生玩家安全错误；“目标不存在”等错误不能确认隐藏实体。
- 事件归档保存完整秘密时仍只是 D1 可重建副本，不可由玩家直接读取；Runtime 日志只记录短 hash/版本和公开错误码。
- 相位到期和他处分支计划不从现实时钟、轮询形状或计数泄漏。
- 结论：Profile conformance 没有建立新的错误、候选、日志、语音或历史旁路。

### 12.4 版本审查

- genesis、每个事件、动态定义、Encounter 和时间/触发事件均保存精确 ProfileRef；ID/hash 任一不符显式拒绝。
- 机器规范、Registry Adapter 和 conformance golden vector 三者共同阻止实现漂移。
- 当前 0.4 房间不因进程重启而重新编译定义或重新计算已提交的几何/触发/时间；前 0.4 房间不进入本产品回放。
- 2014 与产品裁定分开标注，禁止 2024/5.5e 通过改名混入。
- 结论：0.4 只解释精确当前闭包；未知/退役输入不会静默落入当前规则，且不存在“非当前即 Legacy”的含混分派。

### 12.5 第二权威审查

- Rules Module 是 Profile 解释、Ability 编译、Geometry、Trigger 和 Time 的唯一机械权威；外部 Interface 仍只有 `step/project/replay`。
- Room DO 是 manifest、活跃状态、事件、Pending Input、骰面和 Receipt 的唯一提交权威。
- D1 只保存目录/静态卡/ProfileRef 与可重建归档；页面、AI、Room Action、语音和日志不保存坐标、触发队列、倒计时或 compiled graph 的活跃副本。
- conformance tests 通过公开 Interface 驱动，不直接调用 helpers 形成测试专属第四路径。
- 结论：本规格没有引入第二条机械裁决、状态提交、观察者投影或事件回放路径。

## 13. 实施完成门

本规格只有在以下证据全部成立时才算实现完成：

- P01–P08、A01–A09、G01–G15、T01–T07、F01–F09 均通过表列责任 Interface；
- 所有机器 Profile 具有已提交、非占位的 canonical JSON 与预期 SHA-256；构建验证与运行 Registry 一致；
- 新房 genesis、每个权威事件、Receipt 和 D1 归档均可证明绑定正确 manifest；
- 0.4 当前规则精确分派，未知/退役/错 hash 输入稳定拒绝且不 fallback；
- 动态 Ability 注册、继续使用和 archive rebuild 不查询最新目录或重新编译；
- Geometry 的距离、占位、路径、掩护、区域与高度向量通过 `step/replay`，且调用者无法覆盖区域集合；
- Trigger 的对象乱序、网络乱序、掉线、嵌套和失效向量产生相同结果；
- Time 的现实等待、六秒轮、Activity、分支因果和战斗相位转换确定且不自动替玩家行动；
- 2014 护栏测试证明禁用的 2024/5.5e 行为全部被拒绝；
- 包入口未导出 Profile helpers、Compiler、MechanicOp、Geometry、Trigger queue、fold/applyEvents 或生产骰源；
- 0.4 重置 migration 经本地最小迁移与写入—读取闭环证明，远端未执行时不得写成远端数据已删除；
- 实现证据回填总追踪矩阵、决策登记和 refactor log；未运行项不得写成已验证。
