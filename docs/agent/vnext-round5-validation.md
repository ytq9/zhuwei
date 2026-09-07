# vNext round5：Narration 输入与完整事实表达

日期：2026-09-05。基线 `cloudflare` / `258caee404e0814405eb497653ee9f00d647b773`，继续既有未提交树。开发期；没有 push、部署、远端 migration、生产切换或数据退役。

**已定位 Narration 输入与校验的表达缺口，并补通用事实生成；真实可用旁白仍未通过。** 本批只有同一已提交行动的旁白恢复，没有新 Proposal 或机械提交。[脱敏证据](vnext-round5-live-evidence.json) 与 [round4](vnext-round4-validation.md) 分账。

## 症状与证据

普通 Cookie HTTP 恢复的两次旁白均为 `unsupportedClause`，机械状态、库存、HP、职业资源、Receipt 与原 submission 不变，无 Proposal 重跑。

一次独立真实模型诊断保留了私有原响应：感官事实按原词呈现，但模型把“物品：弩矢”与“角色已将 1 件该物品放置在场景中”合成“你将 1 件弩矢放置在场景中”，又把目标名称和环境互动结果合并。现有 guard 只接受原词事实；第二人称还可能把行动者误归为旁观者。

原输入同时包含完整 Claim payload、分类字段、名称表和 narrationFacts，使模型面对多套表达；库存和交互的事实片段又需要主体/对象组合。这是可证的接口缺口。没有证据证明传输丢 Claims、旧 Prompt 混入或本次 800 输出 token 不足；不能把所有失败都归给模型能力。

诊断请求使用 Rules 内部 Receipt，正常 HTTP 使用 Room PublicReceipt，安全字段相差 epoch、branch 和 event range。其余模型、Claims、系统指令、工具和参数相同，但该次输入为 2,307 tokens，HTTP 初次为 2,365，**不能称字节相同的 HTTP 重放**。这些额外字段不含人物归属，未证明其造成正文差异。历史两条被拒旁白没有原文，本次诊断也不用于追认历史正文。

## 修改与直接消费者

- `kp/narration-v3.ts`：模型仅接收从完整冻结 Claims 派生的分组 `narrationMaterials`，保留每个 narrationFact、原顺序与来源归因。`required` 与 guard 共享必需事实策略；实质结果不能被事务确认替代。原完整 Claims、hash、Viewer 权限、body-only 输出、校验及重试依据留在服务端，不截断事实，不解析或改写模型响应。
- `rules/v2/claims.ts`：库存事件携带明确的 actor、recipient 和操作语义，不能从排序后的参与者列表推断行动者；Viewer 名称只取已授权冻结名称表。收取、放置/丢弃/遗失、转交、装备/收起、识别、损坏/修复/销毁共用同一类型和事实生成路径。遗失与丢弃不再显示为放置状态；部分移动的源堆不获目标堆状态。
- 同一 Claims builder 为环境互动保留结构化结果种类，直接生成含行动者、目标、真实成功/失败及对应检定值/DC 的完整事实。只读摘要不反向解析成规则，模型不负责拼接实体关系。其他有现役消费者的 Claim 家族继续现有生成路径。
- 直接链为 committed events → Claims derivation → Viewer refs/名称与 conformance → Frozen Delivery → Narration Adapter。新操作引用也接受 Viewer 检查；分类字段和角色引用不直接进入正文。

以上没有物品名称派发、按提示词关键词裁决、替换“角色”为“你”、固定伪成功、自动删模型步骤或放宽事实校验。叙述承诺的 KP 创作边界未改。完整句由真实已提交语义生成，只解决事实交接，不能据此声称整个 KP 已达到产品要求。

## 真实对照与成本

先只改 Provider 材料呈现，再恢复同一 submission：初次仍 `unsupportedClause`，替换为 `missingClaimFacts`，没有新正文发布，全部机械状态保持原样。因此精简输入不足以修复整个问题。之后补结构化完整事实，**本批没有再次调用模型测试该最终修改**。

