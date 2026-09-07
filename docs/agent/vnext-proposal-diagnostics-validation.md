# KP 提案结构化诊断与有界窄修订

日期：2026-09-06。开发分支 `cloudflare`，继承基线 `258caee404e0814405eb497653ee9f00d647b773`，保留原有未提交修改。当前实现为v22，已做真实模型修订与本地Room验证；没有部署、push、远端 migration 或数据退役。历史样本不作为模型修复成功率的统计前后对照。

最新真实结果见 [round44](vnext-round44-validation.md)：环境互动、观察及保存检定修订后驱逐恢复 **3/3通过**，三次真实模型响应均确认完整计划，重复请求无新调用/提交，检定恢复只掷一次骰。首稿固定合成、correction为真实DeepSeek、Room为真实本地实现、旁白为测试替身；没有自然首稿分布或统计稳定性提升证明。[round42](vnext-round42-validation.md)原有漏terminal失败保持历史结果，未清洗旧响应。完整游玩仍受[round48旁白语义失败](vnext-round48-validation.md)阻断，不能把修订3/3外推为完整游玩稳定。

2026-09-07 增量以 [round52](vnext-round52-validation.md) 与 [round53](vnext-round53-validation.md) 的完整真实 HTTP 行动为准：52首步发布、拾取误填定义引用被拒；53放下/拾回均发布，复杂提案补取后仍发生嵌套JSON错误并停批。不能声称稳定性或统计成功率已提高。

当前修订验收为文末 v22，早期记录只证明当时源码。本报告的真实入口指本地 `ZHUWEI_VNEXT_LOCAL` 启用的完整 vNext 入口，不表示线上已采用或完成生产替换。地点集成的新增诊断与验证另行记录，不以本批修订结果覆盖未测能力。

此前交付复核已核对 v20 原始日志：Node **176/176**、本地 Room **10/10（23 跳过）**、typecheck **exit 0**。这组三类检查对应当时 v20 源码；随后旁白、social前序及v21诊断实现已有变更，当前全树不再与 [round32源码清单](vnext-round32-source-manifest.json) 完全一致。不能用旧Room检查声称当前全部运行时已验证；当前证据见文末v22及round44。

本次交付范围保持诊断与窄修订。交接中已结束的 [round32 真实调用](vnext-round32-validation.md) 仅补齐结果与费用记录，原行动的旁白审核失败不改判为成功；执行成本、后置 social、完整游玩及生产替换不包含在本报告的完成结论中。

## 能力合同与范围

KP 在获授权的冻结上下文中提交任意已注册提案类型。现有 parser、提案 validator、依赖图与 Rules/Room 各自报告真实校验失败；同一份原稿可以获得一次服务端证明安全的稀疏修订，修订后重新校验完整提案，再沿原有 lowering、Rules 与 Room 提交链执行。没有第二套机械裁决或状态写入路径。

本次保持[主 PRD](../specs/0001-llm-kp-responsibility-contract.md)的叙事边界：兼容已有事实的新创作不因没有旧引用而失败；NPC 可以说谎或转述错误信息。台词的真假与世界事实一致性分别处理，格式修订不能补造谎言动机、裁决、目标或后果。

| 代表性变化 | 验收边界 |
| --- | --- |
| observe / worldInteraction 两种共享检定拥有者 | 同一诊断分类、固定修复、完整重校验；DC、成功失败分支和条件后果保持 |
| knowledgeReview / inWorldRefusal | 同一机制处理不同 terminal 结构；不补缺失的实际裁决，已定资源成本保持 |
| authored item / hazard 与 social | 保留深层原生诊断和引用位置；本人 NPC 依据候选不混入其他 holder |
| 修订越界 / JSON / 恢复 | 拒绝改目标、成本、后果和固定值；保留语法证据；恢复与重复提交保持同一原稿、请求和提交结果 |

## 现有问题与修改

真实入口为 `room/action → vnext/adapter → offer/submit Provider → parse → validateVNextProposalBundle`，本地通过后经 `room-bridge → lowerVNext2ProposalBundle → Rules.step`。

- `canonical-json` 原来只抛 `json:*` 的 TypeError，Provider catch 又将原因汇总成 `strict-*-output-invalid`。现在 parser 返回稳定原因、真实路径及 UTF-16 offset（0 起）、line/column（1 起）；错误字符串 token 定位其起始引号，重复键定位重复成员起点，不猜测字符。
- 多条件 guard 原来只剩 `bundle:*invalid`。现在现有字段谓词直接携带缺字段、类型、枚举、引用数组、DC 等诊断；按原 JSON 对象身份定位嵌套路径。没有可靠位置的旧深层 guard 继续保留原原因，不反推路径。
- clarification 原来吞掉嵌套错误，observe 的合成 branch 也丢失对象位置。现在保留实际对象与 authored 原生诊断。exactKeys 改为报告缺/多字段后，合法 hazard area 的替代形状按原字段存在性选择，避免提前抛错阻断另一合法形状。
- 依赖图在原验证函数内报告缺 producer、类型冲突、重复 producer、条件支配与循环，lowerer 不再丢失该诊断。NPC basis 的失败精确到提案序号、分支、依据索引和 ref。
- Provider、修订票据、Room invocation transition、adapter 错误与私有 authority rejection 传递诊断。Room 内部最终 outcome 的 `proposal` 保存 lowering 诊断；拒绝机械修订时另存原样 `authorityDiagnostics`，不把原 Rules 记录伪装成新的字段诊断或修订指令。公开 Table 使用字段白名单，原稿、候选引用和诊断不进入玩家 DTO。
- 修订准入曾主要允许摘要。现在服务端先从原稿生成固定修复计划，并用同一完整 validator 证明全部改动后的形状可接受；计划、诊断和原稿一起绑定到票据。独立审查发现并修复“未开放的 highRisk 裁决借其他格式错误进入修订”的准入差异，完整、空白错误和 JSON 外壳错误均在额外调用前拒绝。
- 收束复核补修：删除按字段名遍历全树的 trim，只消费同一 validator 实际报告的 `whitespace:trimmed` 路径，最多八次叶子修复与最终完整证明。作者化内容、NPC 解释及 social 摘要原本合法的空格保留，不能误报错误或改变定义哈希。共享检定已完整存在时，条件后果的缺失空分支也可进入同一修订；检定拥有者缺失失败后果仍拒绝。
- 最后复核补修：schemaRequest 的原 gate 仍用空 catch 和汇总 guard 丢失未知能力、重复 ID、类型、缺/多字段及混合草稿的原因。原 capability lookup 现在抛携带失败 ID 的 TypeError 子类，Provider 仅定位对应提交字段；内部依赖失败不能定位时不编造 path 或外发未广告 ID。原 gate 的精确诊断直达 Provider 拒绝结果；纯 schemaRequest 的坏 JSON 也保留原解析位置。没有改变能力依赖闭包、允许的 schema、原准入或调用数，parser binding 更新到 v12。

## 通用诊断与修订范围

`ProposalDiagnostic.code` 为 `JSON_SYNTAX / FIELD_MISSING / TYPE_MISMATCH / VALUE_INVALID / REFERENCE_UNAVAILABLE / CONSTRAINT_CONFLICT / REPAIR_OUT_OF_SCOPE`。按实际证据附 `path / expected / actual / constraint / location / repair`。`pathBase` 默认为传入校验器的 draft；原始 JSON/transport 位置明确标为 `arguments`。Rules 原生诊断明确标为 `rulesInput`，原子步骤位置是实际执行输入中的 steps 路径，不冒充可能重排过的 Proposal ordinal。不把解码后的容器路径称为原文坐标。`repair` 明示是否允许、原因和获准的 add/replace 路径；固定格式改值也一并给出。不能定位的错误不填 path，不能证明等价时 `allowed:false`。

