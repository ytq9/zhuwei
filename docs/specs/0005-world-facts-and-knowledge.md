# SPEC 0005：世界事实、因果与角色知识

- 状态：**已裁定（本 Goal 授权）**
- 裁定日期：2026-08-26
- 上位规格：`SPEC 0001`、`SPEC 0003`、`SPEC 0004`
- 取代范围：`SPEC 0002` 第 8、19–20 节及 B04、B06、B23、B43–B45、B52 中的通用世界、秘密、定义、分支与知识条款

## 1. 目的

本规格把世界真相、证据、主张、推断、关系、承诺和动态定义变成可追溯的正史与观察者知识，而不是 Prompt 记忆、聊天消息或 D1 镜像。事实本身与“谁知道什么”严格分离。

## 2. Canonical Fact

`CanonicalFact` 是当前活动分支中可裁决的事实记录：

```ts
type CanonicalFact = {
  id: string;
  kind: string;
  subjectRefs: string[];
  value: unknown;
  source: FactSource;
  validFromEventSeq: number;
  validUntilEventSeq?: number;
  causalParentIds: string[];
  branchId: string;
  visibilityPolicyId: string;
  definitionRef?: VersionedDefinitionRef;
  supersedes?: string[];
};
```

来源至少区分 `moduleAnchor | dynamicMaterialization | observedEvent | mechanicalResolution | characterAction | npcOrFactionAction | correction`。事实必须引用形成它的世界事件与因果父项；不能只保存最终布尔 flag 而丢失来源。

已固化事实只能由后续世界事件改变、终止或由更正分支 supersede。叙述文本、模型重试、部署、目录更新和查看者变化不能改写它。

## 3. World Event

`WorldEvent` 是房间内连续、不可变、版本化的事实变化，至少绑定：

- `eventSeq`、`eventId`、`eventSchemaVersion`、`rulesetVersion`；
- `branchId`、根行动/结算/Receipt 引用；
- 虚构时刻、场景/作用域、因果父事件；
- 规范载荷、定义/Profile 哈希、前后状态哈希；
- visibility policy 引用，而非已脱敏副本。

事件不包含 KP 文学旁白。一个动作可以原子产生多个事实事件，但所有事件必须来自 `step`。Room DO 的活跃事件流是唯一真相；D1 仅追加保存相同事件的可重建归档副本。

## 4. 动态定义与隐藏现实

开放留白第一次产生证据、被引用或影响机械前必须固化。选择顺序固定为：

1. 因果唯一推出时采用该结果；
2. 合理性有差异时选最合理结果，或先固定隐藏权重后使用 DO 随机；
3. 同样合理时优先产生有意义选择、回应既有行动或延续关系；
4. 仍无法区分时使用 DO 随机。

若需要隐藏随机，KP 提交完整 `HiddenRealityCandidateSet`，包含未预选候选、权重、因果依据、可见性和每个候选的可执行定义。Rules Module 在产生随机请求前验证所有候选；任一候选非法则整组退回修订。DO 骰面选择后，选中事实、定义注册与机械起点同一原子提交；未选候选永不向无权观察者泄漏。

动态实体、危险、物品、地点、通路和能力以 `DefinitionRegistered` 保存规范定义、编译器版本与内容哈希。回放使用事件内精确版本，不查询最新目录或重新编译。

## 5. 可见性不是事实副本

每个事实引用版本化 `VisibilityPolicy`。策略可以按：

- 公开世界事实；
- 场景内可感知主体；
- 指定角色/Principal；
- 物件持有或接触；
- 感官与能力条件；
- NPC 有限知识；
- KP 主持；
- 内部审计/更正；

计算投影。不得为不同玩家复制多份互相漂移的事实。`project` 结合事实、角色知识、当时位置/感官和 Viewer 权限生成 Read Model。

## 6. 四类认知对象

### 6.1 隐藏真相

