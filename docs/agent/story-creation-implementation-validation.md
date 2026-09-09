# 故事创作、幕后世界与历史分支实施回执

- 日期：2026-09-09。
- 依据：[能力合同 C01–C11 / A01–A13](story-creation-capability-contract-proposal.md)、[模块化框架](story-creation-modular-framework-proposal.md)、[批准的调用预算](story-creation-call-budget-decision.md)。
- 当前状态：用户于本轮明确要求“先进行到一个 mvp 的程度停止”。本地模块 MVP 和代表性 Room / HTTP 链路已完成本轮定向验证，停止扩展；最后代码提交为 `2791ceb`。本文不声称全部合同通过、完整支线的真实模型质量、统计稳定性或生产采用。
- 集成目录：`/Users/sanmu/.codex/worktrees/story-integration-01a07fe3/zhuwei-cloudflare`。本任务未 push、部署、执行远端 migration 或创建远端资源。

## 本轮 MVP 停止点

本轮机制合同：玩家通过正常行动表达目标，KP 能在冻结的当前世界材料中准备一条短篇并独立评审，经 Rules / Room 接入人物与事实知识；同一准备可保存、后续继续使用，未知调用不重抽，技术失败不成为世界事实。已有 NPC 冲突与新 NPC 调查通过同一真实本地 Room 路径验证，模型响应为受控脚本。有界真实模型样例只选择了普通互动，未触发完整创作；完成相关本地恢复验证后按用户要求停止，不追加采样挑选成功。

已经实现的两种创作配方、幕后事件、导出和历史分支代码保留，证据按下表如实标明。长篇与个人线的真实质量、多地区连续游玩、完整 A01–A13 验收及发布属于下一阶段；能力合同仍保留为完整目标，不改写成只有 MVP 的产品合同。

## 已实现的模块边界

| 职责 | 实际接口与主要位置 | 共同约束 |
| --- | --- | --- |
| 完整创作与独立评审 | `room/story-creation/index.ts` 的 `prepareStory`；`contracts.ts`、`authoring.ts`、`review.ts` | 输入为请求和已冻结世界材料；输出为稿件、评审或明确失败，不直接写世界 |
| 创作方法组合 | `room/story-creation/recipes.ts` | 利益冲突、调查方法与长篇、人物约束组合；稿件保存方法版本，停用方法不影响旧内容 |
| 权威材料和当前提案接入 | `room/story-context.ts`、`story-action-context.ts`、`story-preparation-host.ts`；`kp/vnext/story-materialization.ts` | Adapter 负责现役 Proposal 的映射，Rules 负责 NPC、事实、知识与时间验证 |
| 保存、复用和共同预算 | `room/story-creation-store.ts`、`story-library*.ts`、`story-runtime-policy.ts` | 同一 SQLite 中保存作业、稿件、接入映射与调用；普通提案、创作、NPC、叙述共用来源账户；不确定结果不重抽 |
| 幕后故事机会 | `room/story-world-event.ts`、`story-world-event-host.ts`，由 Room 的到期工作调用 | 根据已提交的虚构事件选择是否展开；稿件不等于已发生事件，也不直接成为 NPC 知识 |
| 导出与历史新团 | `room/story-history/index.ts`、`story-history-server.ts`、`story-history-room.ts`；Rules 的 `historical-world.ts` | 可信会话选择可恢复起点，新身份建立新 genesis；来源团不变，未来结果可分歧 |
| 玩家入口 | `/api/game`、`/table/[code]/history` | 经历导出按 Viewer 权限分页；历史起点选择、重新建卡与同请求恢复，不向玩家下载系统秘密包 |

Room Action 与 Rules 仍是系统级边界。创作、历史准备是 Room Action 内部模块；Rules、Room、身份、虚构时间和知识合同是有意保留的共同依赖。这里没有第三方代码热加载或插件市场。

## 当前验收证据

以下是已实际运行的定向证据，不把预填模型回应算作真实模型质量。表中的源码状态用于区分先前检查与后续增量；没有相加声称完整回归。

