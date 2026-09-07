# 被动时间经过与精确数值表示修复

2026-09-07。承接 [round60 真实失败](vnext-round60-validation.md) 与 [能力方案](vnext-passive-time-plan.md)。[真实 API round61](vnext-round61-validation.md) 已完成：等待及NPC到期通过，后续观察因服务器知识引用表示不一致拒绝；不代表整条链或模型稳定性通过。

round60 的“安静等一分钟”被填成即时 observe：感官正文说经过一分钟，权威时间仍为0，未来 NPC 计划未执行。根因是普通成功/检定表面没有通用被动耗时入口，不能靠窄修订从原文补造时间裁决。另一问题是未来计划 trace 被叙述为当前感官事实；现在 Prompt 明确区分已读取的 scheduled 记录与已发生事实。

能力合同：玩家可以主动等待或守望；KP只填 `decision: {kind: "passTime", durationMicros: "60000000"}`。服务器补齐已验证身份、原意图、Activity身份、上下文hash和read-set，Rules创建Activity并逐段推进源时间线，在真实到期点先处理原义务，再决定继续、实际中断或技术停止。不能通过这个入口预写未来感官、检定、伤害、成本、制作、移动或休整结果。知识回顾继续零时间。

| 变化维度 | 定向证据与边界 |
| --- | --- |
| 不同时长的普通等待/守望 | 同一最小填写面、lowering、Rules创建；不产生未来知识；开始时零推进；完成后精确replay。 |
| 一分钟内第2秒NPC到期 | 同一队列先推进2秒，消费原计划请求/响应，再推进剩余58秒；defer/revise重新按实际deadline计算。 |
| 死亡、失能、遭遇或位置变化 | 原源时间线记录实际结束时间；原合法玩家可通过lifecycle取得自己的活动结果，第三者不可取得。 |
| 系统不能安全继续 | 不越过未处理deadline，不伪造世界内中断或完成；Activity保持active并显示技术状态。 |
| 冻结与修订 | 缺失read-set、权威变更、伪造身份/未来结果、任意改时长拒绝；原数字token为正十进制安全整数时，只允许同值改为字符串。 |

现有单一解析器按需保留原数字token及UTF-16位置。仅真实原始字符串能够证明数值表示；`60000000` 和 `15000000` 可以一次确认修复，`60000000.000000001`、指数、非正值、小数、超安全范围及已解码对象不能凭舍入值取得权限。修订使用原完整草稿、冻结上下文和固定替换，恢复时重新核原稿，之后完整重验；其他机械数字接受范围不变。parser v29、repair ticket v4，Room原样持久化/传递票据，无旧票据兼容层。

纯等待的开始、计时、完成和中断通过本人Activity状态确定性交付，最终时间Claims仍用于审计和后续上下文。精确且非空的纯时间终结材料不创建模型audience；NPC行动及额外可见机械结果仍走原旁白。旧设计在NPC execute时必需6调用，超过每HTTP5的现有预算；现设计受控验证为纯等待1次、可见NPC等待4次，不提高上限，不把恢复失败藏为成功。

已集成 [Rules 18文件](vnext-time-passage-rules-integration.json)、[源时间线显示2文件增量](vnext-time-passage-progress-integration.json)、[数字修复6文件](vnext-numeric-repair-integration.json)、[Room/Claims/Table 7文件](vnext-time-passage-room-integration.json)，全部逐baseline/new SHA核对、备份后串行集成，0冲突，继承修改保留。四次共33个文件应用、31个不同文件。

主树KP目标组：`npx tsx --test tests/kp-vnext-pass-time.test.mjs tests/kp-vnext-numeric-repair.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-plan-confirmation.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs`，80/80、退出0；日志 `/tmp/zhuwei-pass-time-final-kp-node.log`。此前主树53/54，唯一失败是新增测试直接验证未加服务器外壳的中间值；已删除该错误断言，保留真实入口与lowering行为覆盖。更早尚未集成Rules时加载失败也保留在日志，未改判。

隔离Rules 32/32、数字修复69/69及各自typecheck通过；这些不是主树完整验证或真实API成功。长施法/残留战斗期限目前会安全停在deadline，复杂耗时裁决、新NPC计划形成、多人20+连续链及完整Goal仍未完成。本阶段无部署、push、commit、远端migration或数据退役。

最终主树直接消费者：`npx tsx --test tests/kp-vnext-time-passage-rules.test.mjs tests/play-table-time-passage-ui.test.mjs` 9/9、退出0（`/tmp/zhuwei-pass-time-final-consumer-node.log`）；`npx vitest run tests/kp-vnext-time-passage-room.test.ts` 9/9、退出0（`/tmp/zhuwei-pass-time-final-worker.log`）；`npm run typecheck` 退出0（`/tmp/zhuwei-pass-time-final-types.log`）。Worker日志中的未知响应与驱逐异常来自明确故障注入，相关恢复断言均通过；React测试通过真实DTO及组件显示验证，无浏览器截图或全量回归。
