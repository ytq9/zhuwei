# docs/agent 目录结构

本目录原为 307 个平铺文件，研究、提案与验收回执混在一层。现按用途分开：

| 目录 | 内容 | 数量 |
| --- | --- | --- |
| `proposals/` | 合同提案、方案与裁定依据（`*-proposal.md`、`*-plan.md`、`*-decision.md`、`*-redesign.md`） | 17 |
| `receipts/` | 验收回执，一次性证据（`*-validation.md`） | 137 |
| `fixtures/` | 集成夹具与真实响应样本（`*.json`） | 133 |
| `releases/` | 发布与推送记录 | 7 |
| `research/` | 外部调研笔记（`*-research-YYYYMMDD.md`） | 3 |
| 根目录 | 指导文档与当前工作项：剧本写作指导、handoff、repo-map、production-todo 等 | 11 |

回执与夹具是历史证据，读完即可归档，不作为当前产品行为依据；产品合同在 `docs/specs/`，技术决策在 `docs/adr/`。

## 按任务查阅

- 排查页面报错、按故障编号查询日志或实时采集：[故障排查](diagnostics.md)。区分历史查询权限失败、没有记录和结果截断。
- 逐项查看产品与 KP 功能的验收样例、测试入口、历史证据和待补范围：[功能验收清单](functional-acceptance.md)。该清单是验收导航，当前运行结果仍以具体源码状态下的工具输出和回执为准。
- 定位实现、运行环境与验证入口：[repo map](repo-map.md)；运行时与认证约束见 [README](../../README.md)。修改前仍以源码与配置核实实际位置。
- 创建或补充剧本、修改开场准备：先读 [写作指导](module-writing-guide.md)；涉及黑橡剧本时再读 [开场补充](black-oak-opening-preparation.md)。
- 承接 vNext 生产替换或其真实 API 验证：[生产替换 TODO](vnext-production-todo.md) 记录专项授权、数据范围、批次预算与停止条件。先核对适用范围，历史交接不自动授权本轮部署或扩展任务。

## 当前待办任务书

- [同一模组的沙盒剧情实施方案](proposals/sandbox-story-continuity-plan-20261006.md)（2026-10-06，实施中；本地整合、收束与感知记忆已实现，真实路线预算及剧本候选的本人采纳调用待确认，多路线长期验收未完成）
- [交接：战术地图、战斗与 NPC 立场](handoff-tactical-map-combat.md)（2026-10-06，已整合进本地 `cloudflare`；编号冲突已处理，五项问题已裁定并落实。固定开局已准备，真实样本和后半能力仍待完成；未 push、未部署）

- [NPC 提到的新内容：审核、成真与支线触发](proposals/npc-introduced-content-proposal.md)（A 段[原实施回执](receipts/vnext-npc-reply-review-stage-a-validation.md)与 [review 修复回执](receipts/npc-reply-review-follow-up-20260930.md)；确定性缺陷已修，真实审核格式与两项规格门波动未关闭。B/C 段待实施，完整真实链未验收）

- [动作结果与见证覆盖填写合同草案](proposals/action-results-and-witness-coverage-proposal.md)（review 后待裁定：保留独立条件库存、逐候选多感官覆盖与 Ability 阶段授予；六项缺陷修复独立验收）

- [深 Module 边界剩余 115 处违规](./task-deep-module-boundary.md)（2026-09-20 方案 (b) 已按 [ADR 0036](../adr/0036-publish-the-rules-shape-vocabulary.md) 实施，148 → 115）
- [vNext 提案请求体积没有离线门](./task-vnext-request-size.md)（2026-09-20 已按 [ADR 0035](../adr/0035-ratchet-the-vnext-proposal-request-size.md) 进棘轮；计数器校准仍未裁定）
- [未声明为门的 Worker 套件与现役合同的剩余偏差](./task-worker-suite-drift.md)（2026-09-20 已修完，保留为这批产品裁定与遗留缺口的记录）

V5 的提案请求体积任务书随 `tools/run-kp-v3-eval.mjs` 于 2026-09-20 按 [ADR 0034](../adr/0034-remove-the-v5-private-form-proposal-path.md) 一并删除：那四道红门量的是已退役的 V5 提案请求。vNext 的等价缺口另立上面那份任务书，并带 2026-09-20 的实测数字。

任务书是自足的：新会话不需要上下文就能接手，写明了已确认的事实、需要用户裁定的点，以及不该做什么。0012 战斗机械的单测失败已于 2026-09-18 按 [ADR 0029](../adr/0029-combat-checkpoint-drift-repairs-and-rulings.md) 修复并裁定，任务书已删除。

`node tools/check-doc-links.mjs` 检查本仓库 Markdown 的相对链接是否可解析。
