# ZW-mu3qdzkw 提案恢复修复验收

- 日期：2026-09-16；分支：`cloudflare`。
- 范围：用户要求保证恢复机制正常。本回执承接[原始故障定位](incident-mu3qdzkw-origin-20260916.md)，不修改此前诊断回执。
- 决定：[ADR 0025](../../adr/0025-explicit-proposal-invocation-recovery.md)、SPEC 0016 §7.2、SPEC 0011 §2–3。

恢复从页面显式点击进入原行动和 Room 私有调用账本。Room 在原调用未知、玩家仍有控制权、方案未冻结及预算可用时，允许原来源根行动一次替补；已完成阶段照常复用。原调用不删除，未知用量不释放；替补准入与原调用失去裁定资格原子保存，晚到响应仅补记旧调用证据。并发点击不增加派发，替补再次失败返回不可恢复状态，页面保留输入与故障信息并移除无效按钮。客户端恢复标志不改变提交缓存身份。

保持原模型、Prompt、45 秒时限、工作流哈希和预算策略。使用既有 SQLite 表；含替补关联的提案归档使用 v2 宿主格式，既有 v1 仍可读取，归档隔离保持。未增加依赖、SQL schema 或 migration。

## 直接验证

1. 修复前，真实本地 Room 的首轮、填写和修订三个回归样例均失败于 `STORY_INVOCATION_UNKNOWN`，不能完成原行动。
2. `npx vitest run tests/kp/provider/provider.room.test.ts tests/kp/stories/story-external-invocation-journal.room.test.ts -t 'explicit|ambiguous 429|frozen repair proof|rejects concurrent duplicate starts|started and unknown|only proven notSent'`：16 项通过。包括三阶段恢复、旧响应先到与后到、过期派发、驱逐、原请求复用、并发重复、权限/冻结/作用域拒绝、跨阶段同来源次数上限、预算保留、归档隔离和恢复后归档往返。最终终止分类调整后，`stops explicit proposal recovery` 再次通过，断言结果为明确 `rejected`。
3. `npx tsx --test tests/platform/recovery/send-action-recovery.test.mjs tests/platform/telemetry/game-diagnostics.test.mjs tests/platform/telemetry/failure-diagnostics.test.mjs`：19 项通过，涵盖实际 React 按钮、原意图与提交身份、次数耗尽、重挂载、断连缓存及脱敏诊断。
4. `npx tsx --test tests/platform/recovery/story-archive-host.test.mjs`：9 项通过，验证既有提案、旁白、NPC、故事准备和私有宿主归档语义。
5. 最终 `npm run typecheck`、`git diff --check` 通过；`npm run spec:check` 为 0 错误、8 警告（篇幅与已有 stale gate）。新增 SPEC/ADR 相对链接全部存在。

## 既有失败与停止边界

对上述两个 Worker 测试文件完整运行得到 55 通过、12 失败。将本次改动前保存的源码和原测试复制到独立本地诊断目录，重跑这 12 项，全部复现同名失败；新增失败集合为空。未改断言掩盖这些失败，也未把有既有失败的整份 Provider 文件登记为新规格门。失败涉及：冻结澄清检定的中断点、冻结攻击、过期选项取消、控制权恢复、无骰到期提交、安全暂停、其他玩家待决骰、逐 Viewer 到期旁白、多个休息结算、观察/反思、休息按钮和 Item/Ability 夹具。它们不在本次未知提案替补的直接因果范围内。

全仓文档链接检查另报 6 处对已删除 `handoff.md` 的引用；该文件在本次开始前已处于删除状态。未修改这批引用或检查基线。源码与差分对照、完整命令输出保留在本地忽略目录 `.wrangler/incident-mu3qdzkw/`。

本次没有模型实付探针、远端数据修改、部署、push 或完整项目回归。线上 A48CY8 尚未应用该修复；部署后仍须由 Room 按当时控制权、作用域、预算及冻结状态判定能否恢复。修复保证有界恢复与明确停止，不保证 Provider 在两次尝试内完成。
