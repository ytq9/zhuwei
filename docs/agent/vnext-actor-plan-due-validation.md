# 既有 NPC 计划到期：实现与验证

2026-09-07。能力合同：已由 Rules 保存的 ActorPlan，在已提交的虚构时间或 NPC 已有知识触发条件满足后，通过同一 due 队列建立独立 child root，冻结 NPC 自身知识，调用模型一次，沿现役 Rules/Room 结算并按 Viewer 发布。查询已有知识不会发动世界行动。本切片不包含模型创建新计划的入口。

原路径提前选择到期计划，将 NPC 限知投影送入要求 KP 空间材料的 vNext context bridge；普通到期队列又排除了 ActorPlan。旧决定调用缺少独立 root 的持久请求/响应，生命周期、检定和资源结果缺少完整 Claims 映射。

本次复用 Rules eligibility/resolveDueActorPlan 和当前 due Activity 队列，原因提交与入队同事务。内部 submission 不借玩家身份，沿 authority_vnext_invocations 保存原始请求和响应。服务器用 RPC capability 转发同一请求的模型绑定，NPC、玩家提案、旁白与审核共用一次 HTTP 的计数和私密捕获；旁白恢复用同一个 helper 创建新 scope。alarm 没有 transport 时只保留义务。

模型填写从原 ActorPlan schema/validator 转换，只接收一个正确工具和原始 arguments 字符串，复用唯一成员 JSON parser。重复成员、纯文本回退、错误工具和多个调用拒绝，无第二套裁决或新增玩家提案预算。

支持未发送请求、明确未发送的预算拒绝、已保存响应、两个随机检查点及 Viewer 旁白恢复。最多一次物理决定调用、零 correction；已发送但响应未知时拒绝重发，原请求/绑定/语义前提改变时拒绝继续。只从模型语义输入排除会被 KnowledgeReviewed 改变的 eventHeadId 控制游标，原请求完整保存。Provider45秒、Room50秒、lease60秒；不重掷或重复扣资源。公开 trace 只来自已提交 description，计划目标、理由、前提与私有生命周期不公开。

20文件逐项核对复制基线后串行集成，0冲突，原文件已备份。[集成清单](vnext-actor-plan-due-integration.json)包含原/新 SHA；manifest SHA `4c20a73d3a5e5e0816c0733591b0799dec9b67bf39581e26e1e5c7901673c848`。直接消费者为 Rules due/ActorPlan/Claims/事件/投影、Room提交/恢复/telemetry/server、KP strict决定/workflow和共享调用scope，玩家parser v27保持。

主树定向证据：

- `npx tsx --test tests/actor-plan-kp-boundary-v3.test.mjs tests/kp-vnext-actor-plan-due-claims.test.mjs tests/kp-vnext-model-call-scope.test.mjs`：21/21、exit0，`/tmp/zhuwei-actor-plan-integrated-node.log`。
- 新NPC12项与普通到期移动1项：13通过、38跳过、exit0，`/tmp/zhuwei-actor-plan-integrated-worker.log`；覆盖执行/延期/知识隔离/原响应/随机资源/请求损坏/未发与已发未知/limit1与limit5。模拟丢失Provider响应出现一条预期的脱敏RPC错误日志。
- 首过滤器行首限定漏选嵌套旧消费者，随后只运行 `tests/kp-vnext-provider-room.test.ts -t 'settles an uncontrolled NPC|recovers each frozen Viewer root|settles three due rests'`：3通过、35跳过、exit0，`/tmp/zhuwei-actor-plan-integrated-consumers.log`，未重复新矩阵。
- `npm run typecheck`、`git diff --check`：exit0，类型日志 `/tmp/zhuwei-actor-plan-integrated-types.log`。

以上为受控模型 binding，不是真实 DeepSeek 成功。下一批走正常登录/HTTP，仅未来计划为本地可信 Rules fixture，不称真实创建计划；每请求5次，批次20次/20分钟/¥5，最多一次实际Viewer旁白恢复，保留全部失败。

未覆盖新计划创作入口、longSpellcasting、未结任务归档、长期稳定性及双人20+链。未知响应当前没有重新决策授权动作。Goal未完成；未commit、部署、push、migration或修改已批准SPEC。