| 变化维度与链路 | 实际检查 | 结果与限度 |
| --- | --- | --- |
| 既有 NPC 地方冲突、新 NPC 调查；先接入人物再补知识；继续接入同稿剩余事实 | `npx vitest run tests/story-action-room.test.ts tests/story-world-event-room.test.ts tests/story-creation-store.test.ts --bail=1`，集成 `2791ceb` | 三文件 43/43，exit 0，30.65 秒；action 文件占 4 项。真实 Room、SQLite、Rules 与 Viewer，Provider 回应为受控脚本 |
| NPC 实际到期执行触发稿件、玩家后来复用、未知不重抽；前次预算耗尽未发送 NPC 调用后，新提交恢复旧工作再冻结新上下文 | 同上，world 文件占 9 项 | 包含 eviction、完整 storyArchive 恢复、旧 cause/预算/调用身份不变、新 Receipt 归属、旧叙述先发布和提交后崩溃恢复；不推进未来 Activity |
| 同一持久账本、失败诊断保存/导出/恢复，原始响应或诊断被替换时拒绝 | 同上，Store 文件占 30 项；`npx tsx --test tests/story-inspection-failure.test.mjs tests/story-creation.test.mjs`，集成 `2791ceb` | Worker 与 Node 均 exit 0；Node 26/26。Store/StoryArchive 从已完成调用重建失败候选，核对失败码/哈希/发现；失败稿不成为有效准备或历史主持材料，恢复不增加调用或费用 |
| 实际鉴权、历史起点、两个新角色构建、目标 HTTP 行动、源团不变及越权拒绝 | `npx vitest run --config tests/fixtures/story-history-http.config.mjs tests/story-history-http.test.mts --bail 1`，集成 `69ad0ac` | 2/2，exit 0，4.40 秒。真实路由、会话 cookie、D1 与 Room；外部 fetch 0，不声称模型叙述完成 |
| 公共类型和直接消费者 | `npm run typecheck`，最终代码 `2791ceb` | exit 0。集成时发现的诊断分类 unknown 收窄错误已修复，没有用强制类型转换绕过运行时验证 |
| 两个故事配方、同束 NPC/事实及最新对象补全接缝 | `tests/kp-vnext-object-completion.test.mjs`、`tests/kp-vnext-story-materialization.test.mjs`、`tests/story-creation.test.mjs`，主目录差量合并阶段 | Node 30/30，exit 0；合并保留双方能力 |
| 故事事实、知识与历史时间 | `tests/story-facts-admission.test.mjs`，`5a26b34` | Node 17/17，exit 0；当前起点绑定保持原候选文本，通过类型化时间映射解释 |
| 已提交稿件的时间游标和自身时间证据不误挡剩余候选 | Creation Worker 的 `tests/story-library.test.mjs`，`1612fa0` | Node 6/6，exit 0；真正新增的相关事实仍拒绝旧依赖，既有稿件原文不变 |

原有 12 个 archive 测试消费者已改传完整 storyArchive；它们先前因旧 Proposal fixture 在归档前失败，不能记为通过。现代 Room 完整归档纵切提供本次实际恢复证据，没有为旧 fixture 恢复过时 fallback。

Room 组合检查首次在首个归档用例触及默认 5 秒时限（exit 1）；单独诊断时该用例全部断言通过，实际用时 4.79 秒。两个包含多次行动、驱逐及完整归档恢复的用例改为明确 30 秒时限后，最终 43/43 通过。产品超时、调用预算和断言没有放宽。

## 已执行的有界真实模型检查

每批开始前冻结源码、输入、模型、调用和 token 上限，保存完整私有请求/响应、原稿、评审、usage、作业/账本、世界事件及 Viewer 结果。秘密和认证头不进入报告。生产合同内的一轮有界修订保留；完整动作最终明确失败、结果未知或预算/时间触顶后立即停止该批，不更换话术或任务身份来挑选成功。

