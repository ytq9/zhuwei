# vNext round9：Form 选择、填写指导与约束保留

- 日期：2026-09-06；`cloudflare`，基线 `258caee404e0814405eb497653ee9f00d647b773`，持续未提交开发树。
- 目标：继续优化模型输入，同时保留正确选择 Form、完整填写字段和理解约束的能力；不按动作词、物品名或样例结果进行路由。
- 结论：通用指导装配、字段约束和冻结恢复已通过定向检查。**在线输出可靠性、真实 schema 补取后的提交及旁白仍待验收，不能标为 V01/V11 完成。**

## 能力合同与代表性矩阵

KP 始终看到完整能力目录、世界权威边界与选择规则；详细填写指导随同一类型依赖闭包的完整 schema 加载。普通提案、补取后提案与窄修订使用各自指导；Room 验证并持久保存对应请求。缺少能力不得变成世界内拒绝或改变玩家方法，决定性上下文不截断，字段及合法分支不删除。

| 维度 | 验收证据 | 边界 |
| --- | --- | --- |
| 已加载普通能力 | 控制件交互通过真实本地 Room 接口；真实 DeepSeek 为库存放下选中 inventoryOperation，并填正确实例、数量及 release | HTTP 输出因重复 JSON 成员被拒，未提交 |
| 新物品的复合填写 | authorItem 闭包包含 Ability、实例、库存；受控模型同束定义、创建、取得、使用，库存余量 1 | 确定性 Room 纵切，不是真实模型主动补取证据 |
| 不同依赖结构 | authorHazard 闭包与更名实例、全部能力的 schema/指导配套检查 | 走同一目录与解析/领域路径，无名称分支 |
| 跨字段约束 | directSuccess 与 check 的单交互/双分支组合；area use 的空目标及非零方向；现有 authored materialization 组 | 合法/非法解析与 lowering；不冒称本批在线执行区域能力 |
| 冻结及恢复 | 两个已保存阶段后驱逐恢复，第三阶段窄修订；普通重试、503/429、重复/越权；篡改指导、额外消息及只变 schema 呈现顺序均拒绝 | 同一冻结工作流内恢复，不提供跨版本兼容 |

## 实现与直接消费者

- 新增 `kp/vnext/proposal-guidance.ts`：共同权威规则、共享裁决、八种能力的详细填写指导、阶段指导及模板目录构成一个版本化策略。模板只随 `materializeObject` 加载；共同规则继续包含叙述承诺连续性、精确引用、Viewer 边界和禁止模型决定最终机械结果。
- `proposal-schema.ts` 的三个 `create*ModelInput` 统一装配 `[system,user]`，因此正常 Adapter、直接 authored/行为探针和 handshake 都获得同一指导。Adapter 只执行完整请求预算与 journal，不再重复注入系统说明。handshake 的 prompt hash 同时绑定指导策略。
- 模型可见字段明确：区域使用 `targetRefs=[]`、方向非零、实际目标由 Rules 计算；直接成功各项 `always` 且交互 failure 为 none；共享 check 恰好一个 `worldInteraction` 且完整双分支；attack 引用角色拥有的冻结 Ability，abilityCheck 不带 Ability。未改机械判定。
- 修正 authored 公共 `produces` 描述的归属：只有库存操作禁止生产句柄；定义和实物创建保留各自类型句柄。物品唯一性与定义/实例区分随详细指导保留。
- `runtime-policy.ts` 冻结全部指导及未加载模板；另保存 schema 呈现 hash。`room/vnext-proposal-invocation.ts` 从已保存响应推导阶段，精确校验工具的序列化形状、系统指导与唯一 user 消息；journal 仍保存完整实际请求，无新增持久表或迁移。
- 真实异常后，将 authored 对象的 `kind` 通用地排在公共字段之前；不接受、清洗或覆盖模型输出中的重复 JSON 成员。该调整改善填写面的顺序，单次对照不足以证明它修复了 Provider 的重复字段问题。

## 定向检查

