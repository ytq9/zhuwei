# 容器查看记录与 review 修复：本地验收

日期：2026-10-07。分支 `cloudflare`，基线 `ca0dd00f`。用户批准普通背包直接取用、关闭容器显示上次查看清单并在重新打开时刷新；其余采用有来源才能物化原内容、损坏按实际后果裁定。产品规则在 [SPEC 0001 §16](../../specs/0001-llm-kp-responsibility-contract.md)，决定见 [ADR 0130](../../adr/0130-container-inspection-and-original-content-provenance.md)。

## 实现与直接影响

物品继续由原 `ItemEntry` 保存身份、定义、数量、持有人、容器位置、状态和资源。武器、护甲、工具、消耗品、普通道具与容器共用既有库存与补全入口，只读取适用的机械；本次没有建立按名称选择的物品专用路径，也不为普通道具添加无关 HP。缺项补全与已确定不存在保持区分，补全不重置已有计数器、损坏或识别知识。

新增 `container-knowledge.ts` 在事件折叠中记录按观察者与容器索引的紧凑查看记录；关闭期间不随他人取物或失败取用更新，重新打开才检查实际内容。打开期间本人取放更新查看记录。记录没有可执行活动，不复制定义；KP 的冻结材料仅包含行动者自己的相关记录，机械仍验证真实库存。现有背包面板独立标记“上次查看”，没有把历史条目变成取用按钮。

个人容器物化原内容须有与容器绑定的已固化来源，或未检查世界／NPC 战利品的取得记录；已检查或已确定的原内容封闭，后续增减使用实际实物转换。已有叙述承诺先固化再检查，不允许检查为空后再补出资源。起始装备包沿原初始化链展开。标准袋子的直接访问由新版本的初始化政策按固定定义引用控制，新创作的普通袋子使用结构化标签；没有修改旧标准装备目录或其校验和。明确封口是实际状态转换。

开箱与拿取的根因是分组表单没有表达执行先后，而服务器缺少容器访问依赖。`container-access.ts` 从冻结条目及同束产物推导源和目的容器祖先路径，生成打开／解锁、取放、关闭／上锁的依赖；Rules 独立核对路径与依赖。私有编译预览仅供后续步骤读取前序声明状态，不提交事件、资源或骰子。此前“开箱使读集过期”的推断已撤回，未据此增加读集例外。

其余三项 review 修复：完整地形只检查适用的缺项，depth 仅用于 ditch／water、current 仅用于 water；混合描写与原生补全时才发送原生行两个描写字段填 none 的说明；Provider 夹具使用固定的未提供能力列表，保留夹具中确实提供的 NPC 战斗补全。

损坏容器可同时保存实际开关后果，KP 裁定的操作可以作用于已损坏容器而不修复耐久。新增查看记录、来源和物品权威绑定进入逐记录更正审计，恢复原值与此前不存在的状态。追加探针复现了更正后仍留错误清单，以及新分支的下一次物化无法重放；已修复记录审计和新分支当前时钟绑定，保留独立时钟与恢复后的时间。旧版本事件不套用新解释。

新开发 runtime 为 `runtime-srd51-2014-authoritative-vnext-stage3-v8`，event schema 为 `room-world-events-vnext-stage3-v6`；提示词 `zhuwei.proposal-guidance/v103`，parser `kp-vnext2-proposal-parser-v84`。所有共享补全说明进入提示词政策 hash。沿原 DO JSON 状态、事件与归档保存，没有新增 SQL 表或 migration；没有部署或迁移旧开发房间。

## 代表性验证

| 变化维度 | 实际证据 |
| --- | --- |
| 原物多次读取 | 桶内三件实物部分拿取、转交、移动容器、毁坏后保留内容；同名容器不混合，陈旧读集和循环归属原子拒绝 |
| 单束顺序 | 关闭箱子打开、拿取、合上；反转开关填写行仍由服务器推导；打开并放回走相同路径；同束新建关闭箱子与原内容后打开拿取 |
| 历史清单 | 他人取走一件后本人仍保留旧数量；失败取用不刷新；本人重新打开更新原条目；他人查看记录不进入行动者上下文 |
| 来源与更正 | 个人包无依据物化拒绝；绑定唯一来源可物化一次；未检查战利品可首次确定原内容；已检查或已固化内容不可重复；更正恢复查看记录与唯一来源，后续操作和重放成立 |
| 补全与使用 | 实物补全不改其他实例或恢复已耗充能；同束创作能力、补原实物并扣费使用；完整地形不提供不适用补全；混合补全共享协议仍合法 |
| 本地 Room | 既有木桶路径及关闭箱子的打开、取物、合上，经脚本 Provider、真实本地 adapter／DO SQLite、观察、驱逐及归档恢复保持同一库存与清单 |
| 桌面消费 | Table 严格 DTO 保留历史记录并拒绝可执行字段；React 背包面板显示旧数量与历史标记，不提供历史物品操作按钮 |

