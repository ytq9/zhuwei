# 故事创作并行实施协调记录

- 用户授权：2026-09-08，开始按能力合同与整体模块化框架实施，使用并行 worktree；需要具体产品/版本/数据裁定时暂停相应工作并询问。
- 产品依据：[能力合同](story-creation-capability-contract-proposal.md)、[整体框架](story-creation-modular-framework-proposal.md)，上位 SPEC 继续生效。
- 初始代码基线：5d4c1512488da9e134314589344c613a60aaf26a（cloudflare）。原工作区的其他未提交修改未纳入；任何依赖在途修改的范围排队等待 checkpoint。
- 集成目录：/Users/sanmu/.codex/worktrees/story-integration-01a07fe3/zhuwei-cloudflare。
- 本文件是实施协调记录，不声称已具备能力或全部检查通过。

## 第一轮：只读接缝审查

共享验收来自 C01–C11 / A01–A13。三路先只读核实以下独立问题；代码 Implementation 的公共类型、唯一文件所有权、指定测试和依赖次序由协调者补齐并形成第二个 checkpoint 后再派发。

| Worker | 独立问题 | 禁止事项 |
| --- | --- | --- |
| creation | 完整准备、配方与语义/玩法评审的最小可执行 Interface，以及现有 KP 触发/接入方式 | 不修改现有 KP/Rules/Room、共享文档或任何源码 |
| journal | 当前持久调用与预算接缝，故事作业的原子性、恢复和可复用 SqlStorage Interface | 不修改 DO/存储、共享文档或任何源码 |
| history | 精确历史因果起点、授权导出、晚录事实及新分支 genesis 的实现接缝与具体规格影响 | 不修改归档/genesis/Rules、共享文档或任何源码 |

协调者负责共享合同、宿主集成、Rules/Room 等共享文件以及唯一执行日志。Worker 只在自己的 worktree 工作，不改 AGENTS、共享 SPEC、docs/refactor-log.md，不执行远端 migration、部署或 push。

## 尚待具体化

- 故事准备 DTO、受控创作工作流、审查报告与上下文读集绑定。
- 作业/调用身份、预算预留与持久恢复，跨作业共同额度。
- 正常行动触发、准备结果接入与后续主持，以及当前生产/开发 Profile 的适用范围。
- 支持的历史起点、身份映射、新 genesis 版本与归档数据责任；具体冲突须定位到规格条款。
- 每个 Worker 的源码与测试路径、定向验证命令，集成次序与最终代表性验收证据。

## 第一轮回执与暂停点

合同 checkpoint：d768e7fcc5e3bdb5e833cb2d38069349924f2719。三个 Worker 均基于此提交完成只读审查；没有修改源码、测试、模型调用或新的 Worker commit。原主目录其他在途修改保留。