世界中成立但指定角色尚未获得的 Canonical Fact。它不会仅因完整模型上下文、其他角色知道、页面需要或后来来到同一地点而自动公开。

### 6.2 感官证据

`SensoryEvidence` 必须引用真实原因、感官类型、观察者、地点、虚构时刻、清晰度和取得方式。明显且理应察觉的证据直接授予；细微或可能遗漏的证据才使用检定。证据不能由无来源全知旁白伪造。

### 6.3 角色推断

`CharacterInference` 是角色根据已有证据得出的解释，记录信心、依据与形成主体。推断可以错误，不能覆盖真相；后续证据可以支持、反驳或修订。

### 6.4 来源主张

`SourceClaim` 记录说话者/文献、其知识来源、动机、形成时间、原话语义和传播链。它可以真实、错误、夸张、过时或故意欺骗。传闻不等于隐藏真相；无来源“系统提示”不得用来欺骗玩家。

## 7. 角色知识

`CharacterKnowledge` 是主体对证据、主张、推断或事实的权威取得关系：

```ts
type CharacterKnowledge = {
  id: string;
  characterId: string;
  knowledgeRef: string;
  layer: "hint" | "partial" | "full";
  acquiredByEventId: string;
  acquiredAtFictionSeconds: number;
  sourceCharacterId?: string;
  provenanceChain: string[];
  visibility: "private" | "shared" | "publiclyObservable";
};
```

取得知识由 `KnowledgeAcquired` 事件提交。实物移动、毁坏、角色掉线、章节切换或模组更新不会撤销已经取得的知识。更正若改变知识因果，必须走显式补偿或分支，不静默删除。

个人线索默认私有，分享协议由 SPEC 0010 定义；分享会为接收者生成新的取得事件并保留来源，不把原知识对象改成全局布尔值。

## 8. 关系、承诺、债务与声誉

- `RelationshipFact` 记录主体之间的当前关系、来源事件和可见性；同一关系的变化追加事件。
- `Promise` 记录承诺者、受诺者、内容、条件、期限、状态和知情主体。
- `Debt` 记录债务来源、范围、履行/豁免条件和知情主体。
- `ReputationClaim` 区分实际行为、谁目击、谁传播以及某 NPC/势力相信什么；不会因全桌知道自动全世界知道。

这些状态进入 KP Viewer 和 NPC 专属投影，驱动长期回响、势力行动和章节连续性。

## 9. 知识传播

传播必须有世界内载体：对话、手势、书信、广播、展示实物、法术或其他已固化通讯方式。Rules Module 验证发送者拥有相应知识、载体可达、耗时/资源与内容边界；`step` 生成接收者各自的 `KnowledgeShared`/`KnowledgeAcquired` 事件。

传播范围在提交时冻结，不追溯授予后来加入、后来到场或后来取得频道权限的人。若创建持久的公开记录、告示或文献，它先成为世界物件/事实；未来角色必须实际接触后才获得知识。

传播可以降低层级、带有错误概括或以 Source Claim 形式转述，但不能凭空授予发送者不知道的真相。NPC 传播受其有限知识、动机和错误影响。

## 10. 分支与更正

全局事件序列持续单调；每事件属于一个 `branchId`。错误未影响后继选择时追加前向补偿。错误已经改变死亡、位置、资源、秘密获得、关系或玩家选择时：

- `CorrectionBranchOpened` 引用父分支、分叉事件、受影响闭包和沿用的无关作用域头；
- `BranchActivated` 明确活动分支；
- 旧事件、旧骰面、旧知识和旧 Receipt 保留审计；
- 活动投影只显示当前 Viewer 有权知道的更正结果和必要说明；
- `replay` 从完整全局日志确定活动状态，拒绝裁剪、循环或哈希不符的分支图。

更正权限及流程服从 SPEC 0003/0011。

## 11. 主要事件

