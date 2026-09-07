# KP 填写接口与窄修订开发回执

2026-09-07，`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773`。保留所有既有未提交工作，无 commit、push、部署或远端 migration。

本文是 parser v25 阶段的历史回执，以下“待实现”仅描述当时状态。组件持久化及拆解的后续结果见[组件纵切回执](vnext-component-assembly-validation.md)；当前填写面与真实失败见[扁平选择回执](vnext-flat-selection-validation.md)及 [round68](vnext-round68-validation.md)。组件局部成功不等于复杂填表稳定性通过。

用户最新澄清：装备组装按原组件“能恢复/不能恢复”记录，指拆解后的可回收性，不是缩减错误诊断。记录组件引用、数量和可恢复性；可拆固定不应复制或消耗原物，已裁断/消耗的材料不能自动复原。此组件持久化纵切仍待实现，不能据本次codec或叙述文本认定已经支持。

提案错误仍保留稳定code、准确path、必要expected/actual/constraint及修复计划。仅同源校验器能够证明不改变原裁决的格式/固定表示/非裁决摘要错误可修订一次；缺目标、DC、成本或成败后果、歧义或越权引用、越界修改仍明确拒绝。嵌套JSON无法安全恢复时保留真实解析位置和原因，不猜字段或补裁决。

服务器已接管固定外壳、根依据并集、producer声明、静态模板hash和类型化依赖。KP只填decision；direct只填result，check一次填裁决和完整成败。填写schema从原领域schema转换，仍经同一Bundle validator、graph、lowering与Rules。保留原始arguments、冻结上下文、修订范围、原调用预算及完整重验。普通创作不要求逐句旧引用，NPC台词保留归属。

直接消费者已同步：schema/provider/correction/guidance/graph、producer与引用槽、Room保存恢复、诊断遥测、两个探针工具及对应测试；ADR0015和生产TODO更新。旧producer wire专用入口删除，无生产fallback。当前parser v25、repair ticket vnext-3。

定向证据：初次直接消费者231/266，35个旧wire/断言或缺name的手写fixture失败已定位并修复；对应组后续36/36、11/11、35/35，均exit0。根schema/修订组52/53后失败项1/1；JSON parser10/10；Room保存恢复/缺DC拒绝/单次随机/完整诊断6/6；类型检查exit0。v24字段类型与原始位置反例先失败，修后填写/确认/schema补取27/27、exit0。不是一次全量回归。原始日志保留于`/tmp/zhuwei-shallow-*.log`，精确执行与副本集成记录见唯一执行日志。

真实[round54](vnext-round54-validation.md)：前两步成功、火把10→9→10；第三步整份JSON不能恢复，offset2121、line1、column2122、object-delimiter-expected，0提交。7次调用；两次重复请求无新增调用或提交，2条事件replay精确。没有本批可恢复字段或真实修订成功证据，不能声称复杂输出已经稳定。真实源码冻结在v23；停批后v24仅修诊断位置来源及类型分类，未重新调用模型。

仍缺：持久组件关系的创建、保存、库存一致性与拆解；复杂提案连续真实成功证据。简单手动操作无需自动创建Item/Ability，但描述文本不能代替正式组件关系。
