# 按类型分组的步骤：提案 wire 从三张平表改成 decision + steps 分组对象

2026-09-12，基线 `e50194c`。承接 round 104–118 的失败清单：十五轮里绝大多数错在 results 表（行缺 step/branch、kind 写成 none/result、给不带结果的步骤配行）和类型用错。三张平表让模型抄写三个可以由服务器推出来的字段：行属于哪一步、那一步是什么 kind、directSuccess 只有一个分支。这次把可推导的字段全部拿掉。

## 线上形状（最终 parser v66，fillingLayout v4）

```
{
  "decision": { kind + 裁决字段 }                              // 或 terminal
  "steps": {
    "<选表ID>": [ { …步骤字段, outcomeBinding, success?, failure? } ],
    …                                                          // 本轮已加载的每个类型一个键，都必填，没有就 []
  }
}
```

- 键是选表 ID（`authorItem`、`materializeItem`、`inventoryOperation`、`worldInteraction`、`observe`、`social`……），不是 proposalKind。materializeDefinition 的三个定义种类各是一个键，步骤里的 `source.kind` 必须与键一致。
- 步骤不写 `kind`；写了且与键一致的当作没写，不一致的拒绝（`filling:step-kind-must-match-group`）。
- observe / social / worldInteraction 步骤自带 `success` 与 `failure`：directSuccess 时 failure 填 `{kind:"none"}`；check 时只有共享检定的拥有者把 failure 填完整，其余步骤同样 `{kind:"none"}`。其他类型的步骤没有这两个字段。social 的四张小表和 `response` 对象都在 success/failure 里，不再摊平成 responseKind 等。
- terminal 决定时 steps 的每个键都是 `[]`。只选了 terminal 的表单没有 steps。
- clarification 的 continuation 是同样的 decision 字段加自己的 steps 对象。
- 每个类型的步骤形状是一个不在 anyOf 里的对象（一个键一个数组，数组项通常只有一种形状）。round 85/86 证明 DeepSeek 严格模式不校验 anyOf 分支内部的约束；现在 directTargetRefs 之类的枚举第一次处在严格模式能校验的位置。

## 执行顺序

拓扑排序的平局按数组顺序。原来数组顺序是模型写的顺序；现在解码顺序是固定的组顺序：定义（materializeStory、admitStoryFacts、authorAbility、authorHazard、authorItem）→ 人物、对象、实物（materializeNpc、materializeObject、materializeItem）→ 补全与旁白（completeObject、commitNarrativeDetail）→ 库存操作 → worldInteraction → observe → social → formActorPlan；同一组内保留模型写的顺序，消费句柄的步骤仍在生产者之后。跨类型且无依赖的步骤不再按模型的叙述顺序执行。Rules 的 acquire 只查场景，不查容器状态，所以"打开箱子再拿"这类顺序对结算无影响，只影响事实的先后。

## 实现

- `proposal-filling-interface.ts`：schema 生成 `$def.steps` 为分组对象；解码按组顺序展开、注入 kind、每步独立解码并汇总全部问题；编码按 capability 分组、去掉 kind、branches 摊回 success/failure；诊断路径 `proposals[i]` → `steps.<key>[j]`，j 由组内序号得出，有原始 arguments 时按 arguments 数，没有时按解码稿数，两者一致，所以 social 后果表的路径不再需要原始行序。导出 `proposalFillingSteps`、`VNEXT_FILLING_STEP_KEYS`。
- `proposal-producer-completion.ts` 从分组对象里读悬空句柄；`proposal-provider.ts` 未加载类型按键报 `proposal:capability-not-loaded@steps.<key>`，预算规则读分组；`proposal-revision.ts` 补丁根只有 `/decision`、`/steps`。
- `story-action-request.ts`：故事定义的表单从分组里取出那一种形状，再把 kind 常量加回去；故事载荷仍是带 kind 的单步数组。
- 指引 v27：三张表的段落改成分组对象和 success/failure 的写法；social、observe、inventoryOperation 的填写段同步。握手工具 v11。
- 域模型、校验器与 Rules 的机械校验保持。round 120 的已保存回复另暴露两个服务器错误：后续 Rules 修订丢失前票据加载的生产者类型，以及 authored lowering 的 sourceRefs 未跟读取集一起解析角色知识别名；两者在各自现有事实源修复。

## 本地证据

同范围基线是 `e50194c`，原 WIP 为 `aaedd46`，最终工作分支为用户授权的 `claude/local-preview-changes-8206cb`。原交接的“230 对 18”不能用作回归结论：18 来自两个文件的 57 个测试，另一侧却是 65 文件的 426 个测试。

| 检查 | 结果与边界 |
| --- | --- |
| 完整 Vitest 基线 | 426 项：207 通过、214 失败、5 跳过 |
| 原 WIP 同范围 Vitest | 426 项：199 通过、222 失败、5 跳过；新增 8 项均为测试助手的旧 wire 路径 |
| 修复后完整 Vitest（v65） | 428 项：209 通过、214 失败、5 跳过；按文件名和完整用例名比对，新增失败 0，旧失败集合相同 |
| 完整 Node gate（v65） | `node tools/gate.mjs --check --with-tests` exit 0；82 个失败用例名，对已登记 84，新增 0、修复 2；其余棘轮项无新增，规格错误 0，既有断链 1 |
| 最终 v66 增量 | 仅收紧终结表单误填空执行裁决的修订预算，并更新 parser 绑定；Room 5/5；Node 24 项中 20 通过、4 个已登记旧失败，无新增；typecheck exit 0 |

