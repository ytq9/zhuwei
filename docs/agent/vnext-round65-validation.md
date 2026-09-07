# round65：原三句在按家族填写接口后的真实连续链

日期：2026-09-07，正常注册/Cookie HTTP → 默认 deepseek-v4-flash → vNext parser v32 → Rules/Room → Viewer/旁白 → 后续行动。cloudflare / 258caee404e0814405eb497653ee9f00d647b773 未提交源码；320文件起止一致，manifest `e8429292d189d761292d9b58f604eadee1e9dcf905e7a978c13312c03f235ddd`。本批无部署、push、旧房删除。

## 实际结果

原三句全部 committed/published，无更换话术、模型、重采或注入模型响应：

| 原行动 | 实际执行 | 真实调用 | 权威与公开结果 |
| --- | --- | ---: | --- |
| 我现在知道哪些事？ | knowledgeReview | 3 | 回顾原开场知识；时间/实体资源/知识/NPC既有计划不变 |
| 我暂时留在原地，安静等一分钟，留意身边的动静。 | passTime；独立NPC到期决定execute | 4 | 60,000,000微秒Activity完整结束；NPC计划2秒到期、痕迹提交并公开；实体资源不变 |
| 我观察周围在场的人现在各自在做什么。 | schemaRequest(observe) → directSuccess observe | 4 | 3条感官证据、1条归属明确且保留不确定性的推断；引用真实前轮fact trace成功；无额外时间/实体资源变化 |

每个已发布submission重复一次，全部0新调用、相同Receipt/机械状态/发布。8个Receipt、18事件（含2个既有计划fixture事件）、0 pending due；三份实际audience均published。完整replay与存储精确一致。

第3句补充人物姿态、神态与环境细节，作为新创作保留；对照原开场、已提交清嗓痕迹和Viewer公开位置，未识别具体矛盾。推断保留“只是猜测，不能确知念头”的归属与不确定性，不把缺旧同内容引用视为失败。此人工核对及模型审核都不是任意自然语言无矛盾证明。

## 分类及边界

格式失败0、Rules拒绝0、已识别叙事矛盾0；窄修订0、发布恢复0，因此本批不证明真实修订或恢复成功率。原round63/64失败全部保留，不改判。round63漏事实source binding的修复在本批获真实后续引用证据。

已有未来NPC计划由同一Rules的可信本地fixture建立，恰好2个事件，无初始时间/资源/知识变化；模型只对到期计划作真实独立决定。它不证明模型通过交谈形成新计划，后者留给无fixture批次。

三个连续行动只支持本实例链路通过，不证明统计稳定性、任意复杂JSON、自创机械/组装全部变化或完整Goal已经完成。新表单增加了一次观察schema选择，调用上限保持每HTTP5、普通2阶段/补取3阶段，没有清洗原稿或放宽Rules。

## 使用量、预算与证据

预设3行动、20物理调用、1,160,000输入/163,840输出、20分钟与¥5；实际11调用、114197输入（20480命中/93717未命中）、4498输出，全部usage已知，开发费用 **¥0.1618405**。含Proposal/schema/NPC/旁白/审核，重复无费用。正常整桌费用不能由这3项样本直接外推。

官方价格执行前重新获取并检查：北京时间2026-09-07 07:31:48，HTML SHA `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`；实际调用均在空闲时段，百万输入命中0.05/未命中1.5、输出4.5元。

[脱敏证据](vnext-round65-live-evidence.json)；完整私有原稿、冻结请求、journal、状态与执行日志留在 `/tmp/zhuwei-round65-original-preparation/evidence/`。正常setup、3行动/快照/duplicate/ack、meter、shutdown、extract、replay及source-end均exit0。最初只读摘要探查曾误取fixture嵌套键，随后读取result.state得到精确一致；该探查0API/0写入，不影响正式快照和replay。

本批capture20716/setup20726/game20870均按PID启动身份SIGTERM，进程和4320/4321端口确认消失；detached进程退出码不可得，不写作143。源码与执行脚本起止无漂移。
