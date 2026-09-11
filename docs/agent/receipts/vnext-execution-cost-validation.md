# 共享额外执行成本与冻结检定身份

日期：2026-09-06。分支 cloudflare，基线 258caee404e0814405eb497653ee9f00d647b773；保留 314 项继承未提交改动。此增量服务于完整 vNext Goal，高风险/Activity 的模型接线仍待。

## 能力与根因

原子计划的 `executionCosts` 保存额外接受的物品/资源成本和冻结读取集，与 Ability 的固定成本分别保留。全部成本通过既有 `applyAttemptCosts/applyItemCosts` 及正式 reducer 执行；候选预检、随机等待或 native 暂停不公开扣费，最终原子提交一次。未来耗时仍须 Activity，本字段拒绝 fictionTime。

继承用例的 observe 检定在最终发布时报 `world interaction continuation does not exist`：先扣额外资源使候选 actor 读取哈希改变，原执行器对步骤读取集作候选前缀更新后，错误地用执行计划的 hash 标识冻结裁决。现在内部世界步骤同时保留原始步骤及候选计划；机械验证使用候选计划，`WorldInteractionResolved.planHash` 始终取原冻结步骤。未放宽 event/fold 的原 hash 校验，也不刷新冻结上下文或骰面。

直接消费者为同一 atomic compiler/preflight/executor、初始随机 reads、冻结选择 read-set、native/RNG 恢复、事件重放与 Viewer。此次模型尚不能提出该额外成本；后续须将 highRisk/普通裁决、bridge 成本读取集和 Activity 接线一起闭合，不能把本底层结果当作完整游玩能力完成。

## 代表性矩阵与证据

- 物品多步骤、observe/worldInteraction 共享检定的成功/失败：等待不扣，原 Ability 成本保留，最终一次扣额外资源；事件 hash 等于原冻结 check，replay 精确一致，重复随机拒绝。
- 真正无随机的单步骤：额外物品和资源一次提交；缺物品读取依赖及数量不足均整束拒绝，早先私有资源扣减不会泄漏到权威状态。
- 冻结选择→native knockOut→后续随机：候选状态隔离、已付成本随恢复保留，最终一次扣费。
- 资源不足、失效/缺失读取、重复费用身份及即时 fictionTime 均拒绝，无事件及状态变化。

原失败日志 `/tmp/zhuwei-atomic-execution-cost-cause.log`：0/1、exit 1。修复初组 3/3、追加无随机/物品矩阵 4/4 均 exit 0（`/tmp/zhuwei-atomic-cost-frozen-identity.log`、`/tmp/zhuwei-atomic-cost-matrix.log`）。

最终定向 Node：`node --import tsx --test tests/kp-vnext-atomic-input.test.mjs tests/kp-vnext-frozen-choice.test.mjs tests/kp-vnext-shared-check.test.mjs tests/kp-vnext-social-plan.test.mjs`，52/52、exit 0，日志 `/tmp/zhuwei-atomic-cost-node-final.log`。

本地 Room：`npx vitest run tests/kp-vnext-provider-room.test.ts -t 'keeps a repaired check|freezes clarification|retrieves Item and Ability schemas'`，3/3、30 跳过、exit 0，日志 `/tmp/zhuwei-atomic-cost-room-final.log`。这是共享执行器直接消费者回归，不代表新成本已从模型/Room 可达。

类型检查首次 exit 2：内部冻结 hash 参数写成普通 string；改为 `ReturnType<typeof worldInteractionPlanHash>` 后 `npm run typecheck` exit 0（`/tmp/zhuwei-atomic-cost-types-verified.log`）。仅类型标注修改，未重复行为矩阵。未跑全量测试/Lint/build，无部署或远端写入。
