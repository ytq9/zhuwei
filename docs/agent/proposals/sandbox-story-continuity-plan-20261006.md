# 同一模组的沙盒剧情实施方案

本方案于 2026-10-06 经 review 调整后获用户授权开始本地实施，随后用户要求同时处理 Claude 的 handoff。

本方案回应用户的目标：参考《黑水溪》这样的沙盒模组，在相同模组、相同开场局势下，让玩家的不同选择产生有因果依据、能够持续的剧情走向。建议先整合已有地图、行动和 NPC 分支，再补齐主持过程中的局势接续。第一轮交付用现有黑橡模组验证，不移植 CoC 规则，也不扩大为历史开团、插件市场或跨房间世界模拟。

- 核对日期：2026-10-06，Asia/Shanghai。
- 主目录基点：cloudflare / 247219fe476b，开始检查时干净。
- 状态：实施中。用户已授权本地整合与开发；未授权本轮部署、push、远端 migration 或真实模型批次。下文 worktree 盘点保留实施前基点。
- 权威依据：[SPEC 0001](../../specs/0001-llm-kp-responsibility-contract.md) §§3–4、7、9、11、14–18；[SPEC 0006](../../specs/0006-module-npc-and-faction-protocol.md) §§2–7；[SPEC 0009](../../specs/0009-failure-pacing-conclusion-and-interaction.md)；[已认可的故事能力合同](story-creation-capability-contract-proposal.md) C01–C09；[NPC 引出新内容方案](npc-introduced-content-proposal.md) B/C 段。
- 分支中的 ADR 按该分支原文和适用范围记录；未合并不等于用户尚未裁定，也不等于实现已经通过整体验收。正式集成时须同时保留代码、产品决定和证据。

## 目标与完成条件

同一模组的核心真相、初始人物、地点和物品保持一致。玩家采用不同方法、信任不同人物、公开或隐瞒不同信息、投入或放弃不同目标，可以改变角色知识、人物关系、承诺、资源、位置、NPC 计划和实际结果。下一次主持必须读取这些变化，继续形成可行动的局势；问题解决、失败或被真实放弃后允许结束。

不同措辞未必代表不同机会，不同方法也未必必然得到不同结局。差异要与实际因果相称；路线重新交汇时，已经发生的代价与人物立场仍应保留。一次正常选择不创建新的世界分支，不使用历史开团或纠错的 activeBranchId 表示普通剧情方向。

第一轮停止条件是：同一开场的代表性不同路线，通过真实行动入口形成可解释的持久差异，后续 NPC 决定、离开返回和一个阶段的收束都继续服从这些差异。只生成不同旁白、完整准备稿，或只通过单步测试，不计完成。

## Claude worktree 盘点

检查了主仓库登记的 15 个 Claude worktree，分别核对 HEAD、未提交差量、与 cloudflare 的共同祖先以及补丁等价。最终复核时所有这些 worktree 均干净；战术分支的交接文档在检查期间提交为 b0b0a26d，下面使用此最终基点。

