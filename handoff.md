# vNext 阶段三 — 交接说明（给接手的 Codex）

**状态：开发检查点，不是阶段三完成，不可生产采用。**
本文档描述接手时的真实状态、已核实的结论、以及剩余任务。所有数字都是在本机实跑得到的，不是转述。

- 分支：`feature/kp-agent-vnext-stage3-continue`
- HEAD：`951c013`（合并提交），工作树干净
- 工作目录：`/home/ubuntu/workspace/zhuwei/.claude/worktrees/stage3-cont`
- **未推送**：`origin` 上最新仍是 `0b4c7ad`，本轮全部成果只存在于本机本地分支

---

## 0. 先读这一节：会浪费你半天的坑

这些都是本轮踩过的，按严重性排列。

1. **`| tail` 会吞掉退出码。** `npx tsx --test ... 2>&1 | tail -10` 的退出码是 `tail` 的，永远是 0。本轮据此误判过「全绿」。
   正确写法：先落文件再看，`... > out.txt 2>&1; echo "EXIT=$?"; grep "^not ok" out.txt`。

2. **Worker 套件在本机会大面积假失败。** vitest 默认 `testTimeout` 是 5000ms，本机 Durable Object 测试要 5044ms 起。裸跑 `npx vitest run` 得到 29/45 文件失败——**这不是代码坏了**：同一个用例在未改动的检查点 `0b4c7ad` 上同样失败，加 `--testTimeout=60000` 后 19.75s 通过。
   必须用：`npx vitest run --testTimeout=60000 --hookTimeout=60000`

3. **不要并发写同一棵工作树。** 上一个检查点就是三个并发任务把树写成不可编译才被迫中止的；本轮也再次发生（两个 agent 同时写 `stage3-cont`）。要并行就用独立 worktree，且先确认文件集不相交。

4. **只跑 vNext 子集会漏掉真实回归。** 本轮 `165/165` vNext 全绿的同时，legacy V3 causal 路径有 3 个用例是坏的（见 §2 的 `e363129`）。**至少跑一次全量单元套件**再宣称健康。

5. **DeepSeek key 是有限的测试额度。** 用户明确要求不要随意调用，只在真实验证时用。离线能验的（schema dialect 校验、parser 契约、fixture 测试）先离线验完；真要调，一次调用就把 provider 的错误体打出来，不要靠猜反复试。

---

## 1. 环境（本机已配好，换机要重做）

- **Node 是本轮现装的**，系统里原本没有：`~/.local/node/node-v22.23.2-linux-x64/`，已软链到 `~/.local/bin/{node,npm,npx}`（该目录本就在 `PATH` 上）。`package.json` 要求 `>=22.13.0`。
- `node_modules` 在主检出 `/home/ubuntu/workspace/zhuwei/node_modules`，各 worktree 用软链复用，不要在 worktree 里重装。
- 无 `.dev.vars`，`DEEPSEEK_API_KEY` 不在环境里，需要时由用户提供、单条命令内经环境变量传入，**不要写进仓库任何文件**。

## 验证命令（当前基线）

```bash
npm run typecheck                                          # exit 0
npx tsx --test tests/kp-vnext-*.test.mjs \
  tests/deepseek-strict-tool-provider.test.mjs             # 165/165
npx tsx --test tests/causal-action-rules-v3.test.mjs       # 24/24
npx vitest run tests/kp-vnext-stage3-room.test.ts \
  --testTimeout=60000                                      # 7/7
```

全量单元套件（约 30 分钟）最后一次完整结果是在合并**前**的 tip 上跑的：624 个用例、18 失败，其中 3 个是真实回归（已修，见 `e363129`），其余需在合并后的 HEAD 上重跑确认。**合并后的全量跑本轮未跑完，这是接手后第一件该做的事。**

---

## 2. 本轮已完成（`0b4c7ad..951c013`，16 个提交）

### 自己写的
| 提交 | 内容 |
|---|---|
| `11cf36b` | Bundle 多条目原子 lowering（`atomicRulesSteps`，按 produces/consumes 图拓扑排序）；修复确认高风险时 `acceptedCosts` 从不校验的缺陷 |
| `e1e2e3b` | RequiredContext：`sameSelector` 的 `JSON.stringify` 键序敏感 bug；`requiredContextMatchesPreparedAction` 的死代码；新增 12 个 availability 测试 |
| `e51c20c` | 接线 `materializeSemanticDefinition` 与 `ruleWorldInteractionFeasibility` 两个类型化 Rules 原语 |
| `2da58a5` | **撤销一个被发明出来的不变量**（详见下） |
| `96f5507` | **修一个真实保密泄漏**（详见下） |
| `f821a38` | 原子多步在 Rules 内执行 |
| `1c8e69f` | Claims / Narration / recovery 契约 |
| `e363129` | **修一个真实越权回归**（详见下） |
| `951c013` | 合并 strict-tool 分支线，零冲突 |

