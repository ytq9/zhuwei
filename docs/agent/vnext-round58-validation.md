# Round 58：知识回顾提交，审核请求失败后停批

2026-09-07。集成既有ActorPlan到期纵切后，新房通过正常登录/HTTP初始化；停服务后只为该新房用同一Rules种入一个两秒后到期的既有计划，再重启正常入口。此开局fixture产生NpcPlanFormed/ActivityStarted两事件，不证明模型创建计划。

预设三句为已有知识回顾、原地安静等一分钟、观察周围人物；最多20调用、20分钟、¥5、每HTTP5调用及120秒，最多一次Viewer旁白恢复。第一句实际模型选择knowledgeReview，Rules/Room提交成功，但生成后的审核请求返回modelPermanent，公开映射为NARRATION_BODY_INVALID。按首个明确失败停止新行动，第二、三句及旁白恢复均未执行，NPC到期真实结果仍待。

已核对生成响应为合法body JSON，与当前已知信息相符，但未通过审核，未发布。审核响应的HTTP状态/错误正文被原异常边界丢弃，不能把具体供应商原因写成已确认。只读重建发现该无机械结果请求含空resultChecks对象；本地strict校验接受，是否为供应商拒绝原因另做一次有界原请求诊断，不改词重采。

权威证据：开局fixture之后只有KnowledgeReviewed事件；时间仍为0，人物、库存、知识和计划与fixture后完全相同，future trace不存在，NPC调用0、pending due0。总事件3（fixture2+玩家1）、Receipt2（fixture1+玩家1），完整Rules replay与保存状态精确一致。316源码文件起止完全相同，manifest SHA `916f8e9a58a175d0ebfc44a160d41dbad33b60bce3f888548d97dd3c760ffc5e`。

计数：调用scope记录3次（提案、生成、失败的审核）；两个成功响应记录31665输入（hit12672/miss18993）、256输出，官方空闲价已知部分¥0.0302751。失败审核没有usage，不能假定其费用为零，也不能用58k预留作为实际tokens。响应model为deepseek-v4-flash，reasoning包含在completion内。提案格式失败0、Rules拒绝0、发布0、恢复0；服务失败1不应计成模型填表失败。

初始化服务94936、游戏服务95040、捕获94922均受控TERM退出143；extract/source-end/replay退出0，无在途调用。[脱敏证据](vnext-round58-live-evidence.json)保留原结果；私有文件位于 `/tmp/zhuwei-vnext-round58-*`。未部署、push或改源重采。当前只证明知识回顾没有错误推动NPC行动，未证明本批完整游玩成功或稳定性提高。
