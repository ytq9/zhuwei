# 场景物件通用状态规则：本地验证

日期：2026-10-06。分支：`cloudflare`。开始时 HEAD 为 `8b14eaaf`。实现决定见 [ADR 0125](../../adr/0125-lockable-objects-share-state-transitions.md)。本记录只记验证与交接边界。

## 已验证

- 定向 Node 组共 44 个不同用例通过：`common-actions`、`common-action-effects`、`object-completion`、`spatial-diagnostics` 与 `door-completion`。最后一个文件涵盖新地点的门、固定铜箱、自定义状态名的格栅、打开初始状态、隐藏／陈旧引用、同次行动后离开原场景、重放与更正。运行日志在 `/tmp/zhuwei-object-consumers-final.log`、`/tmp/zhuwei-object-mechanics-custom-final.log`、`/tmp/zhuwei-object-original-scene-red.log`；末项文件名为排查时命名，实际结果为通过。
- 提交前从 Git 暂存区导出不含其他会话实现的源码快照，以上 44 个 Node 用例再次全部通过，日志 `/tmp/zhuwei-object-staged-node.log`。仅对象改动的固定请求为 completeObject 8,534、worldInteraction 14,076、全选 48,810 token，相对 HEAD 分别为 +109、+52、+161；暂存区仅记录这些自身增量，共享工作区仍保留最终组合数值。
- `npx vitest run tests/kp/world/object-mechanics.room.test.ts`：1 个纵切通过。真实本地 Room 接口经过选择、填写、动态地点创建与进入、箱体补全／解锁、重试、DO 驱逐后继续打开、观察者地图与归档恢复。模型回复为脚本，未作真实 Provider 验证。日志 `/tmp/zhuwei-object-mechanics-room-2.log`。
- `npm run typecheck` 通过；`npm run spec:check` 为 0 错误；`git diff --check` 通过。
- `node tools/gate.mjs --check` 最后一次通过静态棘轮，规格引用、文档链接、模块与请求体积均无新增违规。日志 `/tmp/zhuwei-object-static-final.log`。
- 请求体积按本地保守估算器：`completeObject` 8,567 token、`worldInteraction` 14,109 token，分别较开始 HEAD 增加 142、85；全能力组合 50,317。工作区包含其他会话的战斗表单变化，组合总增量不全属于本任务。已告知用户后运行 `--accept-request-size`，没有放宽其他违规或失败基线。

## 规格门与共享工作区

`npm run gates:check` 确实运行了 Node 与 Worker 套件：102 个文件，首轮 90 个全绿、12 个有失败。本次两个新增对象规则门通过。检查期间共享目录继续有战斗与知识摘要写入；因此首轮结果不能当作最终整组绿色结果。

失败文件逐项定向复跑：

- `dynamic-locations`、`runtime-profiles`：17 个用例通过。
- `ruling-precedents`、`concealment`、`witnessed-action`、`social-plan`、`long-session-context`、`combat-mechanics`、`combat-map-claims`：122 个中 121 个通过，剩余为战斗结束后的落梁危险。
- `provisional-reply.room`、`knowledge-summary.room`、`stage3.room`：68 个通过。
- 剩余落梁拒绝定位到共享战斗代码新增的 `entityOccupiesSpace(source)`：`environment` 是危险控制来源，不具有角色占位。仅把来源占位要求限于非环境来源，保留受击生物、场景和距离校验；按 `SPEC 0012 §4.2` 标注。落梁、正常近战距离与目标冻结 3 个直接用例随后全部通过。

日志：`/tmp/zhuwei-object-spec-gates.log`、`/tmp/zhuwei-object-gate-diagnosis.log`、`/tmp/zhuwei-object-gate-followup-node.log`、`/tmp/zhuwei-object-gate-followup-worker.log`、`/tmp/zhuwei-object-hazard-regression.log`。没有再次整组运行规格门，没有登记新红门。不能把本记录写成“最终同一源码的全规格门一次通过”。

## 尚未接入与交接

- 库存实物的状态机制补全等待用户确认 `SPEC 0016 §7.2` 的范围扩展；当前生产入口只接场景地图对象。尚未修改该已裁定条款。
- 未接入的库存草稿保存在 `/tmp/zhuwei-portable-lock-pending-spec-before.json` 与 `/tmp/zhuwei-portable-lock-pending-spec.patch`。它们不是已验证实现，不能整体覆盖当前文件：之后同目录还有其他会话改动。若获批准，按当前源码重新合成并验证物品身份、转交、投影、恢复及秘密边界。
- 其他会话的战斗、知识摘要与相关 ADR 保留；本轮仅另外修正上述已复现的危险来源占位判断。对象规则单独提交；落梁来源占位这一行修复留给战斗会话与它的相关修改一起提交。两边共享的 runtime／事件版本号和最终组合验证由战斗会话收尾。
- 没有真实模型调用、部署、远端迁移或 Git push。此前真实剧本探针预算与 NPC 接续额外调用的问题不在本次确认范围。
