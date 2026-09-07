# vNext round26：social 引用目录冲突与正常 NPC 初始化缺口

日期：2026-09-06；基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交树。原批次只有一次正常 Cookie HTTP NPC 对话，失败保留，修复后另开 round27，不重判本批。

## 实际结果

调用前预算：2 根行动、10 次 Provider、580,000 输入/81,920 输出 tokens、10 分钟，每根预留5次调用与120秒。正常注册、建房、建卡、开团均0模型调用；使用当前 manifest 新房，不复用 round25 房间。

意图为向莉安表达哀悼并询问铜钥来历，允许她不回答。实际 `deepseek-v4-flash` Proposal 1次、8,182ms；模型选独立 social，完整 JSON/parser 通过，但返回 `notCommitted/notApplicable/PROPOSAL_REFERENCE_INVALID`。首失败即停，没有旁白、第二行动、ACK、duplicate 或修订调用。

## 根因与语义边界

从实际 SQLite prepared/context、原始响应重走 `lowerVNext2ProposalBundle`，准确复现 `social:foreign-npc-basis`。目录 `citations.npcKnowledge` 广告的是裸 knowledgeRef，且把完整 holder entryRef 放进 `nonCitableRefs`；social 正确要求完整 holder ref。模型复制了目录里那条裸引用。NPC snapshot 与知识正文均在，仅在诊断副本换成对应 holder ref，lowering 接纳；副本从未提交，也不证明语言语义正确。

原引用知识正文为“父亲说过有第三份遗嘱”。**2026-09-06 用户纠正后的审查口径：KP 可以依据人物上下文填补未记载的经历，新经历无需已有同内容引用；缺少旧引用本身不是语义失败。** 因此撤回将铜钥来历、父亲托付等一概判为“无依据杜撰”的结论，应逐项检查它们是否与锚点、既有年龄及经历相悖，并通过创作路径固化。台词保存为来源主张不自动证明或保存了对应世界真相，当前这条正史接缝仍未闭合。`text` 包含低头、摩挲、拨柴火等舞台说明，是台词字段混入表演描述；若其中行动改变权威物理状态，还需合法操作。DC13的有意义失败也未证明。本次因实际引用目录冲突未提交，不用语义口径纠正改判为成功。

只读审查进一步发现正常初始化只保留 NPC 名称/voice/机械与3条 `knows`，丢失模组已经保存的目标、行为边界、明确未知；测试夹具人工注入 semantic definition，掩盖了正常开团缺口。后续修复见[社交与初始化修复](vnext-social-npc-initialization-validation.md)。开场文字“坐在炉边”与权威坐标的既有不一致另行待核，不用本次未提交动作纠正。

## 权威与成本证据

SQLite 为0事件、0Receipt、0Delivery/Claims、pending due=0、1份Proposal journal。当前批次源码的实际 genesis/events replay 精确等于持久 state，也等于 genesis 初态；无时间、库存、资源或随机变化。冻结Claims数量0，conformance=null，不宣称验证空Claims成功。

输入23,403（命中768/未命中22,635）、输出994，空闲标价 **¥0.0384639**，全部记开发验收。2026-09-06 10:30左右重新读取[官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，页面SHA256仍为 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`；每百万命中/未命中/输出为¥0.05/1.50/4.50。不是账户扣款凭证；累计见[成本账](vnext-cost-estimate.md)。

[源码清单](vnext-round26-source-manifest.json)297文件，UTC `2026-09-06T02:30:06.299008+00:00`，hash `f114cde1313ad008c7937e0ffa36d4f6a758a2c1ec11f1ec2781dae5063bc90a`。Workflow `sha256:d096c64316cafc9f4035763667383fbec01827ba9198dc2ba1fbfa49b63ea467`；runtime `sha256:66817680997fd4709d84fb221c0eda74f160042f2b5c232a9436c84899af51ab`。完整计量、脚本hash与parser/schema见[脱敏证据](vnext-round26-live-evidence.json)。源码修复发生在本批服务关闭以后。

HTTP harness、提取、原源码replay与诊断均exit0，仅表示证据采集完成，产品结果失败。server/capture Ctrl-C后分别exit130/1，4320/4321无监听。本地私有 `/tmp/zhuwei-vnext-round26*` 原始材料不入库；无部署、push、远端migration、Secrets、新资源或旧房删除。复杂补取、可用NPC旁白、后续链和生产替换未通过，完整Goal active。
