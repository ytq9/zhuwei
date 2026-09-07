# Round7：Proposal 输入成本与真实链路

日期：2026-09-06。基线：`cloudflare / 258caee404e0814405eb497653ee9f00d647b773`，继续已有未提交树。生产仍为 V3。

## 结果

同一份历史冻结材料的真实 DeepSeek 对照，Proposal 输入 **28,367 → 26,689 tokens，下降 5.9%**。该结果尚未达到简单 Proposal 8k、全体 16k 的采用门。一次新房正常 Cookie HTTP 行动的 Proposal 提交成功，输入 **27,816 tokens**；旁白被拒，连续两步计划按失败停止条件终止。

本批 **1 个游戏根行动 + 1 次不提交的成本诊断，4 次调用**。精确用量、绑定及证据摘要见 [脱敏记录](vnext-round7-live-evidence.json)。不得把不提交的对照计为另一项真实游戏成功。

## 输入成本与实现

原 round6 成功请求为 89,943 UTF-8 bytes，其中完整工具封装 51,369 bytes；系统正文 6,528 bytes，用户正文 28,841 bytes。序列化消息字符串还包含转义及封装开销，不能将这些字节直接视为 token 分区。

只读 schema 核验确认：现役代码已经共享重复结构，传输层未重新展开。当前工具结构完全展开为 82,214 bytes；本轮之前的 compactor 生成 49,778 bytes，不能把“再次开启压缩”当作新优化。

本轮采用两项通用改变：

1. `proposal-context.ts` 从完整冻结 RequiredContext 派生模型表示，保留全部 intent、entries、references 和 contextHash。只将约 3KB 的 Room/root/prepare/state/Profile 清单等 binding 留在服务端；条目正文、权限、Availability、版本、物化义务不裁剪。原始 RequiredContext 继续用于本地校验、修订票据及提交，新的 contextRepresentation 进入 workflow hash。
2. `deepseek-strict-schema-compaction.ts` 用确定性的短 base36 名称引用生成的 `$def`，保留已有名称和碰撞处理。最终 schema **47,346 bytes**，较本轮前减少 **2,432 bytes（4.9%）**；展开后结构、说明、约束和分支深相等。没有引入 ref-only anyOf 分支或放宽 vendor dialect。

未采用 description-aware 二次重构：额外净收益小于 1KB，却会增加描述覆盖与引用优化复杂度。也未通过提高输入预算或截断必需材料制造达标结果。官方 [DeepSeek strict tool 文档](https://api-docs.deepseek.com/guides/tool_calls) 本轮已核验，仍使用其 `$def/$ref` 与现役已验证方言。

## 真实验证与局限

预算为最多 2 个根行动、8 次请求、360k 输入/32k 输出，每 HTTP 最多 4 次；首次明确失败停止，只追加一次能区分原因的诊断。本地宿主为 `localhost:4319` 的显式 vNext，私有捕获 sink 在 loopback，所有原始响应来自同一次真实调用，无公开 Prompt/密钥日志。

新房同类库存释放经真实 Provider → parser/validator → Rules/Room 提交：持有弩矢 **20→19**、场景堆 **1**，HP 28/28，其他职业资源不变，无 Pending，只有一份 Receipt。实际 `genesis + InventoryOperationApplied` 的 replay 与 DO 保存状态精确一致。

该次旁白正文自行增加了容器、地面材质和声响。模型审核仍将它们判为 grounded，且只引用 facts 0/1，漏了必需的 fact 2；服务端以 `missingClaimFacts` 拒绝，未发布。facts 0 与 2 文本相同但对应两个库存 Claim，说明后续要一起审视表达分组、来源与审核质量。未删索引、替换模型输出或放行无依据细节；这不是本轮可用旁白验收通过。

新房 Context 为 20 个条目，历史对照为 15 个；之前的独立单字补召回也载入了更多 Geometry/物品候选，因此不能把两次游戏请求的 token 差异直接归为压缩收益。保留过宽候选的因果/权限边界，后续做通用相关性与指代检索，而非依靠动作名分派或删决定性数据。

为隔离材料变化，唯一追加诊断复用了 round6 完整冻结内容，只更新模型表示及当前工具 schema，沿真实 strict binding 调用且不提交 Room。正文与引用未改变，实际输入 26,689 tokens，解析通过。历史 schema 与当前展开结构还含前批次删除的两处无消费者 optional wire 分支，因此 **5.9% 是相对历史请求的综合对照，并非仅本轮两项修改的严格归因**；本轮改动的语义等价由当前 schema 展开测试证明。没有以这个对照证明模型长期合法率。

## 定向证据

- 新 Room 输入表示断言先红：仍发送 binding，1 项失败；/tmp/zhuwei-vnext-input-red.log，exit 1。
- `npx tsx --test tests/deepseek-strict-schema-compaction.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/vnext-local-room-binding.test.mjs`：**37/37，exit 0**，覆盖不同结构/描述、现有定义碰撞、完整 schema、非法边界及完整 workflow 绑定；/tmp/zhuwei-vnext-input-node.log。
- `npx vitest run tests/kp-vnext-provider-room.test.ts`：**6/6，exit 0**。实际模型表示保留冻结事实，Room 保存完整请求；断连/驱逐、唯一修订票据、重复与越权、429/超预算等直接消费者通过；/tmp/zhuwei-vnext-input-room.log。
- `npm run typecheck`：exit 0；/tmp/zhuwei-vnext-input-types.log。
- 实际事件 replay：exit 0，exactState=true；/tmp/zhuwei-vnext-round7-replay-evidence.json。
- 两个本地宿主均 Ctrl-C 退出 130。未运行全量测试/Lint/build，无 commit/push、部署、migration、生产切换或数据退役。

## 后续

成本目标仍未完成。下一步需要审视通用工具填写面与相关性选择：普通行动如何避免携带完整作者化 schema，同时保持合法复合能力、同一权威及最多一次窄修订。若方案增加模型调用或改变已裁定的 Bundle 冻结/修订合同，应先形成具体方案并按规格路由确认。真实连续游戏、Narration 质量和 V01–V03 完整采用门继续保持未完成。
