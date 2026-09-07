# vNext：缩减创作审核，保留明确边界与错误恢复

2026-09-07，开发期；不部署、不push。依据用户最新决定及SPEC0001 §§3、7、9、12、17、19和SPEC0016 §8：新创作检查具体冲突，不能要求已有引用证明新内容；模型语义无法绝对证明正确，这不是无限追加审核或阻止交付的理由。

## 现有问题与实现

真实入口为Room冻结/提交→Rules.project的FrozenRenderableClaims→authoritative.narrateFrozen→正文生成/审核→Room发布。round49普通放置动作已提交，但逐assertion×fact证据表漏填同一事件的重复结果，旁白被拒。

现已删除逐片段、逐标量证据目录、覆盖矩阵与旧decoder。完整授权事实和表达上下文直接交给现有一次独立审核；固定检查结果、连续性、归属/知识权限、玩家自主权和表达。通过无需逐句证明。仅已提交机械结果每组有一次完整性选择；普通新经历、环境创作、NPC台词不填机械结果表。未按名字或同文去重，也未改变Rules事实语义。

问题报告按需提供code、原文、出现次数、实际计算的位置、具体constraintRef与reason；只能引用冻结Viewer材料或固定边界。明确冲突要引用具体相悖事实，不能用“无旧引用”代替原因。结果遗漏允许空原文，但必须指向必述结果。具体错误与汇总栏矛盾时仍拒绝，保留错误及报告冲突；不会把非法报告转成发布许可。完整诊断透过Adapter异常传播，非枚举私有字段不进入公开错误/receipt/telemetry。Narration取得独立请求快照，冻结材料、原稿和正文绑定、最多生成/审核各一次、原共享期限与恢复不重结算均保留。

创作持久化仍走materializeObject/worldFact、commitNarrativeDetail及SourceClaim原链。NPC谎言/误记/传闻保留来源、时间和私有依据，不当世界真相。明确结构、版本、权限、机械冲突由原校验器拒绝；任意自然语言一致性仍依赖KP理解。没有新增提交前审核调用、第二套Rules、重骰或隐式重试。

## 真实模型结果

同一默认deepseek-v4-flash，固定候选、首个异常停止，每批最多14调用；没有重写原响应或挑成功。当前只证明定向行为，不提供自然错误分布、误报率或稳定性统计。

- round50：前9项符合预期，包括round49原正文、无旧内容引用的新经历、客观童年冲突、NPC有归属谎话与冒充真相、环境补白/冲突、完整机械结果/改数值。第10项漏掉药剂消耗却被接受，停批；其余4项未调用。
- round51：仅对同一“漏药剂消耗”正文做一次有界对照，模型明确指出遗漏，但同时把总检查写pass、分组写changed，报告自相矛盾，原gate以格式错误拒绝。修复错误传播后，在**完全相同请求、未经改动的原响应**上离线重放，仍拒绝并保留RESULT_OMITTED及两个报告冲突；0新增API。不能把它记成完整格式通过或14例通过。

round50实际10调用、20,415输入/1,978输出、¥0.0291299；round51实际1调用、2,314输入/245输出、¥0.0045735。全部开发费用，按round49本轮重读官方空闲价计算，非账单核对。见[round50原始判断](vnext-round50-live-evidence.json)、[round51原始判断及最终离线拒绝](vnext-round51-live-evidence.json)。

## 创作入口的直接回归

直接消费者测试发现真正的WorldFact→NPC发言回归：compiler合法地把同束新建定义加入消费者readSet，而prefix验证要求该定义在事务开始前已存在。原5个成功/骰点/重放用例因此被拒，非fixture过期。

world-interaction-prefix与accepted-cost验证共用精确初始读集选择：只有明确消费的前序always WorldFact生产者可作为事务内依赖，核验原定义/hash、实际完整创建事件、同root/branch和先后范围；其余缺失、过期或未知引用保持拒绝。原事件payload builder提取为同一函数供执行和重放验证使用，不复制另一套机械规则。回溯domain snapshot的version不回退，采用原显式起止eventSeq。

## 定向证据及直接消费者

- `npx tsx --test tests/kp-vnext-narration.test.mjs tests/kp-vnext-knowledge-review.test.mjs`：最终37/37，exit0，/tmp/zhuwei-exception-delivery-final-node.log。包括授权材料、body/receipt冻结、实际Adapter两调用、诊断完整传播、秘密不进入公开错误及最高风险拒绝。这些model doubles不证明语义模型准确。
- `npx tsx --test tests/kp-vnext-world-fact-memory.test.mjs`：修复后11/11，exit0，/tmp/zhuwei-world-fact-prefix-fixed-node.log。新经历和听到传闻走同一parser/lower/Rules/project/replay，保留骰前历史与最高风险重签拒绝。
- 原消费组中环境承诺8/8通过（/tmp/zhuwei-exception-final-node.log）；该次组合总38/44，失败是一个本轮测试试图修改已冻结对象的夹具错误及上述5个真实入口回归，均已分别修复验证，未称该次全绿。
- `npx tsx --test --test-name-pattern='social accepted costs|direct frozen choice pays social|social without new history|social settlement rejects omitted|social after direct acquisition' tests/kp-vnext-atomic-input.test.mjs`：5/5，exit0，/tmp/zhuwei-world-fact-prefix-costs-node.log。
- `npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'normal Room materializes a new NPC history|recovers an Item narration after eviction'`：2/2、33跳过，exit0，/tmp/zhuwei-exception-review-room.log。真实Room接口、驱逐、重复请求和相同冻结上下文；KP为测试替身。
- 新增最高风险反例仅改生产者contextHash、保持definition不变并重签事件：前序事件可接受，social settlement拒绝，目标1/1、exit0，/tmp/zhuwei-world-fact-prefix-adversarial-node.log。命令 `npx tsx --test --test-name-pattern='same definition under a different producer' tests/kp-vnext-world-fact-memory.test.mjs`。
- `npm run typecheck`：exit0，/tmp/zhuwei-exception-prefix-final-types.log。未运行全套、build、Lint、部署、push或远端迁移。
- 两个只读审查分别核对创作/来源链及review异常传播，已修复诊断丢失；源码不新增NPC/物品名称分支。

## 剩余范围

随后已回到正常真实HTTP链：[round52](vnext-round52-validation.md)第一行动完成发布，第二行动在Proposal引用失败；[round53](vnext-round53-validation.md)前两行动发布，第三在Proposal嵌套JSON失败、未进入旁白。round50/51仍不是完整游戏、首稿创作能力或稳定性样本。提交前语义自检对任意矛盾的识别无确定性保证；Viewer审核也不能可靠识别它没收到的秘密。用前置授权、原权威保存、真实游玩与可审计更正管理风险，不因此继续无限加表或加调用。下一验收对象是连续真实Room行动中的错误频率、严重程度和恢复，而非逐句证明。
