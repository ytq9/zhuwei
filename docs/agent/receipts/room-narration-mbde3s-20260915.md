# MBDE3S 旁白处理中无法结束：本地修复回执

日期：2026-09-14 至 2026-09-15（北京时间）。工作分支 `cloudflare`，基于已有未提交工作树。未部署、未 push、未修改远端房间数据，未发起真实模型调用。

## 现象与根因证据

用户反馈 MBDE3S 显示“KP 正在处理桌上的行动”超过二十分钟，刷新仍一样；Chrome 无障碍状态也读到这一提示。该提示在刷新后由 Room 返回的 `narrationRecovery.state = pending` 驱动。

本地用真实 Room、行动提交与旁白编排模拟“旁白发布中断，失败状态 RPC 也断开”。对象重启、时间推进二十分钟后，旧实现仍返回 `pending`。首次运行命令：

```sh
npx vitest run tests/kp/narration/interrupted-publication.room.test.ts
```

失败差异为预期 `retryableFailure / NARRATION_PUBLICATION_FAILED`，实际 `pending`，1/1 失败，约 3 秒。

**已证实的代码根因**：受众发布记录持久化 pending，却没有过期依据；失败回写丢失后，观察接口无限沿用该状态。此前恢复还直接递增 delivery generation，无法保留原叙述及物理调用身份。

**线上推断的边界**：已复现与页面相同的永久等待路径，但没有取得该次线上请求完整调用记录，不能断言这次中断发生于生成、审核还是发布。之前投影断开与归档高耗时的只读证据见[投影回执](room-projection-mbde3s-20260914.md)，没有把相关性升级为因果结论。本轮额外 tail 没有取得有效事件；已删除空的原始捕获和 stderr 文件。

## 修复范围

- [Authority Store](../../../app/_runtime/lib/room/authority-store.ts)：为受众记录增加可空 `publication_lease_until` 和 `publication_attempt`。首次排队与发布尝试获得两分钟期限（两次原有 45 秒模型阶段加编排余量）；观察不续期。
- [Room DO](../../../app/_runtime/lib/room/durable-object.ts)：vNext 观察把过期 pending 分类为明确的可恢复发布失败；已有失败界面因此可以显示“重试 KP 回复”。仍在有效期限内的发布拒绝并发接管。恢复保留原 Receipt、Viewer、Claims、冻结上下文和 delivery generation，用独立私有尝试编号拒绝旧请求的调用、失败与发布写回。
- [行动编排](../../../app/_runtime/lib/room/action.ts)和[旁白调用适配](../../../app/_runtime/lib/room/story-narration.ts)：传递 Room 派生的私有尝试编号；实际模型请求和调用账本身份保持不变。已存生成/审核响应直接复用；已发出但响应未知的调用仍禁止重新采样。

DO schema 的事实源是 `AuthoritativeRoomStore.ensureSchema()`，这里没有 Drizzle 生成器或 D1 migration。按已有方式添加两条可空 INTEGER 列；已有记录保留原数据，无期限证明时显示可恢复失败。测试在已有 Room 中移除新列，再销毁并重建对象，实际运行增列和后续恢复写入—读取闭环。没有运行远端 migration。

依据：SPEC 0011 §2、SPEC 0015 §§8.1–8.3、SPEC 0016 §7.2；未修改已裁定产品规则。

## 实际验证

```sh
npx vitest run tests/kp/narration/interrupted-publication.room.test.ts tests/kp/narration/multiplayer-publication.room.test.ts
npm run typecheck
git diff --check
```

- 定向 Worker 测试 **8/8** 通过，约 8 秒：未开始发布、模型调用前、生成保存后、审核保存后、响应未知、已有 schema 升级、迟到物理响应及正常多人旁白。
- 恢复成功的中断样例最终总计两次模型调用（全部为本地脚本响应），直接复用已存响应；未知结果重复恢复仍只调用一次且保持明确失败。
- 验证二十分钟重连不再 pending、原世界事件逐项不变、delivery generation 不变、其他主体无权恢复、有效发布不能被并发接管、旧尝试不能改写恢复结果、再次重连保留已发布文本。
- 迟到响应样例在两分钟期限刚结束时续接，通过原 invocation 保存并完成审核。探索时推进二十分钟会超过现有来源累计延迟预算而拒绝后续审核；这不修改预算，也不把二十分钟仍在物理调用中的异常解释为可无条件恢复。
- 类型检查退出 0；diff 空白检查退出 0；本回执的相对文件链接逐项核对。

## 未覆盖与上线状态

未运行全量测试、production build、真实模型探针或部署。前一轮桌面投影保留修复仍在同一工作区，证据保留在前一份回执。

线上 MBDE3S 尚未应用本修复。部署后，保存完整模型响应的任务可以在原代次恢复；若线上物理调用结果确实未知，仍需原调用结果或进一步定位，不能通过重复采样伪造恢复。首次投影断开的平台/RPC 触发原因尚未证实。
