# vNext round23：真实知识回顾、review/v5 与重复请求

日期：2026-09-06。`cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交工作树。本批完成一项真实知识回顾的正常 Cookie HTTP → Proposal → Rules/Room → 冻结 Claims → 生成/审核 → 发布及重复请求，不代表连续多人游戏或生产替换完成。

## 范围与实际结果

预设最多1根、4次 Provider、232,000输入/32,768输出 tokens；明确失败即停。本地新房使用当前完整 vNext runtime 和 `deepseek-v4-flash`，本次输入要求理清角色已知事情；新房准备阶段无模型调用。

实际3次调用全部成功：Proposal选择知识回顾，Rules持久化1条 `KnowledgeReviewed`、1份Receipt；生成返回JSON，review/v5返回工具并通过，玩家真实响应为 `action=committed/narration=published`，SQLite audience状态为published。父DeliveryPlan仍为open是逐受众交付状态，不能误读为本Viewer未发布。

人工对照：已发布正文与本人已持有的开场知识原文相同，没有新增事实、移动、决定或机械效果。此例只有一条开场知识，证明该窄路径可用，不证明多条知识整理、NPC人物表达、复杂旁白或持续审核可靠性。此前round19–22失败保持原结果，不重判旧响应。

重复同一submission后，新增Provider调用0，submission、Receipt、机械状态与Delivery均相同。实际SQLite副本中genesis+events经当前Rules replay与保存state精确一致；knowledge、canonicalFacts、entities、campaignRuntime、combatRuntime、fictionTimelines、fictionTime、spotlight均与初始replay相同，所有冻结表达上下文conform。只有正常审计事件与回执发生变化。

## 用量与源码证据

| 调用 | 输入 | 命中 | 未命中 | 输出含思考 | 空闲价费用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Proposal | 17,958 | 3,328 | 14,630 | 179 | ¥0.0229169 |
| generation | 1,693 | 512 | 1,181 | 850 | ¥0.0056221 |
| review/v5 | 4,475 | 0 | 4,475 | 2,148 | ¥0.0163785 |
| 合计 | 24,126 | 3,840 | 20,286 | 3,177 | ¥0.0449175 |

报告的1,944 reasoning tokens已包含在输出。再次读取[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，页面SHA256与今日早先记录一致：`899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`；空闲价格为每百万命中/未命中/输出¥0.05/1.50/4.50。全部费用计开发验收，不计正常玩家整局；金额是标价计算，不是账单证明。

[调用前源码清单](vnext-round23-source-manifest.json)于UTC `2026-09-05T22:28:49.063044+00:00`记录289文件，manifest hash为`4e8d519c2e3a6464da5e824f31f09b93621823d647520028b9d01c6e5cdd9f2e`。结束后逐文件核验无源码变化。实际Workflow为`sha256:1835a36cc2eb7fd721c535f9e3d72b27e81b8b8473566402a4d1de5d28a0b672`。完整数值与哈希见[脱敏证据](vnext-round23-live-evidence.json)。不将捕获文件SHA声称为HTTP wire hash。

## 验证与处置

- 正常HTTP action、重复提交检查、实际SQLite提取与Rules replay脚本均exit0；原始日志/正文/会话只在本机私有`/tmp/zhuwei-vnext-round23*`，不入库。SQLite提取预检发现原文件被运行时锁定，改为隔离SQLite/WAL副本读取，未更改源数据库。
- 本批源码相关本地检查为Room/Store25/25及稳定恢复/Claims41/41；当前最终typecheck exit0（`/tmp/zhuwei-stable-recovery-types.log`）。各组范围不同且可能重叠，不累加成全项目结果。
- server与capture均Ctrl-C退出130，无遗留4320/4321监听。没有commit、push、部署、远端migration或生产房退役。

下一步仍包括复杂schema补取后的完整链、更多知识/旁白变化、实际恢复、20+双玩家链与完整游玩差量。ActorPlan/longSpellcasting、stableRecovery专用Room持久化、归档与后台旁白继续按总TODO推进。私有归档对SPEC0011的窄修改已提问，尚未答复；其余Goal保持active。120金标与长期SLO后置。
