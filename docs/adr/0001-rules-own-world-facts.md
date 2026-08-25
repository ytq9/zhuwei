# 规则内核独占世界事实写权

- 状态：已接受
- 规则版本：D&D 5e 2014 / SRD 5.1

## 背景

AI 直接返回位置、线索、资源和场景补丁，会把 Prompt 记忆变成事实来源。已经观察到的故障包括唯一遗嘱被再次生成，以及玩家绕过锁门直接接触内部神龛。

## 决策

生产调用只提交结构化 `Command`。`step(module, state, command)` 是唯一裁决入口并产生 append-only `WorldEvent`；`project(module, state, viewer)` 是唯一公开快照入口。AI 只解释候选命令和叙述已经提交的事件，不得提交骰点、DC、状态补丁或秘密答案。

## 后果

模组必须把 Portal、Artifact、Interaction、NPC Plan、ScheduledEvent 与 Ending 写进封闭 DSL。新增机械需要先扩展领域模型、编译校验和测试，而不能只修改 Prompt。换来的收益是唯一物品、可达性、资源与秘密投影都能重放和验证。
