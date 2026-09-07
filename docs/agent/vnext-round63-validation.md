# round63 原三句真实复验

2026-09-07。正常注册/Cookie HTTP、默认 deepseek-v4-flash；cloudflare/258caee继承开发树，320源码文件起止一致，manifest `e8316c542efe4086786976ee9f998ec62abbd2f764e35fcfa78a850d01f5369c`。

**前两句通过，第三句因服务器漏冻结已展示事实而被lowering拒绝。连续三步仍未通过。** 本批未改词、未重采。

| 原行动 | 真实结果 |
| --- | --- |
| 我现在知道哪些事？ | knowledgeReview committed/published，准确复述本人开场记录；时间、角色、资源不变，duplicate新增调用0。 |
| 我暂时留在原地，安静等一分钟，留意身边的动静。 | passTime/60000000；Rules先2秒、真实NPC execute及痕迹、再58秒，Activity完成60/60秒。NPC清嗓旁白与已提交事实同义，4调用，duplicate新增调用0。 |
| 我观察周围在场的人现在各自在做什么。 | JSON和结构接受，focusRefs/subjectRef正确选用三名可见NPC及场景；sensoryEvidence.basisRefs中的真实痕迹缺冻结授权，lowering返回PROPOSAL_REFERENCE_INVALID / proposal:basis-ref-not-authorized。未进入Rules，0新事件/旁白。 |

失败原稿中的 `fact:round63:observable-trace` 确实存在于权威canonicalFacts（npcPlanTrace、scene-observers、seq7），并在当次actorProjection.visibleFacts中可见。服务器又在请求08的requiredContext.entries[22].value.factConstraints.facts[0]及continuity.trace.factRef展示了它，但RequiredContext没有该记录的known entry、citation或read binding。模型照抄真实ID遭拒，根因为服务器类型化事实闭包遗漏，不能归为模型编造。主体候选改动在本次输出中奏效，但不能据单次样本宣称稳定性提高。

第三步之后state/events逐字段等于第二步后；未擅自替换依据、生成hash或发起修订。未来计划中的trace ID不等于已经存在的事实，修复必须从已有事实选集沿原权威读取链冻结，不能扫描任意上下文字符串补引用。

实际8次调用，133062输入（hit31104/miss101958）、2204输出，usage齐全；按当日核验官方空闲价格估算 **¥0.1644102**，均为开发验收费用。预算20调用、1160000输入/163840输出、20分钟/¥5，每HTTP5次/120秒。实时NPC usage遥测缺口按未知上界保守计量，最终捕获响应usage完整。

最终10事件（既有计划fixture2）、7Receipt、pendingDue0；两个实际audience均published。extract/source-end/replay均exit0，完整replay精确。setup12092、game12185、capture12084均TERM143，无在途API。原稿及冻结材料位于`/tmp/zhuwei-vnext-round63-*`，关闭证据位于`/tmp/redacted/zhuwei-round63-closeout/`；[脱敏证据](vnext-round63-live-evidence.json)。

分类：JSON语法失败0、填表结构失败0、lowering引用拒绝1、Rules拒绝0、已发布旁白中观察到的具体矛盾0、恢复调用0。现有计划仅为本地Rules fixture，不代表真实模型形成新计划；NPC谎言、复杂Activity、双人20+和统计稳定性仍未验收。Goal保持active，未部署、push、commit或退役数据。