- Node：`npx tsx --test tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-authored-materialization.test.mjs tests/deepseek-strict-schema-compaction.test.mjs tests/kp-vnext-authored-context.test.mjs tests/kp-vnext-hazard-product-closure.test.mjs tests/deepseek-strict-tool-provider.test.mjs`，**68/68，exit 0**。
- Worker：`npx vitest run tests/kp-vnext-provider-room.test.ts`，**8/8，exit 0**。
- `npm run typecheck`，**exit 0**。日志分别为 `/tmp/zhuwei-round9-node.log`、`/tmp/zhuwei-round9-room.log`、`/tmp/zhuwei-round9-types.log`。
- 同一 round8 冻结上下文的 schema 展开后，除描述及呈现顺序外，字段、约束和全部分支结构相同；未裁剪事实。`git diff --check` 和本轮文档直接链接检查通过。
- Node 在公共装配下沉、追加重复成员拒绝后重跑；Worker/typecheck 在呈现绑定收口后重跑。以上是最终结果，不累加重叠次数。未运行全量测试、Lint 或 production build。

## 真实链路与成本

本批预设上限：2 个游戏动作、12 次调用、240k 输入、24k 输出。首个明确失败后停止游戏采样，仅追加一次同冻结材料、不提交 Room 的诊断。实际 **1 个游戏动作 + 1 次对照，共 2 调用，38,232 输入 / 1,126 输出 tokens**，无未知 usage；两个本地服务均已停止。

1. 正常 Cookie HTTP → 实时 DeepSeek → Room journal：模型正确表达放下一支弩矢，`kind=inventoryOperation`、`release`、数量 1、真实引用、`produces=[]` 和共同裁决均有填写；但在该提案中重复写了 `kind`，严格解析拒绝。输入 **19,116**、输出 **546**，约 **3.70 秒**。无 correction、Rules 提交或 Narration。
2. 唯一同快照/system 对照：只调整 authored schema 的字段呈现顺序，返回通过严格解析及已加载能力检查，输入 **19,116**、输出 **580**，约 **3.53 秒**。**没有 Room 提交或 Narration。** 其 risk 文本仍提到未经携带状态证明的“背囊”容纳关系，不能据此宣布所有模型文本无错。

完整 authority、虚构时间、Pending、Receipt 的前后 hash 相同；库存仍 20、HP 28/28、职业资源不变、Receipt 0。严格失败没有改变游戏事实。

| 同一 round8 上下文的离线请求对照 | 之前 | 当前 |
| --- | ---: | ---: |
| 含完整指导、工具和上下文的请求字节 | 67,441 | 65,923 |
| 工具字节 | 25,161 | 22,323 |
| system 字符串 UTF-8 字节 | 6,826 | 8,049 |

完整目录从工具移入 system，且补充了缺失指导，所以不能只拿工具下降量报告收益。**总请求仅下降 2.25% 字节，未测量同快照的实际 token 降幅。** 本批真实输入 19,116 的上下文与 round8 不同，不能与 round8 的 20,217 作因果成本对照。当前初始 schema 22,050 / 完整 schema 48,421 字节，新增字段说明造成体积小幅回升；完整约束优先。

结构 canonical hash 忽略对象成员顺序，所以这次对照的 canonical requestHash 相同，实际 wire SHA256 不同；证据单独记录二者。最终 workflow 在真实采样后补充呈现 hash 和 Room 精确顺序校验，最终 Provider 请求逐字等于成功对照；最终元数据没有另做真实调用。详情见 [脱敏证据](vnext-round9-live-evidence.json)。原始请求、响应、Cookie 只留于本机私有 `/tmp/zhuwei-vnext-round9-*` 文件，未入库。

## 未覆盖与下一步

- 不能用单次对照替代首次合法率/最终合法率。下一批先证明正常 HTTP 的合法 Proposal → 提交 → 可用旁白，再完成主动补取 schema 的复杂动作；需保留正确引用、库存/资源和完整文本检查。
- 8k/16k 输入采用门、真实连续环境交互、完整 NPC 表达和持久 RootAction 累计 token/费用/重试硬上限仍未完成。后续从相关性及完整事实表示降低成本，不通过省略约束或截断决定性闭包降成本。
- 没有 push、部署、远端 migration、旧数据删除或生产切换；生产仍为 V3。