已运行现有黑橡世界中的短篇地方问题样例：玩家明确投入今晚的时间协助莉安处理日常经营问题，由当前事实和留白决定具体冲突，不注入“药船已被征用”等既成事实。使用 DeepSeek v4-flash；上限为 10 次物理调用、960,000 输入 token、64,000 输出 token、20 分钟，每次调用最多 45 秒。实际鉴权/game handler/Room 和现役 strict/JSON 路由参与执行，只有传输经过本地 Node 桥；密钥及认证信息仅保留在私有运行环境。

- 零调用预检及一次 live 均正常结束，exit 0；运行源码为 `7b80eae`，382 个受检文件前后完全相同。后续恢复/诊断修复没有再调用真实模型。
- 实际 6 次物理调用，101,152 输入 token、2,580 输出 token，usage 完整，未知用量为 0。同一提交重试新增调用为 0，Receipt、Delivery 与完整私有状态保持一致。
- 结果为 `needs-review / ordinary-response`：模型选择 `social`，完成普通对话/Activity 及叙述发布，莉安获得正常社交链路中的知识；创作作业 0、故事库 0、draft/review 调用 0。因此不构成完整故事创作或故事质量验收。
- 人工发现的意图保真问题：原始 Proposal 为玩家添加了未表达的“不来唱歌”及避开歌曲/地窖话题的方式，后续 NPC 话语也受影响。保留原始输出作为待修证据，不把机器链路通过解释为玩家意图与叙事质量通过；本轮没有扩大修复或追加评审调用。
- 私有证据目录：`/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-story-room-probe-ZLb0Lc`，其中 `report.json` 保存计量和验收结果。预检证据目录后缀为 `BhrCL7`。后续复查从这些原始材料继续，不以重抽替代定位。

一次普通询问不展开支线可以成立；本批只记普通回应证据，不据此强迫世界生成冲突。档案调查/新 NPC、分阶段长篇/个人关注、自由解局及矛盾识别的真实质量批次已按用户的 MVP 决定后置。

人工审查使用以下条件：

1. 具体因果能接上当前世界；既有角色身份、动机、历史和知识连续。
2. 线索支持行动和交叉验证，玩家的合理替代办法能改变结果。
3. 长篇阶段问题与成果确实不同，个人关注来自玩家明示背景，多人仍能决定。
4. 草稿给出可主持的核心冲突和收束边界；解局、拒绝或离开不因为创作成本受到惩罚。
5. 新知情者有成立来源；旁白、导出、新历史身份均不获得不属于自己的秘密。

## 停止状态与后续范围

- 本轮收尾完成：一次有界真实模型检查、失败诊断归档验证，以及 NPC 到期调用未发送后阻断正常下一步的修复；三 Worker 已交回代码和文件所有权。
- 后续阶段：更广的独立评审有效性、连续游玩/提前收束、异地到期与信息传播、离开返回和承诺后果的组合证据。确定性字段检查不能替代故事质量。
- 创作结构检查在私有 checkpoint 保留具体失败路径，Store/StoryArchive 均核对实际保存的模型响应；公开失败仅显示 kind/code。
- 本地保存引用：`refs/codex/story-creation-mvp-20260909`。最终代码为 `2791ceb`，其后的 MVP 文档提交不改变已验证代码。
- 三路改动已集成到本文所列隔离目录，尚未合回主目录。最终复查原目录仍为 `cloudflare / 79a84d47ad0b9a40178019bc252b7378a85766d3`；未提交改动在检查期间继续增加，覆盖 Proposal、Room、规格及开场准备，与本任务存在重叠。本任务没有写入、暂存或提交这些改动，也没有 stash 或覆盖。下一次主目录集成需以届时可恢复的共同基线处理差量，不能直接用本检查点覆盖这些文件。
- 未运行全量回归、production build、浏览器游玩验收、远端 migration、push 或部署；MVP 停止点不等于可发布或完整开团质量已验收。
