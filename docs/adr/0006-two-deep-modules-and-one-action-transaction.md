# 两个深模块承载唯一行动事务

- 状态：已接受（本 Goal 授权）
- 日期：2026-08-26
- 关联规格：SPEC 0001、SPEC 0003–0013

## 背景

旧实现把自然语言解释、规则命令、服务器掷骰、D1 状态更新、NPC 自动行动和消息历史分散在多个入口。任何一条捷径都可能绕过 KP、机械诊断、原子提交或观察者投影。

## 决策

系统只形成两个深 Module：

1. Room Action Module 接受可信会话形成的意图、待决回答、重试、ACK 和更正请求；负责 KP 提案与修订循环，并只返回 `committed`、`awaitingInput`、`needsKp`、`retryableFailure`、`rejected` 或 `concluded`。
2. Rules Module 对外只公开 `step / project / replay`；内部 fold、事件应用、随机原语、定义编译、几何、触发顺序和缓存均不对页面、API、AI Adapter、D1 或 Room Action 暴露。

Room Durable Object 是 Room Authority 的生产实现，提供 `prepare / observe / commit / acknowledge / commitCorrection`。自由行动、非战斗、战斗、NPC/势力、Activity、资源、休整、成长与收束都使用同一事务。根行动 ID、客户端幂等 ID、提案尝试 ID、待决回答 ID、随机请求 ID、Receipt ID 与投递帧 ID 分离并建立父子关系。

相关作用域版本取代单一 `expectedRevision`。作用域集合及其读取证明由 Rules `step` 决定；外层不能复制推导。LLM 调用永远在 DO 事务外，骰面永远由 DO 在参数冻结后产生。

## 后果

旧房间只可经明确的 Legacy Adapter 继续回放；新规则版本不得调用旧 D1 `game_states`、公开 `applyEvents/fold/rollDie`，也不得让按钮或语音建立快捷裁决。模块边界检查与责任 Interface 行为测试是发布门。

## 验收场景

1. 自由行动、战斗、休整、移动、资源、成长、NPC 与收束都通过 Room Action 的同一 prepare→KP→commit 事务；待决回答和更正只使用该公开合同。
2. Rules 包外只能调用 `step / project / replay`；页面、Worker、AI Adapter 与 D1 不能导入 fold、事件应用、随机原语或私有机械实现。
3. 每个根行动、提案尝试、随机请求、待决回答、Receipt 与投递帧具有稳定且不混用的身份；失败停在最近稳定阶段。

## 实现映射

- Rules 深模块：`app/_runtime/lib/rules/v2-runtime.ts`、`app/_runtime/lib/rules/index.ts`
- Room Action 深模块：`app/_runtime/lib/room/action.ts`、`app/_runtime/lib/room/durable-object.ts`
- 静态边界门：`scripts/check-modules.mjs`
- 验收：`tests/authoritative-table-v2.test.mjs`、`tests/room-authority-v2.test.ts`、`tests/rules-pending-v2.test.mjs`
