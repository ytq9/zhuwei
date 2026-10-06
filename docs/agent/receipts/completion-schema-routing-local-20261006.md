# 补全表单按需加载：本地验收

日期：2026-10-06。分支 `cloudflare`，基线 `0bb07fe6`。用户要求精简补全表单并优化调用。技术决定见 [ADR 0129](../../adr/0129-completion-schemas-follow-selected-mechanics.md)；[SPEC 0016 §7.2](../../specs/0016-part-c-compound-actions-and-claims.md) 的产品规则与调用额度未改变。

## 实现与行为证据

首轮在原选择调用里选补全片段，填写只带所选种类。内部仍使用 `completeObject` 和原 Rules 编排；多个片段共用一个有序 `steps.completeObject`，避免重复公共字段，也不重排同一对象的准备步骤。物品内容与 NPC 战斗数据继续与创作／开战表单共享 schema。

- [表单协议测试](../../../tests/kp/protocol/proposal-schema.test.mjs)覆盖五种单选、混合选择、无关机械结构不发送、未选种类不得提交，以及修订保留原消息前缀和表单。
- [选择与恢复测试](../../../tests/kp/protocol/selection-amendment.test.mjs)验证补 NPC 后补选开战、保留原选择、恢复时不能偷换或扩张片段。
- [填写测试](../../../tests/kp/protocol/filling-interface.test.mjs)复现并修复了异常路径：其他步骤解码失败时，共用的 `completeObject` 键曾把已选 `completeItem` 误报为未加载。诊断改为核对行里的机械类型，真正未选的类型仍拒绝。红样例日志 `/tmp/zhuwei-completion-routing-malformed-red.log`。
- [容器 Room 测试](../../../tests/kp/items/contained-items.room.test.ts)对补灯并损坏的调用断言：恰好一次选择、一次填写；填写请求没有 NPC 战斗和地图破坏状态结构，仍能提交同一实物的状态，并经往返、重复提交、DO 驱逐与归档恢复保持连续性。
- [Provider Room 测试](../../../tests/kp/provider/provider.room.test.ts)验证保存选择、重载、保存填写、再次重载、修订和真实 Rules 执行。夹具原先写死只省略 `endCombat`，按本次已存在对象的实际可补种类更新其期望；调用数、冻结上下文、事件与恢复断言保留。

## 验证结果

- 补全及协议定向组 53 项通过：`/tmp/zhuwei-completion-routing-node-final-20261006.log`。
- 修订相关的三个协议文件 64 项通过：`/tmp/zhuwei-completion-routing-repair-final-20261006.log`。与前一组有重叠，不合计成 117 项。
- 容器和场景物件两条真实本地 Room 纵切通过：`/tmp/zhuwei-completion-routing-room-20261006.log`；模型回复为脚本。
- Provider 保存／恢复／修订的目标用例通过：`/tmp/zhuwei-completion-routing-provider-followup-20261006.log`。
- `npm run typecheck` 通过：`/tmp/zhuwei-completion-routing-typecheck-20261006.log`。
- 最后一轮 `npm run gates:check` 同一最终运行时代码下实际运行 Node 与 Worker：**107 个测试文件全部通过**。规格引用与文档链接错误均为 0，模块无新增违规，请求体积符合已记录基线。日志 `/tmp/zhuwei-completion-routing-gates-final-20261006.log`。工具显示的 3 个单独工具门未作为测试文件运行，没有调用真实模型工具门。
- 首轮整组门有一个 Provider 夹具失败，定位为上述旧的固定目录断言并修正。最终整组通过，没有登记新红门或放宽测试断言、模块 allowlist、预算上限。

## 固定请求体积

下表使用同一个本地保守估算器，含提示词与工具表单，**不含具体游戏上下文，也不是实际模型账单**。优化前从已提交的 `0bb07fe6` 源码临时快照测量；新选择在旧版本按等价的统一 `completeObject` 组合比较。

| 请求形态 | 优化前 token | 优化后 token | 变化 |
| --- | ---: | ---: | ---: |
| 描写／开关状态 | 13,252 | 8,237 | -5,015 |
| 实物定义 | 13,252 | 9,685 | -3,567 |
| NPC 战斗属性 | 13,252 | 10,174 | -3,078 |
| 地形 | 13,252 | 8,201 | -5,051 |
| 地图物件耐久 | 13,252 | 8,221 | -5,031 |
| 开关补全＋实际操作 | 19,839 | 14,820 | -5,019 |
| 物品补全＋库存操作 | 15,725 | 12,171 | -3,554 |
| 补物品＋新能力＋使用 | 20,053 | 16,653 | -3,400 |
| 补 NPC＋开战 | 14,126 | 11,046 | -3,080 |
| 补地形＋实际操作 | 19,839 | 14,784 | -5,055 |
| 补耐久＋实际操作 | 19,839 | 14,804 | -5,035 |
| 物品与 NPC 同时补全 | 13,252 | 11,950 | -1,302 |
| 所有类型都可选时的选择目录 | 10,684 | 10,869 | +185 |
| 所有填写类型同时加载 | 51,761 | 51,476 | -285 |

单类补全的填写固定输入下降约 23%–38%。全类型选择目录增加 185 token（约 1.7%），已单独纳入体积检查；其后常见“补全＋操作”填写减少约 3,080–5,055 token。其他原有单项填写各减少 3–5 token。修订复用精简表单，不重新加载其他种类；调用次数、修订额度、输入上限和输出上限保持不变。

测量文件：`/tmp/zhuwei-completion-routing-before-20261006.json`、`/tmp/zhuwei-completion-routing-after-20261006.json`。计数器新增代表性补全组合和选择目录，共 37 个请求形态；按 ADR 0057 告知用户后，只有 `requestSize` 组更新为测量值。

## 未覆盖与交付边界

没有真实 Provider 调用、线上延迟／缓存命中／账单测量、浏览器 QA、production build、push 或部署。真实模型选择细分类型的准确率仍需有界样本验证；本地绿色不替代它。未修改权威事件、物品持久化格式、Rules 补全行为或运行时 manifest；已有版本切换及未完成调用恢复政策继续适用。
