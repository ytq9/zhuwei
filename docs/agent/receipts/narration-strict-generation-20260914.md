# 旁白非思考严格工具生成与真实恢复验收

日期：2026-09-14。承接用户“可以，做吧”批准的[修复方案](narration-thinking-control-20260914.md)。**原冻结材料已通过真实生成与独立审核；正常本地 HTTP 恢复入口已发布真实正文，未重复结算。中文自然度仍有明确缺陷，不算全部旁白质量通过。**

## 修复与边界

原失败的第一个违反输出合同的位置是 Provider completion：思考耗尽 5,047 token 上限后，`finish_reason=length` 且正文为空；只关闭思考的单次对照又在合法 JSON 后附加了非法尾部。前两次原始结果见[初次验收](live-functional-acceptance-20260914.md)与[诊断对照](narration-thinking-control-20260914.md)，原稿及失败结论保留。

[narration-vnext.ts](../../../app/_runtime/lib/kp/narration-vnext.ts) 的生成请求改为非思考、一次必选严格工具 `submit_frozen_narration`，参数精确为 `{ body: string }`；服务端仍检查非空、长度和正文约束。保留一次独立 `review_frozen_narration`，不增加自动修稿、尾部裁切或失败兜底。截断、错误工具、多个工具、正文与工具混发、重复 JSON 成员及非法尾部均拒绝。原生成 token 上限公式保留，同一原始材料仍是 5,047。

对应 SPEC 0015 §7、§8.2 与 SPEC 0016 §8.3：模型表达已冻结结果，恢复不重裁决、不重掷、不重新扣资源。生成 schema 升为 `zhuwei.natural-narration/v3`，policy 为 `kp-vnext-narration-policy-v17`。Provider、权威 Adapter、Room invocation journal 和归档验证均消费同一请求构造/提取器；Provider 按请求中的 strict 声明自动走 beta endpoint，无需第二条业务路径。

直接夹具和测试同步到工具协议，包含归档保存后重证生成/审核请求的消费者。未修改已批准产品条款，未增加依赖。

## 源码与适用房间

- 分支 `cloudflare`；基线 HEAD `ff78223102950adb4605d8fee9b8c837a34d55fa`，包含既有未提交测试重组。此次业务源码仅修改 `narration-vnext.ts`；保留用户其他差量。
- 实时调用前后 381 个运行时、配置和探针文件一致：`sha256:9d6d5c27f9a0462e40d4f32afaba822b2256ef19319b2c0bdae899334d2b6cac`。
- 新 workflow hash：`sha256:0ad6e5437c9d2338b402c4ebc4dceb4da11df7d73ea29aaadc7692406369160a`。旧 hash 为 `sha256:e095c545a29f4ca69210164b9f65db3549b609b0edc3438034cc1aedbc6d4a00`。
- 房间精确绑定完整 workflow；原旧绑定房间及其归档没有迁移或退役，不会静默套用新策略。本次 HTTP 使用新建的隔离测试房间，原失败房间只提取冻结材料作离线重建与真实生成/审核，没有改写其发布或世界状态。已有房间能否采用新策略仍需适用的数据处理决定。
- 请求保留 `deepseek-v4-flash` 别名；实际响应均为 `deepseek-flash`。当前官方文档将旧别名指向 DeepSeek-V4.1-Flash，不能把应用的 revision 标签当作供应商旧快照保证，也没有证据把原失败归因于模型切换。

## 验收矩阵与实际结果

