# 交接：战术地图、战斗与 NPC 立场（2026-10-06）

写给接手这条分支的下一个 agent。以下内容都按 2026-10-06 的代码核对过，不是凭记忆写的。规则以 [AGENTS.md](../../AGENTS.md)、[SPEC 索引](../specs/README.md)和 ADR 为准；本文只说明现状、待办和容易出错的地方。

**当前接续状态（2026-10-06）**：用户已授权本地整合与本交接的接续开发，五项问题均已回答，见 [ADR 0123](../adr/0123-perceived-combat-continuity-and-own-decisions.md)。战术、开锁及动态地点已在 `cloudflare` 本地整合，原 worktree 保留；编号处理与集成验证见[整合回执](receipts/sandbox-worktree-integration-20261006.md)。第 1 节保留的是交接时的分支快照，不再表示尚待合并；本轮授权不含 push、部署或远端 migration。

场景问题与故事收束已按 [ADR 0122](../adr/0122-story-continuity-uses-the-current-atomic-proposal.md) 接回现役入口。下文 §5 区分本地实现与真实模型样本；尚未执行本轮真实调用，预算问题待用户回答。沙盒接续的范围与分阶段验收见[当前实施方案](proposals/sandbox-story-continuity-plan-20261006.md)。

---

## 1. 分支与现状

- **分支与位置**
  - 工作分支 `claude/tactical-map-actions`，worktree 为 `/Users/sanmu/Documents/zhuwei-cloudflare/.claude/worktrees/relaxed-saha-bd59ee`；
  - HEAD 是交接文档本身的提交，上一个提交为 `e5246fc6`（round176 回执）；
  - 比本地 `cloudflare`（`247219fe`）多 126 个提交；
  - 工作区干净，**没有 push，没有部署**。
- **远端**：远端 `main` 不动。按 AGENTS.md，只在 `cloudflare` 分支体系内工作。
- **另一条分支 `claude/locked-door-open`**（worktree `funny-ellis-259afa`，HEAD `8085ea0f`），由另一个会话做"开上锁的门"，从 `098b46a7` 分出。和本分支有两处**编号冲突**，合并前必须先改号：

  | 编号 | 本分支 | locked-door 分支 |
  | --- | --- | --- |
  | ADR 0112 | `0112-vnext-kp-ends-combat.md` | `0112-tool-weapon-and-armor-proficiency.md` |
  | ADR 0113 | `0113-the-strike-chain-on-the-combat-map.md` | `0113-a-new-runtime-version-retires-open-rooms.md` |
  | 回执 | `vnext-round175-validation.md` | `vnext-round175-validation.md`（内容不同） |

  ADR 0114 只在 locked-door 分支上，本分支跳过了这个号；本分支另有 0115–0118。合并、改号都要先问用户。
- **开发日志**：`docs/refactor-log/2026-10.md`，子任务记作 W9–W16。
- **回执**：`docs/agent/receipts/vnext-round167-validation.md` 到 `vnext-round176-validation.md`。

## 2. 必须遵守的规则

除 AGENTS.md 外，用户在会话里明确说过的：

1. **用中文回复，措辞平实。** 不用比喻、不堆修饰。
2. **提交可以自己做；push、部署、远端 migration、快进 `cloudflare` 每次都要用户点头。**
3. **永远不读 `.dev.vars`。** 真实调用只用 `--env-file` 传进去，命令见第 4 节。
4. **真实调用要先有预算。**
   - 用户上一次的授权是：每个房间最多 16 次调用，遇到第一个失败就停，修好再跑。
   - 接手后先和用户确认是否沿用。
   - **本地测试全绿不算完成，只有编号的真实批次才算。**
