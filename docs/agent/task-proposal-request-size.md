# 任务：提案请求体积超出离线评测的承诺

写给接手的会话。这不是测试过时，是当前提案请求的体积超出了评测当初的承诺；用户于 2026-09-18 裁定保留这道红门作为成本信号，不改阈值。

## 现状

`tools/run-kp-v3-eval.mjs`（`tests/platform/evaluation/kp-v3-eval.test.mjs` 的门）的结构硬门原有四项红。2026-09-20 用户裁定走 `$def` 去重后两项转绿：

| 门 | 修前 | 现在 | 阈值 |
| --- | --- | --- | --- |
| schema-median-reduction | −73.3% | +17.1% ✗ | ≥ 60% |
| input-median-reduction | 37.4% | 66.8% ✓ | ≥ 50% |
| simple-input-p95-estimate | 17,430 token | 9,694 ✗ | ≤ 8,000 |
| overall-input-p95-estimate | 17,430 token | 9,694 ✓ | ≤ 16,000 |

G2 schema 中位 59,242 → 28,345 字节，input 中位 16,463 → 8,747 token。其余门（引用召回、表单合法性、路由覆盖、故障回退）一直通过。token 数是字节估算，不是供应商分词。运行方式：`npm run test:eval:offline`，约 40 秒。

**剩下两道门只剩路径 3 能解**，见下文；需要用户先裁定是否收窄 Form 提供范围。

## 请求由哪几段构成（2026-09-20 实测，取代原先的估计）

原先记的量级是「system 提示词约 28%、工具表单 schema 约 13%、冻结上下文约 58%」。**这三个数字与当前代码不符，照它压缩会压错段。** 实测如下。

评测 G2 arm 送的 `modelInput` 只有 `action`、`contextPack`、`formParameters` 三段（`tools/run-kp-v3-eval.mjs` 的 `evaluateRetrievalGroup`），不含 system 提示词：

| 段 | 中位 | 占 G2 估算 |
| --- | --- | --- |
| `formParameters`（工具表单 schema） | 59,242 字节 | 90% |
| `contextPack` + `action` | 6,610 字节（区间 6,388–14,056） | 10% |

检索这一段已经做到了：G0 送完整投影约 45,232 字节，G2 的 context pack 中位 6,610 字节，变量部分降了 85%。降下来的全部被 schema 吃掉——G0 的冻结基线 schema 是 34,177 字节，现在是 59,242。

把 `private-form-policy.ts` 真正发的 system 提示词算进去，生产的一次简单提案请求是：

| 段 | 字节 | 占比 |
| --- | --- | --- |
| 工具表单 schema | 59,242 | 61% |
| `SOCIAL_PRIVATE_FORM_SYSTEM` | 31,841 | 33% |
| context pack + action | 6,610 | 7% |

合计约 97,693 字节 ≈ 24,423 token。评测报的 17,430 没算 system 提示词，也就是说真实请求比门看到的还大。

## schema 的 90% 集中在两个 Form

`buildKpFormToolParameters` 逐个 Form 的字节（全部十个合计 65,161）：

| Form | 字节 | 120 个 gold 用例里被提供的次数 |
| --- | --- | --- |
| compound.v1 | 46,242 | 120 |
| environmental-stunt.v1 | 8,148 | 120 |
| 其余八个 | 合计 10,771 | 8–120 |

每次提案提供 5–6 个 Form，这两个都在里面，所以中位 59,242 字节里有 54,390（92%）是它们俩。

compound.v1 里 `composition` 占 43,284 字节，其中 `before`、`onSuccess`、`onFailure` 三个数组的 `items` 是**逐字节相同**的 14,240 字节 operation schema，序列化了三遍，合计 42,720 字节——**占一次提案请求的 65%**。三份重复来自 `compound-composition.ts` 的 `compoundCompositionModelSchema`：同一个 `operation` 对象赋给三个数组的 `items`，JSON 序列化时展开三次。

这两个 Form 一直在 allowlist 里是有意的，不是疏漏：`form-catalog.ts` 的 `selectAllowedKpForms` 末尾无条件 `selected.push("compound.v1")`，排序阶段还特意把它排除在外；`environmental-stunt.v1` 由 `mayUseEnvironment` 加入，注释写明「V3 arbitrary prose must always retain the environmental form」。

## 已落地：$def 去重（路径 1，用户 2026-09-20 裁定）

