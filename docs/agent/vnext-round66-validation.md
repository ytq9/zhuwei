# round66：无 fixture NPC 计划形成首次真实请求

2026-09-07，cloudflare / 258caee404e0814405eb497653ee9f00d647b773，parser v32、默认 deepseek-v4-flash。正常注册/Cookie新房，初始0事件/计划/Activity/Receipt，公开瓦罗在场；无seed、未提示表单或要求模型一定答应。

第一句固定自然交谈，请瓦罗半分钟后轻敲账台提醒。模型只返回 `schemaRequest`，选择 `["passTime","social"]`，尚未产生任何Proposal草稿或裁决。该版schema选择enum仅包含step家族，passTime虽然已作为首轮小表单展示，却不在可请求家族中，因此返回 **PROPOSAL_FORM_INVALID** 并停批。

原响应JSON语法完整；准确原稿解析诊断为 `VALUE_INVALID / PROPOSAL_SCHEMA_CAPABILITY_UNKNOWN`，位置 `decision.requestedCapabilities[0]`，actual=`passTime`，expected为真实授权静态类型目录。没有Proposal冻结，不能作裁决窄修订；Rules未执行。现有错误未标明arguments pathBase，纳入同一直接接缝修复。公开遥测只摘要到decision，不公开额外私有上下文。

状态精确等于初始；0事件/Receipt/计划/Activity/随机/资源/时间变化。后两行动停批未执行，未重采、换NPC、改话术或模型。格式失败1、Rules拒绝0、叙事矛盾0、修订0、恢复0。没有形成计划是未进入裁决的技术中断，不能当作NPC合法拒绝或“模型不会形成计划”。

后续设计：纯schema选择可以安全请求已经提供的具体小表单，服务端按同一实际schema识别并复用它，只加载仍需的step家族及类型依赖；未知ID和混草稿仍拒绝。小表单单独查询也消耗既有一次schema阶段，下一请求无再次查询，不增加调用上限或造裁决。此设计尚在隔离实现，本批保持失败，不把离线重新解析改判真实通过。

预设最多3行动/20calls/¥5/20分钟、每HTTP5调用/120秒，实际1call、19941输入（3456命中/16485未命中）、60输出，全部usage已知，空闲价开发费用 **¥0.0251703**。官方价格复用root在07:31:48刚核验的同一HTML，并再次核对SHA和实际默认模型；没有伪记新的取价时间。

[脱敏证据](vnext-round66-live-evidence.json)，完整受限证据 `/tmp/zhuwei-round66-npc-preparation/evidence/`。extract/replay/source-end均exit0、320源码起止一致；manifest `468d463cd3333aef14dd246bb2f84d8cc23381dd64b5442081c75dbfb95ed106`。capture21812/game21820按身份SIGTERM，进程和4320/4321消失，detached退出码未知。本批未部署、push或更改生产数据。Goal继续active。