### 三个值得你知道的判断

**a. `2da58a5` — 撤销了自满足的 `contextHash` 校验。**
原本 Rules 侧用 `materializationContextHash(rootActionId, bundleHash, readSet)` 重算并比对 `plan.contextHash`。但这三个输入全部来自 plan 自身，等于自证，且与既有契约矛盾：`proposals.ts:252` 要求信封的 `contextHash` 等于 `requiredContext.binding.contextHash`，既有的 revision / world-interaction plan 都是原样携带该绑定 hash，Rules 只做 `authorityReadSetMatches` 判陈旧。留着它会在 `materializeObject` 接 KP 侧那天必然拒绝。

**b. `96f5507` — 隐藏 prerequisite 引用会进入公开载荷。**
in-world refusal 事件以 `secrecy: "public"` / `visibility:scene-observers` 提交，载荷带 `prerequisites[].ref`，而这些 ref 原先只对**authority** read set 校验——那只说明 KP 有权推理，不代表玩家可见。一个 `knowledge` 类前置条件指向玩家无证据的事实就会泄漏。现在改为对 Viewer 证据集校验，与既有的 `world-interaction:direct-target-not-addressable` 闸门一致，隐藏引用整条 ruling 失败关闭而非静默丢弃。

**c. `e363129` — vNext handler 越权拒绝 legacy continuation。**
`fulfillVNextWorldInteractionRandomness` 把 Profile 闸门提到了归属判断之前，导致 vNext 扩展未启用时，**任何**进入该函数的 continuation 都被拒（含它根本不拥有的 V3 causal continuation）。返回 `undefined` 才是它「不认领」的方式。3 个 V3 用例因此失败，在检查点上是通过的。**这是 `f821a38` 引入的——同批的 `1c8e69f` 因此不能默认可信。**

### 合并进来的（strict-tool 线，非本人所写、未复核）
`35c06d7` `67755cf` `cda778c` `2de8272` `3ccb8fe` `b4ea1fa` `5488b4c` — 私有 V3 Form 的 strict dialect schema、按 profile 选传输、字段级失败遥测、strict draft 解码、重试可供性。
与 vNext 线**文件零重叠**，属互补而非重复：`form-strict-tool.ts` 管 legacy V3 Form，`proposal-schema.ts` 管 vNext Bundle，二者共用 `deepseek-strict-tool.ts` 这个 dialect 校验器。

---

## 3. 剩余任务（按建议顺序）

### P0 — 先做，否则后面都是浮沙

**T1. 在合并后的 HEAD 上跑完全量套件。**
```bash
npx tsx --test "tests/**/*.test.mjs" > unit.txt 2>&1; echo "EXIT=$?"; grep "^not ok" unit.txt
npx vitest run --testTimeout=60000 --hookTimeout=60000 > worker.txt 2>&1; echo "EXIT=$?"
```
合并前 tip 有 18 个单元失败，其中 3 个已修。**剩下 15 个的归属未查清**——需要和检查点 `0b4c7ad` 的同一份跑做差集，才能分清是继承的还是本轮引入的。基线文件在 `/home/ubuntu/.claude/jobs/2e699b26/tmp/{tip-1c8e69f,base-0b4c7ad}.txt`（两次跑都被中断，只跑到约 1/5，仅供参考）。

**T2. 复核 `1c8e69f`（约 2774 行）。** 覆盖 `claims.ts` `narration-v3.ts` `durable-object.ts` `proposal-provider.ts` `proposal-validator.ts` `proposal-correction.ts` `model-registry.ts`。同批的 `f821a38` 已查出一个真实越权回归，这批必须逐项过。

### P1 — 真实 Provider 已证伪，诊断已到位

**T3. 修 `anyOf` 缺 `type`。**
真实握手（用有效 key）结论：
- `correct_kp_proposal_bundle` **通过**
- invalid-schema 探针 **通过**（HTTP 400 且 `rejectedBeforeGeneration: true`，证明 DeepSeek 确实在生成前强制 strict schema——整个设计依赖的性质成立）
- `submit_kp_proposal_bundle` **被拒**，错误原文：
  ```
  Invalid tool parameters schema : field `anyOf`: missing field `type`
  ```
诊断：schema 共 30 个 `anyOf` 节点，**全部**缺 `type`，且无任何兄弟键。按分支形态分：16 个是 `$ref` 并集（→ `object`）、10 个是字符串并集（→ `string`）、2 个 `$ref`+`object` 混合（→ `object`）、**1 个真异构 `array`/`boolean`/`number`/`string`**（自由 JSON 值，没有单一 type，需要单独决策——可能要改建模而不是加个字段）。另有 3 个 `$def` 条目自身是无 type 的 `anyOf` 包装：`semanticOperation`、`refusalRuling`、`clarificationContinuation`。
源头在 `app/_runtime/lib/kp/vnext/proposal-schema.ts`（17 处 `anyOf`）。
排除项：`$def`（非标准键，标准是 `$defs`）**不是**原因——65 个 `$ref` 全部能内部解析，且报错明确指向 `anyOf`。深度 14、19KB 也不是。

