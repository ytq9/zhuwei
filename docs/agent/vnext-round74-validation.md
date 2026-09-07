# Round74：首句因模型输出 JSON 语法错误被拒，批次停止

2026-09-07，默认 deepseek-v4-flash。经正常注册 Cookie → createRoom → lockCharacter → startGame 建立三级旅行守卫，setup 于 2026-09-07T06:10 前完成，初态核对通过：公开场景 `wake` 有书记官瓦罗，0 预置计划、0 活动、0 行动事件，stateVersion 0，无 fixture、无注入。

场景为 round70 的 NPC 三意图逐字复制（`scenario.mjs` 与 round70 同字节）。**只发送了第一句**，第二、三句未发。

## 第一句与失败

原话：`我走到账台旁，向瓦罗点头：“我叫旅行守卫。我想先用半分钟整理一下思路。您若方便，过半分钟轻敲一下账台提醒我，我们再接着谈。”`

两次真实模型调用。第 1 次（offer，输出 50 tokens）正常返回能力选择；第 2 次（submit，输出 542 tokens）返回的 tool arguments **不是合法 JSON**：`decision.risk` 的字符串值内部写了未转义的 ASCII 双引号 ——

```
"risk": "玩家向瓦罗报号"旅行守卫"，请求半分钟整理思路，…
```

服务端在解析阶段拒绝，诊断 `path=arguments.decision`、`code=JSON_SYNTAX`，公开码 `PROPOSAL_FORM_INVALID`，`failureClass=modelPermanent`，`durationMs=7590`。独立复算解析位置为 pos 56 / line 1 / column 57，落在该字段第一个非法引号处。第二次调用的 arguments SHA256 为 `f9b6660181298d40644f1759a07828e37a44815d3ef240e2a1386e490e987410`，原稿逐字保存在私有证据里。

值得注意的是：玩家原话里的名字用的是中文引号「“旅行守卫”」，模型在复述时改成了 ASCII 双引号又没有转义。这是观察，不是已确认的因果解释；一次样本不能证明措辞与该错误之间有因果关系。

## 为什么没有用那一次窄修订

本批共 2 次调用，`repairUsed=false`。这不是预算耗尽，而是设计上的失败关闭：草稿从未解析成功，bundle 不存在，因此没有任何可证明的修复计划。源码里 `JSON_SYNTAX` 只有在 `syntaxProven`（完整根成员已冻结）时才获得 `repair.allowed`；解析即失败的路径由 `invalidOutput` 直接抛出单条语法诊断，不附修复授权。

## 权威状态

0 提交、0 事件、0 骰、0 Receipt、0 delivery、0 待到期项，stateVersion 保持 0，公开消息仍只有开场旁白，瓦罗没有回应。收尾 replay `pinnedProfilesMatch=true`、`exactState=true`、stateVersion 0、事件 0。

## 引用槽准入本批未被检验

这一点必须说清楚：**round74 没有为当天落地的引用槽准入修复提供任何证据。** 草稿从未通过解析，`basisRefs` 与 `response.basis` 根本没有进入校验。原稿里确实出现了 `basisRefs: ["definition:module-npc:npc:black-oak-will:varo", "npc:black-oak-will:varo", "profile-context:module:black-oak-will:social-resolution-v1"]`，但它们是否会被准入不可知，也不得据此推断。round70 的 wrapper 引用失败没有在本批复现，同样不能算作已修复的真实验证。

## 成本

2 次调用，输入 45,173 tokens（无未知 usage），输出 592 tokens。本地时间为 2026-09-07 周一 14:08 Asia/Shanghai，落在已保存官方峰价窗口（Mon–Fri 09:00–12:00 / 14:00–18:00）内，按峰价计 **¥0.140847**。依据是 usage 与本日 00:58:26Z 核验、htmlSha256 `899affbd…` 的已保存价目，不是供应商账单。批次上限 ¥5，远未触及。

## 计数

格式失败 1（其中 JSON 语法失败 1）；引用失败 0、提案机械规则拒绝 0、明确机械不一致 0、已认定叙事矛盾 0、窄修订 0、Viewer 恢复 0、合法世界选择 0。引用失败与格式失败不重复相加。第二三句未发送，不计入任何类别。

## 收尾

`services.py shutdown` 报告 game/capture 两个角色 `verifiedAbsent=true`，随后 `lsof` 复核 4320/4321 均无监听。321 项源码起止 `allEqual=true`，分支与 HEAD 未变，初始 manifest `adde8baff7348caa0358aaedff3f5417c75ae52b59b21c0996f57380af99643e`，冻结时源码为干净的 `f1aa565`，parser 合同 `kp-vnext2-proposal-parser-v39`。

[机器证据](vnext-round74-live-evidence.json)。原始 capture、冻结上下文、journal、权威快照与原稿保存在 `/tmp/zhuwei-round74-npc-preparation/evidence`；公开文件不含 Cookie、密码、私有上下文正文或模型推理。

## 未覆盖

计划形成、到期执行、提醒分支、等待链、连续意图、窄修订、Viewer 恢复、重复提交幂等，本批全部未触及。round70/72/73 的结论不因本批改变，也不声称成功率提高或降低 —— 单批一次格式失败不构成对模型可靠性的统计判断。
