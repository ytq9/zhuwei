# 首轮小表单与按家族填写验收

日期：2026-09-07。当前 cloudflare / 258caee404e0814405eb497653ee9f00d647b773 未提交工作树。用户要求简化填写接口并允许调整 Goal 验证，以真实 API 为最终结果；当前不部署、不 push。

## 现有问题与能力合同

round64 第二句在大首轮表单下返回未闭合感官字符串，尚未到 Rules，且把一分钟只写入 observe 文本。已有 passTime 指导并未保证正确选择。不能据此推断供应商内部结束原因，也不能清洗字符串后补裁决。原失败保留于 [round64](vnext-round64-validation.md)。

KP 从完整轻量能力目录选择所需家族，再填写当前行为的最小完整表单；服务端从同一领域 schema 生成填写面并仍交同一 validator/Rules。首轮仅 knowledgeReview、passTime、inWorldRefusal 和纯 schemaRequest，其余执行与 clarification 先选类型。按所选家族及既有类型依赖闭合，不附加六个未选常用家族。不能改变原意图以适配小表单或把缺 schema 包装为世界内拒绝。

## 实现与直接消费者

5 个生产文件：proposal-capabilities、proposal-filling-interface、proposal-guidance、proposal-provider、proposal-schema。parser v32；initial 集合和指导进入 policy hash。首轮准入种类从实际 offer schema 派生，空 steps 不生成空 anyOf，也不能用无 steps 的 clarification 绕过准入。诊断保留 draft 路径、actual kind、expected 与禁止修订原因。

Room invocation、Adapter、runtime policy 已从同一注册表重建所选 schema 和保存响应，不需新生产分支。schema 检索、填写、诊断、Provider Room、动态地点及 NPC 计划直接测试消费者均按实际阶段更新；time-passage/actor-plan-due 仍直接使用小表单，无需迁移。库存/观察/社会/NPC计划/Item/Hazard 共用一个选择机制，不按名称或动词路由。

支持原有可证明等义的数字 token、固定外壳及受限字段修复；未加载种类须先选择，不能借修订更换目标、DC、成本或结果，不能补缺裁决或未闭合内部字符串。完整原稿、冻结上下文、唯一修订、整束重验、Room journal、随机与资源幂等不变。普通最多2阶段，schema路径最多3阶段，HTTP5调用保持。复杂行动平均调用可能增加，真实成本需实测。

集成审计见 [manifest](vnext-selected-schema-integration.json)：9个副本文件全部baseline/new SHA核对，0冲突；root另迁移NPC形成测试，独立只读review无阻塞。

## 代表性矩阵与定向证据

- 小表单：知识回顾、等待与真实拒绝直接提交；numeric passTime 一次修订仍2阶段。
- 不同家族：库存/观察/社会独立选择，Item与Hazard闭合不同类型依赖；NPC形成→未来到期→后续等待跨驱逐保持。
- 高风险拒绝：未加载类型、无steps澄清、缺DC、换目标、非法原始数值；0额外修订/0事件/0随机/0资源。
- 恢复：schema响应保存、Proposal/修订保存、429、预算阻断、驱逐重复请求；实际请求、ordinal及原稿绑定，重复不重裁决。

主树同一源码状态实际运行：

1. `npx tsx --test tests/kp-vnext-schema-retrieval.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-diagnostic-repair-provider.test.mjs`：47/47，exit0，`/tmp/zhuwei-selected-schema-root-node.log`。
2. `npx vitest run tests/kp-vnext-provider-room.test.ts tests/kp-vnext-dynamic-locations-room.test.ts tests/kp-vnext-npc-plan-formation-room.test.ts`：44/44，exit0，`/tmp/zhuwei-selected-schema-root-room.log`。
3. `npm run typecheck`：exit0，`/tmp/zhuwei-selected-schema-root-types.log`。

旧20k字fixture对160k context预算已不构成超限，改为从既有单记录reread cap派生完整性超限，仍证明Provider前阻断；未修改生产预算或吞错。旧复杂首轮fixture改走真实schema阶段，计数如实增加；小表单429路径保留，无隐藏调用。

离线不含动态引用的首轮 schema 49,775→4,904 bytes，observe14,902、social17,594；字节不等于实际token。隔离与主树重复验证不累计覆盖。

## 真实验证与剩余缺口

[round65](vnext-round65-validation.md)同原三句、默认DeepSeek、正常注册/Cookie HTTP、原20 calls/¥5/20分钟上限，3/3 committed/published；第三句真实schema选择后引用前轮痕迹通过。11调用、114197输入/4498输出、¥0.1618405，18事件replay精确、320源码起止一致。0格式失败/规则拒绝/已识别叙事矛盾，0修订/恢复；仅支持本实例连续链，不声称统计稳定性提高。普通创作仍检查具体冲突，NPC台词保留归属；此变更未增加逐句引用审核。

复杂提案稳定性、无fixture NPC新计划、完整Activity、双人20+与SPEC0001 A–O仍待真实验收。Goal保持active。