支持的修订：

- 同一 validator 明确要求 trimmed 的 prose 字段去除首尾空白；原本合法的文本保持原样，不按字段名猜测。标识、枚举、数字字符串或任意 operation.value 不转换。
- 已声明为集合的引用数组删除完全相同的重复成员，保持原顺序；包含 `consumes` 的 existing/prospective 依赖记录。不更换引用，不处理有数量语义的库存操作目标，也不去重 `produces`。
- 根据已选 mode 添加缺失的 inactive `null` / `[]`，或 directSuccess 下缺失的 failure:null；共享 check 的 onSuccess/onFailure 后果也可补 failure:null，但须通过原完整校验确认唯一且完整的检定拥有者。不覆盖原稿已有值，不创建缺失父容器。
- 延续原有摘要合同，修正缺失/错型/空摘要；只可概括原稿已有操作。摘要与固定格式修复合计最多 8 处。
- 原有完整顶层成员的缺根闭括号/根尾逗号证据可以占用同一次修订；v22 仍要求 `confirm:"server-plan"` 明确确认整份安全计划；没有摘要待填时使用 `summaries:[]`，不再接受旧 `changes` 响应。
- v20 的 producer 表示证据只允许可逆的空数组或完整单声明数组转换成当前 strict 对象表示，仍要求唯一 correction 明确确认。`wireEvidence` 保存原输入与固定变换，不能直接接受首稿；与字段修订合计最多八处，详见文末。

拒绝的修订：

- 更换目标、未知或越权引用；补造实际裁决、DC、成本、成功失败后果；修改已有语义值或未获准路径。
- 把数字字符串猜成 DC、补缺失的有意义失败分支、改变原裁决类型、请求未加载能力，或以新提案替代原稿。
- 任意截断的嵌套 JSON、坏 token、重复 JSON 成员；这些情况不能证明原决策完整。
- 当前 canonical JSON 身份无法绑定的非 NFC 草稿明确拒绝。本次没有引入新原稿 hash/兼容协议，也不声称支持 NFC 修复。
- Rules/authority 诊断没有对应的等价编辑证明时，本地明确拒绝，不再调用模型重作机械决策。
- 纯 schema 请求尚无冻结提案，未知/重复/已加载能力、混合草稿、坏 JSON 和 envelope 错误保留精确原因后作为技术失败结束；不分配 Proposal 修订票据或额外 schema 补取阶段。

获准的一次修订将完整诊断、原稿和计划传给模型。补充计划覆盖短路校验尚未报告、但同一完整 proof 已证明的其他可修字段。v22 工具要求 `confirm:"server-plan"` 与 `summaries`：模型确认整份计划，只填写 `summaryPaths` 中的自由展示摘要；服务器从重证计划应用固定值。模型不能逐项遗漏固定编辑，也不能把旧 `changes` 结果当成确认。未获准的 authority 修订保留原始原因和拒绝说明在服务端，不为传递诊断额外调用模型。

NPC 依据候选仅来自该 NPC 已冻结、验证并加载的本人 records / knowledge 身份；不存在和其他 holder 的知识引用统一视为不可用。物品操作填写候选仅来自冻结 known 记录、ItemEntry 身份与 viewerEvidenceRefs 的交集；保留 prospective 新实例入口，由原依赖图验证其生产者类型和 consumes。所有操作仍交同一 Rules 校验地点、所有权、数量与效果。不会为了诊断查询当前世界、其他角色知识或额外 authority-only 事实。

## 冻结与预算

保留原始草稿和必要的原始 JSON 语法证据。票据重算完整诊断、固定计划、允许路径与 hash；Room 另从持久化首响应重解析并核对票据，不能通过重新计算一个自洽 hash 偷换原决策。apply 也自行重算计划，不信调用者 allowlist；固定修复必须精确等于计划中的值。

普通链最多 offer + 一次修订；先作纯 schema 请求时最多 offer + expanded proposal + 一次修订。没有增加新的决策阶段或无界重试。网络失败恢复复用持久化阶段的相同请求，不重跑机械、不重新掷骰或重复扣除角色资源。

## 验证记录

本报告只记录本次源码证据，不将此前真实模型失败改判为成功。实际日志均为本地开发输出。

- Node：`node --import tsx --test` 运行 `kp-vnext-diagnostic-repair-provider`、`kp-vnext-proposal-schema`、`kp-vnext-schema-retrieval`、`kp-vnext-json-syntax-diagnostics`、`kp-vnext-representation-repair`、`kp-vnext-structured-diagnostics`、`kp-vnext-private-lowering-diagnostics`、`kp-vnext-social-plan`、`table-server-outcome-v2` 九个 `.test.mjs` 文件，**111/111，exit 0**，日志 `/tmp/zhuwei-diagnostics-node-verified.log`。覆盖 parser、字段/深层 schema、固定计划、Provider、检索、NPC 私有 lowering、social Rules/project/replay 和公开 Table DTO。谎言与误传旧行为测试保持通过。
- 本地 Room：`npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|complete root|incomplete JSON'`，**5/5，exit 0**，日志 `/tmp/zhuwei-diagnostics-room-final.log`。observe/worldInteraction 两种修复各完成真实 prepare → Provider → ticket → correction → Rules → commit → narration；驱逐后原 submission 重复提交没有新增调用或状态变化。越界改 target 在任何 Rules 效果前拒绝；已有 503 恢复测试保留同一修订票据和逐字相同请求，嵌套 JSON 不完整时不修订。
- 追加最高风险检定恢复：同一 Room 文件 `-t 'keeps a repaired check'`，**1/1，exit 0**，日志 `/tmp/zhuwei-diagnostics-room-dice.log`。修订响应已持久化但尚未提交时中断，原 state/events 和角色资源不变；驱逐后恢复保存的原提案与修订响应，服务端自动掷骰一次。再次驱逐、重复原 submission 不新增模型调用、骰子或状态变化。与上一组共 6 个不同用例，不重复计数。
- 最终 `npm run typecheck` **exit 0**，日志 `/tmp/zhuwei-diagnostics-typecheck-verified.log`；文档与最终 `git diff --check` **exit 0**。

收束复核后的增量验证（没有重跑无关用例，也不将重复执行累计为新覆盖）：

- 新行为回归先复现合法文本被修改、共享检定条件后果误拒和原 Rules 原因丢失，3 项均失败，日志 `/tmp/zhuwei-diagnostics-followup-red.log`；内部 lowering 结果丢诊断另复现 1 项失败，日志 `/tmp/zhuwei-diagnostics-private-outcome-red.log`。修复后已通过。测试中一次 null-prototype 与普通对象比较差异改为比较等价 JSON，没有改产品行为。
- Node 直接消费者六文件：`kp-vnext-diagnostic-repair-provider`、`kp-vnext-proposal-schema`、`kp-vnext-schema-retrieval`、`kp-vnext-representation-repair`、`kp-vnext-private-lowering-diagnostics`、`table-server-outcome-v2`，75/76、exit 1，唯一失败是新隐私断言误匹配公开英文解释中的普通单词 proposal。改为检查 JSON 字段与秘密标记后，仅失败项 1/1、exit 0；日志 `/tmp/zhuwei-diagnostics-followup-node.log`、`/tmp/zhuwei-diagnostics-followup-table-final.log`。没有泄露的行为失败。
- 最后恢复原先可修的纯空白摘要：先在 Provider 普通 JSON/完整根外壳两路径复现拒绝，再修正 presentation 判断，同时保留 social 合同原本合法的空白。`kp-vnext-proposal-schema` 与 `kp-vnext-representation-repair` 最终 **43/43、exit 0**，日志 `/tmp/zhuwei-diagnostics-whitespace-summary-final.log`；最后类型检查 **exit 0**，日志 `/tmp/zhuwei-diagnostics-followup-typecheck-final.log`。
- Room 原六项直接消费者重新验证 **6/6、exit 0，22 跳过**，命令为 `npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check'`，日志 `/tmp/zhuwei-diagnostics-followup-room.log`。此前命令中的 `complete root` 没有匹配完整外壳恢复用例，不将其列入本次 Room 覆盖；完整外壳证据来自定向 Node 及前项已有验证。

