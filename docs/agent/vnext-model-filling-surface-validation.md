# 模型只填写自身选择：修复与真实验收

日期：2026-09-08。范围：提案填写表单、字段说明和共享提示词。用户要求“给模型看的就只能是模型需要填的，服务器应该填的就不用给模型看”。本次修复恢复已有职责边界，不修改产品规格、解析器或语义修订权限。

## 症状与根因

[上一批真实回执](vnext-narration-precision-validation.md)的治愈伤口请求被 `filling:ability-basis-owned` 拒绝：原生施法表单只接受 `kind/operation`，共享提示词却统一要求填写 `basisRefs`；模型还复制了 `intent/method`。表单、说明和上下文之间的职责不一致是已证实的输入缺陷；一次采样不能证明它是模型额外字段的唯一成因。

还发现三个同一填写边界的问题：只有原生操作时，根说明仍要求填写不存在的 `steps/results`；拒绝/澄清的依据说明沿用内部根表单的 `terminal.*` 文案；静态模板目录把服务器负责的哈希、修订、schema 和来源元数据一起发送。澄清计划的说明也仍混用旧嵌套结果格式。

## 修改与直接消费者

- `proposal-filling-interface.ts` 按实际分支列出可填字段，只在真的有步骤表时说明 `steps/results`；澄清的原生操作沿用相同字段边界。施法、等待、知识回顾的根依据由服务器派生，拒绝、澄清、观察和创作仍保留确实需要模型选择的依据。
- `proposal-guidance.ts` 去掉无条件抄写依据的要求及内部字段清单，统一按所选分支填写；更正澄清的平表说明。模板目录只发送 `templateRef/semanticKind/defaults`。指导策略版本由 v7 升至 v8，解析器未改。
- 现有冻结事实、授权、原始意图和可用候选仍作为只读上下文提供，不能把“少填服务器字段”变成“不给模型判断所需事实”。哈希和依赖仍由服务器保存并校验；多填服务器字段继续严格拒绝，没有静默删除或放宽修订。
- 已核对实际请求构建、能力检索、Room 保存/恢复请求的直接消费者。保留同目录其他任务的 social 承诺指导及 Rules/Room 改动。

## 本地定向证据

| 检查 | 结果与边界 |
| --- | --- |
| 新增 `kp-vnext-model-filling-surface.test.mjs` | 修复前 1 过/3 失败，exit 1；修复后 4/4，exit 0。直接检查生成请求、字段和真实解析拒绝，无源码匹配替代行为验收。 |
| Node 四文件组 | 首次 54/56，exit 1；两个失败均在 schema-retrieval：旧断言要求完整服务器模板目录，并忽略有无生产者会改变依据说明。更新断言后该文件最终 13/13，exit 0；其他 43 项已通过。 |
| Room 保存/恢复 | 两个目标用例通过，42 跳过，exit 0。覆盖只选终止表单时重建和已保存扩展响应恢复。 |

命令：

```sh
node --import tsx --test tests/kp-vnext-model-filling-surface.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-ability-operation.test.mjs
node --import tsx --test tests/kp-vnext-schema-retrieval.test.mjs
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'rebuilds a terminal-only selection|recovers a durably saved expanded response'
```

日志位于 `/tmp/zhuwei-model-owned-filling-20260908/`：`red-final.log`、`surface-green-final.log`、`node.log`、`schema-final2.log`、`room.log`。选定与完整表单比较只忽略两句已知的生产者可用性说明，字段、类型、枚举、引用约束和其他说明仍逐项比较。未改导出类型或公共签名，未运行 typecheck、全量测试或构建。

收尾文档/JSON/7 个链接检查与本次目标文件的 `git diff --check` 均 exit 0。一次全工作树 `git diff --check` 为 exit 2，唯一输出是其他任务修改的 `rules/v2/projector.ts:20` 行尾空格；未编辑该并行文件。

## 原句真实复测

从 `cloudflare / 5d4c1512488da9e134314589344c613a60aaf26a` 加当时在途修改冻结 343 个源码/配置/工具文件，保存于 `/tmp/zhuwei-model-filling-live-20260908/source`。源码清单 SHA256 为 `3624ec90e078d5ed4cbdfafc715a533c7ec7aed1458af98450c32dc658101f7a`，冻结副本与测试器起止未变化。使用独立本地 D1/DO，运行本地 migration，再通过正常注册、建卡、开局接口准备角色，没有注入伤势、裁决或骰面。

冻结预算为一个原句、最多 5 次模型调用、最多 ¥1.25；默认 `deepseek-v4-flash`，不换模型、不重采样。原句：

> 我握住圣徽，对自己施放一次一环的治愈伤口。

结果为 **`committed / published`**。选择阶段只选 `abilityOperation`，填写阶段根只有 `decision`，其中只有 `kind/operation`；能力和自身目标均正确，首次填写直接通过，修订调用为 0。两次提案请求/响应与 Room 保存日志逐值一致。

真实旁白的原始 JSON `body` 经当前正式解析器读取后，与审核正文、最终公开正文逐字一致：

> 你握住圣徽，对自己施放治愈伤口，消耗了1个一环法术位（还剩3个）。但你本就满血，生命值并未增加，仍是24/24。

权威状态：HP 24/24 → 24/24；一环法术位 4 → 3；二环保持 2。一次真实 d8=1，加值 3，理论治疗量 4，实际恢复 0；只有一次资源扣除、一个 Receipt、9 条事件。原 submission 重复提交新增模型调用为 0，状态、事件、随机日志、Receipt 和 Delivery 一致。当前冻结 Profile 重放得到 `exactState=true`。生成和审核共两次调用，五个审核项及五个结果组通过，人工核对无额外伤势或含糊资源名称。

本批共 4 次物理调用：65,086 输入、562 输出 tokens，其中缓存命中 512。按当晚保存的官方价格及实际 usage 估算 ¥0.0994156，非账单实扣证明。正常请求、重复、接受核对、重放、正式正文解析核对与冻结源码检查均 exit 0；本地 migration exit 0。汇总脚本最初把整个 JSON 封装与正文字符串比较，离线改用正式 `body` 解析后通过，未产生新调用或改动原文。

结构化结果见[本批真实证据](vnext-model-filling-surface-live-evidence.json)。原始模型材料只保存在本机 `evidence/precision-private/`，正文核对、费用与重放结果在 `closeout/`。game/capture 两个自有进程及 4330/4331 端口已关闭。

## 未覆盖范围

本次证明一个正常施法请求经过真实模型、Rules、Room 提交和公开旁白，并不证明统计稳定性或完整游玩能力。等待、知识回顾、创作和澄清只有上述本地定向证据；第二种治疗、真实错误旁白检出率、多人和完整回归未复测。未部署、push、远端 migration 或退役数据。

真实测试期间其他任务继续修改主目录的承诺、历史覆盖及相关规则；本次两份生产修改与冻结副本一致。结构化回执记录核对时主目录相对副本的差异，新增 worldFact.historyCoverage 等并行合同不由本回执验收。先前失败与隔离旁白对照保持原分类，本次成功是新的独立正常请求证据。