大面积 `PROPOSAL_FORM_INVALID` 主要来自基线已不能被现役 Room 接受的旧 `privateFormProposal` 助手，不是漏空组导致的新增生产回归。新增的 8 项分别是 promise lifecycle 的旧 results 索引、Provider 测试对 steps 数组 schema 的假设与机械诊断路径。mock 里的旧断言还会被外层包装成 `PROPOSAL_PROVIDER_TIMEOUT`。Node 的两个新增失败分别是共享检定 owner 按旧索引查找，以及把 wire 的 none 对象直接交给领域 validator；修复后该目标组 15/15。

round 120 的确定性证据：使用真实保存回复和同一份非空 Rules 诊断，最初类型集合建票抛 `VNEXT_PROPOSAL_REPAIR_TICKET_INVALID`，前票据已证明的 `authorItem` 集合则接受。Adapter 与 Room 的当前/历史重建均继承已证明前票据，不信任调用方自报加载类型。完整 Room 回归覆盖缺生产者、Rules 拒绝、保存后断连、驱逐恢复、重复提交和伪造 `authorHazard`；伪造拒绝，恢复零新调用、无部分效果。

同一原始回复的第二个失败是 `Every materialization source must retain its frozen read binding.`：原角色知识 ID 被读取集解析成 holder-qualified 引用，sourceRefs 却保留裸 ID。lowering 现在使用 `requiredContextReadBindings` 的相同映射，未改模型回复、未放松 Rules；原回复离线已走到 Rules committed。回归覆盖提交、事件重放、知识版本变化及缺少授权正文后的拒绝。

最终 v66 的追加边界用例先复现终结选择被错误给予第 3 次调用，修复后只调用选择与填写两次，状态和事件不变；已选执行类型的全空组仍可修订。最终源码没有重跑整套 Vitest/Node；采用上述 v65 完整结果与这一小范围预算收紧的增量证据，不把两者混称为 v66 全量通过。`.gate-baseline.json` 未扩充或重写。

## 真实批次

均从真实本地登录、开房、建卡、开团、`sendAction`、`fetchTable` 入口调用默认 DeepSeek v4 flash，使用独立本地 D1/DO 状态；14 份 migration 仅应用到本地。原交接的 fetchTable 500 来自脚本把房间码参数传成对象；改回房间码字符串后本批前后均为 200，不能据原调用认定 archive 故障。

| 批次 | 调用数 | 输入 token | 输出 token | 缓存命中输入 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| round 120，v64 | 4 | 116,078 | 1,274 | 63,744 | 拿蜡烛；已填非空步骤并补齐 authorItem，随后服务器修订链失败；0 事件，停批定位 |
| round 121，v65 | 5 | 81,537 | 1,426 | 38,656 | 拿蜡烛；选择、补选 authorItem、填写、旁白、审核；真实提交并发布，新增 1 根蜡烛，9 事件 |
| round 122，v65 | 5 | 105,683 | 2,526 | 43,520 | 询问莉安父亲的情况；选择、填写、修订、旁白、审核；真实提交并发布，累计 17 事件 |

round 120 明确失败后没有继续采样，先完成离线定位、修复和回归，再开新房运行 round 121–122。新批预设最多两次行动、每请求最多 6 次调用；实际 10 次。三轮合计 14 次，303,298 输入、5,226 输出、145,920 缓存命中输入；Provider 没有给出费用字段，费用保持未知，不记为零。

round 122 首稿额外填写 `decision.intent` 与 `decision.method`，服务器给出准确路径，真实 `correct_kp_proposal_bundle` 返回删除补丁后通过。这个批次证明一次真实差量修订，没有自然复现 round 119 的全空组或 round 120 的后续 Rules 修订链；后两者靠确定性 Room 回归证明。

两次成功行动都对原 submission 再次请求：响应相同、模型调用增加 0；比较前后 SQLite 的权威 state、events、receipts、delivery plans/audiences/slots 完全相同。用保存 genesis 和全部事件经现役 Rules replay 重建，分别精确等于版本 9 和 17 的保存状态。round 122 后蜡烛仍只有 1 根。

## 未解决与未覆盖

- 固定组顺序保留既定方案的行为限制：跨类型无依赖步骤不能再表达任意模型顺序。尤其同束新增 NPC 知识却未被 social 引用时，提前物化会触发 `social:npc-context-changed-or-forged`。“late history”测试仅证明领域层晚生产者路径，不能算 v4 wire 已支持。此次未放松该 Rules 检查，也未新增顺序协议。
- round 122 的最终旁白末句重复“你也拿起一根蜡烛，装进了背包”。库存、事件没有重复，但叙述把上一轮动作带入本轮；保存的旁白上下文 recentDialogue 含前轮玩家原句，审核仍接受。未定位其究竟属于上下文选择还是旁白约束问题，不宣称完整叙述验收通过。
- 全量 Vitest 保留 214 个既有失败；Node gate 保留 82 个已登记失败用例名。未执行全项目 Lint、production build、部署、push、远端 migration、统计可靠性或完整游玩验收。
- 最终 v66 仅比真实批次的 v65 收紧未选执行类型时的空裁决预算并更新绑定，未在 v66 再跑付费模型。两个真实成功行动都选择了执行类型，不触及该新增拒绝分支。

## 证据位置

工作树下 `.wrangler/grouped-wire-validation/` 保存 captures `001.json`–`014.json`、round/table/authority/verification/replay 报告和真实批次源码清单，属于忽略的私有本地文件；session cookie 不提交。全量 JSON 比较报告在 `/tmp/zhuwei-wire-{baseline,verified}-vitest.json`，Node gate 在 `/tmp/zhuwei-wire-verified-gate.log`，最终增量日志为 `/tmp/zhuwei-wire-final-{node,room,typecheck}.log`。这些临时路径不承诺跨机器可用。
