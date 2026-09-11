---
kind: part
part_of: "0015"
title: "SPEC 0015 分册：D1、发布证据与版本边界"
clauses: "14-19"
---
# SPEC 0015 分册：D1、发布证据与版本边界

本文件是 [SPEC 0015](./0015-private-form-context-rag-and-narration.md) 的 §14–§19，条款编号与拆分前一致。规格的状态、取代关系与验收门记在主文件的 frontmatter。

## 14. D1、migration 与派生语料闭环

如静态语料/FTS 需要 D1 schema 变化，`db/schema.ts` 是唯一 schema 源；运行 `npm run db:generate` 后逐行审查只增不改的新 migration。已生成 migration 禁止修改。必须先在全新和已迁移本地 D1 各完成 migration，并通过最小“编译静态语料 → 写入 → FTS/别名查询 → sourceRef/hash 重读 → 删除索引 → 从权威语料重建”的闭环。

远端 migration 只在用户授权的发布串行阶段应用于现有 D1，并先核对目标 database/binding、待应用清单与备份/恢复边界；不得创建新 D1。若实现不需要 schema 变化，执行日志必须明确记录“不需要 migration”，不能生成空 migration。

D1 FTS、别名表、实验结果和静态 chunk 可重建且不持有活跃 Room 状态。临时语料、测试用户、房间和实验数据必须带唯一前缀/清单，由创建者在证明不是真实用户数据后走既有精确清理路径；禁止广泛删除。

当前实现已生成 `0008` 静态 corpus/FTS 与房间 workflow 绑定、`0009` corpus/profile/hash 加固、`0010` 三张可重建派生索引表的一次性逻辑 scrub，以及 `0011` `authoritative_room_archive_checkpoint`。`0010` 不修改权威 Room、身份或归档 schema/data，也不宣称物理擦除 SQLite 空闲页或历史恢复点；`0011` 只增加按 `(room_id, runtime_epoch_id)` 定位的灾备 checkpoint，不把 D1 变成活跃状态权威。

归档只有在 `internalContinuations` 与 `combatRuntime.randomnessResolutions` 都已结清时才可取快照。分页每批最多 40 条并为最终 checkpoint 预留一条；只有完整 event prefix 与 head projection-audit 集合都已物化时，checkpoint 才在同一最终 batch 单调推进。旧 checkpoint 必须同时通过 event/state hash、active branch 与权威 prefix replay；伪造 audit cursor、缺行、回退或同序冲突均 fail closed。灾备读取只接受精确 room/epoch locator，忽略 checkpoint 之后的行，重放并校验 genesis/event/state/branch/audit 后，才可由 service-only disaster-recovery capability 恢复空的 Room DO；恢复只从活跃 member/control 重建派生权限索引，不把历史已撤权实体重新授权。

`npm run db:generate` 已生成并逐行审查 `0011_low_leo.sql`（SHA-256 `da8aa71c0ac9e909b890d02536c7eb6cc555e1c9b0fdb29808fcf77903863a8e`）。隔离 Wrangler local D1 已顺序应用 `0000–0011` 并完成 checkpoint 写入/读取；独立 SQLite 已验证 `0000–0010 → 0011` 升级写读。静态 corpus 的 fresh/upgrade/MATCH/权威重读/清除/重建仍由原定向套件覆盖；archive D1 分页/伪造游标/前缀篡改、checkpoint ahead event/genesis conflict 防线 11/11、80+ 事件和 48 个 projection audits 的 D1 reader→fresh DO restore 1/1，以及无当前受控 viewer 的 D1→fresh DO 1/1 均通过。发布阶段已在既有远端 `DB` 串行应用 `0008–0011`，全部成功并复核无 pending；`0011` 临时 checkpoint 写入、读取和精确删除闭环后相关计数为 0，没有创建新 D1。

## 15. 浏览器、发布与远端证据

### 15.1 定向与完整验证

实现阶段先跑相关 Form/Context/RAG/Room/Rules/Environment/Narration/telemetry 定向测试。正式部署的最终冻结 SHA 必须依次通过仓库发布合同去重后的门；production build 只能由最后的 `npm run cf:deploy` 执行一次：

```text
git diff --check
npm run module:check
npm run typecheck
npm run lint
npm run test:unit
npm run test:worker
npm run cf:deploy  # 唯一一次 production build，并部署已授权的现有 Worker
```

本轮用户随后明确裁定改动较小，只运行实际需要的定向检查并豁免完整门；因此 `module:check`、全量 unit/Worker、全量 Lint 等没有在最终源码上统一重跑，不能写成通过。该事实是本次执行范围例外，不修改上面的长期发布合同。

真实浏览器必须在 375px 与 1440px 各完成观察、NPC 对话、Proposal 失败、Narration 重试和动态环境入口五条路径；要求无横向溢出、console error、秘密 DOM/ARIA/网络旁路，且已提交行动在 Narration 失败时保持可见、不被重复结算。