| 场景 | 结果与证据 |
| --- | --- |
| 原失败冻结材料，真实生成＋审核 | 2 次调用通过。新旧请求的材料消息深比较完全一致，生成上限仍 5,047；独立审核通过。只返回候选，不发布、不改世界 |
| 正常物品转交/放置，受控模型 | 正文原样返回，生成及一次审核各留准确调用记录；两种行为共用同一输入/提取路径 |
| 原空正文截断、非法尾部及其他畸形输出 | 定向回归稳定拒绝，不调用审核、不清洗正文、不伪造成功 |
| Provider/审核失败与原回执恢复 | 受控行为测试保留错误分类、已提交行动、恢复发布及调用上限 |
| 真实 HTTP 恢复 | 正常注册和会话、Room、SQLite、游戏 handler；初次模型选择/填写是真实调用。在生成 seam 注入 **1 次合成空正文截断故障**，得到 `committed/rejected` 和 `NARRATION_BODY_INVALID`；从 `fetchTable` 取原恢复凭据，经 `retryNarration` 调用真实生成＋审核，得到 `committed/published` |
| 恢复结果与原提交重复 | 恢复生成请求与初次冻结请求完全相同；恢复前后 state、8 事件、3 机械 Receipt、0 随机批次、故事 jobs/library 均相同。再次使用原 submission 请求，零新增模型调用且完整私有快照精确相同 |
| 公开正文与事件重放 | `fetchTable.messages` 新增一条 KP 正文，与实际工具返回逐字相同；用同一 `VNEXT_RULES_RUNTIME.replay` 重放 8 事件，完整状态一致 |

HTTP 中原行动推进虚构时间 30 分钟；恢复和重复请求各新增 0。状态 hash 为 `sha256:c2c8e3e5b9dbcf959574e118c1d2d7b993adb9bbd310327b811821f7780f0053`。首发故障是显式合成材料，不能声称真实供应商自然发生故障后恢复；恢复生成与审核确为真实调用。只核对了已发布 Table 与重复请求，未把未执行的 ACK/历史恢复或浏览器交互算作通过。

## 实际正文的独立阅读

