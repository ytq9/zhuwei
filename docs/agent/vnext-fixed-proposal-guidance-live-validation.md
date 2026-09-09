# vNext 固定 Proposal 提示词真实测试：未通过

2026-09-09，用户要求“真实测试”。使用真实 `deepseek-v4-flash` 与现役 Proposal Adapter；两批各在首次明确失败时停止。**结果不能支持“整体填写可靠”或“问题已修复”。**

## 方法与预算

源码基线为 `cloudflare / bec5e28c44f3c815a341c2f1e425cfaaeb65acf9`，包含当时未提交修改。每批复制并记录 563 个源码、测试和配置文件的 SHA-256；结束时两份快照均无变化。第二批仅改变本次的两个提示词文件和一个测试夹具，其他生产源码与第一批相同。

模型经过正式 strict binding、类型选择、可补选填写、空稿重发、解析器、冻结 RequiredContext、lowering、Rules `step/project/replay`。测试 journal 保存请求和完成结果，并调用正式 `assertVNextInvocationTransition`。成功用例再读取保存响应，核对 Bundle 相同且物理调用增量为零。场景和状态由隔离 Rules 夹具初始化，模型输出没有被代填或改写。

全部调用采用当时生产默认组合：`thinking.type=disabled`、`max_tokens=4000`、beta strict endpoint、`strict=true`，未换模型或提高上限。原上限为 12 次；初批最多三个用例，修正后的复测最多两个用例、五次调用，每批十分钟内结束。未强迫模型补选。

这次没有经过正常 HTTP 登录、Room Durable Object 持久化或最终 Narration，不是完整正常房间游玩验收。测试的是正式 Proposal/Rules 链路使用真实模型时的填写结果。

## 逐例结果

| 批次与场景 | 真实调用 | 结构、规则与重放 | 内容检查与最终判定 |
| --- | ---: | --- | --- |
| A：原地观察阀门，区分感知与解释 | 2 | 通过；9 个事件；保存响应重读零新调用 | 内部 `ready`、`barrier` 和坐标被当作感官证据，进入 Viewer 可见事实及知识。不能计作语义验收通过 |
| A：向旁边值守员表明来意并请求查看 | 2 | 通过；8 个事件；保存响应重读零新调用 | 本例 NPC 回应、来源和实际社交操作相符；仅支持此普通对话样例 |
| A：拾起已有描写、尚无 ItemDefinition/ItemEntry 的小石子 | 3 | 首次 `{}`，一次正式重发后仍被解析器拒绝；未 lowering/提交 | `steps[0].kind=authorItem`，把选表 ID 当成实际步骤种类。批次停止 |
| B：同一小石子、同一冻结上下文，使用修正说明 | 2 | 被依赖校验拒绝；未 lowering/提交 | 仅提交 `materializeItem`，其 `definitionRef=prospective:stone` 没有生产者，且遗漏 `inventoryOperation.acquire`。批次停止 |
| B：观察复测 | 0 | 未运行 | 因先前物品失败而停止，感官说明修改尚无真实复测结论 |

小石子的固化描写为“阀门旁的地面上散落着一颗普通小石子，可徒手拿起。”实际选择工具两次都选中了 `authorItem/materializeItem/inventoryOperation`，服务器也提供了依赖闭包中的表单。因此 B 的缺步不是没有选到对应类型。

观察问题直接出现在 A 的 `observe-settled.json` 的 `projection.visibleFacts[1].value.evidence` 和 `projection.knowledge[1].content`，并非仅在私有推理里出现。原始 runner 的 `status=passed` 表示结构、规则、投影和重放检查通过；人工内容审查后的总判定以本报告和 `assessment.json` 为准，不覆盖原机器报告来制造通过。

## 根因与证据边界

1. **已确认的第一个违规位置是模型输出。** A 的实际 schema 要求 `decision/results/steps`，合法步骤枚举有 `materializeDefinition` 而没有 `authorItem`；供应商仍返回 `{}` 和错误枚举。strict 配置不等于该次输出实际符合 schema。服务端以 `PROPOSAL_FORM_INVALID` 对外拒绝，离线直接解析对应 `PROPOSAL_BUNDLE_INVALID / VALUE_INVALID`，禁止语义修订。
2. **固定说明存在易混淆的命名。** A 把 `authorItem` 等选表 ID 标成“已加载操作”，虽然同一段也写明正确的 `materializeDefinition/source.kind=item` 映射。这是具体的展示歧义；它独自导致模型失败仍是推断。B 明确区分两者后未再出现错误类型，但仍遗漏定义和拾取，故不能认定整体修复有效。
3. **B 的行动表达不完整。** 实际只提交实例创建，使用未声明的定义 handle，却在 `successOutcome` 声称已放入背包。正式图校验拒绝未绑定/类型不符的引用；离线结果是 `BUNDLE_DEPENDENCY_INVALID`，`repair.allowed=false`。没有自动补定义、换引用或执行库存变化。
4. **结构检查不证明文字的认知边界。** 感官文本出现内部枚举和裸坐标，已通过结构、引用和 Rules 检查并投影。因此此前的字段核对和定向测试不能代替真实输出内容检查。

