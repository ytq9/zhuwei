# ADR 0037：检定分支不越过自己的摘要，NPC 台词用直接引语

- 状态：已接受
- 日期：2026-09-23
- 依据：用户于 2026-09-23 看过线上一次交谈的排查结果后确认两项改动：失败结果不能透露失败摘要里没写的线索；NPC 说的话用直接引语，前后可以有旁白。
- 当前规则：[SPEC 0009 §2 有意义失败](../specs/0009-failure-pacing-conclusion-and-interaction.md)、[SPEC 0009 §6 叙述协议](../specs/0009-failure-pacing-conclusion-and-interaction.md)
- 取代范围：不取代既有条款。§2 原先只要求失败产生相称变化，没有约束分支内部各段文字之间的一致；§6 原先没有规定 NPC 台词的呈现方式。

## 背景

线上房间 `room_229a0e0c3a8d462e` 里，玩家问莉安关于黑橡叶还知道什么。提案冻结了一次洞察检定（DC 12），掷出 11，走失败分支。归档事件显示：

- 失败分支摘要只写了“说叶子是含在父亲嘴里的，挡回酒窖话题”。
- 同一提案的 `failureOutcome` 和失败分支的 NPC 台词额外带了“父亲提过还有第三份东西”。
- 旁白把这句台词拆成“莉安说……她还说……另外她提到……”三段转述。

玩家的感受是检定失败了，莉安却把知道的全说了。实际上她的秘密（夜里听见的歌、铜钥匙）没有说出来，但失败分支比它自己的摘要多给了一条线索，而且转述方式把三件事排成了清单。

旁白提示里原有一句“不要把台词或内部字段逐字拼起来”，本意是不照抄内部字段，结果也把 NPC 台词推向了间接转述。

## 决定

1. 检定分支的摘要是该分支信息的上限。失败时要给的线索必须先写进失败摘要，不能只出现在台词或结果说明里。SPEC 0009 §2 允许的“只取得部分信息”“产生新的选择”保持不变，本决定只要求它们被摘要声明。
2. NPC 台词以直接引语呈现，引语前后允许旁白，旁白不新增事实。
3. 实现只改提示：提案规则写在 `proposal-guidance.ts` 的 `planRuling`。叙述写在现役房间使用的 `narration-text.ts`（`plainText-v1` 策略）的 `WRITE`，旧式冻结叙述 `narration-vnext.ts` 的 `GENERATION_TASK` 保持一致；`chinese-expression.ts` 的“直接或间接引语”改为“直接引语”。分支摘要与台词都是自然语言，本决定不增加确定性的服务器校验。
4. 按 [ADR 0035](0035-ratchet-the-vnext-proposal-request-size.md) 提案请求体积只降不升。新规则的篇幅用删掉两处 strict schema 已经强制的说明抵消（“其他类型的步骤没有 success/failure 字段”“时长和成败说明不能放到根层”），并把 `planRuling` 里与 `authority` 重复的“只解释步骤”并入。22 项选择全部下降 4–12。

## 后果

- 门：`tests/kp/protocol/prompt-contract.test.mjs` 断言 social、observe、worldInteraction 的提案提示含分支约束；`tests/kp/narration/text-protocol.test.mjs` 断言现役纯文本叙述的写作提示要求直接引语、允许旁白、不新增事实；`tests/kp/narration/presentation.test.mjs` 对旧式冻结叙述作同样断言，并确认旧的“逐字拼起来”一句已移除。
- 两项都依赖模型遵守提示，效果需要真实批次确认。
- 提示改变会改变已保存调用的提示 hash。部署前应先让各房间待处理的 NPC 工作跑完。
