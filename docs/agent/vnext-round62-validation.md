# round62 原三句真实复验

2026-09-07，北京06:03–06:05。正常注册/Cookie HTTP、默认 deepseek-v4-flash；cloudflare/258caee继承开发树。知识依据别名修复已纳入319文件冻结，起止SHA一致，manifest `4d297b108d916dfd4288934d82e2767e8ed68e33733f7f2d5f1957cdd6c25e80`。

**前两句通过，第三句lowering引用拒绝，连续三步仍未通过。** 保留round61失败，不改词或重采。

| 原行动 | 真实结果 |
| --- | --- |
| 我现在知道哪些事？ | knowledgeReview committed/published，角色、库存资源及时间不变；duplicate新增调用0。 |
| 我暂时留在原地，安静等一分钟，留意身边的动静。 | passTime/60000000；Rules先2秒、真实NPC execute及痕迹、再58秒，Activity完成60/60秒。NPC旁白发布，该行动4调用，未恢复；duplicate新增调用0。 |
| 我观察周围在场的人现在各自在做什么。 | JSON/结构接受；focusRefs[0]把已持有的开场知识ID当直接观察目标，lowering拒绝world-interaction:direct-target-not-addressable；未进入Rules，公开notCommitted/PROPOSAL_REFERENCE_INVALID，无新事件或旁白。 |

第三步原稿也把同知识ID填为sensoryEvidence.subjectRef，但第一个实际拒绝来自focusRefs转换的directTargetRefs，不将后续潜在问题冒充已执行失败。更换目标不能证明保持原裁决，因此未擅自改引用、未追加修订调用。冻结候选/字段指导的直接缺口继续检查。原稿离线重放精确再现该lowering拒绝；第三步之后state/events逐字段等于第二步之后。

仅未来2秒既有计划使用正常新房中的本地Rules fixture；计划形成不是模型证据。NPC到期决定、实际trace与旁白均来自真实链路。两个已发布旁白没有发现具体事实冲突或秘密泄漏；第一步“自称远房表弟”的来源措辞比既有引号别称更强，证据不足以确认或反证，作为归属精度观察保留。第三步未发布文本不计成世界内矛盾。

实际8次调用，122684输入（hit65920/miss56764）、1454输出，响应usage齐全；按round61当日复核官方空闲价格估算 **¥0.094985**，全为开发验收费用。预算20调用、1160000输入/163840输出、20分钟/¥5，每HTTP5次/120秒。实时计量缺NPC usage遥测时按上界保守收费，最终按捕获响应真实usage计入，未按零计算。

最终10事件（fixture2）、7Receipt、pendingDue0；两个实际audience均published。完整replay精确等于落库状态，extract/source-end/replay均exit0。setup7913、game8042、capture7895均TERM143，端口空、无在途API；未调用恢复。源码对照/replay在`/tmp/redacted/zhuwei-round62-closeout/`，原稿/冻结材料在`/tmp/zhuwei-vnext-round62-*`；[脱敏证据](vnext-round62-live-evidence.json)。

本批支持纯等待及已有NPC到期链在两次固定连续样本中通过，不支持完整观察链、NPC新计划、复杂Activity、双人20+或统计稳定性通过。Goal继续active；未部署、push、commit或退役数据。