| worktree | 分支与 HEAD | 相对主目录的判断 | 对本任务的处理建议 |
| --- | --- | --- | --- |
| relaxed-saha-bd59ee | claude/tactical-map-actions / b0b0a26d | 主目录之后 127 个提交、228 个变更文件 | 作为待集成基础，包含地图、移动、战斗、NPC 插话与立场、战后记忆、长局上下文 |
| funny-ellis-259afa | claude/locked-door-open / 8085ea0f | 主目录之后 106 个提交；相对上述战术分支有 18 个独有提交 | 在战术基础上处理门、熟练与新版本合同；106 与 127 不能相加计算工作量 |
| dynamic-generation-mechanism-6a7271 | claude/dynamic-generation-mechanism-6a7271 / 819226b3 | 主目录之后 3 个提交、8 个变更文件 | 合入目的地认知边界和新地点连接验证；适配新的 goTo 路径 |
| agent-a2c5bbe0cb96948ce | worker/door-completion / c454914c | 基于旧阶段的 worker，主要工作已移植到 locked-door-open | 核对移植差量，不再整支重复合并 |
| agent-ae4c2e934c2c8c90c | worker/proficiency-builder / 5ba14705 | 基于旧阶段的 worker，主要工作已移植到 locked-door-open | 核对移植差量，不再整支重复合并 |
| competent-ellis-0aade5 | claude/story-reuse-fix / 745ed121 | HEAD 已是主目录祖先 | 支线复用修复已在主目录，不重复做 |
| fervent-poitras-00523d | claude/story-fixture-first-filling / 4999245c | 提交号未合入，但唯一补丁有等价提交 | 故事夹具修复已覆盖，不重复拣入 |
| angry-williamson-bfd8f0 | claude/narration-empty-social-groups / 0edfeb98 | HEAD 已是主目录祖先 | 已合入 |
| brave-chaum-1e461d | claude/contested-check / f4d5cdef | HEAD 已是主目录祖先 | 已合入 |
| kp-battle | claude/kp-battle / 9842610e | HEAD 已是主目录祖先 | 已合入；分支名称不能证明新版开战入口已完成，实际新入口在战术分支 |
| npc-work-dice | claude/npc-work-dice / bbd584da | HEAD 已是主目录祖先 | 已合入 |
| admiring-dirac-186a14 | claude/admiring-dirac-186a14 / 467e7ddf | 1 个独有旧提交 | 当前 CI 已另行具有 build 后执行棘轮的步骤，按语义判为已覆盖，不为提交号补合并 |
| cranky-maxwell-7b0fbf | claude/cranky-maxwell-7b0fbf / 15986dd5 | 2 个独有旧提交 | 移动 Rules runtime 装配位置，属于独立架构整理，重新核对现有调用者后处理 |
| task-deep-module-boundary-49b120 | claude/task-deep-module-boundary-49b120 / 153e93e1 | 2 个独有旧提交、60 个变更文件 | 包含 Rules 读取 Interface 的技术决定和较早目录；不作为沙盒功能的前置整支合并 |
| local-preview-changes-8206cb | claude/play-table-structure-flake / 90c1b1a8 | 2 个独有旧提交、5 个变更文件 | 测试等待方式修复，独立核对、独立处理 |

因此，按祖先或补丁等价判断有 6 个 worktree 已被主目录覆盖，9 个仍有提交差量；9 个不代表 9 份独立待开发功能。两个 worker 的门补全相关关键文件与开锁分支一致，人物卡分支与开锁分支主要剩牧师装备及对应测试的后续调整；变基后的提交号并不相同。

### 集成冲突与版本影响

只读运行 git merge-tree，未切换分支、未修改索引或工作区：

| 组合 | 实际文件冲突 |
| --- | --- |
| b0b0a26d 与 8085ea0f | 7 个：.gate-baseline.json、proposal-capabilities.ts、round175 回执、规格索引、concealed-check.test.mjs、story-room-probe.test.mjs、concealed-primary-legacy-events.json |
| b0b0a26d 与 819226b3 | 4 个：.gate-baseline.json、proposal-bundle-lowering.ts、proposal-guidance.ts、规格索引 |

还有不会全部表现为 Git 文本冲突的决定编号冲突：

- ADR 0097：战术分支是躲藏检查；动态地点分支是目的地与新地点连接。
- ADR 0112：战术分支是结束战斗；开锁分支是工具、武器与护甲熟练。
- ADR 0113：战术分支是攻击链；开锁分支是新 runtime 与旧房退役。
- round175：两条分支各有一份不同的真实回执，必须分别保留，不能选一份覆盖另一份。

开锁分支的版本 ADR（8085ea0f 下的 docs/adr/0113-a-new-runtime-version-retires-open-rooms.md）记录用户选择新版本、旧房退役，实际改动包括新 runtime manifest 和删除部分旧事件恢复测试。它不是纯开门补丁。集成时须按该决定及仓库授权的适用范围处理；不能在合并冲突中顺手放宽兼容校验或误删仍适用的验收。

战术分支的交接文档（b0b0a26d 下的 docs/agent/handoff-tactical-map-combat.md）还有未定或未验事项。与本任务直接相关的是：旁观 NPC 的战斗记忆尚未覆盖；NPC 本人决定只能直接取得有限旧记忆；被饶过后重新开战尚无真实样本。不能把整条分支描述成沙盒能力已经完成。

## 已有能力与实际缺口

