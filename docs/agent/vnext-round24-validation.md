# vNext round24：普通炉台观察已提交，审核超时及知识分类缺口

日期：2026-09-06。`cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交工作树。本批正常 Cookie HTTP 请求已提交，但旁白未发布，且提交内容存在知识分类错误。不能算普通动作完整通过，更不能算复杂 schema 补取通过。

## 批次与结果

预算在调用前记录为最多2个行动、9次 Provider、522,000输入/73,728输出 tokens、10分钟；首个明确失败即停。正常注册、建房、建卡、开团准备阶段0次模型调用。

实际只发出1个行动：走到莉安旁的炉子前，在不接触炉壁的情况下感受余温并查看火是否还燃着。首轮直接选择 `worldInteraction`，没有 `schemaRequest`。独立只读核验发现，开场已有战术对象 `feature:wake:hearth`，首轮已加载 worldInteraction；未补取是合法路由，不是能力被裁切。仅查 entities/canonicalFacts 不足以判断对象不存在，下次选样须同时核验战术对象和冻结引用目录。

3次真实调用中的 Proposal、generation 成功，review 在41,621ms后中止。玩家响应为 `action=committed/narration=retryableFailure/code=NARRATION_PROVIDER_TIMEOUT`。本批随后停止，没有重发、恢复、ACK或第二个行动。

## 两项独立诊断

1. **旁白本地总预算耗尽。** `authoritative.ts` 的生成与审核共享45,000ms；生成3,379ms、审核41,621ms恰好用尽总额，Proposal的5,758ms独立计算。支持本地截止时间中止审核，不能据此断言DeepSeek返回了服务端超时，也不能区分网络迟滞和服务端生成慢。未加长上限、换模型或追加抽样。
2. **历史推断被放入感官证据。** 原Proposal的touch/sight证据分别包含“主人过去一段时间没有把火烧旺”和“多半在雨停前后就熄了”。这些超出当下触觉/视觉证据；提交把整段保存成 `worldInteractionSensoryEvidence`、`source=observedEvent`，随后以 `clarity=full` 授予角色。错误发生在Proposal到知识提交之间，不是旁白才添加。`full`仅表示内容层级；问题是把历史解释归为sensoryEvidence，而非full本身赋予真实性。现役vNext能力目录/Bundle没有独立推断入口；底层已有 `formCharacterInference → CharacterInferenceFormed → characterInference Claims`，应复用并补齐模型可达性，不能用关键词过滤、旁白改写或回滚已提交事件伪装修复。接通推断时还须核对直接Claims消费者目前遗漏的confidence，保留推断不确定性；类型与权限验证不能被宣称为任意自然语言蕴含关系的确定性验证。本批尚未修复该缺口。

当前Room持久化Receipt、逐Viewer Claims、完整冻结表达上下文、投递代次与失败码；未审核候选正文和审核请求只有Adapter局部变量。本机私有捕获不是生产恢复journal。专用Viewer恢复复用冻结材料，但会重新生成、重新审核，最多新增两次调用；不会只重发本次review。已发布后的零调用幂等证据不能外推到这一失败状态。是否保存审核阶段属于后续实现选择，不能把现状写成阶段恢复完成。

## 权威状态与定向证据

- 实际SQLite副本中5事件：两组 `CanonicalFactDeclared + SensoryEvidenceAcquired`，最后 `WorldInteractionResolved`；1份Receipt，pending due=0，audience为retryableFailure。
- 实际genesis+events经当前Rules replay与保存state精确相等；冻结表达上下文conform。entities、战斗、timeline与虚构时间未变，无随机、库存、伤害或资源扣减事件。该结构证据不证明文本知识分类正确。
- `npx tsx /tmp/zhuwei-vnext-round24-replay.mts`：exit0。SQLite提取继续采用隔离SQLite/WAL副本，不修改源库。
- `npx tsx --test --test-name-pattern='recovery keeps the identical frozen inputs' tests/kp-vnext-narration.test.mjs`：1/1，exit0，验证冻结输入、429/总超时不触发额外修复。日志 `/tmp/zhuwei-round24-timeout-recovery.log`。这是既有确定性恢复边界，未冒称本批真实恢复成功。

- `npx tsx /tmp/zhuwei-round24-knowledge-boundary.mts`：exit0，固定实际原Bundle被接纳、两段原文进入full感官知识、显式注册stage3的Rules推断成功及未知证据拒绝、vNext推断变体被拒绝。日志 `/tmp/zhuwei-round24-knowledge-boundary.log`。这是缺口复现，不是语义修复通过。早先诊断误用生产runtime返回unsupportedProfile，改用本房现役完整manifest后得到上述证据；未改生产Registry或状态。

## 用量、源码与处置

| 调用 | 输入 | 命中 | 未命中 | 输出含思考 | 空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Proposal | 20,383 | 9,088 | 11,295 | 845 | ¥0.0211994 |
| generation | 1,799 | 768 | 1,031 | 428 | ¥0.0035109 |
| review超时 | 未知 | 未知 | 未知 | 未知 | 未知 |
| 已知小计 | 22,182 | 9,856 | 12,326 | 1,273 | ¥0.0247103 |

317个reasoning tokens已包含在输出。重新跟随重定向读取[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，正文SHA256为 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`；空闲每百万命中/未命中/输出为¥0.05/1.50/4.50。初次未跟随302的响应不是价格证据，未用于计价。全部计开发验收；超时调用缺usage不记零费用。

[调用前源码清单](vnext-round24-source-manifest.json)记录289文件，UTC `2026-09-05T22:42:27.477743+00:00`，manifest hash `ffb31229a14c052b1dbddd7ef9edce984a18e75703c7f808907edf1b99dc7d00`；调用结束逐文件核验无变化。Workflow仍为 `sha256:1835a36cc2eb7fd721c535f9e3d72b27e81b8b8473566402a4d1de5d28a0b672`。完整数值和结果见[脱敏证据](vnext-round24-live-evidence.json)；捕获文件hash不是HTTP wire hash。

本地server/capture均Ctrl-C退出130，无生产变更、push、部署、远端migration或旧房删除。原始Prompt、正文与会话只留本机私有`/tmp/zhuwei-vnext-round24*`。

后续先补齐感官证据/角色推断的通用表达与Viewer边界，再继续复杂schema补取和真实可用旁白；不得把本批失败改判为成功。私有归档合同仍待用户答复，独立工作继续；总Goal保持active，20+双玩家链、生产替换和后置认证未完成。