中间失败均有明确处置：旧断言期待汇总错误，改为精确诊断；新测试一度误用已完成行动的 retry、公开 errorCode 字段、漏拒绝提案 intent/method，已按真实接口修正；检定实际走自动掷骰，改测保存修订响应后的中断/恢复，不人为改变产品行为。新增 authored 诊断的 TypeScript 字面量推断错误已用类型收窄修正并通过最终 typecheck。

后续 [round29 来源字段诊断](vnext-round29-validation.md) 补齐一个进入修订前拒绝的实例：旧知识引用填到同束新事实 variant，原来直到 Rules 才返回汇总错误；现在同一源 validator 精确报告全部三个错误字段及拒绝自动换来源的原因。两种引用形状、已有知识与新事实正常路径使用同一机制；四文件 Node 首次 45/46，修正唯一正常夹具后失败项 1/1；social Room 3/3、最终 typecheck 通过。原真实批次仍为失败，不用本地修复改判，也未重新采样。

最后 schema 补取准入补修的实际验证：

- 新增准入矩阵与 schemaRequest 语法位置两项先复现失败，`node --import tsx --test --test-name-pattern='offer admission preserves|malformed schema request retains' tests/kp-vnext-schema-retrieval.test.mjs`，0/2、exit 1，日志 `/tmp/zhuwei-diagnostics-offer-red.log`。此前仅得到 `strict-tool-output-contract` 或覆盖了原 `JSON_SYNTAX`。
- 修复后 `node --import tsx --test tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-diagnostic-repair-provider.test.mjs`，18/18、exit 0，日志 `/tmp/zhuwei-diagnostics-offer-node.log`。矩阵涵盖 11 种准确拒绝路径；已有 Item/Hazard 正常补取及多类一次修订继续通过。
- `npx vitest run tests/kp-vnext-provider-room.test.ts -t 'retrieves Item and Ability schemas|rejects repeated retrieval and extra stages'`，2/2、exit 0，26 跳过，日志 `/tmp/zhuwei-diagnostics-offer-room.log`。保存两阶段、驱逐恢复、唯一 correction、原子物化/使用和重复阶段拒绝经过真实本地 Room；保持同一预算和无重复资源变化。
- `npm run typecheck` exit 0，日志 `/tmp/zhuwei-diagnostics-offer-types.log`；最终目标文档链接和 `git diff --check` 通过。本次只读审查限修订语义边界、传播和候选权限；未做全量回归、build、部署、push 或新模型调用。

## 当前工作树收束复核

本次继续仅完成用户要求的诊断与窄修订。保留交接中的其他修改与未完成 V05 工作，没有追加真实模型调用，也没有推进部署、push 或远端操作。

独立只读审查与定向复现补齐以下直接缺口：

- correction 的缺 `changes/path/value`、额外字段现在逐叶报告，保留原精确键集合与拒绝条件；`canonicalClone` 的原错误传给同一 `invalidOutput`，不再覆盖非 NFC 原因，也不猜测 canonical 校验器未提供的字段位置。
- 同一 bundle validator 的顶层对象、活动分支对象、提案数组类型/长度与非活动分支 `null` 约束输出准确诊断。原 `checkedField` 消费原谓词，接受集合不变，缺裁决仍不能进入修订。
- 响应已保存后，遥测在 parser 前计算 `canonicalHash(response)` 曾把非 NFC 表单错误变成 `PROPOSAL_PROVIDER_TIMEOUT`。现在包括 hash 在内的遥测构造与投递都在保护范围内，首次行动立即得到真实诊断，驱逐恢复复用已保存响应。
- Room 首次保存 correction 请求时，原来只验证 system/tool、非空 user 文本、票据及原响应，未验证 user 文本就是该票据的内容。Provider 与 Room 现在共用 `vnextProposalCorrectionPrompt`，在首次保存及恢复前逐字核对原稿、完整诊断、允许路径和固定修复计划；不建立第二套正文或机械校验。普通 adapter 原本正确组装，未发现公开 HTTP 能直接利用此内部边界。
- parser binding 更新到 **v13**，仍为一次 correction、最多 8 处、普通最多 2 阶段/补取最多 3 阶段。

增量先红证据：correction envelope 与 canonical 原因 0/2，`/tmp/zhuwei-diagnostics-correction-red.log`；双 mode 容器矩阵 0/1，`/tmp/zhuwei-diagnostics-containers-red.log`；真实 Room 首次非 NFC 误报超时与首次正文篡改 0/2，`/tmp/zhuwei-diagnostics-room-binding-red-final.log`，均 exit 1。Room 新用例最初误用公开 Table 的结果字段，已按内部 Room 的 `kind/code/action` 修正后再次复现原问题，未改变产品行为。

最终源码的定向验证均 exit 0：

- `node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-social-plan.test.mjs tests/table-server-outcome-v2.test.mjs`：**120/120**，`/tmp/zhuwei-diagnostics-closeout-node.log`。
- `npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics'`：**9/9，20 跳过**，`/tmp/zhuwei-diagnostics-closeout-room.log`。新增 offer/correction 两阶段非 NFC 的首次准确拒绝与驱逐恢复；正文为空、删诊断、换草稿或允许路径都在首次 journal 保存前拒绝。已有检定恢复、目标越界、schema 补取、两种提案修复保持通过。
- `npm run typecheck`：**通过**，`/tmp/zhuwei-diagnostics-closeout-types.log`；最终目标链接与 `git diff --check` 通过。未将不同源码状态或重复执行累加成新增覆盖。

两名只读审查代理复核增量后未发现新的可操作问题；机械接受条件、完整重验、原稿绑定和候选权限保持。没有进行真实模型前后对照，因此只能证明诊断可达、修订范围扩大且受约束，不能声称模型修复成功率已经提高。任意自然语言的事实冲突识别、摘要准确性、叙述质量及未能定位的深层规则诊断仍是后续工作；本次不扩大到发布或全量回归。

## 重复引用的诊断与修复指令一致性

本次承接重新验证当前工作树，Node 原九文件 120/120、Room 原九项 9/9 通过；typecheck 首次 exit 2，定位到继承 V05 的 `world-interactions.ts` 在尚未收窄的 `StepResult` 上读取 `events`。此前 v13 的类型通过记录仅对应当时源码，不用于证明继承改动。现在提取 refusal 成本证据前要求结果为 committed，其余结果明确拒绝；没有开放或补完 V05。

独立只读复核另发现本任务直接问题：仅有重复引用时，validator 的准确诊断路径为数组成员，如 `basisRefs[1]`，而服务端固定去重计划位于父数组 `basisRefs`。原诊断和计划只按完整路径相等关联，导致同一票据同时传递 `repair.allowed:false` 与父路径的 `allowed:true`。

