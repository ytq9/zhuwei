# 同场观察行动旁白未显示：2026-09-14

范围：线上 MBDE3S 的同场行动结果不可见。仅在 `cloudflare` 工作区修复；未修改线上数据、执行 migration、部署或 push。用户随后确认“投影暂不可用”已恢复，该暂态错误未被本次修复归因为同一故障。

## 根因与证据

只读查询该房间的 D1 事件归档与故事调用归档，未调用真实模型。18 个已归档事件可以用当前 vNext Rules 精确重放；两名玩家同在 `wake`，彼此可见，行动完成时旁观者的 Claims 中已有 `mechanicalOutcome / observe`。这排除了该事件范围的受众投影遗漏。

归档中，一名旁观者只有一项观察完成结果，材料同时将其列为 `required=true` 并标记 `evidenceRole=stepSettlement`；共享生成/审核指引又禁止把这个角色的材料作为正文义务。其首发和随后三次恢复审核均拒绝，出现 `RESULT_OMITTED` / `RESULT_CHANGED`；最后一次恢复审核通过。四次拒绝足以证明该场景的材料合同存在冲突，不能证明房间中所有未显示内容均由此引起。事件范围中没有 NPC 对话事件，知识回顾和私人发现也不应广播。

完整私有归档与调用响应仅用于本机临时诊断，没有写入仓库、普通日志或玩家响应。实时 tail 没有建立连接，历史日志 API 返回 403；没有把它们当成成功取证。

## 修复

[旁白材料](../../../app/_runtime/lib/kp/narration-vnext.ts) 仅对已经由具体结果替代、没有正文覆盖义务的步骤保留 `stepSettlement`。旁观者唯一可见的结果继续可叙述，按既有材料权限只能表达已授权人物、目标及完成状态，不能补造其私有发现、推断、回答或观察完整度。生成与审核使用同一份材料。依据 SPEC 0010 §1.1 与 SPEC 0016 §8.3。

保留工作区既有的非思考、严格工具旁白改动；本次没有改变 Rules、受众资格、持久化结构、发布权限或模型调用次数。

## 验证

- `npx tsx --test tests/kp/narration/presentation.test.mjs`：修复前 2 通过、1 失败，明确捕获 required 结果同时标记 `stepSettlement`；修复后 3/3 通过。
- `npx tsx --test tests/kp/narration/generation.test.mjs tests/kp/narration/review.test.mjs`：24/24 通过，仍拒绝泄密、虚构事实、结果改变和无效审核。
- `npx vitest run tests/kp/narration/multiplayer-publication.room.test.ts`：1/1 通过，实际 Room → Claims → 生成/审核材料 → 调用 journal → 发布 → 亲历记录；同场两人各获专属结果，异场者无记录，私有输入/发现不泄露，ACK 与 DO 重启后仍保留记录。模型响应使用确定性夹具，不是实测模型质量。
- 初始选择的 `observer-delivery.room.test.ts` 两项用例在 commit 返回 `rejected`，未进入此次现役 vNext 旁白链路；没有修改这些用例或将其计为通过。
- `git diff --check` 通过。未运行全量测试、构建或线上模型复测；未承诺自动补取过去未成功发布的正文。

部署准备时撤回非必要的 Prompt 补充及 v18 升版，仅保留材料分类的实现修复；现有 v17 Prompt、协议与工作流绑定保持不变，以保护当前测试房间。部署操作另记发布回执。