实际已部署前端壳在 375×812 与 1440×900 各完成上述五条路径的前端视觉/DOM 验收，共 10/10。五条路径的页面数据均由公开 DTO 注入；其中本规格明示允许的 Proposal 失败、Narration 重试与动态环境三路使用确定性故障/动态注入，额外 Provider action 为 0。两档 document/body 宽度均等于 viewport、可见元素无横向越界，console/page error、失败请求和秘密 canary 的 DOM/ARIA/URL/网络正文命中均为 0。Proposal 失败保留草稿且不产生 committed bubble；Narration 失败后已提交行动只保留一条，重试没有重复 settlement；动态入口只提交自然语言与稳定 submission id，并展示 KP 自定义 `state-only` 与 `area-hazard` 内容，不含吊灯专项。该结果只证明已部署前端的视觉/DOM 边界，不声称五路浏览器流程穿过真实 `/api/game`/auth/Room/Provider；这些真实接缝只由下述独立三交互 smoke 提供。语音/TTS 和 SPEC 0014 的完整战术地图纵切仍未覆盖。

### 15.2 串行发布顺序

1. 冻结交付 SHA，确认工作树、`cloudflare` 分支、Profile/hash、迁移状态和所有门；记录远端 `main` 初始 SHA。
2. 若有 migration，先完成本地闭环，再在明确目标上应用现有远端 D1 migration 并证明无 pending。
3. 用现有 `npm run cf:deploy` 部署现有 Worker `zhuwei`；不得创建新 Worker、D1、DO、KV、R2、Queue、Workflow 或未经授权的 Vectorize。
4. 对部署版本执行有界线上 HTTP、认证、建房、三次普通生产 KP 交互和权威状态读取冒烟，并核对脱敏日志；Proposal 失败、Narration 重试和动态环境输入的浏览器路径可使用确定性网络故障/公开 DTO 注入，不得借浏览器 QA 增加第四次 Provider 行动。
5. 按精确清单清理本次临时账号、房间和实验数据，不删除真实用户数据；清理失败必须阻塞发布完成声明。
6. 仅以非 force 显式 refspec 推送 `HEAD:refs/heads/cloudflare`，证明远端 `cloudflare` 等于交付 SHA，且远端 `main` 等于任务开始记录值。

部署、远端 migration、线上冒烟、清理和 Git push 必须串行，不能由隔离 Worker 并发执行。部署保护必须绑定交付 SHA、SPEC/Profile/hash、既有 bindings 与环境；分支不净、SHA/Profile 不匹配、迁移不明确或全量门缺证时 fail closed。

本轮线上冒烟的精确上限为三次计数交互；它只验证部署后的真实 HTTP/auth/Room/Provider 接缝、公开状态与清理，不应用 §13.2 的完整质量阈值。默认 31 轮 runner 仍保留给用户自行运行，但本代理不得在本次发布中调用或宣称其通过。