### 世界状态与人物反应已经有基础

主目录已有自然语言裁决、事实与知识、社会关系和承诺、ActorPlan、Activity、事件提交和恢复。战术分支进一步增加公开交谈后的插话、NPC 自主战斗立场、战后记忆和再次开战，以及有界的长期知识目录。

这些直接支持“同一场景不同选择产生不同后果”。建议继续复用 Rules 和 Room Authority 的同一套状态，不建立另一个支线人物库、剧情状态副本或后台世界模拟器。

证据也有边界：战术分支 e5246fc6 下的 docs/agent/receipts/vnext-round176-validation.md 记录劝降和接受玩家投降的真实通过，但没有跑成被饶过后重新开战；开锁分支 8085ea0f 下的 docs/agent/receipts/vnext-round175-validation.md 记录开锁、撞门通过，新地点的门却因前置移动失败而没有验到。未合入材料使用提交号和仓库路径定位，避免方案依赖本机 worktree 目录长期存在。

### 当前作者材料同时包含事实与旧流程指令

[black-oak-will.ts](../../../app/_runtime/lib/module/black-oak-will.ts)保留了“大厅冷场两轮”“强行破门成功就进入 ch2”“失败与不骰是同一句正常答案”等旧组织方式。[authoritative.ts](../../../app/_runtime/lib/module/authoritative.ts)将 triggers、failures、stallBeats 合到 initialPressures；[story-context.ts](../../../app/_runtime/lib/room/story-context.ts)又把 initialPressures 作为完整创作材料发送。

普通裁决的[当前场景上下文](../../../app/_runtime/lib/kp/vnext/context/runtime-requirements.ts)没有直接发送整个 initialPressures，不能据此断言每次正常行动都受旧触发词控制。这里确认的是完整创作输入仍混入旧流程要求；它造成的实际偏航风险需要代表性样例验证。

建议保留核心真相、历史和确定的危险，将主持材料整理为人物目标、可见线索、冲突、行动窗口、世界内触发条件和收束信号。章节和预设解法只是组织与参考；已有字段能够表达的内容先调整消费者和写作说明，不先建一套大型模组编辑器。这些文字是否导致偏航尚无行为证据，整理降为可选项；发现具体条款冲突或失败样例后再修正。banned 经 contentBoundary 也进入普通裁决，不能把所有旧作者材料都归为仅影响完整创作。

### 故事机会身份的重复生成风险待验证

[createStoryRequest](../../../app/_runtime/lib/room/story-action-request.ts)计算 opportunityId 时包含 goal 原文、行动者和场景集合。选择阶段虽然有复用目录，但没有稳定的“这次仍在处理同一个问题”的关联保证。

本轮运行纯本地探针，保持同一房间、场景和其余输入：

| 改动 | 是否仍为同一 opportunityId |
| --- | --- |
| 同一玩家从“继续调查这份遗嘱”改为“继续查这份遗嘱” | 否 |
| 原话不变，另一名玩家继续 | 否 |

这证明身份算法会区分上述请求，不证明每次实际对话必然重复生成——模型仍可能主动选中已有准备。当前只列风险，不能据此认定已发生重复生成或预算重置。先以明确关联的既有故事验证 Room 复用与记账；复现违反 SPEC 0015 §6.1 后再决定最小修复。

以下仅为复现后的候选方案，不是本轮必改项：以已保存的机会及其来源事实、主张、对象关系确定身份；玩家原话用于表达本次目标。模组预设问题使用稳定的模组局部身份，动态机会使用首次认可的来源记录。多人、别名和换措辞先查关联；不能只按场景把所有事件合成同一个机会。同名对象也不能据名称自动合并。

### 普通主持缺少明确的当前局势读取入口

[story-library.ts](../../../app/_runtime/lib/room/story-library.ts)按当前引用、场景和人物筛选故事目录，目录主要给标题、核心问题和创作状态；[adapter.ts](../../../app/_runtime/lib/kp/vnext/adapter.ts)只有选择新准备或已有故事后才绑定完整材料。普通裁决在[context/index.ts](../../../app/_runtime/lib/kp/vnext/context/index.ts)有意只默认读取有限连续性域，没有直接提供一份“这段问题现在发展到哪里”的相关局势材料。

