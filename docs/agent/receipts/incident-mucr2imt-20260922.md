# ZW-mucr2imt：提交超时与行动回复错位

2026-09-22，用户报告线上行动失败、上一条回复出现在下一条行动下，并提供故障编号 `ZW-mucr2imt-66eb41fdc9244ae195a1efc9aee945d9`。工作分支为 `cloudflare`，起点 `f95fa59`，开始时工作区干净。本回执记录本地修复与验证，未部署或 Git push。

## 线上证据

`npm run diagnose -- --reference ZW-mucr2imt-66eb41fdc9244ae195a1efc9aee945d9 --out /tmp/zhuwei-diagnostic-20260922.json` 返回 `found`。按请求、提交与根行动的脱敏关联标识查询平台记录，确认两次请求属于同一行动。以下时间均为北京时间：

| 时间 | 证据 | 结果 |
| --- | --- | --- |
| 22:07:18–22:07:25 | `offer` 与两次 `expandedProposal` 调用 | 均为 `success`，随后选定提案 |
| 22:07:57.859 | `room.authority.commit.failed` | `authorityCommit / authorityOverloaded`，32101 ms |
| 同次提交 | Cloudflare `commit` RPC 平台事件 | `exceededWallTime`，wall 32033 ms，CPU 23675 ms |
| 22:09:04.847 | 显式恢复 | 复用原已保存提案，没有重新请求模型 |
| 22:09:35.779 | 第二次 `room.authority.commit.failed` | 同一分类，30932 ms |
| 同次提交 | Cloudflare `commit` RPC 平台事件 | `exceededWallTime`，wall 30766 ms，CPU 23201 ms |

本次有明确平台证据的失败是房间提交执行超时；没有证据表明是玩家意图错误或模型未能返回提案。截图中的旧“本次行动已取消”面板不能用于判定这次超时行动的结果。

只读 D1 SELECT 取得目标房间已发布检查点与较新的完整归档 generation；后者包含原失败提交和已保存提案响应。归档内权威历史为 20 个事件，世界状态约 201667 字符。私有世界、玩家输入及模型正文只保存在本地忽略目录，没有写入本回执或测试夹具。

## 根因与修复

1. **提交反复回放同一候选状态。** 用真实归档和原提案驱动本地 Durable Object，单次提交调用 `provisionalMechanicsReplay` 12 次，每次原本都会从 genesis 重放已提交历史和候选事件。冷态提交 5624 ms，其中该方法累计约 5158 ms。独立合成回归确认同一事件前缀最多被重复回放 7 次。增加单条、实例内的已验证候选缓存；权威头、Profile、genesis、持久化世界、候选归属或候选字节变化都会失效，返回值隔离复制。原有冲突检查、Rules replay 与事务边界保留。约束依据为 [SPEC 0011 §2](../../specs/0011-reliability-correction-observability-and-evaluation.md)及 [ADR 0026](../../adr/0026-provisional-results-and-natural-narration.md)。
2. **前后端都有回复排序错误。** 前端把 `currentDeliveryId` 的变化当作新行动的回复，延迟轮询时会得到“行动 A、行动 B、回复 A”；后端合并跨场景亲历记录时又按插入 ordinal 排序，覆盖了存储层正确的事件顺序。现在按事件序号及同序号的 ordinal 合并记录；前端仅用行动回执关联回复，用原 `submissionId` 对账本地输入，不按文本去重。后端仅为可信 Viewer 自己的已保存输入投影提交标识，因此掷骰暂停、Activity 子回执和连续相同文本都能正确对账。依据为 [SPEC 0010 §1.1、§8.3](../../specs/0010-observer-specific-presentation.md)。
3. **旧取消提示被新请求失败重新显示。** 原取消面板的 capability 恒为 `cancelled`，新本地输入移除后旧面板会回到页面。现在取消身份绑定具体行动，新的提交会抑制已被替代的旧提示；新的取消仍可显示。没有把提交超时伪装为成功。
4. **归档恢复中的 Profile 误冲突。** 还原原提交时发现 `profilesMatchContext` 用 `JSON.stringify` 比较对象，归档规范化改变键顺序就会把相同绑定误判为 `readSetConflict`。改为比较排序后的 Profile 标识及 hash 值；真正改变 hash 仍拒绝。依据为 [SPEC 0016 §5](../../specs/0016-coarse-forms-frozen-adjudication-context-and-typed-claims.md)。这是本地恢复另行发现的问题，不把它冒充线上超时的根因。

## 实际验证

- Node 定向组：`delivery-confirmation`、`send-action-recovery`、`authoritative-table`、`feasibility-readset`，45/45 通过。前端延迟回复路径修复前已失败；夹具同时核对真实 `outcome.receipt` 响应结构。覆盖相同文本连续发送、掷骰后投递、子回执、失败后旧取消提示和新取消提示。
- Worker 定向组：`provisional-reply.room.test.ts` 24/24；`authoritative-replay-cache.room.test.ts` 1/1。覆盖每个候选前缀只回放一次及调用者隔离、重启/驱逐、归档恢复、相关冲突与无关并发、随机与资源不重复、两受众原子发布、晚落库回复的实际 observe 顺序，以及真实 Room → table 投影的提交身份。其他 Viewer 不取得该客户端提交标识。
- 私有原场景：`npx vitest run --config .wrangler/incident-20260922/worker.config.ts`，1/1，通过真实归档恢复、原提案 `prepare → commit`，到达 `awaitingNarration`，提交通过临时的 2000 ms 本地检查；没有调用外部模型。
- 单次冷态对照：缓存前 5624 ms，缓存后 2099 ms，约减少 63%。后者仍高于临时 2000 ms 观察线，原失败输出保留。冷态与 prepare 后的热态分别报告，不把它们混为同一比较；正式回归以重复回放次数为确定性断言，不把本机时长当作生产 SLO。
- `npm run typecheck`：退出 0。
- `npm run gates:check`：退出 0；54 个声明的 Node/Worker 测试文件全绿，0 个失败文件；规格错误和文档断链均为 0，模块既有债务未增长，未更新任何 allowlist 或基线。命令明确未执行 3 个工具门和全项目单测，不能把此结果表述为全量发布验收。

## 边界与留存

私有归档、CPU profile、临时重放脚本和测试日志保存在 `.wrangler/incident-20260922/`，诊断 JSON 位于上述 `/tmp` 路径。临时测试已移出 `tests/`；业务源码和正式测试没有遗留诊断日志。未修改已裁定 SPEC、持久化 schema、远端资源或 Secrets，未做远端 migration、生产写入、模型探针、部署或 push。

线上超时有直接平台证据；同归档本地测量确认重复回放是主要提交耗时来源。生产降幅、较长历史房间的性能和实际多轮游玩仍需发布后的有界验证，本回执不宣称线上已经恢复稳定。