**T4. 补 `deepSeekStrictToolSchemaIssues`（比 T3 更重要）。**
`app/_runtime/lib/kp/deepseek-strict-tool.ts` 的本地 dialect 校验器对上述 schema 报告 **0 issues**——它不认识 provider 实际强制的规则。这才是「为什么非得烧一次真实调用才发现」的根因。把「`anyOf` 必须同时带 `type`」加进去，并补测试。

**T5. 修完后重跑一次握手确认。**
```bash
DEEPSEEK_API_KEY='sk-…' npx tsx tools/run-deepseek-strict-tool-handshake.mjs \
  tools/deepseek-vnext2-strict-tool-handshake-definition.mjs
```
无 key 时会干净返回 `blocked` / `DEEPSEEK_API_KEY_MISSING` / `liveProviderCalls: 0`，可安全空跑验证接线。

### P2 — 阶段三真正的剩余能力（原任务 5，一点没动）

**T6. 删除旧 vNext 双入口。** 真正的第二入口只有一处：`app/_runtime/lib/kp/vnext/room-bridge.ts:160` 的 `VNEXT_KP_PROPOSAL_SCHEMA` 分支（import 在 :15）。注意 `proposal-bundle.ts` 内部 `lowerExecutableEntry` 仍复用旧 lowerer 构造旧信封——那是实现细节，不是第二入口，可保留但要注明。会波及 `tests/kp-vnext-stage3-room.test.ts`（:735、:829）与 `tests/kp-vnext-world-interaction-rules.test.mjs`（:637 及直接调用处），需改写为 Bundle 信封。

**T7. Viewer 保密端到端验收** —— 证明 Claims / Narration 不泄漏 authority-only 引用。
**T8. Narration 重试路径验收。**
**T9. 阶段三完整纵切矩阵。**

### P3 — 仍然 fail-closed / 已知缺口

**T10.** `room-bridge.ts:295` `highRiskConfirmed` 无 Rules 消费者。
**T11.** `room-bridge.ts:253` 尝试成本无 transition：只有 `kind: "item"` 有 Rules 路径，`fictionTime` / `resource` 会让整条 refusal lowering 失败关闭。注意 `validateAttemptCosts` 会跳过 `fictionTime`（视为合法），于是「花了十分钟没成功」这种极自然的情形目前无法落地。要支持得新写 Rules transition，不是补字段。
**T12.** `openBlank` 授权提交时从不重校验：`authorizationRef` / `authorizationHash` 在 `required-context.ts` 与 `context/availability.ts` 之外**没有任何消费方**；提交期只校验 `rulesInput.plan.readSet`，而后者只由 `known` 条目构成。目前**休眠**——没有任何调用方向 `freezeAdjudicationContext` 传 `availabilityRequirements` / `openBlankAuthorizations`，所以实时路径产不出 `openBlank`。是门后的洞，接线那天必须同时补上。

### P4 — 从未跑过的门

**T13.** `npm test`（build + 两套件）整体跑绿；全项目 lint；production build。
**T14.** SPEC 0001 A–O 全绿 —— 这才是生产采用门，本轮完全没碰。
**T15.** 浏览器 QA、migration、部署、push。

---

## 4. 不可破坏的不变量

1. **一个玩家动作 = 一次 Rules 事务 = 一个 Receipt。** 多步 bundle 要么全提交要么全失败。不要把 `RoomVNextProposalLoweringResult` 放宽成返回输入列表——那正是部分执行风险。
2. **无权 Viewer 永远不得取得 authority-only 引用。** 「通过 authority read set 校验」≠「玩家可见」。任何进入公开载荷的字段都要对 Viewer 证据集校验。
3. **失败要关闭，不要半执行**，也不要静默丢弃真实成本。
4. **Rules 内不得有 `Date.now()` / `Math.random()`**，随机只经既有 continuation / randomness-request 缝。
5. **不要为了让测试通过而放宽共享 fixture 的权限。** 本轮抓到过一次：某个 worker 把共享 fixture 的 `viewerEvidenceRefs` 放宽成全部 ref，一举关掉了整个文件十个用例的 direct-target 可见性闸门。要授权就只在那一个用例里窄授权。
6. **既有约定优先于新造不变量。** 满足不了就说清楚，不要发明一个自证的替代品（见 `2da58a5`）。

---

## 5. 其他工作树（可清理）

`t2-reqctx`、`t3-bundle`、`verify-f821a38`、`merge-check` 均为本轮验证用的临时 worktree，`kp-strict-and-retryable` 已合并（locked）。确认无未提交内容后可 `git worktree remove`。