逐项依据[质量评价方法](../functional-acceptance.md#5-真实旁白和故事质量如何评分)，以下是代理阅读实际冻结材料与正文的评价，不冒充玩家/真人评审，也不以模型自评代替判断。

| 维度 | 原冻结候选 / HTTP 恢复正文 |
| --- | --- |
| KP-H01 通顺自然 | 原冻结候选能通顺表达玩家来意。HTTP 正文 **有明确缺陷**：一处“交给能照着话里的人”语义不完整；该病句已经出现在上游 NPC 发言，旁白再次照搬，审核仍报告全部 pass |
| KP-H02 具体可行动 | HTTP 正文说明了两项可继续核对的问题，样例满足；原冻结候选仅含玩家来意，不足以证明 NPC 回答或可行动性 |
| KP-H03 NPC 声口 | 材料不足；只有一个 NPC 的单轮回答，不能证明多人可辨或跨轮一致 |
| KP-H04 玩家决定权 | 两份正文未观察到新增玩家决定；HTTP 的 NPC 建议没有写成玩家已同意执行 |
| KP-H05 世界内表达 | 两份正文未出现内部 ID、表单或检定结算播报，样例满足 |
| KP-H06 结果一致完整 | 所读正文没有改变此样例的冻结交谈信息；原候选只有玩家表达。没有治疗、消耗物品等机械成本样例，不能外推 |
| KP-H07 跨轮连续性 | 与当前可见开场未发现冲突；未执行多轮取物/交谈/等待矩阵，材料不足以完整验收 |
| KP-H08 延时归属 | 该样例的 Activity 完成仍使用原玩家意图/来源；正文主体一致。未覆盖澄清、主动停止或不同触发者 |
| KP-H09 冻结恢复 | 本次单受众故障注入与真实恢复通过，事件/资源/虚构时间不重复；未做多受众对照 |
| KP-H10 秘密边界 | 正文所用内容均来自该 Viewer 冻结材料；没有成对 Viewer 样例，不能完整验收 |

故事 jobs 与 library 均为 0，实际得到普通 NPC 回答，**动态支线未触发**。本批不继续采样挑选成功，不把格式修复当作自然度、故事创作或全部 103 项功能通过。下一项质量工作可从保存的病句及其上游来源做定点语言修复/审核拒绝对照，无需重跑玩家行动。

## 命令与定向检查

以下结果只属于列出的目标，不是全量回归。

| 检查 | 实际结果 |
| --- | --- |
| `node --import tsx --test tests/kp/narration/{generation,frozen-input,recovery,review,continuity,presentation,social-context,narration-provider-failure}.test.mjs` | 首次 41 过 / 5 失败；五项失败均由独立 Provider 夹具仍返回旧 JSON 引起。更新该直接夹具后单独运行 `narration-provider-failure.test.mjs` 为 8/8，其他 38 项对应代码/夹具未再改动；未重复累计为一次全绿报告 |
| `npx vitest run tests/kp/narration/kp-narration-transport.room.test.ts` | 4/4，exit 0 |
| `node --import tsx --test --test-name-pattern='narration restores frozen' tests/platform/recovery/story-archive-host.test.mjs` | 旧归档夹具先失败；同步严格工具响应后 1/1，exit 0，原恢复/防伪造断言保留 |
| `node --import tsx --test tests/platform/evaluation/story-room-probe.test.mjs` | 初次 8 过 / 1 失败；更新新增 case 的目录期望后，仅重跑 `--test-name-pattern='default is configuration'`，1/1，exit 0 |
| `npm run typecheck` | exit 0；其后未改共享类型或业务源码 |
| `node --import tsx tools/run-story-room-probe.mjs --preflight --case narration-recovery` | passed，0 次真实调用 |
| 原冻结材料私有 `frozen-live/run.mjs` | `generation-and-review-passed`，2 次真实调用；设置阶段两次误传 90 秒 Adapter 超时，均在外呼前拒绝且 0 调用，修正为其既有 45 秒上限后只执行一次真实样例 |
| `node --env-file=.dev.vars --import tsx tools/run-story-room-probe.mjs --live --case narration-recovery --max-calls 8 --max-input-tokens 920000 --max-output-tokens 47616` | passed，4 次真实调用，Worker exit 0，源码前后一致 |

归档夹具更新发生在实时批次后，不在 381 项运行时/探针清单中，也未改变实际验收源码。原旁白目录中 Activity 未来结果/打断原因的已知旧失败不属于此次根因，未放宽断言或登记新基线。

`node tools/spec-trace.mjs --check` 为 0 错误、7 个既有警告；`git diff --check` 通过。目标测试说明、功能清单与本回执的 285 个本地链接均存在，实现导航只同步旁白这一行。此前全仓文档检查涉及已删除 `handoff.md` 的断链仍属原工作区差量，本次未扩大检查基线或修改无关文档。

## 调用预算、费用与私有证据

预设整个批次最多 10 调用、960,000 输入 / 64,000 输出 tokens、540 秒，单次 45 秒；原冻结材料分配最多 2 调用，HTTP 恢复最多 8 调用。预算、未知 usage、意外终态失败或源码漂移触发停止，最多一次有区分力的诊断对照。本次无未知 usage、无意外终态失败，无追加付费对照。

| 阶段 | 真实调用 | 输入 / 输出 tokens | Provider 累计耗时 | 官方标价估算 |
| --- | --- | --- | --- | --- |
| 原失败冻结材料生成＋审核 | 2 | 12,447 / 251 | 2.649 秒 | ¥0.01761944 |
| HTTP 选择/填写＋恢复生成/审核 | 4 | 85,847 / 1,400 | 11.036 秒 | ¥0.14777080 |
| 本批合计 | **6** | **98,294 / 1,651** | **13.685 秒** | **¥0.16539024** |

实际外呼发生于北京时间 17:07:26–17:10:25，均在周一高峰时段。按当天已核验的官方价（每百万缓存命中输入 ¥0.04、未命中输入 ¥2、输出 ¥8）逐响应计算；这是标价估算，不是账户账单。探针内 `ROOM_STORY_TRANSPORT` 的旧保守成本权重没有币种证明，不拿它作实际人民币费用。原失败及诊断对照费用单列于各自回执，不合并成通过率。

私有证据保存在被忽略的 `.wrangler/narration-strict-fix-20260914/`，目录 0700、文件 0600，包含 `plan.json`、起止源码 manifest、`frozen-live/` 原请求/响应/候选、`http-recovery-evidence/` 请求/响应/状态/恢复/重复快照，以及 `cost-analysis.json` 和 `offline-audit.json`。没有凭据进入回执或 Git。价格原始页面沿用 `.wrangler/live-acceptance-20260914/pricing.html`，SHA256 `a1602748f50a9baacd416f4b831438896ba1351160f1f9afe89a9423c4b76cf3`。

本次没有 production build、完整回归、部署、远端 migration、Git push 或旧房数据处理。