修复仅改变诊断与既有计划的关联：已证明的父路径 replace 可以覆盖其成员的错误。原 code/path/expected/actual/constraint 保留，repair 明示父路径、replace 和固定值；没有开放成员修改、其他目标或自选数组值。允许路径、计划生成、apply 和完整重验保持。parser binding 更新为 v14，以绑定新的诊断票据和请求正文。

新增 Provider 行为矩阵仅制造一种错误，分别覆盖 bundle.basisRefs、observe.focusRefs、worldInteraction.targetRefs 和 knowledgeReview.knowledgeRefs，验证原成员诊断与父数组修复指示一致、模型收到完整票据、只调用一次 correction，且修复后的完整 bundle 精确等于原合法 bundle。旧目标/DC/成本/后果越界与自造票据仍拒绝。

实际证据：

- 先红：`node --import tsx --test --test-name-pattern='a proven reference-set replacement' tests/kp-vnext-diagnostic-repair-provider.test.mjs`，0/1、exit 1，日志 `/tmp/zhuwei-diagnostics-parent-repair-red.log`，准确复现相反修复指令。
- 定向增量：`node --import tsx --test --test-name-pattern='a proven reference-set replacement|fixed-value repair rejects|ticket diagnostics|a frozen refusal preserves' tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-frozen-choice.test.mjs`，4/4、exit 0，日志 `/tmp/zhuwei-diagnostics-parent-repair-green.log`。只选择 refusal 相关用例，不代表完整 frozen-choice 文件通过。
- 最终 Node：运行上一节同一九文件命令，121/121、exit 0，日志 `/tmp/zhuwei-diagnostics-final-node.log`。
- 最终 Room：运行上一节同一九项命令，9/9、20 跳过、exit 0，日志 `/tmp/zhuwei-diagnostics-final-room.log`。覆盖本地真实 prepare/Provider/Rules/commit、原稿绑定、恢复和重复提交，Provider 使用确定性替身。
- 最终 `npm run typecheck` exit 0，日志 `/tmp/zhuwei-diagnostics-final-types.log`；目标文档链接及 `git diff --check` 通过。以上为当前源码记录，不累加重复运行作为新增覆盖。

增量只读复核未发现权限扩张或剩余相反指令。未做真实模型前后对照或新增模型调用，不声称成功率提高；未进行全量回归、部署、push 或其他远端修改。开放创作与 NPC 可撒谎的产品边界保持，任意文本矛盾判断和继承 V05 未完成部分仍不由本次诊断验证证明。

## 交接后直接消费者复核

本轮按用户明确要求收束诊断任务，不继续交接摘要中的完整 Goal 或 V05 开发。诊断源码保持 v14；上节 Node 121/121 的证据已核对原日志，不重复运行或累加。由于继承的 Rules 公共运行时在该验证之后发生修改，追加一次同一 Room 九项命令与 `npm run typecheck`，分别 **9/9、20 跳过、exit 0** 和 **exit 0**，日志为 `/tmp/zhuwei-diagnostics-handoff-room.log`、`/tmp/zhuwei-diagnostics-handoff-types.log`。真实本地 Room 的修订、拒绝、恢复及原子提交继续通过，Provider 仍使用确定性替身。目标链接与最终 `git diff --check` 通过。

本次仅补齐验证记录及当前任务范围，保留全部继承源码修改；没有新增模型调用或远端操作。冻结选项尚未完成的执行/接线与其独立审查项属于后续工作，不由本次诊断回执声明完成。

## v15 直接消费者与澄清分支复核

本轮继续用户明确的诊断/窄修订开发任务，不部署、不 push。交接后的 parser 已为 v15，strict schema 和 lowering 已接入一层完整 clarification continuation，故以上 v14 记录只证明当时源码；本节是当前直接消费者证据。保留其他未完成 vNext 修改，本次没有扩展其产品范围或追加模型调用。

继承的 v15 实现会在生成修订票据前检查全部 continuation 的 capability 和 ruling，并在嵌套 lowering 失败时为已有准确 path 加上 `terminal/choices/<index>/continuation`。本轮为这两项直接变化新增四个行为用例（两个测试文件），没有建立新的 validator 或放宽修订规则：

- observe/worldInteraction 两种检定拥有者分别放入完整澄清选项；第二选项同时包含文本空白、重复依据和条件后果缺少 inactive failure。KP 收到完整原稿、精确诊断及三项固定计划，一次 correction 后完整 bundle 精确等于原合法 bundle，第一选项保持不变。修改任一选项的 DC、失败后果或目标仍为 `REPAIR_OUT_OF_SCOPE`。
- 首轮 offer 和补取后的 submit 均覆盖未选择分支的未加载 capability/highRisk：原形、另一分支的可修空白、完整根语法损伤三种状态都在修订前拒绝，只有一次调用，错误指向实际 continuation。highRisk 是现有实现缺口，不是产品禁止。
- 任一选项缺 adjudication 或检定拥有者缺 failure 时，即使兄弟选项有可修格式，也不能补造裁决；原完整 validator 的 proof 拒绝整份修订。
- 未选择的 NPC 分支有两条不可用依据时，lowering 与私有 Room bridge 都保留两个准确路径、原分类、要求及本人候选。其他 NPC 正文和私有动机不进入诊断，状态保持不变。

准确命令与结果（均 exit 0，未把重复运行累计成新增覆盖）：

```sh
# 新增四项分支证据：4/4
node --import tsx --test --test-name-pattern='clarification' tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs

# 当前源码的九个直接消费者：125/125
node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-social-plan.test.mjs tests/table-server-outcome-v2.test.mjs

# 真实本地 Room：10/10，20 跳过；Provider 使用确定性替身
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics|freezes clarification through Provider'

npm run typecheck
```

日志分别为 `/tmp/zhuwei-diagnostics-v15-branches.log`、`/tmp/zhuwei-diagnostics-v15-node.log`、`/tmp/zhuwei-diagnostics-v15-room.log`、`/tmp/zhuwei-diagnostics-v15-types.log`。Room 继续覆盖原稿与正文绑定、修订响应保存后驱逐恢复、唯一随机/资源效果、重复提交，以及澄清选项执行/取消的现有直接消费者。最终文档链接与 `git diff --check` 通过；bridge 的过时 command 说明同步现状，只改注释，不改变已验证行为。

独立只读复核未发现 v15 新增修订绕过或诊断路径问题。未做真实模型前后对照，不能声称模型修复成功率提高；非 NFC 草稿、不完整嵌套 JSON、未知/越权引用、缺失机械裁决仍明确拒绝。任意自然语言事实冲突识别、摘要真实性、尚无可靠定位的深层 Rules 原因，以及继承 V05 的完整随机/native 恢复与并发 read-set 行为不由本次诊断矩阵证明。没有运行全量回归、build、部署、push、远端 migration 或数据退役。

## v16：依赖声明的诊断与固定修订

本次按用户明确的诊断开发范围承接已有工作，保留其他未提交修改，不继续高风险/Activity 或生产替换。起始核验分支仍为 `cloudflare`、HEAD 为 `258caee404e0814405eb497653ee9f00d647b773`。先验证继承状态：诊断五文件 56/56、本地 Room 九项 9/9、typecheck 均 exit 0（`/tmp/zhuwei-diagnostics-current-{node,room,types}.log`），再只补独立审查发现的同源缺口。

根因是 `proposal-validator` 的 `isConsumes/isProduces` 对非数组、错型成员、无效 handle、outcome 和重复依赖直接返回 false，上层只留下 `bundle:entry-common-invalid`。固定计划只认识字符串引用集合，导致不改变依赖成员的重复 `consumes` 也没有修订资格。