发布源码 `4822d2b62d40d922758e77762f378495398958f8` 已通过唯一一次实际 build/deploy 更新既有 Worker `zhuwei`；Version `97291f34-67cf-47a4-a9f6-899db6ee975a` / deployment `834c2b79-c24f-4d7c-9aca-ef523b4e7eea` 承接 100% 流量。唯一一次 `node tools/run-live-kp-eval.mjs --interactions=3` 实际完成 3/3 真实 HTTP/auth/Room/Provider 交互并得到 `liveModelVerified=true`；原命令因旧 evaluator 把合法 compact V3 receipt 误判为第二权威而退出 1。修复该纯评测器判断的 `9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 已通过定向检查，但为遵守三交互上限没有重跑生产 Provider，所以原命令不能记为绿色，完整线上指标仍未测。临时房间、会话和账号均已精确清理；15 秒 exact-version error Tail 为 0，历史 Observability 查询因权限返回 403，故没有完整历史日志证据。功能源码与 evaluator 提交 `9cc5e3cd97143ac1f6ad2e26513a91e82e617f3e` 已非 force 进入 `origin/cloudflare` 提交历史，复核时远端 `main` 保持 `29eb06dc009c983ad61b2d862454503e67a7f40a`；其后只追加 docs-only 发布事实。

## 16. 新房、版本与迁移边界

本规格的 Form Catalog、Action Language、Context Pack、corpus/retrieval、Model Registry、Narration schema、publication protocol、Environment state graph 和相关 compiler 全部进入房间完整 runtime manifest。创建新房时固定精确 ID/hash，不接受 `latest`。

0.4 当前只注册完整 `runtime-srd51-2014-authoritative-environment-v5`，并精确绑定 `authoritative-kp-private-form-narrow-tools-workflow-v2`、本规格的 private Form catalog、V5 NPC/物品/环境闭包与独立 Body-only Delivery。具体 runtime、event、module、Proposal protocol 和 workflow hash 以 `SPEC 0013` §2.1 的当前闭包为准；任一 ID/hash、planner、model profile 或 module 不一致都在模型调用前 fail closed。

历史 environment-v2/v3/v4、旧 `authoritative-kp-action-plan-v1`、旧 Outcome/Delivery Adapter 和旧房状态只保留文档/Git 审计意义，不进入 0.4 Registry 或回放。不得从旧 Prompt、Delivery、聊天、抽象距离或 D1 数据猜测当前 Form/Context/Environment 状态。未来若需要兼容或迁移，必须另写规格并取得用户授权，不能预留自动 fallback。

## 17. 对下位规格的窄 supersede

本规格不修改 `SPEC 0001`，也不整篇替代既有规格。仅以下冲突条款对启用本规格的新 V3 房间由本规格取代：

2026-09-09 批准的故事准备作业是 §6.1 的独立有界例外；下表的普通 Proposal 1+1 不用于限制故事初稿/审查，也不能被故事额度绕过。两类工作流保持同源总计量和各自冻结语义。

| 原规格 | 被窄取代的条款 | 新裁定 | 未改变部分 |
| --- | --- | --- | --- |
| `SPEC 0003` §§2.2、11–12 | 单一 `RoomActionOutcome.kind` 同时表达行动与交付结果 | 公开结果分别携带 §8 的 action/narration 状态；不再以顶层 `ok` 或六种 kind 混合提交与叙述 | Room Action 仍只接收认证输入；`step/project/replay`、prepare/commit、随机、Receipt、scope 与更正不变 |
| `SPEC 0003` §6、场景 5 | 默认最多两次自动修订 | 一次首 Proposal + 最多一次窄修订；耗尽后无第三次完整 Prompt | Rules 诊断、未提交稳定点和 `needsKp` 语义不变 |
| `SPEC 0010` §§8、10–12 | 当前帧发布未区分逐受众 Narration 状态，且未固定模型 body-only schema | §7–8 的 `{body}`、服务器派生元数据、逐受众独立状态/重试优先 | Audience 提交冻结、projector、ViewerKey 亲历、ACK/覆盖、秘密与语音同正文边界不变 |
| `SPEC 0011` §§1、3–5、8–10 | 1+2 修订预算、旧模型调用/日志与笼统故障分类 | §6 的 1+1、§9–10 角色化 Profile/实验门、§12 精确错误和更窄日志、§13 新指标 | 恢复、更正、D1 archive、无隐藏主 KP 切换和既有 31 轮硬门不变 |
| `SPEC 0014` §§2–5、9、11–12 | 通用环境有限状态和破坏/区域验收 | §11 增补五类版本化机械结构、`environmental-stunt.v1`、显式效果模式与不绑定具体物件的通用动态纵切；后续用户裁定取消吊灯专项完成门 | Geometry/Tactical Projection/preview、客户端不提交 targets 与地图 Adapter 边界不变；前 0.4 房间按当前退役裁定拒绝 |

若本表之外出现解释差异，优先保持 `SPEC 0001`、单一 Room/Rules/DO 权威和秘密边界；不能用本规格扩大模型、页面、D1 或辅助模型权限。

## 18. 实现映射与当前证据状态

本节为非规范附录，已移至 [SPEC 0015 附录](./0015-appendix-implementation-map.md#18)。

## 19. 固定不变量

1. `SPEC 0001` 始终最高；KP 权威不因小表/RAG/辅助模型缩小。
2. 玩家永远只提交自然语言与封闭待决回答；内部 Form/RAG/primitive 不成为 UI 命令语言。
3. RequiredContext 不可由 Planner/RAG 删除，动态房间状态永不进入静态索引。
4. 检索命中只是 ref；使用前必须按 source/profile/hash/权限重读权威原文。
5. 每 RootAction 最多一次首 Proposal 和一次窄修订；骰后不改判。
6. `CausalActionProgram` 不拥有状态、随机、事件、权限或投影。
7. Narration 模型只输出 `{body}`；所有元数据由服务端派生。
8. 已提交行动不因任何受众 Narration 失败而回滚、重提案、重掷或重复消耗。
9. Audience 与逐受众发布键在提交时冻结；一个受众失败不影响另一个。
10. 辅助模型只建议检索/结构，不决定 KP、Rules 或 Audience 权限；失败不自动换主 KP。
11. 环境使用 KP 自定义的版本化有限状态，不是对象目录或通用物理；机械模式只能由 KP 显式选择，名称、关键词和对象族不得触发派发。
12. `state-only` 不得伪造 Hazard/Area/区域 save/区域目标 damage；`area-hazard` 的实际区域集合只由 Rules 从完整 Geometry 计算。
13. 新协议只进入 0.4 V3 房间；前 0.4 房间与旧 `environment-feature-fsm-2014-v2` 已退役，不猜测迁移、不注册旧解释器，也不按当前代码回放。
