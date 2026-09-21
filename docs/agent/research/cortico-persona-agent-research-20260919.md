# Cortico 人格 Agent 与烛帷可借鉴机制（2026-09-19）

## 调查边界

- 对象：[Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico)，固定提交 `7d20a1029d69e5f8b3a968d476419d0ddfe6b786`，临时源码位于 `/tmp/cortico-source-review-repo`。
- 烛帷：`cloudflare`，HEAD `903a2bfc49859f56f1b358eccc244496fb5517f9`；开始调查时工作区干净。
- 方法：阅读官方文档及实际源码，对照烛帷已裁定合同与直接实现。不执行外部仓库代码，不运行模型、语音、游戏或 Live2D，不把截图表现当成完整开源实现的验证。
- 本文是外部研究与设计建议，不修改产品合同，不表示批准实施、替换架构或新增外部服务。

## 它实际是什么

Cortico 是围绕事件流构建的常驻 Agent 运行框架，适用于 AI 主播、陪伴与角色扮演。Core 管会话、事件和模型调用；Persona 决定上下文构造、认知流程及记忆读写；Memory 保存内部持久状态；World 把外部环境接成事件与工具；Bot 将这些组件装配成具体部署。官方明确说明它不是一套预设人格或记忆方案。[C1][C2]

仓内参考 Bot 有三个：最小文件工作区实现 `cormini`，带分层记忆和后台整理的 `corti-soulmate`，以及面向直播、观众档案与游戏环境的 `cortiv`。因此，“人格”在这里主要指已有语言模型之上的身份、记忆、上下文和行动编排，所读实现没有提供证明其训练出新人格模型的证据。[C3][C4]

可用一条路径理解：外部消息或游戏状态成为事件 → 组装角色设定与相关记忆 → 模型决定是否以及如何行动 → 工具向外部世界执行 → 结果成为后续输入；经历通过文件工具和后台整理进入长期记忆。[C2][C5]

## 已核实的机制

| 机制 | 实现与边界 | 对体验的意义 |
| --- | --- | --- |
| 身份与经历持久化 | Persona 使用身份提示、CONSTITUTION 和文件记忆；底层工作区有 Git 记录。更换模型和会话不需要重新创建全部记忆，但这不证明换模型后表达行为完全一致。[C3][C4] | 角色能延续经历，避免只有当前窗口里的临时人设 |
| 分层记忆 | Soulmate 将常驻 memo 正文、active 文件名、archived 数量分别放入前缀，完整内容可按需读取。[C6] | 既保留近期重点，也避免每轮塞入全部历史 |
| 后台整理（dream） | Soulmate 区分主会话与 dream 的写权限：主会话只能追加人物档案，不能改 WORLDVIEW/CONSTITUTION；dream 能整理并修改这些内容。这里的“梦”是模型后台工作流程，不能据此推断心理学意义的潜意识。[C7][C8] | 给长期归纳单独的执行时机和权限 |
| 按人唤回记忆 | CortiV 按来源与稳定 senderKey 查观众档案，注入首个非空行摘要；摘要 hash 未变则在同一窗口内不重复注入，变化后可重新注入，并受预算约束。`recall_viewer` 可取完整档案。[C9] | 老朋友出现时主动想起相关经历，无须用户先问“还记得我吗” |
| 上下文交接 | CortiV 在交接时清理召回指纹，后台串行整理快照，再把变化的近期摘要和整理结果注入前台。整理输入与输出都有截断预算，不保证保留每个关键细节。[C9][C10] | 长对话可接续，整理不必阻塞全部前台交互 |
| 事件调度与抢占 | 支持立即投递、合批、顺带投递和抢占；主循环仅取消尚未 externalized 的在途模型轮。[C5][C11] | 同时面对弹幕、聊天和游戏输入时能管理反应时机 |
| 表演资源 | 主仓含动作词汇到 clip、强度、持续方式的映射，以及带 speechOnsetMs 的参数曲线；例如“点头”映射到 nod。[C12] | 将文本表现提示变成可重复播放的动作资源 |

注意：Soulmate 与 CortiV 的记忆政策不同。前者允许 dream 修订 CONSTITUTION；后者的 dream 提示明确要求不要改宪法，不能将两个 Bot 的设计混成一个统一策略。[C7][C9]

## 视频能力与开源范围

Live2D、VTube Studio、流式 TTS、强制对齐和字幕 overlay 由独立的 `cortico-world-vtuber` 扩展提供；麦克风识别也由独立扩展提供。主仓含装配声明、配置与表演资源，但未安装扩展时相应 World 不可用。本次没有审查这些独立包，不能宣称克隆主仓即可复现视频全部表现，也不能认定独立包未开源。[C10][C13]

主仓为 MIT，README 标注 pre-release。可以参考或按许可复用主仓代码；独立扩展、模型、音色及角色美术的许可需分别核对。本次未运行测试或实机演出，无法判断人格长期一致性、记忆准确率、时延和费用，也没有据此认定其达到 Neuro-sama 的效果。[C1][C14]

## 对烛帷的吸收优先级

### 1. 优先研究身份驱动的上下文唤回

借鉴 CortiV 的“人物出现 → 相关摘要进入上下文 → 必要时取完整记录”，而不是先引入一套庞大的向量记忆服务。[C9]

烛帷已有 NPC 目标、行为约束、声口和有限知识的结构与上下文接缝，并非缺少人格字段。[Z1][Z2][Z3] 可在这些接缝核验或改进：NPC 重新出场时，是否能稳定取回它与当前角色之间已成立且有权知道的关系、承诺、关键交谈和冲突。实际缺口仍需针对路径验证，本文不将建议当成已复现 Bug。