能力合同：任意已支持提案及冻结 clarification 分支共用原依赖字段校验；可准确获得的字段/成员原因带真实 path、expected、actual 与拒绝说明。只有完整 canonical 值相同的 `consumes` 记录可按服务端固定整数组值去重，保持首次顺序；计划还须通过原完整 validator 与依赖图。缺失成员、未知 prospective、额外字段和 producer 冲突不得靠去重补造或隐去。

- `proposal-validator.ts` 原谓词复用 `arrayField/checkedField/FieldValidationError`，未建立另一套接收条件；删除不再有消费者的旧 outcome 布尔谓词。
- `proposal-repair-plan.ts` 固定去重 existing/prospective 消费依赖；`proposal-correction.ts` 沿用计划重算、精确 path/value 比对及完整重验。修订数组清空、增员、改 ref/handle 或保留重复成员均拒绝。
- `proposal-schema.ts` 中 Proposal 与 correction 共用同一封闭引用 transport schema，`proposal-provider.ts` 允许复制固定引用数组；数组记录不直接取得领域或权限资格，最终仍须匹配固定计划。parser binding 为 v16；一次 correction、最多八处及既有调用预算不变。
- 直接消费者为 Provider/修订票据、Room invocation 请求绑定与恢复、lowering 的依赖计划和 Rules。existing 引用的存在及权限继续由原冻结上下文 lowering/Rules 检查；局部格式 proof 不声称已证明引用获授权，也不读取额外世界信息。

代表性矩阵覆盖 observe/worldInteraction 的 14 类依赖字段错误、两类检定与 authored item 的 existing/prospective 固定去重，以及相同内容位于未选择 clarification 分支的情况；完整修订结果等于原合法提案，原稿不变。拒绝矩阵覆盖重复 producer、恶形状重复、缺依赖、混合引用字段和未知 prospective。既有两类真实 Room 修订用例增加 `consumes` 重复，仍在同一次修订修完五处，提交与驱逐恢复后重复请求不增加调用或状态变化。

先红：新增 Node 两项 0/2、Room 两项 0/2，均 exit 1，日志 `/tmp/zhuwei-diagnostics-dependencies-red-{node,room}.log`；Node 返回汇总错误/无修订，Room 因同束依赖错误无法证明完整修复而拒绝。修复后两项 Node 2/2、exit 0，日志 `/tmp/zhuwei-diagnostics-dependencies-green-node.log`。

最终同一源码的三类定向证据（均 exit 0）：

```sh
# 93/93
node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/deepseek-strict-tool-provider.test.mjs

# 9/9，24 跳过；真实本地 Room，模型为确定性替身
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics'

npm run typecheck
```

日志 `/tmp/zhuwei-diagnostics-v16-{node,room,types}.log`。一名代理只读复核增量，无并行写入或代码集成；最终目标链接与 `git diff --check` 通过。未运行全量测试、Lint、build、真实模型调用、部署、push 或其他远端写入。

剩余缺口不变：未进行真实模型前后对照，也未真实验证新增 correction 引用数组的 Provider strict 解码表现，因此不声称模型修复成功率已提高。非 NFC、任意嵌套 JSON 截断、缺裁决及无法证明等价的机械修订继续拒绝；不能可靠定位的深层 Rules 错误只保留原原因，不虚构字段位置。NPC 来源主张可为假，开放留白创作无需旧内容引用；任意自然语言事实冲突及摘要语义不由本次格式测试证明。

## v16 交接验收与继承改动边界

本轮再次以用户明确的诊断开发请求为准，未继续交接摘要中的完整 Goal、额外执行成本或 Activity。只读复核真实 Provider/validator/correction/Room 传播与七类诊断、固定计划、私有候选、原稿绑定、调用预算；独立代理未发现新的必修问题。保留全部继承 dirty/untracked，诊断 parser 仍为 v16，不重复实现或累计重复覆盖。

已核对上节 `/tmp/zhuwei-diagnostics-v16-node.log` 的六文件 **93/93、exit 0**。因之后继承 Rules 公共运行时修改，移除 `rules/v2/actions.ts` 临时 `[DEBUG-atomic-cost]` 错误对象输出后，运行上节同一 Room 九项命令：**9/9、24 跳过、exit 0**，日志 `/tmp/zhuwei-diagnostics-v16-handoff-room.log`；当前 `npm run typecheck` **exit 0**，日志 `/tmp/zhuwei-diagnostics-v16-handoff-types.log`。修订、目标越界、原稿/请求绑定、一次随机、驱逐恢复与重复提交经本地 Room 验证，Provider 使用确定性替身。目标链接、最终 diff 与 `git diff --check` 通过。

继承的额外执行成本定向测试另有已知失败，原日志 `/tmp/zhuwei-atomic-execution-cost-cause.log` 为 0/1、exit 1：observe 检定结算报 `world interaction continuation does not exist`，随后返回 `invalidRulesInput`；候选 read-set 与冻结 check planHash 身份不一致是已定位的待修方向。本轮保留其源码及测试，未重跑或修复此独立能力，也未将类型通过或诊断 Room 通过当作它的验收。无真实模型调用、全量测试、build、部署、push 或远端写入。

## v17：同源深层诊断与修订准入拒绝原因

本次在继承 v16 的基础上补齐已经复现的直接缺口；没有重做 parser、票据或机械裁决。分支/HEAD 不变，保留全部继承修改，按用户当前请求不部署、不 push。两名代理分别核对校验原因和授权传播，其中一名只修改独立的 social conformance 段与其源形状测试；主代理接入原 validator 并统一验证。没有 Git 集成冲突、commit 或外部写入。

原问题与同源修改：

- 各提案种类已明确规定 `produces` 的数量、种类与 outcome binding，却仍以 `bundle:*invalid` 丢失原因。原校验现共用 `isProducerForEntry`，在实际失败点报告精确 path、expected、actual 和禁止自动改写声明的原因；不改变生产者资格或依赖图。覆盖 observe、worldInteraction、social、inventoryOperation，以及 ability/item/hazard/worldFact 定义和 Item 实例。
- 提案 kind、Item quantity、分支容器及感官证据数组的原布尔谓词携带字段诊断。不存在的字段与错误类型分开，数字字符串不转成数量，也不以默认值补造实际操作。
- `socialEvidenceConform / socialConsequenceConform / socialBranchConform / socialRetryChangeConform` 的原 Rules 谓词提供可选 `SocialShapeDiagnostic`。KP validator 只加原稿路径前缀并取得实际提交值，未写第二套 social schema。台词、动机、依据、承诺及重试字段得到准确深层位置；合法 NFC 文本空白、沉默、说谎和误传边界保持。
- 窄修订完整 proof 已发现不可修错误时，最终结果原来仍只返回挡在前面的空白错误。现在原 proof 可报告后续原因，Provider 仅在拒绝分支与原诊断合并；排除与临时修复路径相交的诊断，避免把去重后的索引或摘要占位当成原稿。它不授予新的允许路径、不创建修订票据、不增加校验轮数或模型调用。
- parser binding 更新到 v17；直接消费者为修订计划/Provider、原 Room 请求与票据绑定、lowering、Rules/project/replay 和公开 Table DTO。授权引用候选仍只取本人冻结 NPC snapshot，诊断保持私有。

本地重解析继承的 round31 对照原响应，原 `bundle:observe-invalid` 现准确为：`CONSTRAINT_CONFLICT`，path=`["proposals",0,"produces"]`，expected 数组长度 0，actual 长度 1，constraint=`proposal-producer-count`，repair 拒绝原因=`changing-producer-declarations-requires-a-decision`。原响应没有修改、提交或重采样；这只是旧失败的离线定位，不是模型对照成功证据。

