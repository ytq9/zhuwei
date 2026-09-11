# 引用槽准入与候选面对齐

2026-09-07。基线 `cloudflare` / `72201ea` 加本次改动。开发期任务，未部署、未 push、未跑真实模型。

## 能力合同

模型填写「已存在世界对象」的引用槽时，schema 呈现的候选集必须由同一冻结上下文按**该槽接受的对象类别**导出。prose 描述不能代替枚举；准入的类别维度必须在候选面里出现，否则模型只能靠猜。

变化维度是**对象类别**（生物 / 物理主体 / 物品条目 / 依据记录），不是某个 proposal 家族。服务端校验器仍是准入权威：候选面收窄只是填写辅助，不放宽也不替代 Rules 的完整目标判定。

## 缺陷的准确形状

`proposals.ts:434` 在 `directTargetRefs` 不可达时，**已经**算出该槽的精确候选集（viewer ∩ authority ∩ read ∩ addressable）当作诊断吐出来。也就是说服务器一直有能力说清楚这个槽能填什么 —— 只是等模型猜错之后才说。

逐槽核对当前呈现方式：

| 槽 | 呈现 | 状态 |
| --- | --- | --- |
| `observe.focusRefs` / `subjectRef` | `observationSubjectRefs` 枚举 | 已覆盖 |
| `social` `response.basis` | `npcSourceChoices` 枚举 | 已覆盖 |
| `inventoryOperation.*.entryRef` | `itemEntryRefs` 枚举 | 已覆盖 |
| `*.basisRefs` | `existingRefs`（authority ∩ read）枚举 | 已覆盖，round70 后落地 |
| `abilityOperation.operation.target.refs` | 自由字符串 | **本次修复**，round73 在此填入知识记录 |
| `worldInteraction.targetRefs` / `directTargetRefs` | 自由字符串 + prose | **本次修复**，同形状的洞 |
| `worldInteraction.instrumentRefs` | 自由字符串 | 未覆盖，见下 |

round70 的 basis 半边在本次之前已修好：`tests/kp-vnext-basis-reference-surface.test.mjs` 在改动前独立跑过，exit 0（`nonCitable` 的 npc-decision 包装既不在枚举里，也被 lowerer 以 `proposal:basis-ref-not-authorized` 拒绝）。

## 修改

- `kp/vnext/proposal-context.ts`：把三个平行的候选面函数收敛为一个 `proposalSubjectRefs(context, class)`，类别判定集中在 `subjectOfClass`，身份一律与 `entryRef` 比对，所以定义、目录、知识记录或私有决策包装不能冒充它所描述的对象。`proposalObservationSubjectRefs` 与新增的 `proposalCreatureTargetRefs` 都是它的投影。
- `rules/v2/ability-operation.ts`：`abilityOperationSourceSchema(creatureRefs?)` 可按请求收窄生物目标槽；`ABILITY_OPERATION_SOURCE_SCHEMA` 保留为无参默认，`isAbilityOperation` 与 Rules 目标判定不变。无参时结构与原常量逐字节相同。
- `kp/vnext/proposal-schema.ts`：ability terminal 用收窄后的 source schema；`worldInteraction` 的 `targetRefs` / `directTargetRefs` 改用与 observe 同一个 `subjectRef` 变体（枚举 ∪ prospective），描述里「从 viewerEvidenceRefs 选」的 prose 由枚举承担。
- `kp/vnext/proposal-provider.ts`、`room/vnext-proposal-invocation.ts`：两个生产调用点同步传入生物候选面，Room 重建与 provider 发出的 surface 保持逐字节相等。
- parser 合同 `kp-vnext2-proposal-parser-v38` → `v39`，`referenceSelection` → `frozen-authorized-read-bound-basis-and-classed-visible-subjects-v3`；workflow hash 由既有派生消费者跟随。

空候选集按既有约定用 `^$a`（不匹配任何字符串）表达：没有可见生物时该槽不接受任何成员，但不影响 `none` / `area` 等其他目标种类，也不会凭空造一个引用。

## 代表性矩阵

`tests/kp-vnext-reference-slot-admission.test.mjs`，4/4 通过：

