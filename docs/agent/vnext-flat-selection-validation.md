# 扁平类型选择与所选表单填写

2026-09-07，cloudflare 未提交工作树，parser v34。round67 的真实响应把 social 家族填成 decision.kind，原稿缺少裁决和结果；旧混合入口还同时讲类型选择和完整裁决。该失败保持，不补造裁决，不将原响应改为查询。阶段说明竞争是已识别线索，尚不能证明是供应商输出违规的原因。

现首轮单一 strict 工具只填 requestedCapabilities 数组，第二轮才填所选完整表单。小表单身份来自同一领域 schema，执行家族仍沿原注册表类型依赖闭包；不建立第二套字段或机械规则。两轮完整冻结 user 正文由 Room 逐字验证，保留精确请求、原始响应、hash 和恢复 journal。未知、重复、混合草稿、重复选择及未加载表单均带原解析诊断拒绝。

普通知识回顾、等待和世界内拒绝最多两次，选择及填写用完后无法再调用模型修订。实际含已选执行家族的复杂草稿最多三次，第三次仍须通过原有等义修复票及全提案重验；额外选择闲置家族不能给纯小表单增加调用。缺裁决、目标、DC、成本或后果，以及不能证明安全的不完整嵌套 JSON 继续拒绝。HTTP 五次上限、骰与资源幂等边界不变。此接口增加普通动作调用，是否值得采用仍须真实对照。

16 文件按 baseline/new SHA 串行集成，0 冲突，备份、patch 和哈希见 [集成记录](vnext-flat-selection-integration.json)。直接消费者包括 Schema/Provider、Adapter、Room journal、NPC 计划形成及动态地点；没有修改主 PRD 的创作或 NPC 来源归属边界。

主树同一源码：Node 97/97、Room 50/50、typecheck exit 0。覆盖不同表单、复合依赖、两轮驱逐恢复、第三次修订及预算拒绝、秘密隔离、原稿和完整重验。日志 `/tmp/zhuwei-flat-selection-root-node.log`、`/tmp/zhuwei-flat-selection-root-room.log`、`/tmp/zhuwei-flat-selection-root-types.log`。独立只读生产审查未发现新增 P1/P2；最后差量仅共用函数改名及类型收窄。

真实 [round68](vnext-round68-validation.md) 已复用 round66/67 原话、正常登录新房、默认 DeepSeek、原预算及首失败停批策略：第一轮选择通过，第二轮 JSON 失败；2调用、0提交、¥0.0642114。独立标点诊断副本仍有不可窄改的社会知识 producer 约束，原稿不变，未重采。局部选择和本地测试不能证明完整填表稳定性提高；完整 Goal、连续 20+、复杂提案和生产采用保持未完成。没有部署、push 或修改生产数据。另发现旧 time-passage-room 的受控响应仍使用混合首轮形状，作为直接消费者由 Ability 集成任务迁移，原时间/资源不变量继续保留。