修订范围仍是服务端可证明的格式变化：按原字段合同 trim、相同引用集合去重、唯一非活动 `null`/`[]` 补齐，以及既有展示摘要合同；一次最多八处，普通最多两阶段、schema 补取最多三阶段。目标、DC、实际数量与资源代价、生产者声明、NPC 动机/知识来源、成败后果和缺失裁决不得补造或改写。未知/越权引用、非完整嵌套 JSON、重复 JSON 成员和无法证明语义等价的机械修订继续明确拒绝。摘要属于展示合同，其自然语言准确性不由格式 proof 保证。

先红与增量证据：字段/producer 两项 0/2（`/tmp/zhuwei-diagnostics-v17-fields-red.log`）；Provider 已完成校验却丢失拒绝原因 0/1、exit 1（`/tmp/zhuwei-diagnostics-v17-admission-red.log`；此前测试漏传必需 persistence callback 已修正）；补修后三项 3/3、exit 0（`/tmp/zhuwei-diagnostics-v17-fields-green.log`）。social 源形状测试先红 1/2，修后 2/2，覆盖 19 类拒绝与 8 类合法输入。全部通过原 conformance，原稿不变。

最终产品源码的三类定向检查均 exit 0：

```sh
# 144/144；完整模型替身与本地 Rules 行为，不计为真实模型成功率
node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-social-shape.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-world-fact-memory.test.mjs tests/table-server-outcome-v2.test.mjs

# 9/9，24 跳过；真实本地 Room，Provider 使用确定性替身
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics'

npm run typecheck
```

日志 `/tmp/zhuwei-diagnostics-v17-{node,room,types}.log`。随后独立复核建议补原稿位置保护：仅新增一个行为用例、产品源码未变，`node --import tsx --test --test-name-pattern='refused repair reports original' tests/kp-vnext-diagnostic-repair-provider.test.mjs`，1/1、exit 0，日志 `/tmp/zhuwei-diagnostics-v17-proof-origin.log`。未知引用在临时去重后的索引与摘要占位均不出现在原稿诊断；无新票据和修订。未将重复执行累计为新覆盖。目标链接、最终 diff 与 `git diff --check` 通过。

没有真实模型前后对照，也没有新增模型调用，不能声称修复成功率已经提高。无法可靠定位的其他深层 Rules 拒绝仍只保留真实原原因，不编造路径；任意自然语言事实冲突与摘要真实性没有因此获得通用证明。KP 的新经历可以没有旧同文引用，NPC 的来源主张允许为假，现有 worldFact/social 回归保持通过。继承的 social 加额外执行成本仍有冻结来源计划待修问题（`social:frozen-source-plan-changed`），本次没有扩展该独立能力，也不以本次通过声明全 vNext、真实整桌游玩或生产替换完成。未运行全量测试/Lint/build、远端 migration、部署或 push。

## v18：未知类型与引用槽诊断

2026-09-06。本次承接以用户明确的诊断与窄修订开发任务为准；分支/HEAD 不变，全部继承修改保留。交接中额外启动的 producer wire 改造已由原作者精确撤回自身五个生产文件、十二个测试文件及其新增模块；原数组协议保留。该未完成尝试无 Git 合并、外部写入或冲突，废弃源码状态的测试不作为本次验收。

当前真实入口已核对为 `roomRuntimeConfiguration(ZHUWEI_VNEXT_LOCAL) → room/server → room/action → vnext/adapter → offer/submit parser → 原 validator → 同源 repair plan/correction → room-bridge/lowering → Rules.step`。现有 v17 当前树先验证 Node 145/145、Room 9/9、typecheck 通过；随后独立复核发现以下同源诊断遗漏并补修：

- 未知 `proposals[i].kind` 字符串原来落到 `bundle:world-interaction-invalid`，丢失实际字段。原 validator 现以受 `VNextProposalBundleEntry["kind"]` 穷尽约束的合法枚举调用既有 `enumField`，返回 `VALUE_INVALID`、原路径、允许枚举和实际值。
- authored 引用先被 `authoredReferenceSlots(...).some(!isTypedRef)` 汇总拒绝，后续字段校验无法定位。`authoredReferenceSlots` 现可回调原容器/key；validator 复用原 `refField/isTypedRef`，精确定位 materializeItem 标量及 inventoryOperation 嵌套数组成员。同文 prose 不被当成引用位置；原收集结果仍去重排序，graph 和 lowering 两个直接消费者保持原语义。
- Provider binding 更新至 v18。新增 Provider 矩阵验证两类未知提案、物化定义引用和库存目标引用，并分别放在可修空白错误之后：最终拒绝保留准确字段，原稿不变、仅一次调用、零修订票据。没有自动猜类型、trim 标识或替换引用，也未扩大原修订授权。

摘要消费者另作只读核对：摘要仍属于既有展示修订合同；机械效果依赖冻结的类型化字段。worldInteraction 的 Viewer Claim 使用闭合裁决和真实效果，inventory Claim 使用实际库存操作，均不把 KP 摘要直接当机械结果。该边界不能证明任意自然语言摘要真实，也不扩展为自由改写事实的许可。

先红证据：新增 validator 两项 0/2、exit 1；Provider 矩阵 0/1、exit 1，日志 `/tmp/zhuwei-diagnostics-v18-admission-red.log`，原结果只有无 path 的 `bundle:world-interaction-invalid`。修复后 validator 目标文件 19/19、Provider 矩阵 1/1、exit 0（`/tmp/zhuwei-diagnostics-v18-admission-green.log`）。

最终源码只运行三类定向检查，全部 exit 0：

```sh
# 148/148；包含新增三项及全部诊断直接消费者
node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-social-shape.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-world-fact-memory.test.mjs tests/table-server-outcome-v2.test.mjs

# 9/9，24 跳过；Provider 为确定性替身，经过真实本地 Room
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics'

npm run typecheck
```

日志为 `/tmp/zhuwei-diagnostics-v18-{node,room,types}.log`。Room 继续证明两类提案修复、越界拒绝、保存响应后驱逐恢复、唯一修订及骰子/资源幂等；Node 保留 NPC 谎言/误传、新经历与本人候选权限、公开 Table 白名单验证。最终目标链接及 `git diff --check` 通过；不累计不同源码或重复执行的覆盖数。

剩余缺口：无真实模型前后对照，本次新增 API 为零，不能声称模型修复成功率已经提高。其他没有可靠字段位置的深层 Rules 拒绝继续保留真实原原因；自然语言事实一致性与摘要真实性尚无通用证明。现有 strict schema 的 nonproducer 数组广告偏宽仍是后续 schema 表达改进项，本地同源 validator 已准确拒绝。继承执行成本/Activity 的未完成修改保留，未以本次证据声明它们或完整 vNext 通过。没有部署、push、远端 migration、Secrets 修改、数据退役或全量测试/build。

## v20：当前格式证据与同源深层类型诊断

2026-09-06。本轮继续用户明确的诊断/窄修订开发请求，未执行交接摘要中的完整 Goal、真实批次或生产替换。分支/HEAD 不变，继承未提交修改全部保留；结束时共 324 项 dirty/untracked。已完整阅读主 PRD，核对 SPEC 0016 §7.2、CONTEXT 与 ADR 0015；本次没有修改已批准规格。

继承 v19 已用同一 `proposal-producer-contract` 供 strict schema、填表指引和原 validator 消费：模型填写 `{kind:"none"}` 或一个封闭声明对象，领域仍为零/单成员数组，Rules、依赖图及 lowering 保持原合同。其三项工具 prompt 和编码后的测试消费者保留；历史真实模型 fixture 原件不改。当前先验证 Node 168/168、Room 10/10、typecheck 通过，日志 `/tmp/zhuwei-diagnostics-v19-{node,room,types}.log`，随后针对独立复核发现的直接缺口补修，不将该旧源码结果当最终验收。

