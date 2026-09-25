---
spec: "0013"
kind: spec
title: "版本化运行时 Profiles 与确定性 Conformance"
status: ruled
authority: goal
ruled_on: 2026-08-26
status_detail: "已裁定；0.4 开发重置修订已获用户明确确认"
depends_on: ["0001", "0003", "0004", "0005", "0006", "0007", "0010", "0011", "0012"]
supersedes:
  - spec: "0002"
    scope: "第 9、10、14、20.2、23、26 节中尚未裁定的 Profile 精确算法，以及 B39、B49、B52 的 Profile conformance 细节"
  - spec: "0006"
    scope: "要求保留、迁移或恢复前 0.4 房间的条款"
revisions:
  - date: 2026-09-25
    scope: "§3.3：definition hash 与 compiled hash 只作名称，不再重算核对"
  - date: 2026-09-25
    scope: "§3.2、§3.4、§9 P04/P05/P07、§10 F08：事件不再带 payload/前一事件/状态/scope proof hash，replay 按序号与父事件衔接折叠、不算状态 hash"
  - date: 2026-09-18
    scope: "§7.2：Activity 的推进或提醒阶段不是已到达的 due，同一瞬间开始的新行动先执行并可打断该 Activity"
  - date: 2026-08-31
    scope: "0.4 开发重置：放弃全部 0.4 以前房间及可恢复归档，不保留 Adapter、fallback 或 migration"
parts:
  - "0013-part-b-ability-and-geometry.md"
  - "0013-part-c-time-and-conformance.md"
gates_verified_on: 2026-09-11
gates:
  - "tests/platform/profiles/runtime-profiles.test.mjs"
  - "tests/kp/combat/ability-profile.test.mjs"
  - "tests/kp/combat/combat-mechanics.test.mjs"
  - "tests/kp/time/runtime-trigger-time.test.mjs"
  - "tests/platform/recovery/stable-recovery.test.mjs"
  - "tests/kp/world/dynamic-locations.test.mjs"
---
# SPEC 0013：版本化运行时 Profiles 与确定性 Conformance

- 产品：烛帷
- 适用规则：D&D 5e 2014 / SRD 5.1
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
| Ability compiler | `ability-srd51-2014-v2` | `AbilityDefinition` 到受限 `MechanicOp` 图 |
| Battlefield geometry | `geometry-2d-feet-2014-v1` | 二维水平空间、独立高度及全部空间算法 |
| Trigger ordering | `trigger-initiative-order-2014-v1` | 同一因果点的合资格冻结与确定排序 |
| Fiction/combat time | `combat-round-six-seconds-2014-v1` | 分支虚构时间、Activity、六秒轮与相位转换 |
| Combat mechanics extension | `combat-srd51-2014-v1` | 引用 `SPEC 0012` 的战斗机械 |
| Damage/death extension | `damage-death-srd51-2014-v1` | 引用 `SPEC 0012` 的伤害与死亡顺序 |

`ruleset_version` 保存 Ruleset `profileId`，用于目录层 fail-closed 路由；它不是第二份版本事实。任何执行或回放仍必须取得完整 manifest 和所有 hash。

0.4 当前完整 manifest hash 为 `sha256:4ee31c57284246b9bb634ab127a11b4ca1a2e2f30fd4d0fc102621c5096e72e3`；Ruleset hash 为 `sha256:bc22610d7a75d9f14ec5a0f2905f3bebcd080d6b66acb180179b50ec42018c78`；事件 schema hash 为 `sha256:1d1d82768da015c40fc15bf5303259ad8a64084aaa6c04637ba913be9d18686a`。Ability Compiler `ability-srd51-2014-v2` hash 为 `sha256:08d7d7e27f001d16543a7fa3edb4328af4fb38be506b35938da169a1ad07eff5`；Item System、Standard Gear 与 NPC Mechanical Definition 的 hash 分别为 `sha256:3617527d10a13c6df79475756851c8de72498307574ff2b1fa8be833e59bfb71`、`sha256:96be7de4760e9f0f0a9da46c795e96f65cae74e58efc2beb83e1c59e94b791b9`、`sha256:6e3ebb6456b8db2e909648378131a249050cfc33da31f2d3ed7f24a654693b88`；Causal Action Interpreter hash 为 `sha256:d92dfdbfd68f4aadb38441d45bdd449baa478b099d81dc7b04a5a58edb90f52f`。