5. **已批准或已裁定的 SPEC，用户确认条款后才能改。** 用户这次已经确认过的见第 3 节。
6. **提示词变长时**，先告诉用户加了什么、多多少 token，再运行 `node tools/gate.mjs --accept-request-size`（ADR 0057）。新文字不能重复已有提示词。
7. **记账句要在材料里修，不在提示词里禁。**
   - 旁白里出现"结算了什么"一类句子，是因为写手拿到了那样的材料。
   - NPC 的回答也一样：修它知道什么、看见什么、是谁，不规定句式。
8. **不按数字检查 KP 的 DC。** 只要有成功分支，就说明 KP 判断能成功（用户 2026-10-02 的裁定）。
9. **git 操作。**
   - 不用 `git add -A`，逐个文件暂存；
   - 不用裸 `git stash` / `git stash pop`，stash 栈是所有 worktree 共用的；
   - 提交信息末尾加 `Co-Authored-By` 行时，按你自己的工具约定写。
10. **用户贴来一份方案却没有给指令时**，先问是要审阅还是要实现。

## 3. 本分支做了什么（按 ADR）

| ADR | 内容 |
| --- | --- |
| 0105 | 选表目录里不放"拒绝" |
| 0106 | KP 写明行动者最后停在哪里（`successEndsAt` / `failureEndsAt`），Rules 按步骤核对 |
| 0107 | 选表时写的常见动作名按 worldInteraction 处理（用户确认了 SPEC 0016 §7.2 的修改） |
| 0108 | 战斗旁白不再写记账句：按观察者合并移动段，内置动作写成看得见的样子 |
| 0109 | 只有"轮到谁行动"时，用服务器的固定句，不调用写手 |
| 0110 | 听到当众交谈的旁人 NPC 可以插话，每步最多 2 人 |
| 0111 | 知识目录分层：较早的记忆按场景和天数归组 |
| 0112 | 新版 KP 能结束战斗（`endCombat`）；敌人都不能战斗时，Rules 在回合结束时问玩家是否结束 |
| 0113 | 地图上的一击：观察者能看到武器名；徒手攻击按 SRD 为 1+力量；地图上能急救；NPC 的攻击选项带名称和距离 |
| 0115 | 长局里冻结上下文有上限：记忆清单只冻结条数和版本，NPC 视图只列读到的记忆，NPC 本人决定最多读 40 条 |
| 0116 | 死亡豁免按看得见的样子叙述，不写累计次数（用户裁定，已改 SPEC 0012 §12.1） |
| 0117 | 战斗中的 NPC 按本人视角投降、接受投降、停战或重新动手；KP 不替 NPC 决定（用户裁定） |
| 0118 | 战斗结束时 NPC 记住本人经历的经过；NPC 的当场反应和到期计划可以开一场新战斗（用户裁定） |

0117 和 0118 落实的用户裁定（2026-10-05）："投降 NPC 按照自己的视角决定，可以部分投降，也可以投降后反叛，这要看 NPC 的决定。" SPEC 0006 §§7、11、12 和 SPEC 0012 §§1、3.3、13 已按这句改写。

之后几次修复也值得知道：
- **`e62945ce`**：武器攻击那条 Claim 曾把出手者当成目标，写手因此把伤害方向写反了。
- **`2757d913`**：表格层曾丢掉击昏选择和所有反应选择的按钮，玩家看不到，行动停住。
- **`587209cd`**：昏迷或死亡的人不再给写手附说话风格，因为写手会照风格编台词。
- **`10dee7ae`**：结束战斗的理由改为结算材料。拒绝结束时，旁白走固定句。
- **`f3e99c90`**：玩家承诺的内容由服务器按玩家原话填写，KP 表单不再要这一栏。
- **`7a6e61e3`**：对战斗中的对手说话时，检定只写话起没起作用；NPC 回答审核升为 v10，把立场当作 NPC 本人的决定。
- **`a5c1e2c3`**：预备的移动目的地就在原地时，按原地不动处理；NPC 回合说明解释了 `interruption`。
- **测试夹具修复**：`385d2a31`、`0e65b189`。这两个验收门是之前拣入子任务时没跑到、被弄坏的。

