# 未解析输出的一次重发

2026-09-07。基线 `cloudflare` / `6dd1806` 加本次改动。开发期任务，未部署、未 push、零 API 调用。

## 起因与证据

round74 第一句的第 2 次调用返回了非法 JSON，整批停止（[回执](vnext-round74-validation.md)）。查证时发现这不是孤例：

扫描 `/tmp/zhuwei-round*/evidence` 全部历史 capture，**32 份不同的 tool-call arguments 里有 3 份结构非法**，三种不同形状：

| 批次 | 错误 | finish_reason | completion_tokens |
| --- | --- | --- | --- |
| round64 | `Unterminated string`（pos 1334） | `tool_calls` | 665 |
| round68 | `Illegal trailing comma before end of object`（pos 1208） | `tool_calls` | 631 |
| round74 | `Expecting ',' delimiter`（pos 56，字符串内裸引号） | `tool_calls` | 542 |

三次都是模型正常收尾、远未触及 4000 的 `max_tokens`，**没有一次被救回来**，三批全部以 `PROPOSAL_FORM_INVALID` 收场。约 9% 的草稿非法；因为首个技术失败即停批，批次层面的代价远大于 9%。

同时核实：请求确实发往 `https://api.deepseek.com/beta/chat/completions`，`tools[0].function.strict === true`，`tool_choice: "required"`，schema 通过本地方言校验（255 节点 / 上限 2048，深度 19 / 上限 32，0 issues）。**声明了 strict 仍拿到非法 JSON**，供应商侧的事我们改不了。

一个曾经的假设被证据否定，记在这里以免下次再走一遍：起初怀疑是 `[\s\S]+` 这类宽松 pattern 被编进解码文法、让裸引号漏出来。但 round68 的**尾逗号**是纯结构错误，与任何字符串 pattern 无关。所以不是 pattern 的问题。

另需澄清一处易混淆：`baeedb5 fix(kp): do not enable strict output` 撤销的是 **V3 生产 profile** 的 strict（该 Form 家族的条件规则在 strict 方言里无法表达），**不是 vNext 这条链**；vNext 一直带着 `strict: true`。

## 能力合同

**完全没有解析出草稿时，允许一次由 journal 证明的重发，服务器不提供任何内容。** 变化维度是「草稿是否存在」，不是错误文本长什么样：

- 字节根本不是 JSON → 无草稿、无票据、无修复计划 → 一次重发，模型重述**自己**的决定，服务器只说明字节在哪里不再是 JSON。
- 字节是合法 JSON 但被内容校验拒绝 → 有草稿 → 走既有修复票据，绝不重发。
- 字节是合法 JSON 但因**重复成员**被策略拒绝 → 服务器看得见草稿，是主动拒绝而非缺失，绝不重发（既有 `rejectsDuplicateJsonMembersAtEveryDepth` 契约不变）。
- 根边界可恢复（如尾逗号能还原出完整根对象）→ 既有 `syntaxEvidence` 修复路径继续拥有它。

这条线守住了 `89697c4` 的原则：服务器**不得改写原始文本冒充合法**。重发不改写任何字节、不保留任何内容、不授予任何删除或修改权限；重发回来的草稿与首稿一样从头完整校验。（`89697c4` 本身改的是 V3 的 `authoritative.ts`，不是这条链，但原则同样适用。）

## 修改

- `kp/vnext/proposal-provider.ts`
  - `vnextProposalUnparsedArguments(response)`：**只从响应本身**判定「无草稿」。要求正确工具名、字符串 arguments、`finish_reason` 存在且不是 `length`；`JSON.parse` 成功则不算（合法 JSON 的策略拒绝有草稿）；根边界可恢复则不算。Provider 与 Room 从同一份保存字节得到同一结论。
  - `vnextProposalReemitPrompt(evidence)`：两侧共同绑定的私有正文，只含指令、语法位置和原稿；不含决定内容。
  - 首轮结果新增 `reemitRequired`；新增 `invokeReemitKpProposalBundle`（同一 submit surface、同一冻结上下文，只换 user 正文），结果从头校验，`invocationCount: 2`、`repairUsed: false`。
  - `vnextProposalHasThirdCallBudget(capabilities)`：terminal-only 选择的两次调用已用尽，没有第三次；与既有 `vnextProposalHasExecutionRepairBudget` 的区别是它读选择而不是草稿，因为无草稿可读。
  - parser 合同 v39 → **v40**，新增 `unparsedOutputPolicy: journal-proved-single-reemit-of-the-same-question-no-server-content-v1`。
