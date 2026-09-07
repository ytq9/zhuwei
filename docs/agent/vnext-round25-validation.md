# vNext round25：独立 observe 实测在 strict 参数解析前被拒绝

日期：2026-09-06。基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交工作树。独立 observe 本地纵切已通过，但本批真实模型未完成合法提交，不能算普通行动、知识分类或旁白通过。

## 批次与实际结果

调用前预算为最多2根行动、10次 Provider、580,000输入/81,920输出 tokens、10分钟；每根预留5次调用，启动时至少剩余120秒，首个明确失败即停。HTTP 单请求上限5次与外部批次累计计量分开。本地注册、建房、建卡、开团准备均0次模型调用；源码审查期间首次准备的房间未发出行动，正式批次使用重新准备的新房。

实际仅发出一次正常 Cookie HTTP 意图：“我仔细观察炉内是否还有火，不触碰炉壁，感受炉台附近的温度，并想想这些迹象能否说明炉子最近是否有人使用过。”只有1次 `deepseek-v4-flash` Proposal调用，11,049ms。响应为 `action=notCommitted/narration=notApplicable/outcomeKind=rejected/code=PROPOSAL_FORM_INVALID`，随后停止；未进入 Rules、Narration、第二根复杂行动、duplicate 或 ACK。

## 原始失败与诊断边界

最早失败是原工具 arguments 缺少一个 `}`：长度3043字符，缺口偏移3012，`parseJsonWithUniqueMembers` 返回 `json:object-delimiter-expected`，Offer parser 抛 `VNextProposalBundleOutputError`。仅在内存诊断副本补括号后，得到 `bundle:adjudication-shape-invalid`；再仅删除额外的 `adjudication.pressureLabel` 后结构 parser 接纳。两份诊断副本均未提交，不证明语义或机械合法。先前过程说明误将额外字段称为首因，现按上述更早的原始 JSON 失败纠正。

已核对实际捕获请求与当前 `createVNextProposalOfferModelInput → deepSeekRequestBody` 的 canonical hash 相同，system/tools 相同；服务器使用 strict binding 与 beta endpoint，tool 为 `strict:true`，check schema 的9个必填字段及 `additionalProperties:false` 正确。`pressureLabel` 在实际 schema/system/context 中均不存在，也未找到旧 compound/observe/formSchemas 指导混入。`finish_reason=tool_calls`，输出1541小于4000上限，不是达到输出上限后的截断。当前证据支持 Provider 返回违反 strict 合同，未定位为应用 Prompt 污染。

原草稿选择了新 observe，并填写1条 inference，以本分支2条 sensoryEvidence 为依据；但感官文字仍含“无近期翻动添柴的痕迹”“不像刚添过柴的炉膛”等解释。类型入口可达不等于自然语言分类通过，本批语义审查保持未通过。没有自动修补 JSON、删除字段后提交、扩展 schema 或追加抽样。

## 权威状态与验证

后续规格复核：SPEC0015 §§6.1–6.2 与 SPEC0016 §§7.2、12 允许语义已完整冻结时的一次 JSON/schema 稀疏修订，当前 summary-only 实现仍有差量。但本次原扫描只完整证明 mode/basisRefs/adjudication/terminal，proposals 在偏移3012失败，无法冻结完整子提案及 outcomeBinding，所以本批仍不能恢复，不重发整束或以平台 retry 绕过预算。同 submission 复用已持久 completed 响应是正确行为。

- SQLite：0事件、0Receipt、pending due=0、1份 Proposal journal，无 Delivery/Claims。
- 实际 genesis+events 经 Rules replay 与保存 state 精确一致；完整 state 也等于 genesis 初始 state。无随机、时间、库存或资源变化。
- Claims 不存在，`frozenContextsChecked=0/frozenContextsConform=null`；不以空集合全称判断宣称 Claims 已验证。
- 本地 HTTP harness、SQLite 提取、replay 与诊断脚本均 exit0；harness exit0 仅表示记录完成，产品结果失败。诊断只处理私有本地副本，无额外 API 调用。
- 独立 observe 当前源码的 Node80/80、Room5/5、typecheck exit0 见[本地验收](vnext-observe-validation.md)，与本批真实语义失败分别计量，没有重复运行已通过测试。

## 用量、源码与处置

| 调用 | 输入 | 命中 | 未命中 | 输出含思考 | 空闲标价 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Proposal | 20,555 | 256 | 20,299 | 1,541 | ¥0.0373958 |

thinking disabled，未单独报告 reasoning。重新读取[DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，页面 SHA256 仍为 `899affbdbc33d0be620d8dea59e86f5036c11b5410b14d060b8d2874c74f38e5`；空闲每百万命中/未命中/输出为¥0.05/1.50/4.50。标价不是账户扣款凭证，全部记为开发验收。累计见[成本账](vnext-cost-estimate.md)。

[调用前源码清单](vnext-round25-source-manifest.json)为290文件，UTC `2026-09-05T23:28:47.583234+00:00`，manifest hash `b6c3c61f4fae04f6813719fa94b2568b91cfc86ba53d86ed46546e11d07aafac`；批次后逐文件无变化。Workflow `sha256:5f20b4c6760ff1627be580b5be0f220e77e568be4c00fe8e6527a202ed322b96`，完整 runtime 为 `runtime-srd51-2014-authoritative-vnext-stage3` / `sha256:246593e8bccb34662e49b778b267d89c161527468aca7d364b44f1932c0ff8e7`。完整数值、parser/schema hash 和脚本hash见[脱敏证据](vnext-round25-live-evidence.json)。捕获文件hash不冒充HTTP wire hash。

server/capture均Ctrl-C退出130，4320/4321无监听；无生产修改、部署、push、远端migration、Secrets或旧房删除。原始Prompt、响应和含Cookie的会话仅留本机私有 `/tmp/zhuwei-vnext-round25*`，不入库。

下一步继续来源主张/social 的通用纵切及已复现的 Viewer 边界修复，保留本次 Provider strict 违规为未解决的真实链问题。复杂补取、可用旁白、后续行动、双玩家20+链及生产替换未通过；私有恢复合同仍待答复，120金标/SLO后置，总Goal保持active。
