# Round75：首句完整通过并发布，但没有形成 NPC 计划，覆盖到此为止

2026-09-07，默认 deepseek-v4-flash，源码 `74e713d`（parser `kp-vnext2-proposal-parser-v40`）。经正常注册 Cookie → createRoom → lockCharacter → startGame 建立旅行守卫，初态核对通过：公开场景 `wake` 有书记官瓦罗，0 预置计划、0 活动、0 行动事件，stateVersion 0，无 fixture、无注入。

场景是 round70 的 NPC 三意图逐字复制（`scenario.mjs` sha256 `668da7ad…`，与 round74 同字节）。**只发送了第一句**。

## 第一句：通过

原话：`我走到账台旁，向瓦罗点头：“我叫旅行守卫。我想先用半分钟整理一下思路。您若方便，过半分钟轻敲一下账台提醒我，我们再接着谈。”`

4 次真实调用（选择 52 输出 / 填写 559 输出 / 旁白 / 审核），**无窄修订、无重发**，提案 committed、旁白 published、1 条 Receipt。第二次调用的 arguments SHA256 为 `78484dc8c7d5965e…`。

公开旁白：

> 你走到账台旁，向瓦罗点头，报上名字……瓦罗抬眼确认了你的身份，一点头，带着办事的分寸说：“可以。半分钟，我在账台上等你。到时就敲三下。”

这段公开结果合法、连贯，与玩家原话一致，没有越权也没有泄漏。**格式、引用、规则三关全过** —— 这是 round70 以来这个场景第一次走完提交与发布。

## 为什么仍然停在这里

权威状态里 `npcPlans` 与 `activities` **都是空的**。5 条事件是 `SourceClaimCreated`×2、`KnowledgeAcquired`×2、`WorldInteractionResolved`，**没有 `NpcPlanFormed`，也没有 `ActivityStarted`**：提案被降级成 `worldInteraction` 而不是 `formActorPlan`。

gate1 要求「等待链」必须有新形成且 `scheduled` 的计划、活跃的 Activity 和对应的提交事件才能继续第二句。三者都不存在，所以按本场景规则记 `legalNoPlan` 并停止——不追问、不换措辞、不重采，第二三句未发送。

**这不是技术失败。** 分类上与 round70/72/73/74 完全不同：那四次分别死在引用、值校验和 JSON 语法；这一次模型交出了一个完全合法的提案，只是没有形成可验证的未来计划。

## 一项待判观察

公开旁白让瓦罗承诺「半分钟后敲三下」，但世界里没有任何机制会兑现它：没有计划、没有活动、没有到期项，虚构时间也没有推进。也就是说这是一句**没有机械支撑的叙事承诺**。

NPC 的口头承诺是否必须形成计划，是一项独立的能力决定（涉及 SPEC 0001 对叙事承诺与固化的要求）。本回执只记录观察，不裁定，也不因此改判本句「合法」的结论。

## 两项本地改动的真实覆盖

诚实分账，这是本批最重要的结论：

- **parser v39（引用槽准入）—— 只验到了「不误伤」这一面。** 一个合法提案带着被枚举约束的引用槽，完整通过解析、校验并提交。这证明收窄没有挡住合法选择；**不证明**它能挡住错误选择——本批没有发生任何错误引用。
- **parser v40（未解析重发）—— 完全没验到。** 草稿第一次就解析成功，没有触发重发。

## 幂等

原 submission 重复提交：**0 次新模型调用**，权威状态、事件、随机 journal、Receipt、结果与 delivery 全部不变（9 项检查均 true）。

## 成本

4 次调用，输入 51,611 tokens（无未知 usage），输出 900 tokens。本地时间 2026-09-07 周一 14:45 Asia/Shanghai，在已保存官方峰价窗口内，按峰价计 **¥0.162933**，上限 ¥5。依据是 usage 与本日 00:58:26Z 核验、htmlSha256 `899affbd…` 的已保存价目，不是供应商账单。

## 计数

格式失败 0、引用失败 0、提案机械规则拒绝 0、明确机械不一致 0、已认定叙事矛盾 0、窄修订 0、重发 0、Viewer 恢复 0；合法世界选择 1（`legalNoPlan`，结束覆盖）。

## 收尾

`services.py shutdown` 报告 game/capture 两角色 `verifiedAbsent=true`，`lsof` 复核 4320/4321 无监听。收尾 replay `pinnedProfilesMatch=true`、`exactState=true`、stateVersion 5、事件 5。321 项源码起止 `allEqual=true`，分支与 HEAD 未变，初始 manifest `86012e6db342548079ca91c5eceeacaf595218de273177e96a2a4b26256a8b8f`。

[机器证据](vnext-round75-live-evidence.json)。原始 capture、冻结上下文、journal 与权威快照保存在 `/tmp/zhuwei-round75-npc-preparation/evidence`；公开文件不含 Cookie、密码、私有上下文正文或模型推理。

## 未覆盖

- 第二、三句未发送：到期执行、提醒分支、等待链、连续意图稳定性全部未触及。
- 重发路径零真实证据。
- 窄修订未触发，Viewer 恢复未执行。
- `runner ack` 在批次停止后拒绝执行，因此确认未走；delivery 仍为 open、受众为 published。
- round70/72/73/74 的结论不因本批改变。单批一次成功不构成对模型可靠性的统计判断。