KP 闭包精确绑定 Form catalog `kp-private-form-catalog-v5` / `sha256:996c8b5221f8acb10e66c3cd4d3766d0a2a04d3910609aeee84f418d1c35212b`、Causal language `causal-action-program-v5` / `fnv1a64:9b3fb1371759dd5e`、Proposal protocol `authoritative-kp-private-form-narrow-tools-v2` / `fnv1a64:9afffc8be976225a` 与 workflow `authoritative-kp-private-form-narrow-tools-workflow-v2` / `fnv1a64:e3abe4c1ff669b12`。Projection Policy `projection-observer-safe-v1` hash 为 `sha256:972b82b84594386abc2a988a98afb94e5ec925ee1819bc53cd677c722edf8b91`；当前模组引用 `module:black-oak-will:social-resolution-v1` hash 为 `sha256:e04a553deb9808df6dc614e813fa503c6ff659cae2570e738969ac0e70fbc272`。这些 v1/v2/v5 名称分别描述协议自身，不等于产品 V3 或应用 0.4。

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

0.4 不提供旧房兼容或重置 migration，也不清空既有 D1 行。当前路由只接受精确的 0.4 完整绑定；仍存在的旧目录行显式退役并只允许房主删除，不能被新解释器打开。源码中的退役决定不得被误报为远端数据已经删除。

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
- 规范 payload；较早的事件另带 payload hash、前一事件 hash、前后状态 hash 与 scope proof hash，照原样保留，不再读取或核对；
- visibility policy 引用和秘密级别；
- 非机械审计时间 `committedAt`。该现实时间不能参与规则、排序、到期或 NPC 决策。

`room-world-events-v2` 维护封闭的 `eventType → eventTypeVersion → payload schema` 表。未知事件类型、缺失必填字段、额外机械字段、错误枚举、非规范 ID 或 Profile 不匹配均显式拒绝。事件 payload 不接受任意状态路径、JSON Patch、函数名或调用者生成的 `MechanicOp`。

### 3.3 Definition 与 Profile 特定事件

- `DefinitionRegistered` 保存规范 `AbilityDefinition`、definition hash、Compiler ProfileRef、编译后的私有图、compiled hash 和引用闭包；之后继续使用该已提交图，不查询最新目录或重新编译。
- `EncounterStarted` 保存 Combat、Geometry、Trigger、Time 与 Damage/Death ProfileRef。
- `TriggerBatchOpened` 保存冻结合资格集合的承诺 hash、排序依据和当前公开安全摘要。
- `FictionTimeAdvanced`、`CombatRoundClosed` 与相位转换事件保存 Time ProfileRef。
- 每个事件仍携带完整 manifest；上述字段记录所用的版本与已提交内容，不允许覆盖 manifest。definition hash 与 compiled hash 只作名称，不再重算。

### 3.4 回放与显式迁移

`replay` 先验证 genesis，再逐项验证连续 envelope（事件序号与父事件衔接）、ProfileRef 和分支图，按记录折叠事件；不计算状态 hash，也不比对事件 hash。回放只折叠已提交事件，不执行编译器、不重新选目标、不重新计算 NPC 决策、不重新掷骰。

前 0.4 房间不迁移，当前产品也不恢复或自动删除它们；目录与归档可以保留在 D1，但不会进入当前解释器。若未来对 0.4 之后的某个版本批准确定性迁移，仍必须先新增明确产品决定，再用旧 Profile 可解释的 `RuntimeEpochMigrated` 关闭旧 epoch，并追加新 epoch genesis、迁移 ProfileRef、源/目标状态 hash、逐作用域映射与回滚说明。没有该决定与完整映射时显式拒绝，不能由新 Adapter 猜测解释旧事件。

## 分册

本规格的其余条款在以下分册，编号连续：

- [§4–§6 AbilityDefinition 与战场几何 Profile](./0013-part-b-ability-and-geometry.md)
- [§7–§13 时间 Profile、护栏与 Conformance](./0013-part-c-time-and-conformance.md)