已有角色记忆、关系和承诺仍会随相应人物进入上下文，因此不能说后续完全失忆。缺口是跨这些记录的故事关联、待处理问题及已发生发展，没有贯穿普通主持的明确读取合同。

建议在现有上下文构造中加入按相关问题、人物和地点选取的主持材料：当前问题、已经成立的变化、相关 NPC 当前打算、未解决的后果及收束依据。扩展 ADR 0111、0115 的分层目录和回读，沿用现有读取集；按 ADR 0044 保持稳定缓存前缀，按 ADR 0057 先说明各表单的实测增量。普通房间输入估算上限 90k，完整准备 96k；排除无关材料后仍超限须如实失败，不能截断必要依据。正文按需取回，必要依据绑定到读取集；不每轮注入全部剧本，不把摘要变成世界事实。玩家与 NPC 继续各取本人有权知道的投影。

[storyLibraryBlockedCandidates](../../../app/_runtime/lib/room/story-library-context.ts)已经会因相关世界变化阻止旧稿的未接入候选。应保留这道检查：继续读当前世界，复用未失效的材料；不得为继续故事覆盖新事实，也不得改机会 ID 绕过原预算重新生成。

### 剧本中的发展建议尚未连成持续计划

创作产物的 developments、nextIntention、resolutions 已被保存和审查，但生产接入主要处理定义与事实。NPC 的正常计划已有[formActorPlan](../../../app/_runtime/lib/kp/vnext/proposal-capabilities.ts)、[计划形成](../../../app/_runtime/lib/rules/v2/npc-plan-formation.ts)和[npc-work](../../../app/_runtime/lib/kp/vnext/npc-work.ts)，承诺也已有到期工作；缺的是准备材料与这些活跃机制的可靠衔接。

建议在对应人物和知识成立后，让 NPC 按本人视图决定是否采用、修改或放弃准备中的打算，并通过现有 ActorPlan/Activity 运行。同一决定要有稳定来源，重试不重复建计划；条件改变时走现有取消、修订或推迟路径。新人物的知识尚未提交时不能先形成假定其已知的计划，也不能把剧本里的未来结果直接写成历史。

先覆盖本场景人物和直接相关的离开返回。广域势力模拟、异地长期传播另列范围，避免第一轮扩成全世界日常模拟。

### 场景问题和故事收束是应优先修复的规格 Bug

[campaign-actions.ts](../../../app/_runtime/lib/rules/v2/campaign-actions.ts)已有 openSceneQuestion、answerSceneQuestion、raiseEndingCandidate、concludeStory，状态中也有 sceneQuestions、endingCandidates 和 stories。当前 KP 选择目录没有这些能力；Room 的[提案接入口](../../../app/_runtime/lib/room/proposal-adapter.ts)没有对应故事收束 action。

本轮本地探针确认当前选择目录有 16 项，其中包含 formActorPlan，但没有场景问题或故事收束；提交一个 concludeStory 形状的 authenticatedCampaignAction 得到 undefined。未合并的战术和开锁分支虽增加战斗结束入口，也未增加故事收束入口。战斗结束与故事问题解决需要分别处理。

SPEC 0009 §§1、8 和验收场景 4 已要求该行为，ADR 0034 未取消这些产品要求；这是现役入口缺失的 Bug。以现役提案和 Rules 验证接通场景问题、进展依据和收束。现有底层语义先审计再复用，尤其是 concludeStory 检查全房间未决机械：结束一个局部问题不能错误结束整场 Campaign，也不能跳过与该问题有关的待决行动。准备就绪、玩家介入和世界冲突结束应分开记录，任务面板不作为本次前置。

## 已批准决定与执行次序

2026-10-06 用户对 handoff 的五项问题逐项确认：

1. 没有参战但实际感知战斗的 NPC 保存本人感知到的经历。
2. 记忆包含本人目睹、但不直接涉及本人的事件，保留来源并控制长度。
3. 玩家通过交谈明确投降时同步记录本人停手；对方是否接受由 NPC 自己决定。
4. 目标 NPC 尚无可执行战斗属性时，先补齐合法定义，再允许开战。
5. 玩家角色也保存本人感知到的战斗经历，保持秘密边界。

