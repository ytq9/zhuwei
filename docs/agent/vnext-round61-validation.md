# round61 真实连续行动验收

2026-09-07，北京05:41–05:46。正常注册/HTTP、默认 deepseek-v4-flash、Room/Rules/Viewer；cloudflare/258caee继承开发树，319源码文件起止SHA相同，manifest `4db082a4d110d127cbe0d4a984fd02e213ddf934ae0d6b32f788ff82faedf8ea`，parser v29/ticket v4。

结论：**前两句真实通过，第三句Rules拒绝，整条连续链未通过。** 没有改词、重采或隐藏失败。

| 原行动 | 真实结果 |
| --- | --- |
| 我现在知道哪些事？ | knowledgeReview提交并发布；时间、角色、库存/资源不变；重复请求零新增调用/提交。 |
| 我暂时留在原地，安静等一分钟，留意身边的动静。 | 模型只填passTime/60000000，建立Activity；时间先推进2秒，真实NPC决定execute，提交行动与痕迹，再推进58秒并完成。本人Table显示完成60/60秒，实际NPC旁白发布。该行动4调用，未触发预算恢复；重复请求零新增调用/提交。 |
| 我观察周围在场的人现在各自在做什么。 | 首稿格式与lowering均通过，但Rules拒绝causalFrontierConflict：“Scene observation requires the frozen scope and evidence read set.”。Adapter明确拒绝不具等义证明的再次裁决；公开notCommitted/PROPOSAL_RULES_DIAGNOSTIC，无新旁白/事件/资源变化。批次停止。 |

仅既有未来NPC计划使用受信本地fixture：正常新房开团后停服，备份SQLite，通过原Rules形成未来2秒计划；真实NPC提案入口、到期决定、状态提交和旁白均实际执行。fixture不是模型创建新计划的证据。离线seed预检改用当前Profile的隔离genesis，实际apply仍严格要求本批新房、单人、无既有玩家提交。

等待结果完全来自权威事件：`FictionTimeAdvanced(2000000)` → `NpcActionCommitted`/`CanonicalFactDeclared` → `FictionTimeAdvanced(58000000)` → `ActivityCompleted`。原计划状态resolved、预定trace存在；未预写等待后的感官，也未公开私有NPC目标/动机。旁白“莉安·黑橡轻轻清了清嗓。”与已提交、获授权的sceneFeature逐字一致。样本没有NPC台词/传闻，不能据此证明撒谎归属可靠性。

第三步原稿和冻结上下文已封存，离线重放精确再现相同Rules拒绝、0事件。根因已证实在服务器lowering：模型采用玩家已持有的knowledgeRef别名，readSet已通过冻结映射转换为带holder的真实记录，但plan.basisRefs与sensoryEvidence.basisRefs仍保留原别名，触发同记录不同表示的严格匹配失败。修复统一使用既有requiredContextReadBindings，不改Rules或扩大授权。原失败稿离线重放修后committed；这不改判本批真实失败。该步状态逐字段等于第二步完成后状态。

实际8次调用、122846输入（hit36224/miss86622）、1310输出，按当批复核官方空闲标价估算 **¥0.1376392**，全为开发验收费用，捕获响应usage齐全。实时预算计量遗漏NPC遥测类型，因此曾将1次调用按未知用量保守计入上界；最终费用按该真实响应的完整usage核算，没有将未知用量视为0。预算仍为最多20调用、1160000输入、163840输出、20分钟/¥5，每HTTP5次/120秒。

最终10事件（fixture2）、7Receipt、pendingDue0；两个实际旁白audience均published。完整replay精确等于落库状态，源码冻结核验通过，extract/source-end/replay退出0。未调用恢复，因为第三步未提交；前两步duplicate均零新增调用。setup4962、game5066、capture4948全部TERM143退出，无在途API。

取证过程中，直接读取活跃SQLite未命中房间，改为既有SQLite+WAL副本方式；初次离线断言误用executed状态名，核实后改为现役resolved。没有改变输入、模型响应、产品状态或追加API。私有材料均保存于 `/tmp/zhuwei-vnext-round61-*` 与 `/tmp/zhuwei-round61-preparation/`，源码对照/replay摘要位于 `/tmp/redacted/zhuwei-round61-closeout/`。

证据：[脱敏JSON](vnext-round61-live-evidence.json)、[本次实现与定向验证](vnext-passive-time-validation.md)。本批证明被动等待及既有NPC到期链可真实执行，不能证明后续观察、复杂Activity、新NPC计划、多人20+或统计稳定性通过。完整Goal继续active；未部署、push、commit或退役数据。