这两批没有出现 `finish_reason=length`；所有九次均为 `tool_calls`。A 的三个物品输出分别为 57、25、561 tokens，B 为 57、287 tokens。B 的缺步不是耗尽 4,000 输出额度。由于当前采用关闭 thinking 的默认组合，不能将它与更早 8,000 推理额度的失败当成严格模型能力对照。

## 本次修改与连带检查

- `proposal-guidance.ts`：policy v12。把已加载列表明确标成选表 ID；填写标题从现有能力注册表生成实际 `proposalKind`，三类创作表单同时标明 `source.kind`。不更名领域种类、不把错误输出自动转换成合法步骤。
- `proposal-schema.ts`：observe/worldInteraction 共用的感官证据字段说明明确要求可感知的自然语言，不将内部字段、ID、状态/类别码或裸坐标当作亲见事实。
- `tests/kp-vnext-selection-amendment.test.mjs`：修正固定请求夹具的 `basisChoices`，从错误的数组改为当前 `{existingRefs, viewerRefs}` 对象。首次目标组的唯一失败为该夹具 `.filter` 访问错误；没有改业务代码容忍错误参数。

实际验证：

- `npx tsx --test tests/kp-vnext-prompt-contract.test.mjs tests/kp-vnext-selection-amendment.test.mjs tests/kp-vnext-unparsed-reemit.test.mjs`：19 通过、1 夹具失败，exit 1；修正夹具后仅复跑 `tests/kp-vnext-selection-amendment.test.mjs`，5/5、exit 0。共 20 个不同用例分次得到通过结果，非最终完整组重跑。
- 两份原始非法响应分别经对应冻结源码离线解析重放，均保持原拒绝和 `repair.allowed=false`，零外部调用。A 的首次诊断脚本误把公共错误码当作直接解析器错误码，修正断言后 exit 0；没有改原响应或校验器。
- 30 组实际工具请求构造与 v11/v12 展开 schema 对比：去掉 description 后约束完全相同，user 消息也相同，exit 0。该批固定 all-type 样本 system 从 19,770 到 20,073 UTF-8 字节，工具从 92,281 到 92,462，合计增加 484 字节；这是修正说明的开销，不是 tokens 或可靠性改善量。前次精简表使用更早的同期 schema，其原结果保留为历史测量。
- 两批 preflight 均 exit 0、零模型调用；两批 live runner 均 exit 1，明确保留失败。最终 `git diff --check` exit 0。

## 调用与证据

| 批次 | 物理调用 | 输入 tokens | 输出 tokens | 未知用量 |
| --- | ---: | ---: | ---: | ---: |
| A | 7 | 94,505 | 1,867 | 0 |
| B | 2 | 29,126 | 344 | 0 |
| 合计 | 9 | 123,631 | 2,211 | 0 |

所有请求、原始响应、用量、上下文、journal、失败详情、成功 Bundle 和 Rules 结果已保存；没有保存认证请求头。

- A：`/tmp/zhuwei-fixed-prompt-live-20260909-u6ir3uiu/`。guidance hash `sha256:640880454cb1ae80121a3377b280ef9b9f6aca5de30207512abac64ead41240e`，workflow hash `sha256:2c8d91151d1c137d3a41e30a1bf8a6240a1d8c3e6b14fd6e4cf9b9bff98d59a6`。
- B：`/tmp/zhuwei-fixed-prompt-followup-20260909-gfa_3pb5/`。guidance hash `sha256:60ec4d97c1d3f2935ce03f9b261d0a17752d396340c31c1bf801e41a1b8bee13`，workflow hash `sha256:dcb5a03fe69be5279d282d4671d7768770d0ec3174b60b64dffd942139c01115`。
- B 的 `evidence/assessment.json` 为合并判定，`surface-comparison.json` 为约束及尺寸对照，`workspace-changes.patch` 为相对于 A 快照的三个改动文件。

## 未覆盖与下一步

物品拾取仍未通过。优先检查如何减少“定义 → 实例 → 取得”在模型填写接口中的重复表达和未绑定引用机会，同时保持模型明确选择实际操作、服务端严格验证；继续加说明尚无可靠性证据。这一结构问题不能用自动补造缺失步骤或提高 token 上限宣称解决。

没有自然发生补选，不能声称真实补选通过；感官说明修改尚未真实复测。未覆盖所有 12 类表单、NPC 工作调用、完整 HTTP/DO 恢复、旁白、长期游玩或生产部署。没有执行全量测试、build、远端 migration、部署、commit 或 Git push。
