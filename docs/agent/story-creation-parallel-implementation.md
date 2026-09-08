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