- `kp/vnext/adapter.ts`：生产路径接上重发分支；terminal-only 时以 `reemit:terminal-selection-call-budget-exhausted` 失败关闭。
- `room/vnext-proposal-invocation.ts`：ordinal 3 先由 Room 自己判定保存的第 2 次响应是否无草稿。是则要求**不带票据**、有第三次调用预算、工具面与 ordinal 2 相同、user 正文逐字等于重发提示词。证明来自 journal，不来自调用方声称。

### `finish_reason` 这条门为什么在

重发要花掉预算里真实的一次调用，所以需要正面证据说明它可能有用：`length` 意味着撞了上限，同一请求会再撞一次；没有 `finish_reason` 说明信封不是文档形状。两者都不值得花。观察到的三次真实失败全是 `tool_calls`，这条门对它们没有影响。

## 代表性矩阵

`tests/kp-vnext-unparsed-reemit.test.mjs`，5/5：

1. **两种真实形状**（round74 裸引号、round64 未终止字符串）都走同一条路：2 次调用、第二次工具面与第一次逐字相同、结果 `locallyAccepted`、`repairUsed=false`；并断言重发正文的键只有 `instruction`/`syntaxError`/`originalArguments`，且指令里不出现 `social`、`directSuccess`、NPC、场景、结果码等任何本应由模型决定的内容。
2. **不该重发的三类**：内容被拒的合法草稿、重复成员、根边界可恢复的尾逗号，一律不进重发。
3. **Room 证明**：从保存响应独立判定后接受正确请求；带票据被拒；正文换成普通上下文或被篡改的诊断都被拒。
4. **`finish_reason` 门**：`tool_calls`/`stop` 允许，`length` 与缺字段拒绝。
5. **预算**：terminal-only 选择无第三次调用。

## 定向验证

所有失败都与 `6dd1806` 基线（独立 worktree 检出）逐名 `comm` 对照。

```
npx tsx --test tests/kp-vnext-unparsed-reemit.test.mjs                          5/5   exit 0
npx tsx --test tests/kp-vnext-json-syntax-diagnostics.test.mjs \
   tests/kp-vnext-diagnostic-repair-provider.test.mjs \
   tests/kp-vnext-frozen-intent-repair.test.mjs \
   tests/kp-vnext-representation-repair.test.mjs                                34/53 失败集与基线逐名相同
npx tsx --test tests/kp-vnext-reference-slot-admission.test.mjs \
   tests/kp-vnext-observation-reference-surface.test.mjs \
   tests/kp-vnext-basis-reference-surface.test.mjs \
   tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-proposal-schema.test.mjs   失败集与基线逐名相同
npx vitest run tests/kp-vnext-provider-room.test.ts tests/kp-vnext-stage3-room.test.ts  75/79，provider-room 全绿，
                                                                                4 项 stage3 失败与基线同名
npm run typecheck                                                                     exit 0
git diff --check                                                                      exit 0
```

过程中确实引入过一次回归并已定位修正：最初的检测器把「重复成员」也当成无草稿，`kp-vnext-frozen-intent-repair.test.mjs` 的「never gain echo deletion authority」由 `rejected` 变成 `reemitRequired`。该测试是对的——重复成员是合法 JSON、服务器看得见草稿。加入 `JSON.parse` 与 `finish_reason` 两道判定后回到基线同集，没有修改那条测试来迁就实现。

## 未覆盖范围

- **零 API 调用。** 重发能否让真实模型交出合法 JSON 完全未验证。三次历史失败是三种不同形状、内容各异，读起来像随机而非确定性，因此重发有实际机会——但这是推断，不是证据。
- 重发只覆盖有第三次调用预算的选择。**terminal-only 选择（如 `abilityOperation`）仍然一次语法失败即停批**，round73 那类场景不受益。要覆盖必须改调用预算，属另一项决定。
- 供应商侧 strict 不保证 JSON 良构这一事实未做专门探针确认，只有 3/32 的观察证据。
- 重发不解决内容质量：模型仍可能重发出一个会被内容校验拒绝的草稿，那时按既有路径处理，不再有第三次机会。
