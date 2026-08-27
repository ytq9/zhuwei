# 权威状态独占世界事实提交权

- 状态：部分被 ADR-0005 取代
- 规则版本：D&D 5e 2014 / SRD 5.1

本 ADR 关于 `step` / `project` 单一提交与投影权威、事实可重放和秘密隔离的决定仍然有效；“AI 只解释和叙述”“AI 不得提出 DC 或新世界事实”以及模组必须使用封闭故事 DSL 的限制已被 ADR-0005 与产品规格 `docs/specs/0001-llm-kp-responsibility-contract.md` 取代。

## 背景

AI 直接返回位置、线索、资源和场景补丁，会把 Prompt 记忆变成事实来源。已经观察到的故障包括唯一遗嘱被再次生成，以及玩家绕过锁门直接接触内部神龛。

## 仍有效的决策

在新的实现规格获批前，`step(module, state, command)` 仍是唯一机械裁决入口并产生 append-only `WorldEvent`；`project(module, state, viewer)` 仍是唯一公开快照入口。AI 不得自报权威骰面、把 Prompt 记忆当作状态、绕过规则内核直接写入资源和机械效果，或向玩家投影秘密答案。

## 已被取代的决策

“AI 只解释候选命令和叙述已提交事件”“AI 不得提出 DC 或新的世界事实”，以及模组必须预先把 Portal、Artifact、Interaction、NPC Plan、ScheduledEvent 与 Ending 全部写进封闭 DSL 的要求已经失效。新的产品方向允许 LLM/KP 按批准规格提出动态叙事事实与机械方案，再由同一规则和状态权威验证、固化和投影。

## 验收场景

1. KP 可以提出新的叙事事实和机械方案，但只有 Rules `step` 验证且 Room Authority 原子提交的事件才进入世界状态。
2. 页面、API、AI Adapter 与 D1 不能直接应用事件、生成骰面或修改活跃机械状态。
3. 两个不同 Viewer 只能经同一 `project` 得到各自有权观察的事实；未公开真相和私人知识不会通过快照、错误或候选旁路泄漏。

## 实现映射

- Rules 公共边界：`app/_runtime/lib/rules/v2-runtime.ts`、`app/_runtime/lib/rules/index.ts`
- 行动与事件：`app/_runtime/lib/rules/v2/actions.ts`、`app/_runtime/lib/rules/v2/events.ts`
- 单一投影：`app/_runtime/lib/rules/v2/projector.ts`
- Room 提交：`app/_runtime/lib/room/action.ts`、`app/_runtime/lib/room/durable-object.ts`
- 验收：`tests/authoritative-action.test.mjs`、`tests/authoritative-table-v2.test.mjs`、`tests/privacy-bypass-v2.test.mjs`
