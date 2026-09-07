# vNext round27：social JSON 缺闭合符与创作边界纠正

日期：2026-09-06；基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交树。正式请求使用修复 NPC 引用目录、Activity 投影及正常 NPC 初始化后的新房；后续创作指导与背景投影修复发生在服务关闭后，不重判本批。

## 实际调用与结果

预设上限为2根行动、10次Provider、580,000输入/81,920输出tokens、10分钟；每根预留5次调用与120秒。正常Cookie HTTP注册、建房、建卡、开团0调用。原意图是向莉安表达哀悼并询问铜钥来历，允许她不回答。

正式 `deepseek-v4-flash` Proposal 1次，9,969ms，27,982输入（命中768/未命中27,214）、1,185输出，空闲标价 **¥0.0461919**。工具参数在 proposals 内缺少一个 `}`，唯一成员parser报告 `json:object-delimiter-expected`，HTTP返回 `notCommitted/notApplicable/PROPOSAL_FORM_INVALID`。首失败停批，无旁白或第二行动。

唯一额外诊断仅把同一捕获请求的 `thinking.type` 从 disabled 改为 enabled，模型、tools、上下文、beta端点、max_tokens=4000保持，timeout=60000，不提交Room。UTC `2026-09-06T02:55:46.987Z` 开始，182ms返回HTTP400 `DeepSeekApiError/request_rejected`；没有usage或模型输出，响应正文被binding丢弃。**具体拒绝原因未知，不能据此判定模型不支持思考或比较思考质量。** 不再追加对照；预算中的58,000/4,000 token占额不是实际usage。共2次尝试、1次已知usage、1次费用未知。

## 离线诊断与证据限制

仅在诊断副本的字符偏移2399插入一个闭合符，parser接受；`relationship.basisFactRefs` 是合法字段。先前诊断脚本预期它非法属于脚本错误，已撤回。副本继续lowering得到 `PROPOSAL_REFERENCE_INVALID / proposal:basis-ref-not-read-bound`，需要定位直接引用绑定，不能宣称已到达Rules。原请求与本批源码生成的strict请求hash精确一致，holder引用均属于本人snapshot，NPC身份/目标/行为边界实际存在。所有诊断副本均未提交，离线诊断无新增API。

SQLite为0事件、0Receipt/Delivery/Claims、pending due=0、1份Proposal journal。该批实际genesis/events replay精确等于持久state与genesis，时间、资源、库存、随机不变。Claims数量0、conformance=null，不把空集合当验证通过。

后续绑定修复：准确缺失的是本人裸开场knowledgeRef，正文实际已按holder路径加载且hash匹配；guard和selector的alias规则不一致。已统一精确冻结binding解析，保留原basisRefs的同一诊断副本lowering接受；未改原JSON仍拒绝，未执行Rules或提交Room，新增API为0。见[NPC来源记忆与知识别名验证](vnext-npc-source-memory-validation.md)。

## 用户纠正后的语义审查

KP可创造尚未记载的人物经历；新内容不要求一个证明同一内容早已成立的引用。已有事实用于检验一致性，创建后进入正史并约束后续创作。资料未写与角色明确不知道是两件事；来源主张、谎言和世界真相也应分别保存。

若把台词内容解释为真实经历，可指明的具体矛盾是：既有人物 `publicFace` 为28岁，草稿却说幼时得到铜钥并“攥了它三十年”。年龄已在genesis definition.description保存，却没有进入被指定为NPC决策依据的本人identity。这个上下文遗漏与错误的“不能补写未知历史”指导已另行修复，见[本地修复证据](vnext-social-npc-initialization-validation.md)。按SPEC0001 §9，NPC也可夸张、误记或撒谎，所以“攥了三十年”作为来源主张不能仅因与年龄不符就判非法；应审查提案时已经冻结的动机和认知依据，不在失败后补造欺骗意图。谁交给她钥匙等未写细节本身不判失败。草稿用尚未介绍的玩家角色名称呼玩家、成功/失败的披露边界及有意义后果仍需审查。

当前social固化的是来源发言；新经历正史、主体记忆、同束回应及自由文本一致性验证尚未闭合。引用存在或parser通过都不能证明语义相容。

## 源码与计量

[源码清单](vnext-round27-source-manifest.json)298文件，UTC `2026-09-06T02:50:27.191988+00:00`，manifest hash `c579b7f3ebead1e89bbddc1c86b7034384cc22cd4d3b5d29dbccb8d835b36896`。Workflow `sha256:107652583143f2ff101d1a0ce39f917bde589b88ab21960500c677658c7890cd`；runtime `sha256:eb496bd870ee6ce96ca3918a7511230be98ed5ffd714dd8985ac31626a7864d9`。详细schema/parser、usage、脚本hash见[脱敏证据](vnext-round27-live-evidence.json)，价格及累计见[成本账](vnext-cost-estimate.md)。官方空闲标价不是账户扣款凭证。

HTTP采集及原源码replay完成；修正后的离线诊断exit0，表示准确复现拒绝，不表示产品成功。server/capture已Ctrl-C退出，分别exit130/1。私有Cookie与捕获原文仅在 `/tmp/zhuwei-vnext-round27*`，不入库。无部署、push、远端migration、Secrets、新资源或旧房退役。普通NPC可用链、复杂补取、后续行动和完整Goal仍未完成。