| 调用 | 输入 tokens | 输出 tokens | 结果 |
| --- | ---: | ---: | --- |
| 原材料 HTTP 旁白 | 2,365 | 156 | unsupportedClause |
| 原材料 HTTP 替换 | 2,267 | 156 | unsupportedClause |
| 独立原材料响应诊断 | 2,307 | 157 | unsupportedClause，取得私有原文 |
| 精简材料 HTTP 旁白 | 995 | 148 | unsupportedClause |
| 精简材料 HTTP 替换 | 880 | 159 | missingClaimFacts |
| 总计 | **8,814** | **776** | **5 次，无未知用量** |

宿主是独立本地 `dev:vnext`，旁白使用普通 DeepSeek `/chat/completions`，并非 Proposal 的 beta strict。预算仍为最多 12 次、360k 输入/32k 输出，每 HTTP 最多 4 次；失败定位后只做上述一次响应诊断和一次修复对照，未继续采样碰成功。输入成本下降不代表约 27.5k 的 Proposal 输入或整体 token 采用门已完成。测试宿主已 Ctrl-C 停止，退出 130；凭证及原响应只留权限受限本地文件。

## 定向验证与未覆盖

- `npx tsx --test tests/kp-vnext-claims.test.mjs tests/inventory-operations-vnext.test.mjs tests/kp-vnext-world-interaction-rules.test.mjs`：最终 **57/57，退出 0**。含两种物品/不同角色顺序、各库存操作、部分/完整转交、单独移除授权、未知字段拒绝、直接成功/攻击失败，以及真实 Rules → Viewer Claims → replay。首跑一个新拒绝 fixture 仍携带已移除授权的 displayName，被名称边界提前拒绝；同步移除 fixture 名称后通过，未改产品权限。
- `npx tsx --test --test-name-pattern='vNext .*narration|vNext .*Claims|vNext provider materials' tests/authoritative-kp-adapter.test.mjs`：**8/8，退出 0**。材料无损、来源保留、初次/替换一致、旧真实改写仍拒绝、玩家能动性、完整效果与安全原因码通过。
- `npm run typecheck`、`git diff --check`：退出 0。未跑全量测试、Lint 或 build。旧 round4 的 5 Claims/14 facts 在最终源码下仍 conform，原事实正文仍可校验，不改写旧 Delivery。

下一步先明确 guard 的语义改写边界，再用新提交验证完整事实句的真实旁白，并在受限诊断中保留实际拒绝正文，避免只有错误码时额外重采样。随后仍需环境承诺 → 后续引用固化、实际有成本行动/职业资源、生成物品连续生命周期与 token 采用验收。更长事实集合与固定 1,600 字符/800 输出预算的边界，以及其他 Claim 家族的完整主体/目标表达，尚未完成。本报告不宣布 V01–V03 或生产替换通过。

用户追问“校验器要怎么改”后的拟议方向（尚未实现）：保留冻结材料 conformance、Viewer 权限及结构化结果约束；原词表达作为可确定通过的快速路径，其他忠实改写需要对照冻结 Claims 检查逐项断言、归因、数值/结果与必需事实覆盖，不能用字面相等或相似度代替语义判断。若使用独立语义验证调用，它只见相同冻结材料和候选正文，不能新增事实；与现有旁白修订共享调用上限，失败或不确定时停在已提交/未发布状态。第二人称必须有服务端冻结的 Viewer 与行动者关系支持，不能从 opaque viewerKey 或角色列表位置猜。本文不把该设计建议记为已交付功能。

用户进一步明确自然可读与人物性格一致是直接影响游玩的必过项，已纳入 [Narration 重构方案](narration-grounding-redesign.md) 和 V01 TODO。原词事实匹配不能替代可读性验收；近期对话、人物表达特征和基调必须经授权选择并冻结，不能为润色引入秘密或新的世界决定。
