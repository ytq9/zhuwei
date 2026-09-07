# vNext round10/11：现役输入、开场知识与旁白断言审核

日期：2026-09-06。基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773`，保留全部既有未提交工作。前序 round9 已产生实现/真实调用证据，属于进展；本轮启动核验无遗留进程。未切换生产。

## 用户决定与能力差量

本轮已把快速部署决定同步到 TODO、release、SPEC0015 §13、SPEC0016 §4.3/§7.2 的直接冲突条款：完整测试/Lint/冻结门及120条统计认证后置；8k/16k输入和压缩百分比作为优化参考。产品、安全与机械合同不变，部署仅授权现有 Worker/绑定，push/migration/Secrets/新增资源仍单独授权。

并行只读审计确认：已存在 Rules 不等于当前 vNext 模型可达。仍缺 clarification/highRisk continuation、独立 observe/social/objective/story/combat、NPC/location/portal 作者化；vNext dispatch 早于到期 Activity 调度；默认上下文缺部分连续性/聚光灯。当前 correction 仍限 summary；这些是后续实现差量，不改为“只差验收”。

## 实现、合同与代表矩阵

1. **现役直接输入恢复。** DO 根据已验证封闭输入派生 `authorityDirect` 后，跳过仅供 KP 的 RequiredContext；自然语言仍必须冻结，未知 kind 仍拒绝。休整、装备、移动、环境能力、结束回合、安全操作等继续进入现有鉴权/Rules路径，没有扩大模型权限。
   - 新增实际 Room `restStart → 驱逐 → 重复提交 → restInterrupt`，库存/资源/时间不重复改变；他人提交拒绝；另一个结构是 `Room Action → safetyPause`，零 Proposal 调用。
   - 原失败用例两个均在 prepare 被 `requiredContextUnavailable` 拒绝。修好后暴露取消休整的回执无 subject 导致 projectionIntegrity：ActivityInterrupted 只引用 Activity，原 eventSubjects 未读取其拥有者。现从权威 Activity 关系提取 Interrupted/Completed 的 owner，不从 cause 或 ID 文本猜角色；投影完整性校验未放宽。
2. **开场初始知识。** 初始化时将固定 Module Profile 的 publicOpening 原文、moduleRef、sceneId及来源写入相同 Rules genesis 的 sensoryEvidence，只有实际在场初始角色获得，私有 Viewer 投影；人物卡继续从既有权威读取。两名在场/一名缺席、ACK、驱逐恢复和双绑定通过。
   - 开场 Delivery 与知识生命周期分开，读取/ACK 不推进时间。该实现不等于自然语言“我知道些什么”已经可用；独立既知回顾/状态询问与实际调查的 wire/Rules结果边界仍须完成，不能伪造新感官发现。
3. **旁白审核改为逐断言证据。** 保留一次正文生成与一次审核。review/v2 为每段的原文片段、明确断言、类型、判定、覆盖事实索引和具体证据位置/摘录建立义务；服务端检查全文无遗漏/重复、路径存在、标量摘录真实、claim组匹配与必需结果覆盖。普通动作润色与实际结果、世界属性、历史、非事实句分别审查。原句级grounded+编号不能再作为有效审核响应。
   - 正文仍body-only；不清洗或删掉非法句子，不增加重生成或审核阶段。Workflow绑定新Prompt/schema hash，原已冻结的模型请求不替换。
   - 审查后修复标量证据：数值/布尔必须完整匹配，字符串允许原文摘录；有 payload 依据的合法细节可以不贡献 fact 覆盖，但 required facts 仍须全部覆盖。审核预算改按正文与段落估算，486 字复合结果不再在调用前被旧估算直接拒绝；保留 12k 输入/4k 输出异常限额，无截断。这三项修复在 round11 后，只经过离线验证，未追加外部采样。
   - 这仍是模型语义判断，确定性检查证明证据结构/出处与覆盖，不证明语义蕴含或漏判率。控件/旁白fixture仅证明服务端合同。

## 定向证据

- Node：`npx tsx --test tests/kp-vnext-narration.test.mjs tests/table-server-outcome-v2.test.mjs`，32/32，exit 0，`/tmp/zhuwei-vnext-round10-node-final.log`。含旧整句背书拒绝、伪造摘录/路径、漏文本、跨组覆盖、动作润色、角色/来源/历史、拒绝/容量/429/两调用，以及标量/payload/复合正文边界。
- Worker：`npx vitest run tests/authoritative-opening-v2.test.ts tests/kp-vnext-provider-room.test.ts tests/rest-activity-eviction-v2.test.ts`，13/13，exit 0，`/tmp/zhuwei-vnext-round10-room-final.log`。最终组用于集成收口，不累加前序重叠检查；其后 narration 校验小修由 Node 组覆盖。
- `npm run typecheck`，exit 0，`/tmp/zhuwei-vnext-round10-types.log`；后续标量/payload/预算校验未改变公共签名，最终 Node 组通过。
- 两个真实房间各一条 InventoryOperationApplied，用实际 genesis+events 重放与 SQLite 存储精确相等，冻结 Narration contexts conform，脚本均 exit 0。只读URI打开SQLite失败后，在已停止服务的本机副本核对，未修改源数据库。
- 开场初版测试错读 readModel.personalKnowledge 导致 harness失败，已改为实际 `knowledge`；没有据该初版错误宣称产品红例。最初只读探针确认为 playerKnowledge=0、NPC=12，后续实际知识断言通过。
- 全项目测试、Lint、production build、远端修改均未执行。

## 真实批次与结论

各批预设最多2动作/12调用、240k输入/24k输出、单调用超时；实际在首次明确失败后停止，round10只追加一个同冻结材料/正文的审核诊断，不提交Room。全部调用均为 deepseek-v4-flash。

| 批次 | 实际调用 | 输入/命中/未命中/输出 | 结果 |
| --- | ---: | --- | --- |
| round10 | 3游戏调用+1审核诊断 | 25,055 / 4,736 / 20,319 / 1,154 | 合法库存提交，但旧审核错放行石板、材质/光照描写；人工验收失败。新版同材料诊断拒绝无依据断言；主句误归润色、漏结果覆盖，不能称审核完全正确。 |
| round11 | 3游戏调用 | 23,874 / 8,704 / 15,170 / 1,067 | 新房含开场知识，Proposal合法提交；正文仍新增无依据腰间/地面材质/感官属性，review拒绝，未发布；保留已提交库存。没有重复采样。 |

两批库存弩矢20→19、地面新增1、HP28/28、职业资源不变、虚构时间0、Pending空、Receipt1。round10成功发布后相同submission重复请求新增调用0、Receipt/机械/Delivery相同；它只证明幂等，不使错误旁白变合格。round11没有以失败旁白回滚机械，也没有调用生成第三份正文。

证据：[脱敏usage与状态](vnext-round10-live-evidence.json)、[源码差量hash清单](vnext-round10-source-manifest.json)、[成本估算](vnext-cost-estimate.md)。JSON 的 requestSha256 是规范序列化请求对象的摘要，非原始 wire 字节摘要；源码清单记录批次后定向修复收口状态，不能冒充每个先前调用的精确源码。原始请求/回复/Cookie/数据库片段仅保留本机私有 `/tmp/zhuwei-vnext-round10-*`、`round11-*`，不入库。两个批次服务均已停止。

## 恢复与剩余风险

Activity receipt owner 修复会改变补丁前某些旧 Activity 事件 replay 的 stateHash；尚无生产vNext新房，既有0.4数据仍未动。生产切换必须按授权先盘点退役旧解释范围；未来保留的 vNext 新数据只能由理解此解释语义的候选恢复，不能回滚到不识别它的旧代码。开场知识只影响新的genesis，不回填未经历开场的角色。

尚未完成：可用真实旁白、主动schema补取后的完整提交、20+双玩家连续链、A–O全场景证据；开场既知非行动问答、其他家族及到期调度等实际缺口；持久RootAction累计token/费用/重试保护；构建/部署/生产核对/旧房退役和旧路径清理。120条金标、统计合法率/延迟和长期SLO后置，仍未通过。
