# Round78：第一次问到第二句。等待在机械上是对的，在公开上什么也没发生

2026-09-07，源码 `8b67f32`（parser `kp-vnext2-proposal-parser-v41`，与 round77 同一份产品代码）。正常注册建卡，初态核对通过。场景仍是 round70 三意图，**只改了 gate**：等待链不再要求首句之后形成 NPC 计划。

改 gate 不是为了放水。`actorPlanPremiseIsAvailable`（[actor-plans.ts:20](../../app/_runtime/lib/rules/v2/actor-plans.ts:20)）只从**本次行动之前**的 `state` 认依据，提交时再查一遍（[npc-plan-formation.ts:172](../../app/_runtime/lib/rules/v2/npc-plan-formation.ts:172)）。所以同一束里 `formActorPlan` 引不到本束刚创建的承诺——首句能做的只有**记下承诺**，第二句才谈得上凭它形成计划。而 77 个批次里第二句从来没有发出去过。新 gate 改成：声明世界实际新增了什么（promise / plan），双向核对——声明不存在的拒，真实存在却漏报的也拒。

## 首句：承诺写进了散文，机械槽位空着

4 次调用，committed 且 published。瓦罗的公开台词：

> 「知道了。旅行守卫，你自去理你的思路。**过半刻，我敲一记账台**，算打断，也算了结。备案不等人，我也不强迫你现在开口。」

同一个 social step 的 `goal` 原文是「应承旅行守卫临时整理的请求，**并在半分钟后敲账台提醒**」。

而 `consequences: []`。`socialConsequence` 的 promise 变体就在 schema 里（[proposal-schema.ts:1018](../../app/_runtime/lib/kp/vnext/proposal-schema.ts:1018)），描述写着「this NPC's own promise to the actor」，指引也写着「NPC只能作出自己的承诺或债务」。槽位在、指引在、依据不需要预先存在——**它就是空的**。第三批连着如此（75/77/78）。

选择仍然只有 `social`。补选工具在 ordinal 2 的请求里，没有使用。

gate 记 `nothing-recorded-awaiting-due` 并放行。

## 第二句：机械做对了，玩家什么也没看到

玩家：「我留在账台旁，安静等一分钟，留意瓦罗和周围的动静。」

选择 `["passTime", "observe"]`，填写 `{"decision":{"kind":"passTime","durationMicros":"60000000"}}`——**`observe` 被选中后丢弃**。

机械侧完全正确：`ActivityStarted` / `FictionTimeAdvanced` / `ActivityCompleted` 三条齐全，`branch:main` 的 `nowMicros` 由 `0` 推进到 `60000000`，正好一分钟。

但结果是 `narration: "notApplicable"`。**公开对话止于玩家自己那句 say，没有任何已发布旁白。** 等了一分钟的玩家，屏幕上什么都没多出来。玩家明写的「留意瓦罗和周围的动静」随 `observe` 一起被丢掉了。

到期时刻：0 条 `NpcActionCommitted`、0 条痕迹事实、`npcPlans` 和 `promises` 仍是 0。瓦罗承诺的那一记敲击没有发生，因为没有任何东西支撑它。

gate 记 `uncovered` 停批：没有公开结果，第三句无从复核。

## 本批第一次同时看到的两件事

1. **承诺只存在于散文里。** 旁白说了，世界不知道。
2. **时间真的走了，到期什么也没有。** 这不是「半分钟太短不值得建计划」——玩家显式等了一分钟，时钟诚实推进了 60 秒，而那个被公开承诺的动作依然不存在。round77 之后关于时长阈值的怀疑到此可以放下：问题与时长无关。

另一条独立缺口：**选中后丢弃没有留痕**。`observe` 在选择阶段被选中、填写阶段消失，玩家的观察请求随之消失，而记录里看不出这是判断还是遗漏。这次它有了具体代价。

## 费用与收尾

6 次调用，¥0.364632（无未知 usage，上限 ¥5）。输入 117,719 / 输出 1,275。批次在平峰时段（18:48 CST 周一）执行，全程按峰价计，是保守方向。

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口复核无监听。replay `exactState=true`，stateVersion 8，8 条事件。321 项源码起止 `allEqual=true`，分支与 HEAD 未变。

[机器证据](vnext-round78-live-evidence.json)。私有证据在 `/tmp/zhuwei-round78-npc-preparation/evidence`。

## 未覆盖

第三句未发送。补选路径仍**零真实证据**——两次 ordinal 2 请求都带着该工具，两次都没用。parser v40 的未解析重发仍从未触发。