本轮发现和修改：

- `inventoryOperation.operation=7`、`operation.entryRef=7` 和 `materializeItem.ownership.ownerRef=7` 原来只留下无 path 的 `bundle:inventory-operation-invalid` / `bundle:item-materialization-invalid`。现有 `matchesAuthoredSourceSchema` 增可选诊断 sink，布尔接受结果仍由原 matcher 决定；`isInventoryOperationSource` 转交，原 validator 的 `AuthoredSourceValidationError` 适配相对路径。现能保留准确 TYPE_MISMATCH、位置、expected/actual，覆盖根提案和 clarification continuation。没有第二套 schema 或字段接受条件。
- strict decoder 原来将全部数组 `produces` 在修订前拒绝。`prepareVNextProducerWire` 现与既有 codec 共用实际 proposal 槽遍历，仅为可逆的 `[] → {kind:"none"}`、`[完整声明] → 完整声明` 提出固定表示证据。首稿强制 locallyRejected，不因可解码就直接接受；原完整 validator 和原字段修复 plan 必须证明整束形状，才可发出一次 correction。缺 producer、错 kind/handle/outcome、多个成员和其他非法声明仍拒绝；`[{kind:"none"}]` 会在解码时丢失原成员，明确排除，不能借表示修订删除声明。
- `wireEvidence` 保存原始解析值及精确 replace 路径/值，Room 仍保存原始响应文本。仅有表示或完整根语法错误时，模型必须返回 `changes:[]` 明确确认；有字段计划时，在同一次调用完成既有固定字段修复并确认表示，不增加独立修订。表示变换与字段修改合计至多八处。不存在自由修改 producer、目标、DC、成本、成败后果或补造裁决的路径。
- 票据重新解析原 `wireEvidence`，核对解码草稿、hash、证据、诊断和允许路径；同时含 JSON 语法证据时也从原工具响应重新证明两份证据。Room 再对照持久首响应核验，不能将另一份自洽票据当原决策。修订后重新校验完整 bundle，再走原 lowering / Rules / Room。纯表示确认夹带字段修改时，Provider 明确返回每项 `REPAIR_OUT_OF_SCOPE` 路径和 `transport-confirmation-cannot-edit-frozen-decisions`，避免提前变成无位置的 envelope 汇总错误。
- 诊断坐标明确区分：字段诊断默认相对 `rejectedBundle`，producer 的领域数组路径确实指向该冻结草稿；原 JSON 和 wire 错误标记 `pathBase:arguments`，分别对应原文本或 `wireEvidence.originalValue`。提示同时说明两者，不将解码后数组的下标伪称为原始 wire 字符位置。实际 parser 位置仍保留 UTF-16 offset、line/column。

直接消费者为 Provider offer/submit、修订票据/提示、Room invocation transition、adapter、lowering/Rules 和 Table 私有诊断白名单；parser binding 更新至 v20。两名代理在互不重叠文件完成 matcher 与 producer helper/测试，其余集成由主代理完成，没有 Git 合并或文件冲突；末次代理回执因容量错误终止，实际源码和测试由主代理重新检查并统一验证。

代表性矩阵：observe / worldInteraction、Item/Hazard 定义及实例、根提案/未选择 clarification 分支、纯表示/表示加字段/表示加完整根 JSON 外壳，全部走同一机制。拒绝矩阵覆盖声明缺失/冲突、不可逆 sentinel、目标/DC/后果越界、证据原值或变换路径/值被篡改后重算 hash、八处允许与九处拒绝。既有 Room 两类修订用例现在同时修复五个字段并确认一个 wire 表示；检定在保存 correction 后驱逐恢复仍只掷骰一次，重复 submission 不新增调用、事件或资源变化。

深层类型矩阵已先红 0/1、修后 1/1，命令为 `node --import tsx --test --test-name-pattern='inventory and ownership type errors' tests/kp-vnext-authored-diagnostics.test.mjs`，退出码分别 1/0。producer 新测试的首次执行正逢父侧 import 已接入、helper 尚未导出，是加载失败，不把它记为行为先红。当前最终同一产品源码的三类验证全部 exit 0：

```sh
# 176/176；确定性 Provider、parser/validator/修订、Rules 和公开 Table 边界
node --import tsx --test tests/kp-vnext-diagnostic-repair-provider.test.mjs tests/kp-vnext-structured-diagnostics.test.mjs tests/kp-vnext-representation-repair.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-json-syntax-diagnostics.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-private-lowering-diagnostics.test.mjs tests/kp-vnext-social-shape.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-world-fact-memory.test.mjs tests/table-server-outcome-v2.test.mjs tests/kp-vnext-producer-wire.test.mjs tests/kp-vnext-authored-diagnostics.test.mjs tests/deepseek-strict-tool-provider.test.mjs

# 10/10，23 跳过；真实本地 Room，模型使用确定性替身
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors|rejects a correction changing|persists the one repair ticket|incomplete JSON|keeps a repaired check|retrieves Item and Ability schemas|rejects repeated retrieval and extra stages|preserves noncanonical response diagnostics|freezes clarification through Provider'

npm run typecheck
```

日志 `/tmp/zhuwei-diagnostics-v20-{node,room,types}.log`。文档目标链接、最终修改段落与 `git diff --check` 通过。未将历史版本、增量或重复检查累加为新增覆盖。

剩余缺口：未做真实模型前后对照或新 wire 的真实 strict 调用，本轮新增 API 为零，不能声称修复成功率已提高。没有可靠字段位置的其他深层 Rules 错误继续保留原原因；任意自然语言事实一致性、摘要真实性不由格式证明保证。新经历无需旧同文引用、NPC 可说谎或误传的回归保持通过，不能用 correction 事后编造动机来挽救草稿。继承成本/Activity、高风险、完整游玩和生产替换改动保留，当前证据不证明它们完成；后置 social 的共享 timeline 变化缺口仍在。没有部署、push、migration、Secrets 修改、新资源、数据退役、commit、stash/reset、全量测试/Lint 或 build。

## v21：真实表示确认误拒修复与稳定性结论

[round41](vnext-round41-validation.md)暴露第一个新的真实失败：模型按5项字段计划及1项wire表示证据返回全部固定值，provider仍把表示确认当作未授权字段。v21在同一parser内先验证完整原始JSON、exact keys、所有路径和原始总8处限制，再对重证票据中的wire path/value作严格确认。确认仅核对原始表示，不再写decoded draft；其他字段仍由原apply与完整validator决定。没有清洗非法响应、补填模型遗漏或追加调用。

直接更新为`proposal-provider`、`proposal-correction`、`proposal-schema`、`proposal-guidance`及`producer-wire`行为测试。Proposal与correction对象形状共用同一个producer contract，未增加规则事实源。诊断给出原样操作；原样none或单声明对象可以显式确认，空确认合同继续有效。`null`冒充none、错声明、重复wire/字段路径、额外key、改目标/DC/成本/后果和超预算仍拒绝。原稿、冻结上下文、持久票据和唯一correction保持。

定向验证：五个Node直接消费者89/89、exit0，覆盖跨家族/嵌套/混合修订、实际strict schema广告、最高风险越界与round41原始响应回归；执行回执为`/tmp/zhuwei-round41-wire-validation-receipt.json`，这是实际工具输出的转录摘要，没有冒称原始stdout日志。此前71项是重叠检查，不累计为160。主树Room5/5、28跳过、exit0（`/tmp/zhuwei-diagnostics-v21-room.log`）；`npm run typecheck` exit0（`/tmp/zhuwei-diagnostics-v21-types.log`）。独立审查未发现新增越界。

