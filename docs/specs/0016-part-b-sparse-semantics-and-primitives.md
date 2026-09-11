---
kind: part
part_of: "0016"
title: "SPEC 0016 分册：稀疏语义定义与 Rules 有限原语"
clauses: "5-6"
---
# SPEC 0016 分册：稀疏语义定义与 Rules 有限原语

本文件是 [SPEC 0016](./0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md) 的 §5–§6，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 5. 稀疏语义定义与有限关系

### 5.1 不建设材料物理系统

动态场景对象和 NPC 只需要足够支持游戏裁决的稀疏语义，不需要把现实物理预编码成完整数值系统。一个相关对象切片可以包含：

```ts
type SparseSemanticDefinition = {
  definitionRef: string;
  revisionRef: string;
  kind: "npc" | "object" | "hazard" | "location" | "item" | "other";
  label: string;
  description: string;
  materialDescription?: string;
  observableState?: readonly SemanticState[];
  affordances?: readonly SemanticAffordance[];
  mechanicDefinitionRefs?: readonly string[];
};

type TypedRelation = {
  relationRef: string;
  kind: "supports" | "attachedTo" | "contains" | "blocks" | "triggers";
  subjectRef: string;
  objectRef: string;
  state: "active" | "ended";
  visibilityRef: string;
};
```

`materialDescription` 可以表达“铁制链条”“干燥麻绳”“薄木板”等语义事实；它不要求结构强度、燃点、载荷阈值或每种伤害类型的物理参数。关系只在游戏实际需要时建立，不要求为场景构建完整知识图谱。

KP 根据这些已固化语义、角色做法、工具、Geometry、自然规律和先例判断“枪能否打断铁链”“火能否烧断麻绳”“石头是否足以触发压板”。Rules 不用缺失的材料阈值替 KP 决定现实可行性，也不因没有对象模板拒绝合理行动。

### 5.2 决定性缺失事实必须先固化

若已有语义不足以区分结果，而且该差异将产生因果证据、随机或机械后果，或者玩家已经引用、调查、接触或利用先前描写的细节，KP 必须在裁决及这些后果出现前：

1. 引用已有事实推导；或
2. 在开放留白中提出新事实/稀疏定义；或
3. 为同样合理候选请求可信随机固化。

不得在看到骰面、玩家剩余资源或后续选择后再补“链条其实更脆”“石头其实足够重”等决定性事实。

尚未承担这些作用的环境细节可先创作并保存叙述承诺，无需预建完整规则对象；固化时必须继承承诺已经明确的内容，补齐本次必要的规则语义。不得用非机械描写暗中追加危险、线索结论、实际资源或不可逆后果，也不得用固化步骤撤回已描写内容。已发布矛盾按 SPEC 0001 §17 可审计更正，未提交矛盾拒绝后重做。

### 5.3 模板只提供创建时默认语义

对象/NPC 模板属于版本化静态语料，只提供默认语义和出处，不拥有场景存在性、写权限或活跃状态。允许覆盖的字段由 runtime manifest/Profile 按 semantic kind 固定，不能由模板文档自行扩大。实例创建时将 exact `templateRef/templateHash` 与稀疏 override 一次合成为完整定义；模板后续发布不回溯改变已有实例。

常见对象可以在场景物化时创建，也可以在首次相关的开放留白中按需创建，但两条路径都必须产生具有稳定身份的真实实例。多个可互动对象不能用一个复数 `sceneFeature` 代表并允许无限抽取；多个真实但可互换实例由 §4.4 的候选规则消除无意义选择。数量、所有权、耐久与资源等机械字段仍由相应 Item/Rules 生命周期表达，不能塞入稀疏语义定义。

### 5.4 稀疏修订由服务器合成完整下一版本

对已有动态定义的修订必须绑定 exact `baseDefinitionRef/baseHash` 与 `templateRef/templateHash`。KP 只提出允许字段的稀疏领域变化与 `basisRefs`；服务端从权威 base/template 合成完整、规范、不可变的 `nextDefinition`，验证引用、字段、权限和机械定义后交给 Rules。只有完整下一版本及其事件进入权威状态：

```text
sparse revision proposal
+ exact base definition/hash
+ exact template/hash
→ server canonical synthesis
→ Rules validation
→ immutable next definition + revision event
```

模型 patch、JSON Patch、部分对象和合并指令都不得作为状态、事件或第二事实源保存。旧事件继续引用原 definition revision；新修订不得原地改写历史。若修订引入机械能力，只能引用/生成 Rules 能验证的版本化 Ability/Item/Mechanic 定义，不能把自然语言效果直接当机械。

## 6. KP 判断与 Rules 有限原语

### 6.1 权威分工

主 KP 负责：

- 理解玩家的目标、方法、对象和重大歧义；
- 依据冻结上下文判断五类可行性；
- 设定 DC、优势/劣势、风险、时间、前提及成功/失败的世界意义；
- 选择相关对象、工具、事实和关系，提出因果候选；
- 在开放留白中提出必要的新事实、稀疏定义、NPC 回应、目标/故事连续性变化；
- 区分世界真相、感官证据、角色推断与来源主张。

Rules 负责：

- 重新验证 principal、actor、控制权、地点、回合、作用域、引用和 Profile/hash；
- 验证行动经济、能力、资源、距离、目标、时间、状态和生命周期不变量；
- 请求并执行 Room DO 权威随机，选择实际冻结分支并计算数值结果；
- 原子提交类型化事实、机械、关系、知识、物品、Objective/Story 和时间事件；
- 通过同一 `project/replay` 生成 Viewer 投影与确定性回放。

KP 不能填写权威骰面、最终伤害、实际隐藏目标集合、任意事件、JSON Patch 或“已经成功”；Rules 也不能把“数值高”“队伍等级低”或“缺少材料阈值”当作否决 KP 合理世界裁决的理由。

### 6.2 有限原语家族

下一代 Rules Profile 只注册游戏实际需要的有限、类型化原语家族：

- Ability invoke、check/save/attack、资源/行动成本和结果绑定；
- 世界事实、感官证据、来源主张与角色推断的固化；
- 语义定义 create/revise，以及类型化 relation/state transition；
- Item acquire/transfer/equip/stow/use/consume/damage/repair/destroy；
- Objective open/advance/fail/abandon/complete 与 threat/commitment 连续性；
- Story candidate/conclude/epilogue/sequel 连续性；
- Activity schedule/interrupt/complete 与虚构时间；
- 已注册 Ability/Hazard/Geometry 所需的区域、目标、伤害、状态、死亡与地形后果。

原语是 Rules Module 的私有 Implementation vocabulary，不是玩家菜单或 LLM 的自由脚本。不得提供任意 `worldEffects`、任意字段赋值、通用物理求解、按对象名派发或绕过 `step` 的直接事件入口。新增机械原语仍要求新 Rules manifest/interpreter 和 conformance suite。
