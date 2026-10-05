# ADR 0068：库存预检策略随方案冻结

- 状态：已接受
- 日期：2026-09-29
- 依据：用户要求修复 `c885793` review 确认的旧玩家选择无法回放及旧待骰计划结算不一致。
- 当前规则：[SPEC 0016 §9.2](../specs/0016-part-d-staging-and-supersede.md)、[SPEC 0016 §§7.1、7.3](../specs/0016-part-c-compound-actions-and-claims.md)。
- 取代范围：补足 [ADR 0067](0067-freeze-primary-noticing-evidence-policy-and-source.md) 同批库存修复的旧冻结计划解释；主要对象证据策略与新行动的库存权限不变。

## 原因

`FrozenPlayerChoicePrepared` 回放会重新预检每个选项。`c885793` 收紧跨持有人授权和隐蔽目标取得条件，却没有冻结这两项预检的版本，导致合法的历史事件被当前规则拒绝。旧待骰计划也出现一项沿旧规则结算、另一项成功骰被新规则拒绝的差异。

只让事件回放跳过检查仍不完整：旧计划在玩家选择、Activity 完成或待随机恢复后还会再次执行。它们必须使用同一套冻结语义，不能靠调用位置猜是否应该兼容。

## 决定

新受理的原子计划保存 `inventoryPolicy: "physical-acquisition-v1"`。直接执行、开始 Activity、打开玩家选择三处受理入口先验证输入，再强制写入当前策略；复制旧形状或省略字段不能使新提交获得旧权限。

通用编译器与持久化形状校验保留该可选字段，未知值拒绝；编译、回放、玩家选择、Activity 完成和掷骰续跑均不补版本。无字段计划沿冻结时的旧库存授权与条件语义继续，包括当时已接受的观察检定取得他人物品、隐蔽 always 取得场景物。这个兼容范围仅为已冻结方案，不为新行动建立例外。

库存授权函数默认严格；只有持有已验证旧冻结计划的原子执行器显式请求旧策略。已提交库存事件仍按原审计凭据核验。策略随原有计划与 continuation 持久化，不增加数据库表或 migration。

Room 还有一个先于 Rules 事件的冻结边界：`proposalRecovery` 已保存而 `RandomnessRequested` 尚未提交。新恢复记录在原 `rulesInput` 旁保存 `inventoryAdmissionPolicy: "physical-acquisition-v1"`，不改输入及其故事受理绑定。恢复时先验证记录闭合形状，再由宿主通过内部 runtime 参数传递策略；无字段的旧记录按历史库存语义重做第一次 Rules 执行，随后冻结的计划继续携带原语义。未知策略拒绝，公开 `step` 仍只接受三个参数，模型或客户端不能用 JSON 字段请求历史权限。

重复恢复复用原 DTO 与 `recovery_hash`，不补写版本、不重算历史身份（[ADR 0056](0056-comparisons-and-self-hashes-without-hashing.md)）。已持久化的 Activity、玩家选择及随机 continuation 继续以自身计划为准。这个恢复参数只传到同一命令的原子受理入口，不改变先行到期工作的既有计划。恢复记录仍使用原 JSON 存储，无 SQL schema 变化。

## 证据

`frozen-inventory-legacy-events.json`（2026-10-05 随 [ADR 0120](0120-a-new-runtime-version-retires-open-rooms.md) 删除） 保存由 `67c29ce68b8b74e6d0372187288ddddd983ffe64` 实际生成的两类历史事件与预期 hash；不是在新版本下删除字段伪造的旧计划。[`frozen-choice.test.mjs`](../../tests/kp/adjudication/frozen-choice.test.mjs) 验证旧确认回放、选择、成功和失败续跑，以及旧待骰两分支的事件与状态 hash 均不变；相同输入重新受理必须在冻结和随机前拒绝。

同份夹具的 `rawRecovery` 使用上述旧版本执行其选择中的计划、去掉 duration 的直接输入生成。`frozen-inventory.room.test.ts`（同上删除） 在真实 Room SQLite 保存这份输入，在 `beforeRandomnessRequestCommit` 与 `afterRandomnessRequestCommit` 两处连续中断并驱逐实例，核对历史事件 hash、原恢复记录及身份不变；也验证带当前策略的相同非法输入拒绝，以及新合法输入在首次事件提交前保存当前策略并成功恢复。
