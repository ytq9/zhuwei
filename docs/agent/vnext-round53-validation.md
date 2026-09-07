# round53 冻结实例引用与错误传播的真实对照

日期：2026-09-07；`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773` 加保留的未提交工作。没有部署、push、远端 migration 或数据退役。普通创作不要求逐句旧引用；本轮处理引用填写和错误传播，不增加自然语言审核调用。

## 真实最终结果

正常 Cookie 注册、开房、建卡、开团后，同一玩家按原计划连续行动；Proposal、旁白生成与审核均使用 DeepSeek v4 Flash。

| 行动 | 实际返回与可见结果 | 权威状态 |
| --- | --- | --- |
| 从背包取出一根火把放在身旁 | committed / published：“你从背包里取出一根火把，放在身旁。” | 库存10→9，地面新增1 |
| 拾回刚放下的火把 | committed / published：“你把刚才放在身旁的那根火把拾起来，收回背包。” | 库存9→10，地面实例合回原堆叠 |
| 用已有麻绳和餐具做可拆拉绳警铃，手动拉动测试 | schemaRequest成功；expanded Proposal 的嵌套JSON无效，PROPOSAL_FORM_INVALID / notCommitted | 0新event/receipt，不扣材料、不推进时间，不创建物品或自动触发能力 |

前两步分别重复原 submission：每次同Receipt、同Delivery、同机械状态，均0新模型调用。最终只有两个 InventoryOperationApplied / 两个 receipt，ItemSystem.entries与开场逐项精确相等，无新增定义。原 runtime.replay 完整 state 精确相等，0 randomness batch。

第三步按预设失败即停，没有改词重采、清洗原稿或添加调用。原响应finish_reason为tool_calls、输出1,695 tokens，没有耗尽4,000上限。现役parser对未经修改的原响应返回：

```json
{
  "code": "JSON_SYNTAX",
  "pathBase": "arguments",
  "path": ["proposals", 0],
  "constraint": "json:object-delimiter-expected",
  "location": {"offset": 3220, "line": 1, "column": 3221},
  "repair": {"allowed": false, "reason": "semantic-equivalence-unproven"}
}
```

offset为UTF-16零起位置；line/column一起来自实际parser。真实服务日志已记录安全的 `arguments.proposals[] / JSON_SYNTAX`，没有原值或候选内容。原稿包含“截段/未裁剪/已收回”等不一致表述，但因语法失败从未成为世界事实，不能算装配完成或通过语义审核。

## 修改与支持范围

round52 中实例已交给KP，模型仍把 `acquire.entryRef` 写成 ItemDefinition；Rules的泛化引用错误又在Room/Adapter/遥测中丢失具体信息。

- 从同一冻结上下文的 known ItemEntry 与 viewerEvidenceRefs 交集生成物品操作候选；定义引用不进入实例字段。保留同束 prospective 新实例，由原依赖图校验producer与consumes。
- offer、expanded 与Room保存/恢复核对共用同一schema生成器。完整动态schema仍计入原预算与请求hash，Room从保存的上下文重建，不信任调用者注入候选。
- 原库存Rules planner报告精确引用字段；不存在和不可见地面物品获得相同安全诊断。原子Rules路径、Room首次/随机后拒绝与Adapter私有诊断完整传播。
- 遥测只从现役schema字段名和七种通用code提取字段分类；不记录actual、expected、自由原因、候选或秘密。

已有一次窄修订范围不变：原稿、冻结上下文、确定性修复计划及最多八处修改受绑定，完整提案重新校验；允许确定等义的表示、集合去重、inactive分支和原摘要修复。拒绝换目标、DC、资源代价、成败后果、补造裁决、未知/越权引用以及无法证明原决策完整的嵌套JSON。没有第三次完整提案、重掷或重复结算。

## 定向验证与封存

- typed-schema及六个直接Node消费者：93/93，exit0（`/tmp/zhuwei-round52-typed-refs-node.log`）。
- 增量Node组56项：55通过、1项遥测字段目录未读取DeepSeek `$def`而失败；修复后对应遥测组10/10 exit0（`/tmp/zhuwei-round52-telemetry-fixed-node.log`），其余46项包含两类实例、隐藏/缺失一致、Rules不变/replay及Adapter越界拒绝（`/tmp/zhuwei-round52-final-node.log`）。保留首次失败，不伪造一次全绿运行。
- 真实本地Room定向2/2、33跳过，exit0：直接/原子拒绝、驱逐复用原响应、篡改schema候选拒绝、补schema两阶段及修订保存恢复（`/tmp/zhuwei-round52-typed-refs-room.log`）。模型为替身，不计为真实模型稳定性。
- 类型检查exit0（`/tmp/zhuwei-round52-final-types.log`）；最终diff检查另记执行日志。
- round52原失败响应在本轮最终源码离线 parse→lower→Rules 拒绝，保留精确实例诊断，0event；原state/context/response及旧批封存均不变（`/tmp/redacted/zhuwei-round52-rejection-replay/`）。
- 308文件源码冻结清单SHA256：`cbbff391ed6dec7050587e60d590063fe028616ae4ccbf3f2622b9fc4229080b`；本批起止逐文件一致。私有原始响应/冻结上下文保留于本地journal/capture。封存与原replay在 `/tmp/redacted/zhuwei-round53-closeout/`；[脱敏证据](vnext-round53-live-evidence.json)。

预设最多3新行动/15调用、870,000输入/122,880输出、¥3.8、15分钟；实际8调用，144,484输入（命中32,640/未命中111,844）、3,919输出。沿用30分钟前核验的官方同一空闲价表，计算¥0.1870335；没有核对账户账单。全部计开发验收费用。

本批提供普通放下—拾回和幂等链的真实成功证据，也保留复杂提案JSON失败。它不是统计成功率对照，未完成复杂装配、双人20+连续游玩、完整4–5小时成本实测或生产验证。任意自然语言创作无法获得绝对无矛盾证明是技术局限；本次未因此增加审核表或调用。下一项明确技术缺口是复杂提案的结构输出可靠性，不能把它说成新创作缺少旧引用。
