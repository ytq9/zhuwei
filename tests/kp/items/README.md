# 物品测试

物品定义生成与实际取用分别验收。原库存操作集中测试的场景已拆入下表，共用 [inventory-operations.mjs](../../support/fixtures/inventory-operations.mjs)，原来的复合操作、权限和 replay 断言保留。

| 功能 | 测试入口 |
| --- | --- |
| 物品生成与完整依赖 | [authored-materialization](../adjudication/authored-materialization.test.mjs)、[item-materialization-causal](item-materialization-causal.test.mjs) |
| 拾取、放下与重新取得 | [acquire-release](acquire-release.test.mjs)：堆叠身份、距离、权限、失能与不可见诊断 |
| 装备、卸下 | [equipment](equipment.test.mjs)、[item-loadout-authority](item-loadout-authority.test.mjs) |
| 使用、成本与效果 | [use](use.test.mjs)、[item-use-costs](item-use-costs.test.mjs)：药水、范围效果、多目标随机、反应与消耗 |
| 转交与抢夺 | [transfer](transfer.test.mjs)：部分转移、合并、授权检定、双方条目与 Claims |
| 损坏、修复与毁坏 | [lifecycle](lifecycle.test.mjs)：同一实例的生命周期与 replay |
| 可见结果 | [projection](projection.test.mjs)、[item-projection-visibility](item-projection-visibility.test.mjs) |
| 组装与拆解 | [item-assemblies](item-assemblies.test.mjs) |

整体跨功能场景保留在各测试中；普通转交不能抵扣完整交易验收，受控生成不能抵扣真实模型质量。完整验收边界见 [KP-B03/B04、KP-E01–E12](../../../docs/agent/functional-acceptance.md)。
