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

需用户裁定的当前唯一问题见[完整故事调用预算补充](story-creation-call-budget-decision.md)：现役 SPEC 0015 §6 / SPEC 0016 §7.2 的 Proposal 选择/填写/窄修订限制，尚未表达独立故事创作与评审作业。准备增加有界子额度，保持普通行动合同与同源总预算。

恢复顺序：取得具体预算裁定 → 更新直接规格与共享类型/Interface → 创建公共 checkpoint → 三 Worker 在原 worktree 继续独占实现 → 协调者串行集成共享核心与真实产品纵切 → 代表性验收。没有完成代码、集成或可玩性验证前不报告能力完成。