1. **round73 原样例** —— 一条**确实可引用**（在 `viewerEvidenceRefs` 里，测试先断言这个前提）的自己知识记录，不在生物候选集里，生物目标槽拒绝它；场景也被拒绝（是物理对象但不是生物）；上下文外的 `character:not-in-context` 拒绝；整份 schema 不含该知识 ID。
2. **结构不同的同类样例** —— 换一个 proposal 家族：`worldInteraction.directTargetRefs` 接受生物与场景、接受同束 `prospective:` 句柄，拒绝同一条知识记录。证明修的是机制不是那一个槽。
3. **边界** —— 不传候选面时保留无界领域词表（不因为收窄而改变离线/单测语义）；传空数组时不接受任何成员，也不接受空字符串。
4. **单一事实源** —— `creature ⊂ physical`，两者都不超出冻结 Viewer 可见集，且与两个具名投影逐值相等；返回值冻结。

## 定向验证

同一源码状态下每项运行一次；所有失败都与 `72201ea` 基线（独立 worktree 检出）逐名对照过。

```
npx tsx --test tests/kp-vnext-reference-slot-admission.test.mjs        4/4    exit 0
npx tsx --test tests/kp-vnext-observation-reference-surface.test.mjs \
                tests/kp-vnext-item-reference-surface.test.mjs         6/6    exit 0
npx tsx --test tests/kp-vnext-world-interaction-rules.test.mjs \
                tests/kp-vnext-materialization-and-feasibility-rules.test.mjs \
                tests/kp-vnext-observe.test.mjs                        59/59  exit 0（基线同）
npx tsx --test tests/kp-vnext-ability-operation.test.mjs \
                tests/kp-vnext-proposal-schema.test.mjs \
                tests/kp-vnext-schema-retrieval.test.mjs               54/64  失败集与基线逐名相同
npx vitest run tests/kp-vnext-ability-operation-room.test.ts \
                tests/kp-vnext-stage3-room.test.ts                     37/41  失败集与基线逐名相同
npm run typecheck                                                              exit 0
git diff --check                                                               exit 0
```

### 既有失败（不是本次连带）

`72201ea` 上就已经是红的，本次零引入、零改判：

- 上述三个 schema 文件里的 10 项，基线与现在失败名称集合 `comm` 比对完全一致。
- `kp-vnext-stage3-room.test.ts` 4 项（两项 atomic Item 控制者选择、一项无冻结 Claims 的提交拒绝、一项 rope/stone trap 路径），基线与现在同名，多为 5s 超时。

### 顺带修好的两项既有失败

这两项本来也是红的，但它们正是本次要依赖的守卫，所以修对而不是绕开。都是测试侧的过时夹具，生产路径不受影响（round73 的 ordinal 2/3 能通过就是证据）：

- `kp-vnext-observation-reference-surface.test.mjs`「Room reconstructs the identical subject schema」：测试手搭的 provider surface 用的是过时参数表（漏 `npcSources` / `basisChoices`），与 Room 的重建不可能相等。改为按生产同一组参数构建，并补一条断言说明 observe 请求不含 ability terminal、生物候选面对它是 no-op。
- `kp-vnext-item-reference-surface.test.mjs`「selection advertises types only」：夹具的 `references.citations` 缺 `authorityBasisRefs` 等字段、缺 `intent.actorRef`，`requiredContextBasisReferences` 进来就抛。补齐夹具字段。

## 未覆盖范围

- **`instrumentRefs` 仍是自由字符串。** 它的准入是「行动者当前持有的 ItemEntry」（`proposals.ts:447`），带持有人作用域，不等于 `itemEntryRefs` 的「Viewer 可见 ItemEntry」。要收窄必须先从冻结上下文导出持有人作用域集合，另立合同。
- **`directTargetRefs` 的枚举是准入的超集。** 完整准入还要 `authorityWorldInteractionTargetVisibleTo(state, ...)`，依赖活跃状态与提案本身，冻结期算不出来。枚举只承担冻结上下文能判定的类别与可见性维度，Rules 仍可能拒绝一个已列出的 ref —— 这是有意的，不是漏洞。
- **真实模型未验证。** 本次没有任何 API 调用。round73 的第二句失败不因此改判；要证明这条修复真的让模型填对，必须另跑一批真实批次。
- **round73 的另外两个观察未处理**：遥测仍只报 `REFERENCE_UNAVAILABLE / unrecognized`，没有指向模型实际填错的字段位置；满血「伤势」与不分环级的「资源剩 3 次」旁白措辞缺口未动。
- **选错能力本身没修，也修不了。** round73 第二句还把 `abilityRef` 选成了上一句的 cure 而不是 healing-word。`abilityRef` 已经是行动者已注册能力的候选面问题，与本次的目标槽是两回事；选择哪个合法能力是模型判断，不是准入。
