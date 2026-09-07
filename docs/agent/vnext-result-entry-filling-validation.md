# 结果填写列表：同源转换与真实验证

2026-09-07，parser v27。round56 的具体失败是模型把 observe 的 characterInferences 放入 worldInteraction，同时漏写 effects。既有诊断准确指出位置；删推断或补空效果均无法证明等义，因此未扩大修订权限。

本次改填写面：对具有多个并列结果集合的 Form（当前为 observe、worldInteraction），每个 result/success/failure 只填 outcomeCode、summary 和一个必填 entries 列表。各项保留原字段，并用 recordKind 指定其原集合；服务器生成各类空集合并按类型分组。只有一个集合的 social 保持原结构，不增加包装。

例如直接感知写成 `entries:[{recordKind:"sensoryEvidence", observerRef, subjectRef, sense, evidence, basisRefs}]`；实际机械效果采用该 Form 提供的 `recordKind:"effects"` 及原 effect 字段。明确 `entries:[]` 表示没有这些结果，省略 entries 则失败。推断的 sensoryEvidence/index 仍按同分支感知子序列编号，不按混合列表编号。

字段、可选 recordKind 与 payload schema 均从现有完整领域 schema 派生，不增第二套接受规则。解码后仍经同一 Bundle validator、引用图、lowering 与 Rules。目标、DC、成本、成败及各条结果保持；不从 summary 猜测机械效果，也不把世界互动内的额外推断自动迁移或删除。未知字段保留供完整校验；旧并列数组、混用 Form 类型、遗漏列表以及内部编码碰撞明确拒绝。

直接消费者更新：proposal-filling-interface、proposal-schema 的编解码入口、proposal-provider 指纹、模型 guidance、填写行为与诊断遥测用例。原始 arguments、冻结上下文、同源修订计划、一次确认和完整重验保持；没有增加调用预算。

验证：

- 填写、完整 schema、schema 补取、组件四文件组 63/63，退出 0，日志 `/tmp/zhuwei-result-list-targets.log`；覆盖同一 codec 的观察/互动/物品/危害及 clarification continuation。
- 随后增加内部字段碰撞拒绝并更新遥测直接消费者，最终填写与遥测 26/26，退出 0，日志 `/tmp/zhuwei-result-list-final.log`。保留完整分支结果、推断索引、缺字段/混型拒绝、修订越界、原稿和完整根语法恢复。
- 两个源码阶段的 `npm run typecheck` 均退出 0（`/tmp/zhuwei-result-list-types.log`、`/tmp/zhuwei-result-list-final-types.log`）；`git diff --check` 退出 0。不是全项目回归。
- [round57](vnext-round57-validation.md)用原四句完成正常真实 Room 链：第三步使用 entries 感知结果并成功组装，第四步按此前公开的 assemblyRef 拆解；完整库存恢复。本批还真实触发并成功恢复一次完整根尾语法错误，未改语义。

这是特定四步链及一个自然格式恢复的真实通过证据，不能据此声明统计稳定性已提高。内部截断、缺失裁决/效果列表、错误类型或不安全引用仍可明确失败；这些失败不伪装成游戏内失败。继续完整 Goal、更多连续行为与成本验证，不以追求自然语言绝对无矛盾阻止交付。