- `FactDeclared` / `FactChanged` / `FactEnded`
- `HiddenRealityCandidatesFrozen` / `HiddenRealityMaterialized`
- `DefinitionRegistered`
- `SensoryEvidenceAcquired`
- `SourceClaimCreated` / `SourceClaimRepeated`
- `CharacterInferenceFormed` / `CharacterInferenceRevised`
- `KnowledgeAcquired` / `KnowledgeShared`
- `RelationshipChanged`
- `PromiseMade` / `PromiseFulfilled` / `PromiseBroken` / `PromiseReleased`
- `DebtCreated` / `DebtSettled` / `DebtReleased`
- `CorrectionApplied` / `CorrectionBranchOpened` / `BranchActivated`

## 12. 验收场景

1. 门后多种合理结果先冻结候选，再由 DO 随机选定；开门后无法按玩家 HP 更换。
2. 火药味作为感官证据有真实固化原因；NPC 的“宝藏”说法是有来源主张，可被交叉验证。
3. 两个角色仅一人发现私密线索；另一人的快照、增量、错误、候选和重连均无该知识。
4. 持有者销毁信件后仍保留已读知识；未读者无法从“物件曾存在”自动获得内容。
5. NPC 只按自身知识采取行动，即使 KP Viewer 含玩家计划也不针对性反制。
6. 动态敌人/危险定义固化后部署新目录，仍受支持且绑定该定义/Profile 的房间 replay 仍得到同一定义与事实；前 0.4 房间不进入当前解释器。
7. 一个错误知识取得分别通过前向补偿和因果分支更正，旧历史保留且活动投影一致。
8. 关系、承诺和债务跨章节持续并在符合因果时影响 NPC/势力计划。

## 13. 实现映射

- 模型与事件：`app/_runtime/lib/rules/v2/model.ts`、`events.ts`、`campaign-events.ts`
- 事实/知识/分享 Implementation：`app/_runtime/lib/rules/v2/actions.ts`、`campaign-actions.ts`、`compound-actions.ts`
- 唯一投影：`app/_runtime/lib/rules/v2/projector.ts`
- Room DO 事件与分支：`app/_runtime/lib/room/durable-object.ts`
- 验收：`tests/world-campaign-v2.test.mjs`、`tests/stage4-world-campaign-vertical-v2.test.ts`、`tests/observer-projection-v2.test.mjs`、`tests/causal-action-rules-v3.test.mjs`；20+ 当前多轮纵切待用窄工具/Form/Causal/Room 链重建

### 13.1 当前实现证据（2026-08-31）

- `tests/world-campaign-v2.test.mjs` 覆盖感官证据、来源主张、角色推断、有限知识 NPC 计划和 `shareKnowledge` 通过世界媒介产生接收者取得事件；分享不移动物件、不复制旧叙述，并在投影中保留来源。
- `tests/observer-projection-v2.test.mjs` 覆盖个人知识只给持有角色；异地角色在实时/统一查询投影中不可见；世界内分享后只获得结构化知识，控制转移/继任不会补回旧 Delivery 或未分享内容。
- `tests/causal-action-rules-v3.test.mjs` 验证当前因果程序在同一 Root Action 内提交冻结后果与虚构时间，并对未知引用、额外权威字段和语义 hash 篡改整笔拒绝；`tests/stage4-world-campaign-vertical-v2.test.ts` 覆盖知识取得、物件销毁后知识保持及后来者不被追溯补授。

## 14. 交叉审查

- SPEC 0001：隐藏现实、公正选择、证据/传闻、连续性和动态创造完整保留。
- 权限：知识按角色而非登录全局授予；NPC、玩家、KP 与审计 Viewer 分离。
- 秘密：事实单一但可见性策略版本化；所有旁路经同一 projector。
- 版本：定义、编译器、事件 schema、分支和投影策略均固定；旧事实不重解释。
- 第二权威：Prompt、消息表、D1 flags、页面缓存和 NPC Adapter 不得成为事实或知识真相。