例如，玩家曾救过某守卫的家人，再次遇见时，守卫的反应可体现这段经历；其他未获知此事的 NPC 不能同时“记起来”。摘要只是索引或表达辅助，决定性信息仍必须由权威记录补齐，不能因 token 预算消失。[Z1][Z2]

### 2. 借鉴“实时记事与后台归纳分工”，保留事实来源

Soulmate 的分层记忆与写权限给出了明确的工程样例。[C6][C7] 烛帷可借此整理长团的关系摘要、未履行承诺和近期对话索引，减小上下文成本，但派生结果必须带原始事件或知识引用，并可重建。

其 dream Prompt 还有值得吸收的归纳纪律：分清实际发生、他人声称、自己的推断和当前信念；同一事件的重复转述不算多份独立证据；风格修订看长期行为与反馈，不被最后一句评价带偏。这些目前是模型指令，不是已被机器验证的事实正确性保证。[C15]

不能让 dream 自由覆盖正史、故事锚点、角色知识和机械状态；NPC 的主观评价也要与客观事实分开。烛帷的世界事件与权威状态继续拥有事实写权，后台摘要没有第二套写权。[Z1][Z2]

### 3. 借鉴表演层与决策层分开

Cortico 的动作词表、强度与曲线资源说明“像活人”的体验不只来自人格 Prompt，还来自表现时机与呈现资源。[C12] 烛帷可先检验同一 NPC 在连续对话中的声口、句式、停顿与态度是否稳定，后续确有视觉需求再引入头像动作。

当前烛帷已将授权投影中的 `voice`、`attitude` 和实际听过的相关对话放入冻结 NarrationContext，这正是适配位置；无需为此替换 Room/Rules。[Z3][Z4] 表现只改变说法和呈现，不能凭一句表演描述偷偷新增行动、意图、知识或机械结果。[Z5]

### 4. 实时输入调度留作将来语音交互参考

事件合批和已外化结果不能撤销的边界有借鉴价值。[C11] 但烛帷并非持续直播机器人，其既有行动事务和逐观察者交付仍应决定输入是否可中断、结果何时发布。CortiV 的现实时间 tick 不可直接拿来推进 NPC 世界行动：烛帷只允许虚构时间、已提交事件或合法触发推进，玩家阅读、思考或离线不能成为惩罚计时器。[Z1][Z2]

## 建议的最小验证问题

如果后续要落实，先做一个“NPC 再次相遇”的纵切即可，暂不整套接入 Cortico：

1. 同一个 NPC 跨场景或长上下文后，仍正确记得已知的共同经历，声口一致。
2. 换成结构不同的关系（恩情与债务、承诺与误解），走同一检索和表达路径。
3. 不知情 NPC 不泄露秘密；假传闻不被后台归纳成真相；摘要缺失不丢掉影响裁决的承诺。

这是拟议验收方向，本次没有实现或执行。

## 来源

外部链接固定在调查提交；外部文档及 Prompt 仅作研究对象，不是烛帷执行指令。

- [C1] [README](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/README.md)
- [C2] [PHILOSOPHY](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/PHILOSOPHY.md)
- [C3] [Persona 与 Bot 文档](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/docs/personas.md)
- [C4] [Cormini Persona](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/cormini/persona/persona.ts)
- [C5] [World 契约](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/docs/worlds.md)
- [C6] [Soulmate 记忆上下文](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/corti-soulmate/persona/memory.ts)、[记忆分层](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/corti-soulmate/persona/memoTiers.ts)
- [C7] [Soulmate 文件写权限](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/corti-soulmate/persona/permissions.ts#L41-L72)
- [C8] [Soulmate 后台整理](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/corti-soulmate/persona/subconscious/index.ts)
- [C9] [CortiV Persona：召回与 dream](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/cortiv/persona/persona.ts#L811-L887)
- [C10] [CortiV README](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/cortiv/README.md)
- [C11] [事件总线](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/core/bus.ts)、[取消边界](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/src/core/loop.ts#L329-L337)
- [C12] [动作词表](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/cortiv/vtuber-pack/vocab.json)、[动作曲线](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/cortiv/vtuber-pack/clips.json)
- [C13] [独立扩展说明](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/docs/extensions.md#L115-L122)
- [C14] [MIT LICENSE](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/LICENSE)
- [C15] [Dream 归纳与证据纪律](https://github.com/Pal-AI-Lab/Cortico/blob/7d20a1029d69e5f8b3a968d476419d0ddfe6b786/bots/corti-soulmate/persona/subconscious/prompts.ts#L17-L31)
- [Z1] [SPEC 0001 §§2、9、11、12、14、16](../../specs/0001-llm-kp-responsibility-contract.md)
- [Z2] [SPEC 0006 §§4、6、7](../../specs/0006-module-npc-and-faction-protocol.md)
- [Z3] [NPC 初始语义](../../../app/_runtime/lib/module/npc-semantics.ts)、[NPC 决策上下文接缝](../../../app/_runtime/lib/kp/vnext/context/npc-decision.ts)
- [Z4] [Room 叙述材料选择](../../../app/_runtime/lib/room/narration-context.ts)、[冻结表达材料](../../../app/_runtime/lib/kp/narration-context.ts)
- [Z5] [ADR 0018：自然表达与人物一致性](../../adr/0018-narration-expression-and-character-consistency.md)