最终定向组 6 个 Node 文件共 **66 项通过**，包括容器、原生补全、原有物品更正、表单协议、Table DTO 与背包面板。命令：

```sh
node --import tsx --test tests/kp/items/contained-items.test.mjs tests/kp/world/native-object-completion.test.mjs tests/kp/items/item-correction.test.mjs tests/kp/protocol/proposal-schema.test.mjs tests/product/inventory/inventory-projection-table.test.mjs tests/product/inventory/inventory-panel.test.mjs
```

日志 `/tmp/zhuwei-containers-targeted-final-20261007.log`。`npm run typecheck` 通过，日志 `/tmp/zhuwei-container-typecheck-final-20261007.log`。更正失败证据保留在 `/tmp/zhuwei-container-correction-red-20261007.log` 与 `/tmp/zhuwei-container-correction-source-20261007.log`；失败没有登记到基线。

最终 `npm run gates:check` 实际运行 Node 与 Worker：**108 个声明的测试文件全部通过**，规格错误与文档断链均为 0，模块没有新增违规，39 种请求体积与已记录基线一致。日志 `/tmp/zhuwei-container-gates-synchronized-20261007.log`。3 个单独工具门不在此命令运行，没有调用真实模型工具门。`npm run spec:check` 为 0 错误、11 条既有警告，日志 `/tmp/zhuwei-container-spec-check-frozen-20261007.log`。

整合中的前一轮门为 107 个文件通过，`send-action-recovery.test.mjs` 的首个终结失败用例未通过，日志 `/tmp/zhuwei-container-gates-frozen-20261007.log`；原文件定向 8 项通过。用例的按钮回调以 void 发起异步提交，原测试没有等待响应处理完成；已改为有界等待公开的行动处理中状态消失，保留全部错误说明、输入保留、新提交身份与按钮断言，产品代码不变。修后该文件 8 项通过，日志 `/tmp/zhuwei-container-send-action-synchronized-20261007.log`，再执行上述最终整组取得全绿；未把中间失败改判或登记进基线。

## 固定输入体积

使用原本地保守估算器，包含提示词与表单，**不含具体房间上下文，也不是实际 Provider 账单**。对比基线 `ca0dd00f`：

| 请求形态 | 原 token | 本轮 token | 变化 |
| --- | ---: | ---: | ---: |
| 描写／开关补全 | 8,237 | 8,237 | 0 |
| 实物定义补全 | 9,685 | 9,685 | 0 |
| NPC 战斗补全 | 10,174 | 10,174 | 0 |
| 地形补全 | 8,201 | 8,201 | 0 |
| 地图耐久补全 | 8,221 | 8,221 | 0 |
| 实物操作 | 10,077 | 10,276 | +199 |
| 物化实物 | 9,040 | 9,098 | +58 |
| 创作＋物化＋实物操作 | 13,648 | 13,905 | +257 |
| 补实物＋操作 | 12,171 | 12,370 | +199 |
| 补实物＋新能力＋操作 | 16,653 | 16,851 | +198 |
| 全类型选择目录 | 10,869 | 11,019 | +150 |
| 全填写类型组合 | 51,476 | 51,756 | +280 |

增加两种混合测量形态：描写＋物品补全 10,089，描写＋耐久补全 8,624；计数器共 39 种形态。单独创作物品按既有能力闭包带物化与操作，固定体积同为 13,905。没有新增调用阶段、修订额度、输入／输出上限。查看记录仅随相关容器读取紧凑摘要，不每轮灌入完整历史。

告知用户后执行 `node tools/gate.mjs --accept-request-size`，`.gate-baseline.json` 仅 `requestSize` 更新为测量值；测量 `/tmp/zhuwei-container-request-size-final-20261007.json`。没有扩大模块 allowlist、登记新违规或新红门。

## 未覆盖范围

没有真实模型调用、账单或缓存命中测量、浏览器 QA、production build、Git push、远端 migration 或部署。确定性样例与脚本 Provider 不证明真实模型会稳定选对对象与填写表单。没有新增图形对象面板、全世界物理模拟、旧房版本迁移或重新验证多路线长期沙盒剧情。