## 4. 怎么验证

**开发期**（AGENTS.md「开发期验证」）：
- 类型检查：`npx tsc --noEmit -p tsconfig.json`
- Node 测试：`npx tsx --test <文件>`
- Worker（房间）测试：`npx vitest run --config <仓库根的 vitest 配置> <文件>`。通过时不打印 console 输出，诊断信息要写进断言消息。
- 闸门：`node tools/gate.mjs`
- 规格与链接：`npm run spec:check`、`node tools/check-doc-links.mjs`

**拣入别的分支或子任务之后，跑一次 `npm run gates:check`**，约 5 分钟。只挑测试跑会漏：本分支就漏过两个门，事后才发现。

**真实探针：**

```bash
node --env-file=/Users/sanmu/Documents/zhuwei-cloudflare/.dev.vars --import tsx tools/run-story-room-probe.mjs --live --case <用例> --max-calls 16
```

- 输出只走 stdout，要重定向到文件；
- 可加 `--dice 15,4,4` 预设骰面，按抽骰顺序；
- 先用 `--preflight` 检查用例，不调用模型；
- 用例定义在 `tests/support/fixtures/story-live-room-cases.mjs`，验收断言在 `tests/support/fixtures/daily-gameplay.ts`；新用例要登记到 `tests/platform/evaluation/story-room-probe.test.mjs`；
- 每个 HTTP 请求的调用上限是 12（`tests/config/story-live.config.mjs`），代码允许的最大值也是 12。

**探针证据目录**在 `/var/folders/.../T/zhuwei-story-room-probe-*`，结果 JSON 里有路径：
- `NN.provider-request.json` / `NN.response.raw.json` 是每次调用的请求和响应。`usage` 里有 `prompt_cache_hit_tokens`，可以据此算花费；
- `daily-step-N-authority.json` 的 `privateSubmissions[].prepared_json` 里有冻结的 `requiredContext`；
- `worker.stdout.log` 里的 `room.action.completed` 有 `errorCode` 和 `proposalDiagnosticFields`。

**拒绝原因只有简略记录时**，可以离线重放还原完整诊断。round176 就是这样查到 `social:player-promise-intent-required` 的：
1. 用 `prepared_json` 里的上下文、证据里的状态，加上 KP 和 NPC 的原始响应；
2. 依次调用 `parseSubmitKpProposalBundleCandidateArguments` → `npcReplySteps` / `readNpcReply` / `mergeNpcReplies` → `validateVNextProposalBundle` → `lowerVNext2ProposalBundle` → `vnext2CommandToRoomLowering` → `runtime.step`。

Rules runtime 的创建方式见 `tools/lib/vnext-authored-probe-fixture.mjs`。

**价格**（deepseek-flash，每百万 token，人民币，空闲价 / 高峰价）：

| 类别 | 空闲 | 高峰 |
| --- | --- | --- |
| 命中缓存的输入 | 0.02 | 0.04 |
| 未命中的输入 | 1 | 2 |
| 输出 | 4 | 8 |

高峰是工作日 9–12 点和 14–18 点。仓库里有些文档还写着旧价格。

## 5. 待办（按建议顺序）

### 5.1 五项决定已落实为本地实现

用户已逐项确认，现行规则在 [SPEC 0012 §13](../specs/0012-part-b-abilities-damage-and-conclusion.md) 和 [SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)，决定及取代范围在 [ADR 0123](../adr/0123-perceived-combat-continuity-and-own-decisions.md)，不再重复询问。