Room准确命令：`npx vitest run tests/kp-vnext-provider-room.test.ts -t 'repairs .* representation errors through the Room journal|keeps a repaired check frozen|rejects a correction changing|persists the one repair ticket|rejects a changed correction prompt'`。最后一个pattern未匹配额外用例，不据此声称测过新的prompt篡改场景；五项分别为两种修订、检定驱逐恢复、越界目标拒绝与原票据持久化恢复。

真实复验[round42](vnext-round42-validation.md)为1通过/1失败/1未尝试：环境互动修订及Room重复请求通过；观察漏terminal失败；检定未尝试。首稿/旁白为替身，真实模型只执行correction，不能代表完整游戏。源码清单308/308在批次前后相同。稳定性仍未达标，没有前后统计成功率结论；本次新增真实调用成本round41+42合计¥0.0151412。

摘要准确性另有明确边界：现有presentation-summary-only仅保证字符串/结构，无法确定性证明文字准确；一次离线canary进入私有审计事件，但未进入state、Claims、Viewer、下一轮KP或旁白材料。现役Claims从typed结果重建，因此没有把错误摘要当成新的机械/世界事实。此缺口不以新叙事限制或NPC真假限制处理。旁白v6超时、连续完整游戏及长期稳定性仍未通过；v7离线原型未采用。未部署、push或修改远端资源。


## v22：固定计划整体确认与真实恢复

round42证明即使诊断逐项给了固定值，模型仍可能漏抄terminal。v22沿同一validator生成并重证的repairPlan，把wire改为 `{"confirm":"server-plan","summaries":[...]}`：模型显式确认当前全部固定字段、完整JSON外壳和可逆producer表示，只填写`summaryPaths`中没有固定值的展示摘要。服务端执行自己的固定值，无需模型再次复制path/value/hash。旧changes-only响应、额外字段、漏摘要、重复/越界摘要、固定路径夹带值一律明确拒绝，不将旧失败响应转换成确认。

固定与自由值仍经过原apply及完整提案validator；八处预算包含字段修复和wire修复，不增加调用。不能填补缺失的目标、DC、资源代价或检定拥有者成败裁决，不能改变条件后果、引用对象或新增声明。JSON语法只在原完整唯一成员足以证明所有决策时修外壳，重复键、截断子提案和不完整裁决拒绝。位置、错误分类与授权候选仍来自原解析器、原validator和冻结Viewer上下文。

额外发现并修复等待期间的可变ticket漏洞：原反序列化对象可在await期间被外部调用者改动，定向红测把冻结DC12变成1。现在assertRepairTicket重证后立即深克隆冻结，已发请求和回来的确认共用不可变快照；测试保留DC12。Room保存原始首稿、票据、唯一修订正文，恢复核对schema/prompt/parser和协议、summaryPaths，不能换计划或趁恢复补裁决。

直接消费者：proposal-provider/schema/correction/guidance、现役Room invocation精确绑定、runtime-policy派生hash，以及strict handshake工具与直接mock。未另加状态权威或世界真假规则。展示摘要文字仍只做结构限制；现役Viewer Claims从typed结果生成，不把摘要变成机械或世界事实，不能据此声称自然语言摘要已获通用语义证明。NPC允许假话/误传、新经历允许没有旧同文引用的合同不变。

本地证据按源码阶段记录，不累加重叠测试：协议实现后七个Node直接消费者98/98、定向Room10/10（24跳过）；最终ticket隔离修复后协议组5/5（含1新增红→绿）。准确命令、SHA和逐次日志见`/tmp/zhuwei-plan-confirmation-v22-receipt.json`，没有伪称一次99项。地点/来源前态合并后四个直接Node组48/48、修订Room5/5及typecheck均exit0；最终新增地点嵌套诊断单独记录。

真实证据为[round44](vnext-round44-validation.md)：同三个固定错误样本一次确认、提交及驱逐恢复3/3，三次614/679/665ms，6,848输入/180输出、¥0.0099684。生成测试只把correction binding替换为真实DeepSeek；首稿/旁白仍为替身，不能称完整HTTP游戏或统计成功率提高。没有部署、push、远端资源或数据退役。


### 地点/通道接入后的诊断直接消费者

原location/passage新分支曾把几何、端点、方向和时长的细节重新汇总成materialization-invalid。现已在原Rules谓词的实际拒绝分支给出中性相对路径、code/expected/reason，KP只用既有适配器在原稿重定位，覆盖clarification continuation。固定字段使用现有checkedField；通道/几何机械字段没有进入允许修订范围。几何可选stateGraph/durability/environment的委托没有叶级诊断时只记录真实失败容器，不猜内部路径。

新空间诊断组8/8，包含location、passage及portal正常形状、类型/缺失/取值/冲突、原social消费者、首调用拒绝机械缺失和第二调用越界拒绝。最终组合Node47/48的唯一失败是旧schema测试仍期望汇总错误；更新两个visibilityFactId分支为精确约束和路径后该目标1/1通过，其余47项产品源码不变。Room6/6及typecheck exit0。[完整集成命令、失败与SHA回执](vnext-location-passage-integration.json)。这不是地点真实模型证据；API结果仍分别以round44修订纵切及round45旁白未采用为准。


## 2026-09-07 真实连续行动驱动的增量

round52 原 acquire.entryRef 误填 ItemDefinition，而实例已完整进入冻结上下文。根因分两层：填写面只有任意非空引用，未区别定义与物理实例；Rules 的引用拒绝经过 Room/Adapter 后只剩修订拒绝，旧 telemetry 又只认识字符串错误，最终显示 unrecognized/other。

- `proposal-context` 从原冻结可见实例派生填写范围；`authored-proposal-contract`、offer/expanded 两入口和 Room journal 共用同一 schema 生成器。候选不取实时世界或他人知识，不减少原上下文，完整动态工具进入现有预算、hash 与保存响应核验。
- 库存原 planner 对缺失/不可见实例返回相同的 REFERENCE_UNAVAILABLE 与精确 Rules 路径；不泄漏具体存在性。原子事务前缀、Room 首次/随机后错误传播与 Adapter 私有原因保存同步。没有增加另一次模型决策或目标替换。
- 遥测直接读取现有 schema 字段名和七种稳定code，只记录规范化字段路径/code；actual、expected、constraint、候选、自由文本及秘密全部不写日志。round53 真实日志已显示 arguments.proposals[] / JSON_SYNTAX。
- 单次修订范围不变。定义换成实例仍会改变操作目标身份，未证明等义则拒绝；嵌套 JSON 破损没有完整原裁决证明，也不自动补字改判。完整根外壳、确定性表示修订与原自由摘要路径仍按既有预算工作。

定向验证：原 typed-schema 及六个直接Node消费者93/93；随后Node56项55通过、1项遥测字段漏读DeepSeek `$def`失败，修复后该10项遥测组10/10（exit0），其余46项（包含新增隐私/Rules/Adapter用例）不受此字段目录修复影响。Room2/2（33跳过）覆盖直接/原子拒绝、驱逐复用、注入候选拒绝及两阶段补schema+修订恢复；最终类型检查exit0。round52原未改响应在最终源码离线 parse→lower→Rules 得到精确缺失实例诊断，0event且state/context/原响应全不变。真实批次结果和剩余复杂JSON缺口见round53；未部署、push或远端修改。