`private-form-policy.ts` 新增 `kpFormToolParametersForRequest(formId)`：把目录 schema 交给 `compactDeepSeekToolSchema` 做一次同构节点共享，结果按 Form 记忆化。请求携带它，目录构造器 `buildKpFormToolParameters` 原样不动——它是注册目录 hash 的来源，那个 hash 进了持久化事件，不该因为线上编码变短而移动（`formCatalogRegistrationMatchesCanonicalDocument()` 仍为 true）。

`deepseek-strict-schema-compaction.ts` 把共享算法抽成 `shareIdenticalSchemaNodes`，两个入口共用：`compactDeepSeekStrictToolSchema` 保留进出两次 strict 方言断言，新的 `compactDeepSeekToolSchema` 不断言方言。strict 路径的输出对十个 Form schema 逐字节等于改动前，所以 `strictToolValidation` 的 `schemaHash` 绑定没动，不需要重跑握手。

逐 Form 字节：

| Form | 目录 | 请求 | 省下 |
| --- | --- | --- | --- |
| compound.v1 | 46,165 | 17,246 | 28,919 |
| environmental-stunt.v1 | 8,060 | 6,703 | 1,357 |
| 其余八个 | 10,113 | 8,748 | 1,365 |
| 合计 | 64,338 | 32,697 | 31,641（49.2%） |

评测的 `formToolDefinitions` 改为调用同一个生产函数，所以它量的是请求本身而不是请求更紧凑地编码的那份目录；`productionPureInterfacesInvoked` 与对应断言同步加了这个接缝。

验收：`tests/kp/provider/deepseek-strict-schema-compaction.test.mjs` 三条新用例——十个 Form 的请求 schema 逐个展开回目录 schema、compound.v1 的三个阶段数组共用一个 `$ref`、普通入口保留 strict 方言禁止的关键字而 strict 入口仍拒绝它们。

## 剩下的路径，需要用户先裁定

剩下两道门要绿，简单用例的整个请求得压到 32,000 字节以内（simple-input-p95 ≤ 8,000 token），其中 schema 还得 ≤ 13,671 字节（schema-median-reduction ≥ 60%）。去重后 schema 中位是 28,345 字节，仍是两倍有余：

1. ~~用 `$def` 去重 operation schema。~~ 已落地，见上节。**尚未用真实批次验证**：普通方言下 schema 不被供应商强制执行，是模型读的提示材料，把三份展开换成 `$ref` 改变了模型读到的东西；`first-legal` 系列是 gold-draft 结构测量，不是真实模型准确率，本地绿证明不了模型读 `$ref` 后还能正确填表。下一次真实批次要专门看首轮表单合法率有没有退。
2. **给 strict 方言补上已有的压缩。** `private-form-policy.ts` 的 `narrowProposalTool` 是四个 strict 请求构造器里唯一没跑 `compactDeepSeekStrictToolSchema` 的，compound.v1 的窄修订请求因此多送 14,250 字节。
   代价：strict 模式的准入要求 `strictToolValidation` 证据绑定到 `schemaHash`（`model-registry.ts` 的 `strictToolEvidenceIsBound`），改了 schema 字节证据就失配，profile 直接拒绝 strict。需要重跑 `tools/run-deepseek-strict-tool-handshake.mjs` 取新证据，也是真实调用。
   这条不动四道门：初次提案永远是普通方言（`kpCallStructuredOutputMode` 只在 `allowedFormCount === 1` 时用 strict，而 allowlist 恒为 5–6 个）。
3. **不再对每次意图都提供 compound.v1 与 environmental-stunt.v1。** 只有这条能让 schema-median-reduction 与 simple-input-p95 转绿：去掉这两个后全表 10,771 字节，低于 13,671 的要求。
   代价：这是产品路由规则，不是编码。SPEC 0015 §6.1 冻结了选择协议——「未在本次 allowlist 中的工具属于选择协议错误」，且不得借修订让模型重新选 Form。真正复合的意图若没拿到 compound.v1，只能落到错误的 Form，而 `complex-simple-misroutes` 必须保持 0。改它要走规格工作流的确认流程。

## 不该做什么

- 不改阈值让门变绿。
- 不在这项任务里放宽 `PROPOSAL_INPUT_BUDGET_EXCEEDED` 的 58k 上限。
- 不按「冻结上下文占 58%」去压检索结果：它现在占 7%，压它换不到门。