- 玩家与旁观 NPC 的感知记忆、目睹他人的事件及来源：`combat-aftermath.test.mjs` 覆盖本人／旁观者、失明、耳聋、完全遮挡及回放。
- social 中玩家本人停手与 NPC 独立立场：`npc-combat-stance.test.mjs` 覆盖接受、拒绝及 NPC 同时重新动手；仅要求对方投降不会变成本人停手。
- 目标 NPC 缺少战斗属性：独立主持准备请求补齐后，继续正常开战；`npc-starts-combat.room.test.ts` 覆盖调用保存和 NPC 对 NPC 开战。不存在目标秘密回流 NPC 本人视图的读取路径。

上述为脚本模型和本地规则证据，仍不等于真实模型已能稳定使用。

相关代码：
- 战斗记忆：`app/_runtime/lib/rules/v2/combat-memory.ts`，在 `combat-actions.ts` 的 `answerConclusion` 里写入；
- 交谈立场：`app/_runtime/lib/rules/v2/combat-stance.ts`，以及 `app/_runtime/lib/kp/vnext/npc-reply.ts`。

### 5.2 用真实调用验证"被饶过后再反叛"（ADR 0118）

- **现状**：只有测试，没有真实样本。用例 `combat-spared-rebel` 依赖两个 NPC 决定：奈斯先要自己投降，然后玩家饶过他。round176 里奈斯开局满血，没有投降，后面的场景就不成立。
- **做法**：做一个开局就处在"打过、投降过、被饶过、记得这场战斗"状态的固定场景。可以参考 `startsInCombat` 和 `opponent.hitPoints` 的写法，在 `tests/kp/stories/story-live-room.eval.mts` 的开局里打完一场并接受结束。然后让玩家做一件奈斯能察觉的事，看他从本人视角怎么反应：放过、说话，或开一场新战斗（新的遭遇编号）。
- **验收**：两种决定都算通过，但机械结果必须和他的决定一致。开战时必须是新遭遇，旧遭遇保持已结束。
- **固定开局已补**：`combat-after-spared` 先用 Rules 建立一次交手、NPC 投降、玩家接受及双方记忆，零调用 preflight 同时核对重放；随后真实玩家对莉安公开说话，点到奈斯，让他从本人记忆决定插话、放过或开战。验收拒绝把技术性 lapsed 当作不反应；旧遭遇不得重开。开场投降是明确披露的夹具历史，不冒充真实 NPC 模型样本。尚未执行付费批次。

### 5.3 部分投降的真实样本（ADR 0117）

两个对手，一个投降、一个继续打：不应提议结束，直到继续打的那个倒下。现有房间测试覆盖了这条，但没有真实样本，要新做一个两个对手的开局。

`combat-partial-surrender` 已补两个对手的固定开局：奈斯已经停手，瓦罗仍敌对；零调用 preflight 验证没有结束提问并重放全部事件。之后走真实地图攻击与接受结束入口，建议批次固定骰面 `--dice 15,4,4` 覆盖击倒剩余对手后收束。开场敌对和投降都是披露的夹具前提；这不验证“两名 NPC 在同一轮各自选择了什么”。该自由决定样本仍需另列批次，不能与本用例混记。

### 5.4 小问题（都是 round176 发现的）

- **同一回合重复说话已修。** Rules 只在实际说出口时记入当前回合；重规划不重置，新回合才重置，未执行草稿不消耗。`npc-combat-stance.test.mjs` 覆盖重规划后再次说话被拒且不产生事件。
- **非法 NPC 回合计划的诊断已接入既有重试。** 下一次携带保存的原计划和仅从本人选项导出的具体错误；不增加尝试次数。`npc-combat-turn.room.test.ts` 覆盖修订及重试不再调用模型。
- **旁白记账句的材料已修。** round176 的原失败保留；承诺／债务材料改为主体、内容及条件，由 `social-commitments.test.mjs` 和 `social-context.test.mjs` 验证，尚待真实旁白样本。
- **隐蔽库存动作已补选表说明。** `inventoryOperation` 承担实物变化，`worldInteraction` 承担隐蔽检定及后果。仍需真实样本检验模型是否选对；不把提示词变化记作 round176-7 已通过。