执行顺序：

| 阶段 | 范围 | 停止条件 |
| --- | --- | --- |
| 0 本地集成 | 战术、开锁独有增量、动态地点；ADR 0119/0120/0121，保留 0114；开锁回执 round177 | 冲突解决、相关组合与规格门通过，原 worktree 保留 |
| 1 收束 Bug | SPEC 0009 §§1、8；现役 KP → Room → Rules → Viewer | 确定性测试覆盖胜利、不可逆失败、明确放弃，以及未决机械和恢复边界 |
| 2 一条真实路线 | 行动到阶段收束的有界探针 | 先准备具体用例与调用、token、金额上限，获预算后运行；不以此声称多路线沙盒全部完成 |
| 3 接续与 handoff | 在现有上下文中补相关局势、NPC 后续；落实上面五项决定及交接中的已批准待办与验证缺口 | 各子项独立验收，权限、记忆与世界事实一致；不将整个交接缩成单个测试 |
| 4 多路线验收 | 同一开场不同选择的持续后果与恢复 | 按下表核验因果、连续性与真实收束；不强求每条路径必有不同结局 |
| 待证事项 | 机会身份的重复生成风险、模组材料偏航 | 先取证，复现后按对应规格处理；不预先修改算法或正文 |

所有阶段复用现有 Rules、Room Authority、ActorPlan、Activity 和有界知识读取，不另建活跃世界权威。第一轮真实模型仅一条路线，确定性收束矩阵不能缩成只有成功路径。handoff 中的真实样本缺口须逐项记录，原批次的失败不改判。

## 代表性验收

采用相同模组版本、角色配置、NPC 初始状态、知识、物品和空间关系的新房间；仅测试房间身份不同。不同路线不先换核心真相或人物立场。确定性测试可以控制 NPC 响应与骰面以覆盖分支；真实模型验收保留实际决定，不为了获得预想剧情反复采样。

| 路线或边界 | 要证明的行为 |
| --- | --- |
| 合作调查 | 当面交流、取得许可或承诺后推进；知识、关系、交付及后续本人行动一致；不保证 NPC 必定答应 |
| 秘密调查 | 基于实际空间、工具和信息采取行动；暴露与未暴露的知情者、人物反应、后续计划不同；未知信息不旁路泄露 |
| 公开冲突或拒绝后离开 | 实际听到的人按本人知识反应；离开不撤销承诺或已到期计划；没有承诺就没有自动违约处罚 |
| 连续性与恢复 | 离场返回、超过默认近期记忆窗口、DO 驱逐和归档恢复后仍取得同一对象与相关过去；第二名玩家继续追查不重复生成 |
| 非预写解法与收束 | 合理方法可以提前回答问题或关闭原目标；允许失败与结束；不为用完稿件强加下一场或撤销胜利 |
| 动态扩展 | 从已成立的线索去新地点，通路、地图、人物知识和物品都能继续使用；虚假传闻不被生成器自动变真；无内容也是合法结果 |

验收比较事件、当前状态、本人知识、计划、收束依据和实际可见结果。不同旁白不单独计为剧情分歧；合理地汇合也不自动判失败，须看先前后果是否持续以及原因是否成立。

每阶段按 AGENTS.md 选择最多三类直接证据。优先复用 tests/kp/stories/story-action.room.test.ts、story-world-event.room.test.ts、tests/kp/npc 的计划与承诺测试，以及新增于战术分支的战后和 NPC 立场测试。共享签名改变再运行 typecheck；声明或修改规格门时按 spec-workflow 实际验证。真实模型成本另设有界批次，本方案没有发起该调用。

## 初次分析的检查与限制

已执行：15 个 worktree 的 Git 状态、祖先和补丁等价盘点；相关分支 diff、源码与既有回执读取；两个固定 HEAD 组合的只读合并冲突预演；一个不联网、不调用模型的 Node 探针，验证机会身份、可选能力和 Room 收束入口。

没有执行代码测试套件、类型检查、build、真实模型批次或浏览器连续游玩。分支回执中的通过与失败只属于其注明的源码和批次，不能作为合并后版本已验证的证据。这些是初次分析时的证据边界；实施结果以当前代码及后续独立验收记录为准。
