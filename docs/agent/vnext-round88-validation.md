# Round88：承诺 → 计划 → 到期执行 → 痕迹入正史 → 玩家看见，第一次在真实模型上连成一条链

2026-09-08 下午，源码 `2dc8d8a`（运行时与 `b7c682f` 相同：parser v49，`responseBasis` 平枚举）。场景同 round82–87。正常注册建卡，初态核对通过。发了两句，都提交并发布；第三句没发出去（原因见末尾）。**12 次调用，¥0.66954**（其中一次按上限计费，见「没进遥测的」）。

## 首句：承诺，以及第一次真实的未解析重发

第二次调用的 arguments 不是合法 JSON：`risk` 里有一对未转义的内层双引号，`json:object-delimiter-expected`，offset 154。parser v40 的未解析重发第一次真实触发：第三次调用只带 submit 工具、原字节与出错位置（9251 个 prompt token），模型完整重述了同一裁决——顺带把 `npc-decision:` 包装引用换成了 `npc:…varo`、裸 `"none"` 写成了 `{kind:"none"}`。从头重验通过，没有服务器折叠。

三张表干净。`responseBasis` 六个引用全在平枚举里（round87 的 `{}` 没有复现——那一次是采样，不是形状）。

瓦罗公开承诺：「原件不离手，我就在这儿抄。你在厅里等，一个时辰内给你放到账台上。」`consequences` 里第一次出现 `promise`：

```
due: "1h"
trace: "账台上放着一份抄好的备案件副本，字迹工整，末尾有瓦罗的书记官落款。"
authorityRefs: [瓦罗, 瓦罗的定义]
```

同一根内：`PromiseMade` → `NpcPlanFormed`（`due.atFictionMicros = 3900000000 = 300000000 + 1h`，trace factRef，alternateTarget 为承诺时的场景 wake）→ `ActivityStarted`（npcActorPlan，3600000000）。时钟 0 → 300000000。gate1 记下了计划与承诺的 id（coverage `formed-awaiting-due`）。

## 第二句：等待跨过到期点

7 次调用，正好到每 HTTP 上限：offer（passTime + observe）、passTime 填写（3660000000，observe 第五次被丢弃）、**到期计划决策**（`submit_due_actor_plan_decision`：execute，mechanicalProposal none，targetRef wake）、痕迹旁白、审核、等待旁白、审核。

权威事件 11–17：`ActivityStarted` → `FictionTimeAdvanced` → `NpcActionCommitted` → `CanonicalFactDeclared`（`fact:npc-plan-trace:…`，subjectRefs 瓦罗与 wake，描述就是承诺时填的 trace）→ `ActivityCompleted`（计划）→ `FictionTimeAdvanced` → `ActivityCompleted`（等待）。计划 status `resolved`。时钟 300000000 → 3960000000。

公开输出两条旁白，先痕迹后等待：

> 账台上放着一份抄好的备案件副本，字迹工整，末尾有瓦罗的书记官落款。
> 你在大厅里等候，一个小时零一分钟悄然流逝，约定的等待时间已经结束。

没有编造抄写过程，两次审核五项 pass。这就是[合同](vnext-hours-scale-promise-contract-proposal.md)第 1、2、3 层的真实链。

## 第三句为什么没发

批次脚本 `runner.mjs` 的 `budgetChecks.perHttp` 写死了 `<= 5`，而 `plan.json` 的 `perHttpCallLimit` 是 7（服务端上限也是 7）。等待这一句用了 7 次，脚本按自己的规则把批次标成 stopped，gate2 的 `executed` 被 `TECHNICALLY_STOPPED_BATCH_CANNOT_CONTINUE` 拒绝。这是准备包的错，不是产品失败；round89 修脚本再发三句。

## 没进遥测的

- 到期计划决策那一次调用（ActorPlanTransport）**没有**任何 invocation 遥测行：12 次物理调用、11 行遥测。meter 按上限把它计成未知 usage（¥0.67 而不是约 ¥0.45）。私有 capture 里有它的 usage。
- 等待这一根的 `room.authority.commit.completed` 只覆盖事件 11（`fictionTimeMicros`、`crossedDeadlineCount` 都是 null）；结算事件 12–17 走的是时间推进路径，那条路径不报这两个字段。`crossedDeadlineCount` 至今没有非零的真实证据。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 17，17 条事件。323 项源码起止 `allEqual=true`。[机器证据](vnext-round88-live-evidence.json)。私有证据在 `/tmp/zhuwei-round88-npc-preparation/evidence`。

## 未覆盖

第三句（到账台前查看副本；裁决 `basisRefs` 丢弃的真实触发；observe 单独成根）；`crossedDeadlineCount` 非零证据；ActorPlanTransport 调用的遥测。