| Worker / worktree | 决策与缺口 | 拟独占修改路径 | 实际验证与集成状态 |
| --- | --- | --- | --- |
| creation / story-creation-01a07fe3 | 完整准备与独立语义/玩法评审可以隔离；新 NPC 尚无 vNext 公开生产者，宿主需补齐正式实体路径；现有 occurrence 不能证明历史时间 | room/story-creation 下 index.ts、authoring.ts、review.ts、recipes.ts、prompt.ts；专属 Node 测试与 fixture | 只读源码与规格，无测试、无修改、无新 commit；暂停，尚无代码可集成 |
| journal / story-journal-01a07fe3 | 同一 DO SQLite 同步事务可原子预留；请求内调用计数不能代表作业总额；区分未发、已发未知、已保存和迟到结果 | room/story-creation-store.ts、story-creation-invocation.ts；专属 Store Worker 测试 | 只读源码与规格，无测试、无修改、无新 commit；暂停，尚无代码可集成 |
| history / story-history-01a07fe3 | archive/replay 可复用，首团初始化不能继承完整历史状态；需合法切点、结构化历史时间和可信新 genesis | room/story-history/**；专属 Node 测试与 fixture | 只读源码与规格，无测试、无修改、无新 commit；暂停，尚无代码可集成 |

公共 contracts.ts、宿主 Adapter、Rules、Room DO、共享类型/存储、归档接入、公开输入/投影与执行日志由协调者单写。以上文件归属待共享 Interface checkpoint 后成为正式代码派工范围，避免 Worker 各自发明不兼容类型。

第一轮暂停时的预算问题见[完整故事调用预算补充](story-creation-call-budget-decision.md)：现役 SPEC 0015 §6 / SPEC 0016 §7.2 的 Proposal 选择/填写/窄修订限制，尚未表达独立故事创作与评审作业。准备增加有界子额度，保持普通行动合同与同源总预算。

恢复顺序：取得具体预算裁定 → 更新直接规格与共享类型/Interface → 创建公共 checkpoint → 三 Worker 在原 worktree 继续独占实现 → 协调者串行集成共享核心与真实产品纵切 → 代表性验收。没有完成代码、集成或可玩性验证前不报告能力完成。

## 第二轮：2026-09-09 预算批准与独立实现

用户明确回复“同意”，批准调用预算补充。SPEC 0015 §§6.1、17、SPEC 0016 §§7.2、12 及规格索引已作窄补充；普通 Proposal 限制不因故事作业扩大。

共享 Interface 固定在 `app/_runtime/lib/room/story-creation/contracts.ts`：`prepareStory(request, context, checkpoint, ports)` 返回完整准备/评审或精确等待/拒绝。请求、上下文、配方、草稿与审查分别绑定；宿主注入 hash、持久调用及 CAS checkpoint；时间依据区分发生与取得。History 复用准备包类型，自己的导出/分支 Interface 归其独占目录。Store 通过同一个 SQLite 接入宿主端口，不成为正史写者。

| Worker | 唯一所有权 | 指定验证 |
| --- | --- | --- |
| creation | `app/_runtime/lib/room/story-creation/{index,authoring,review,recipes,prompt}.ts`；`tests/story-creation.test.mjs`；`tests/fixtures/story-creation.mjs` | `npx tsx --test tests/story-creation.test.mjs`，涵盖 A01/A02/A03、有限知识矛盾拒绝、完整评审/一轮修订、保存恢复及配方停用 |
| journal | `app/_runtime/lib/room/story-creation-store.ts`、`story-creation-invocation.ts`；`tests/story-creation-store.test.ts` | `npx vitest run tests/story-creation-store.test.ts`，涵盖同身份/CAS、共同预算、未知不重发、迟到、计量未知和外层事务回滚 |
| history | `app/_runtime/lib/room/story-history/**`；`tests/story-history.test.mjs`、`tests/fixtures/story-history.mjs` | `npx tsx --test tests/story-history.test.mjs`，涵盖 A11/A12、合法切点、异步地区时钟、知情取得筛选与越权/更正/缺失拒绝 |

Coordinator 单写 contracts.ts、Host Adapter、KP/Rules/Room/HTTP/共享存储/归档/规格/执行日志。三个 Worker 不修改这些文件、不全量测试或单独 typecheck；接口不适用时报告最小调整，由协调者更新共享 checkpoint。定向检查允许在代码变化或明确失败修复后重跑，不能挑选成功输出。

集成依赖次序：共享合同 → 三路独立实现与各自 commit → 审查并依次收回 Creation、Store、History → 核心宿主接入与真实本地能力矩阵 → 一次公共类型检查。新的 Rules/Room 共享改动目前与原工作区在途开发重叠：原目录 HEAD 为 bec5e28，尚有未提交的上下文/NPC/Promise 等修改。独立新模块继续推进；依赖部分等可恢复 checkpoint 后针对差量集成，不从旧基线覆盖主目录。

本轮仍处于开发期，不 push、部署、远端 migration、新建远端资源或改变现役房间解释。确定性模块测试不是模型质量、真实游玩或完整合同通过证据。

## 第三轮：2026-09-09 独立模块集成回执

**当前结果是隔离 worktree 中的三个内部模块及真实 SQLite/传输宿主接缝；尚未接通玩家行动入口、世界接入、幕后推进或新房间 genesis。** 代码已收回，代表性模块用例通过，不代表第一阶段或 A01–A13 整体完成。

### 可收回代码与集成处置

共同 Interface 基线为 `fd395a5`，应用代码基线仍为 `5d4c1512488da9e134314589344c613a60aaf26a`。所有 Worker 均在自己的隔离 worktree 提交；Coordinator 依次 cherry-pick，无 Git 冲突。

| 范围 | Worker 提交 → 集成提交 | 修改与直接消费者 |
| --- | --- | --- |
| Story Creation | `24adde091fa92a2faf56c648418eefbc279fc123` → `444a447`；修复 `ceadb85a041da5f18acc65ca7c6b1f365aedf999` → `ea75719` | `room/story-creation/{index,authoring,review,recipes,prompt}.ts`，专属 Node 测试和 fixture；由 `prepareRoomStory` 消费共同 Interface |
| Story Store | `8e8aa2225fb7108e1b953bb37247d4304e3deaa9` → `42d133e`；修复 `071294c13fc90ffccc9c5d034d8abe4966051b38` → `fac83e9` | `room/story-creation-store.ts`、`story-creation-invocation.ts`、专属 Worker 测试；由 `prepareRoomStory` 消费持久调用与 CAS |
| Story History | `e4d2af1e95a5978307aa7f48e1cb9f71a66674e8` → `857e487`；修复 `9e15dde30a1a8824795aaad8b000a54179764312` → `c1e012a` | `room/story-history/{contracts,index,validation,historical-cut}.ts`，专属 Node 测试和 fixture；当前真实房间生命周期调用者尚待接入 |
| Coordinator 宿主与类型收口 | 随本回执创建本地 checkpoint，父提交为 `fac83e9` | `room/story-preparation-host.ts`、`tests/story-preparation-host.test.ts`；修正 Creation 两处文件的 TypeScript 收窄。未修改 KP/Rules/Room DO 等共享核心文件 |

Coordinator 曾先修 Store 的普通回应预算门，随后由 Store 作者将该修复纳入完整账本修复；集成前仅撤回 Coordinator 自己的重复改动，再收回 `071294c`，没有覆盖其他工作。

### 本地能力合同及代表性矩阵

本轮使用者是可信 Room 宿主：同一请求、世界快照与版本绑定经过可组合创作方法，生成完整候选并独立评审，保存每个阶段和调用；候选不拥有正史写权。请求变化、未知调用、知识来源不成立或预算不足明确拒绝/等待。历史模块只准备授权导出或分支种子，不创建第二权威。

| 代表性变化 | 实际证据 | 仍缺少的产品证据 |
| --- | --- | --- |
| 药船地方冲突、档案调查、更换配方 | 两种结构不同的完整准备经过同一 `prepareStory → prepareRoomStory → StoryCreationStore → strict transport`；独立评审后保存 | A01/A02 的真实玩家输入、Rules 接入、NPC 后续回应；调查 fixture 的 `materializeNpc` 只是测试能力 schema |
| 分阶段长篇、普通无支线结果 | 长篇至少两个不同阶段；预算已耗尽或缺少未使用创作材料时，普通结果仍为零调用 `noStory` | 实际主持、多人聚光灯、提前收束和未预写方法的游玩评审 |
| 人物连续性、有限知识和时间 | 拒绝同名替身、知识自引/循环、来源晚于取得；合法直接观察和有时序的传递通过 | 对自然语言年龄/经历矛盾的真实语义质量，以及正常知识提交/离场返回 |
| 共同预算、恢复和配方停用 | 成对预留创作与评审的调用、输入/输出、估价和时延；冻结传输；保存后重启复用；未知不重发；迟到账务单调补证 | 普通 Proposal/NPC/旁白调用者仍需统一接入共同账本；真实模型成本和延迟待实测 |
| 导出与历史分支 | Viewer 路径不读系统包；精确回放前缀，拒绝不闭合切点；跨人/跨事实/来源错配与未来知识拒绝 | 真实 Host 鉴权和分页、准备资料归档、可信新 genesis、新团结果改变且原团不变 |

### 固定接口补充

- `prepareStory(request, context, checkpoint, ports)` 保留单一创作/恢复入口；地方冲突和档案调查为主要方法，长篇及新参与者为可组合约束。配方是版本化受信任资料，无网络、任意脚本或世界写权限。
- `prepareRoomStory` 使用已存作业快照、严格 DeepSeek 工具传输和 `StoryCreationStore`。它是服务器内部 Adapter，不是已经对玩家开放的 RPC。测试中的 fetch 被替代；实际 SQLite 和传输编码器参与执行。
- `OpenStoryJob.stageReservation` 为可信传输提供的每阶段上界，纳入作业身份和持久快照。Store 在首次创作前保护 `draft + review`，首次修订前保护 `revision + revisionReview`；每次调用不得突破该上界。未来评审额度不能被其他作业或普通调用抢走。
- `completed/failed` 的同一结果可以补充此前未知的 usage；响应、已知用量、调用资格、完成时间和时延不能被补证改变。未证实用量继续保留估计预留，不伪装成零费用。当前 Host 只取得 Provider token 数据，没有真实账单获取器。
- `prepareExport` 与 `prepareHistoricalBranch` 需要真实 Host 分别完成来源授权、历史语义和新身份验证。校验回执绑定完整输入与操作目的，hash 本身不是语义或权限证明。
- 第一种分支身份是 `newCharacter`。`cutState` 含来源完整状态，仅供验证，不能直接保存成新房权威；新房必须建立新的身份授权、控制、Receipt/Delivery 和预算。补录条目初始化时还须读取固定来源归档重新验证。

### 交叉审查及修复

| 问题 | 处置 |
| --- | --- |
| 普通无支线结果错误要求剩余两次创作额度 | Store 跳过未使用的创作材料及付费预留；Host 用已耗尽共同额度的对照验证零调用 |
| 不同作业各用掉一次调用，双方均无额度评审 | 共同账户持久原子预留完整两阶段的五维额度；Host 以真实异步创作期间插入第二机会验证拒绝且首作业仍完成评审 |
| 已完成响应不能补齐迟到真实用量 | 允许同结果单调补证，拒绝冲突；不重计调用和等待账单的时长 |
| 本包知识自引或引用更晚取得的来源 | 建立事实/知识依赖检查，在付费独立评审前拒绝；保留直接观察和合法传递 |
| 历史候选可改绑另一 NPC 或未来另一事实的知识 | 筛选前绑定知情者、事实、知识类型与实际来源；新增五种错配反例 |
| 集成类型检查出现七条 unknown 收窄错误 | 添加实际字符串守卫，使用显式 `never` 函数；没有通过类型强转绕过未知输入 |

### 实际验证

| 命令 / 执行处 | 最终结果 |
| --- | --- |
| `npx tsx --test tests/story-creation.test.mjs` / Creation worktree | 19/19，退出 0；初始实现为 17/17，知识来源修复后运行最终用例组 |
| `npx vitest run tests/story-creation-store.test.ts` / Store worktree | 20/20，退出 0；初始实现为 14/14，预算/补证修复后一次通过最终组 |
| `npx tsx --test tests/story-history.test.mjs` / History worktree | 14/14，退出 0；初始实现为 13/13，知识绑定修复后运行最终组 |
| `npx vitest run tests/story-preparation-host.test.ts` / 集成 worktree | 8/8，退出 0；初始宿主为 5/5，集成修复后运行最终组 |
| `npm run typecheck` / 集成 worktree | 首次退出 2，七条错误均位于新 Creation 文件；修复并收回全部模块后最终退出 0 |
| `git diff --cached --check` / 集成 worktree | 退出 0；暂存范围为宿主、其测试、两处类型收窄及协调文档/日志 |

最终目标用例计 61 项；这是模块和宿主用例数，不是完整能力合同通过数。最初 Store 测试文件曾有一个 helper 括号错误，修正后才执行到行为用例；History 初始 Viewer fixture 缺少合法战术 geometry，按现役公开投影要求补齐后通过，未修改 Rules。各 Worker 提交前 diff whitespace 检查退出 0。没有运行全量测试、全项目 Lint、build、真实 Provider 批次或浏览器游玩 QA。

### 共享核心依赖与下一步

原工作区仍为 `cloudflare / bec5e28c44f3c815a341c2f1e425cfaaeb65acf9`，有在途 KP/Rules/Room、NPC/Promise 和 SPEC 0015/0016 修改。原文件、未提交数据和当前任务未被修改或覆盖。

已向用户单独询问是否允许向现有任务“查看日志定位问题”（`01a0817a-e130-7e50-b2e8-60b06bb92910`，local）发送 checkpoint 交接请求；截至本回执尚未收到这项答复，也未发送消息。用户此前“同意”已用于明确批准创作调用预算，不重复询问预算。

依[并行规则](parallel.md)“依赖在途修复的问题等待 checkpoint”，共享核心接入排队。获准协调并取得可恢复交接后，按差量接入；SPEC 0015/0016 必须保留原任务更新后的普通选择补选合同，仅合入本任务的故事调用例外，不能用旧基线整文件覆盖。

后续依次完成：真实 KP 触发和授权上下文/读取集复核；实际 NPC/事实/取得时间 producer；正常 Proposal → Rules → Room Receipt → Viewer 接入及故事关联；普通调用共同预算和 Room 初始化/删除/归档；虚构时间的幕后发展；授权导出与新身份 genesis；A01–A13 所需真实模型和游玩证据。当前无部署、push、远端 migration、新资源或现役房间解释变更。
