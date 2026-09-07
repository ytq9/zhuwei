# vNext round28：NPC 本人知识引用与新经历的真实入口

日期：2026-09-06。`cloudflare/258caee404e0814405eb497653ee9f00d647b773` 的未提交开发树；前置为[新经历与记忆纵切](vnext-world-fact-memory-validation.md)。本批不是生产验证。

## 真实批次

预设上限2根行动、10次Provider、580,000输入/81,920输出、10分钟；每根预留5调用和120秒，首次明确失败即停。正常Cookie注册、建房、建卡和开团使用0次模型。角色向莉安表达哀悼并询问铜钥何时、如何到她手里，明确允许不回答。

实际只有1次`deepseek-v4-flash` Proposal，8,635ms；31,536输入（全部未命中）、953输出，官方空闲标价**¥0.0515925**。原JSON及closed parser接受，但lowering返回`PROPOSAL_REFERENCE_INVALID / social:foreign-npc-basis`，HTTP为`notCommitted/notApplicable`。没有第二行动、旁白或thinking对照，批次已停止。

实际SQLite为0事件、0Receipt/Delivery/Claims，pending due=0，Proposal journal=1。原源码下replay精确等于持久state与genesis；资源、时间、库存和随机未变，Claims conformance为null而非空集合通过。server与capture均退出130，4320/4321端口已无监听。

## 根因与本地修复

失败响应的两项`npcContext`依据使用本人目录中的`knowledgeRef`，而social只接受同一目录中的完整`entryRef`。冻结快照具备本人正文、holder身份和hash，不是该NPC缺少知识，也不是借用另一NPC。顶层5个basis均已授权、读绑定完整；实际请求与该批源码重建请求hash完全相同，源码清单在调用期间无变化。

在已验证的`NpcDecisionContext`上新增唯一的`npcDecisionEvidenceRef`解析：实际record或完整entryRef优先；局部knowledgeRef只能匹配指定npcRef的完整本人快照。social lowering把引用解析为同一规范记录后交给原Rules验证器，不补造知识、不重读当前世界、不改台词、动机、分支或原Proposal。已存在的NPC context检查要求每条目录有正文/hash，缺正文不能以别人的同名知识补足。opaque知识ID可包含`knowledge:`，不按字符串前缀推定归属。

同步consumer为social成功/失败分支、同束materializedKnowledge路径、Profile语义绑定与schema/guidance说明。WorldFactMemory的时序描述同步为骰前冻结、完整结算前持续检查，与允许late producer的现役执行一致。没有增加Provider调用或修订次数。

原捕获响应未改变，在修复后离线lowering接受；未执行该诊断结果的Rules或提交Room，不能改判本次真实批次成功。新源码的schema/guidance已变化，后修复请求hash不再与历史请求相同属于预期，保留修复前的精确请求证据。

## 验证证据

- 先把既有同holder/异holder行为组扩为两种引用写法，定向运行`social can cite the advertised`失败exit1，复现`social:foreign-npc-basis`。
- `npx tsx --test tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-npc-decision-context.test.mjs tests/kp-vnext-world-fact-memory.test.mjs`为33/34、exit1；新alias误用字符串前缀挡住合法opaque ID。去掉该额外判断后只复跑失败项，**1/1 exit0**。成功路径核对同一规范basis/readSet、Rules/project/replay；拒绝路径覆盖外来holder、未知ID、目录缺本人正文但另一角色持有同ID。原其余33项不重复运行。
- `npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'executes social Form.*direct'`最终**1/1 exit0、34跳过**。使用裸本人knowledgeRef经真实Room Action提交，驱逐与duplicate不重复副作用，下轮本人来源记忆保留完整规范依据。首次仅新增断言把现役JSON字符串sourceBasis误当数组，修正断言后通过。
- `npm run typecheck` **exit0**；导出helper签名之后的变动只删除内部前缀判断和补测试。`git diff --check` **exit0**。

本地输出分别为`/tmp/zhuwei-round28-npc-knowledge-alias-{red,node,final,types,room,room-final}.log`；原响应离线诊断`/tmp/zhuwei-vnext-round28-diagnostic.mts`及后修复副本均退出0。首次诊断脚本把ReadonlySet误用includes，改为has后准确复现产品拒绝；不将诊断脚本错误当模型失败。

## 尚未通过的行为

原回复把手指拢钥匙、抬头等舞台说明放入只容纳实际台词的`response.text`，末尾引语亦不完整。它仅提交social，未使用worldFact producer；若要把父亲交钥匙的片段视为实际亲历，就还缺显式正史与知情关系。它也可能被写成有来源的夸张或编造说法，但这必须在原提案的认知/动机中确定，不能事后补造谎言动机来挽救输出。

无旧同义引用不构成失败，NPC说法与世界真相相悖也不单独构成失败。真实模型能否主动选择新经历固化、准确区分自身记忆/转述/编造、跨轮延续并保持秘密，仍未通过。现有同调用一致性自检不证明任意自然语言无矛盾；别名修复只解决具体引用接缝。

## 源码、费用与后续

[源码清单](vnext-round28-source-manifest.json)299文件，UTC`2026-09-06T04:29:17.675165+00:00`，hash`21f8180bed31ae166b0fab3a85555805b4d79d991c25954bdf3f751b91115862`；请求期间源码不变。Workflow/schema/parser/runtime和脱敏usage见[证据JSON](vnext-round28-live-evidence.json)。调用前重读官方价格，周日为空闲时段；费用是usage乘官方标价，非扣款凭证。

round6–28累计55次尝试、52次已知usage、548,899输入/53,386输出，已知空闲标价¥0.78463595–0.8987727，另有原3次未知费用，全部记开发验收。[成本账](vnext-cost-estimate.md)已同步。私有Cookie、API捕获和prepared/replay原文仅留本地诊断文件。

无部署、push、远端migration、Secrets、新资源或旧房退役。V06、复杂补取、双玩家20+、完整游玩和生产替换仍待；不重复已停止的本批。归档仍待原答复，120金标/SLO后置，总Goal保持active。
