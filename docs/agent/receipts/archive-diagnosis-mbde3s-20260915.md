# MBDE3S 归档高耗时与失败排查

2026-09-15，`cloudflare`，在已有未提交工作区上排查。只读现有 Worker/D1，未部署、未执行远端写入、未发送玩家行动或模型调用。本轮源码改动仅补充归档失败的脱敏诊断及相应测试，没有修复或绕过归档兼容校验。

## 已取得的证据

上一轮 00:32 的实时采样已按房间 hash 对应到 MBDE3S：一次归档 alarm 平台 wall time 24,522 ms、CPU 18,214 ms，最后 `room.archive.failed`。应用统一错误分类没有保留失败阶段。D1 检查点仍为 2026-09-14 23:09:53.435（北京时间），事件序号 18、故事代次 114。

本轮两次有界 D1 SELECT 读取该房间的分片元数据与唯一完整归档，均写入 0 行。归档内容 hash 为 `sha256:00a217b21a47f64282f87f957219c05334ef449a5fdc1129c264cde9be6d8afb`：109/109 分片、6,423,669 UTF-8 bytes、18 个世界事件、15 个 host binding、33 个模型调用记录。每片哈希和顺序全部通过，世界归档校验通过；没有把模型请求正文或秘密写入本回执。

控制面读取确认当时线上仍为 `65ce7151-8b30-4f5a-938e-a33a20099f90`，冻结源码 `fd9788ef5e95007ba1090ebdde1cf724c67fae7b`。诊断使用其本地冻结源码，而非正在被其他工作修改的运行时。发布关联见[凌晨恢复发布回执](../releases/narration-recovery-hotfix-20260915.md)。

## 确定复现的兼容缺陷

当前线上源码逐项校验上述归档时，15 个 host binding 中有 6 个旁白 binding 被拒绝。完整包校验返回 `STORY_ARCHIVE_HOST_BINDING_INVALID`。部分单条旁白校验在本机 Node 中需要约 1.8–1.9 秒，完整包遇到首个失败后约 4.5 秒返回；这些不是生产性能分位数。

最小复现命令是本机临时脚本 `npx tsx .wrangler/diagnostics/archive-mbde3s-20260915/minimal-repro.mjs`：原始 binding 1 通过分片、权威世界和受众校验后，在 `validateNarration` 比较已保存 provider request 与当前代码重建请求处失败，`false !== true`，约 1.94 秒。

对同一条未修改的归档记录：

| 对照 | 结果 |
| --- | --- |
| 22:46 发布的原始源码 | 通过，约 1.92 秒 |
| 00:07 发布的当前源码 | 拒绝，约 1.93 秒 |
| 当前源码，仅还原材料分类的一个条件 | 通过 |

单变量对照仅在临时副本将 `isSettlementOnly(claim) && !narrated.has(claimIndex)` 还原为 `isSettlementOnly(claim)`。binding 1 和 binding 6 从拒绝变为通过，正常 binding 0 在两侧均通过。实际运行 `one-change-control.mjs`，退出 0。

这证明[多人旁白材料修复](multiplayer-observer-narration-20260914.md)改变了旧记录重建时的 `evidenceRole`，而[归档 host 校验](../../../app/_runtime/lib/room/story-archive-host.ts)仍要求当前重建请求与历史请求完全一致。两者共用相同现役 workflow 绑定，尚无对应的历史请求解释路径。修复方向应保留旧物理调用及冻结材料的准确解释，并保持新旁白修复；不能删除请求验证、改写历史请求或重采样。

## 因果边界

上述是确定的归档兼容缺陷，不能直接宣布它是所有线上 alarm 失败的唯一原因。23:23 已有归档失败，而多人旁白修复于 23:39 部署，最早失败早于该变更。当前活跃 DO 还会复用已验证 binding 的证明；仅凭 D1 的旧包不能确定当前 alarm 具体重验了哪条记录。

代码证明归档页会回放世界、重算哈希并验证冻结调用；失败后按既有策略重试。高 CPU 采样与这个路径一致，但没有捕获该次慢回复与失败归档的完整因果链，也没有取得当前活跃 DO 的完整私有状态。历史 telemetry API 返回 403；没有尝试扩大权限。

## 本轮准备的最小诊断改动

- [Room DO](../../../app/_runtime/lib/room/durable-object.ts)：在既有 `room.archive.failed` 记录中传递失败阶段，不新增重试、模型调用或归档写入。
- [日志序列化](../../../app/_runtime/lib/room/telemetry.ts)：仅在归档失败时输出 `archiveFailureStage`、`archiveFailureCode`。阶段限定为四个固定值；错误限定为五个现有 `STORY_ARCHIVE_*` 码，其余只写 `unclassified`。不记录异常正文、堆栈、Prompt 或原始模型响应。
- [日志测试](../../../tests/platform/telemetry/structured-telemetry.test.mjs)验证准确匹配、带秘密后缀拒绝、未知错误脱敏、非法阶段与非归档错误不输出这些字段。
- [Room 测试](../../../tests/platform/recovery/archive-do-resume.room.test.ts)从真实归档失败日志验证两个失败阶段，同时验证原退避、对象重启和恢复后 D1 检查点发布。

依据 SPEC 0011 §§1、5、6；没有修改 SPEC、检查基线或已有行为断言。

## 实际验证与下一步

- 新日志测试先红：预期 `buildEnvelope`，实际 `undefined`。
- `npx tsx --test tests/platform/telemetry/structured-telemetry.test.mjs`：9/10 通过。剩余 `party narration emits its own redacted model invocation receipt` 在查找旧源码字符串 `const narration = createAuthoritativeKpAdapter` 时失败；原冻结发布的 `room/server.ts` 已使用 `createRoomKpAdapter`，本轮未修改该文件或该断言，未把此项算作通过。
- `npx vitest run tests/platform/recovery/archive-do-resume.room.test.ts -t 'backs off'`：3/3 通过，其余 8 项未运行。
- `npm run typecheck`：退出 0。
- `git diff --check`：退出 0。

未运行全量测试、build、部署、Git push 或真实模型探针。原始私有 D1 导出和临时插桩副本在排查结束时删除，仅保留脱敏结果。需要用户明确授权将诊断改动部署到现有 Worker `zhuwei`，然后做一次最多 55 秒的只读日志采样；无事件时报告证据缺口，不重发玩家行动。