### 5.5 后续战斗与剧情摘要：本地实现接续

用户 2026-10-06 明确要求继续完成这一节；实现决定见 [ADR 0126](../adr/0126-combat-followups-use-shared-rules-and-real-exits.md) 和 [ADR 0127](../adr/0127-segmented-summaries-are-private-retrieval-hints.md)，代表性矩阵见[实施范围](proposals/handoff-combat-and-summary-completion-20261006.md)。这些能力不再整体列作待开发：

- **NPC 首次定义**：指定组合的 Multiattack、伤害免疫／抗性／易伤、命中或失败豁免后的状态；普通攻击、Extra Attack 和 Multiattack 次数分开。
- **武器与法术**：实际手持主／副手普通攻击、双轻武器附赠攻击、投掷落地、临时武器、现役通用法术的升环定义。特殊法术、多射线执行器不因“升环”被伪装成单次攻击。
- **NPC 回合**：擒抱／推撞玩家时打开本人技能选择，原 NPC 计划继续；NPC 急救使用既有 DC 10 医药规则。
- **撤离与结束**：先在地图走到真实出口，再离开；借机攻击可中断；只改变本人所在场景和活动成员身份，余下角色继续。全员倒下继续死亡机械，全员真正死亡且无剩余冲突才结束 Encounter。离开时保存本人的感知片段。
- **分段剧情摘要**：本人知识原文按固定段生成有界摘要；目录提示不可引用；原文变化后失效。调用沿现有预算与账本，恢复不重采样，归档绑定原持有者与输入。

**仍待用户裁定**：旁观者看到 KP 攻击名、职业特性机制名称的范围；现有呈现规则保留。NPC 急救的规则已由 SPEC 0012 §12.1 确定，沿本人回合选择接入，不额外调用模型。

**本地验收已完成**，实际命令、104 个声明门的组合结果及请求体积见[本轮回执](receipts/handoff-combat-summary-local-20261006.md)。本轮只有确定性规则／Room 与恢复测试；付费真实批次、模型摘要质量以及真实旁白仍待适用预算，不能由本地测试替代。此轮没有 push、部署或远端 migration。

### 5.6 更早留下的未验证项

- 爬水沟（`climb-ditch`）的结果随样本不稳定；行动者终点诊断（ADR 0106）从未在真实调用里触发过。
- KP 有时把不能引用的 `terrain-checks` 当作依据。
- 插话的旁白会重复前面的台词。
- 名字按全名逐字匹配，"瓦罗"匹配不到"书记官瓦罗"（ADR 0110）。
- 探针记录 `replyMentionsWeapon` 取到的是当时的 KP 消息，有时是击昏提问而不是旁白。它只是备注。

## 6. 容易出错的地方

- **旧事件的测试夹具要用当时的创世状态。** 新房间的编译方式变了（例如 ADR 0113 改了徒手攻击），而真实旧房间保存的是自己的创世状态。`tests/support/fixtures/concealed-primary-legacy-events.json` 现在带着 `098b46a7` 时生成的 `genesis`。
- **DeepSeek 的 strict 模式不约束输出。** 表单里去掉的字段，模型仍可能写；解码时要拒绝或忽略。
- **思考模式的取舍**：
  - 旁白审核（ADR 0069）和 NPC 回答审核（ADR 0082）用低强度思考；
  - 填写请求不开思考；
  - 写手开思考做过对照，没有更好（`docs/agent/receipts/narration-writer-thinking-ab-20261005.md`），不要再提议。
- **请求结束在"是否结束战斗"的提问时，整个行动等玩家回答后才提交**，事件还不在日志里。读这个提问要从表格的 `pendingInputs` 读，不能从已提交事件读。
- **NPC 本人的请求**（回合、反应、到期工作、回答）不在 `gate.mjs` 的体积统计里，变大时要自己量出来告诉用户。
