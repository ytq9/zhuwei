# Handoff：分组步骤 wire v4 收尾状态

2026-09-12。用户已允许在 `claude/local-preview-changes-8206cb` 整理原 WIP `aaedd46`，其父基线为 `e50194c`。本次完成定位、修复、同范围回归对比、有界真实批次与正式提交整理；未 push、未部署，根 `cloudflare` 工作树不参与修改。详细证据见[验证回执](./receipts/vnext-grouped-steps-wire-validation.md)。

## 当前实现

最终 parser `kp-vnext2-proposal-parser-v66`、fillingLayout v4、指引 v27、握手工具 v11。模型填写 `{decision, steps: {<类型>: [...]}}`，步骤自己的 success/failure 取代独立 results 表；组键表达类型，服务器按固定组顺序解码，组内顺序保留。故事 payload 仍是带 kind 的步骤数组。

在原 WIP 之外，已修复测试助手旧路径、共享检定 owner 查找，以及三处真实或确定性失败：

- round 120 后续 Rules 修订把前票据已加载的 authorItem 丢掉，裸 TypeError 被显示成 Provider timeout。Adapter 与 Room 均继承已经证明的前票据类型，伪造新增类型仍拒绝。
- 同轮 authored lowering 保留裸知识来源 ID，而 readSet 使用角色限定知识引用，导致 Rules 拒绝源绑定。现在来源与读取集使用同一冻结映射；不改模型回复或 Rules。
- 全空执行裁决可修订的预算只对已选执行类型生效。仅选终结表单却误填执行裁决时保持两次调用，不额外付费。

## 已验证

- 原“Vitest 230 对基线 18”是不同范围的错误比较。重跑同一完整范围后，基线为 426 项、214 失败；原 WIP 实际新增 8 失败，均已修复。
- v65 完整 Vitest 为 428 项：209 通过、214 既有失败、5 跳过；按文件和完整标题比对，无新增失败。
- v65 完整 Node gate exit 0：82 个失败用例名，对已登记 84，无新增；规格错误 0、其余棘轮无新增。未扩充基线。
- v66 只追加终结预算的收紧与绑定更新：最终 Room 5/5；Node 20 通过、4 个已登记旧失败，无新增；typecheck exit 0。最终小补丁没有重跑整套命令，证据为完整 v65 加定向 v66。
- 真实 round 120 失败即停，4 次调用、0 事件，离线修复后原保存回复已能 Rules commit。
- 新房 round 121 拿蜡烛成功，5 次调用、9 事件、背包新增 1 根蜡烛；round 122 对话经一次真实删除补丁后成功，5 次调用、累计 17 事件。两次均已发布旁白。
- 两次成功行动均验证原 submission 重复请求零新调用，响应、权威状态、事件、回执和发布存储完全一致；genesis 加事件 replay 精确等于保存状态。

## 剩余问题与下一步

1. round 122 旁白末句再次叙述上一轮拿蜡烛，库存没有重复增加。旁白输入 recentDialogue 含前轮玩家原句，审核仍接受；下一步应先用保存的输入定位上下文与当前回执事实的区分，避免付费重采样。它没有被记作完整叙述验收通过。
2. 跨类型无依赖步骤采用固定组顺序，不能表达原来的任意模型顺序。特别是同束新增 NPC 知识却未被 social 引用时，提前物化会触发 `social:npc-context-changed-or-forged`。“late history”测试只证明领域层晚生产者路径。若要恢复 wire 的这种表达能力，应明确顺序合同并调整编码/依赖入口，不放松 Rules 的知识快照校验。
3. 全量旧失败仍存在；统计稳定性、完整游玩与生产采用没有验完。v66 未再跑真实 API，真实成功样本为 v65，二者只相差终结选择误填空执行裁决的拒绝预算及绑定。

## 本地证据与环境

- 当前 worktree：`/Users/sanmu/Documents/zhuwei-cloudflare/.claude/worktrees/local-preview-changes-8206cb`。
- `.wrangler/grouped-wire-validation/` 保存 captures 001–014、round/table/authority/verification/replay、源码清单与独立本地持久化。session cookie 属于私有证据，不提交。
- `/tmp/zhuwei-wire-{baseline,verified}-vitest.json` 是同范围比较报告；`/tmp/zhuwei-wire-verified-gate.log` 是完整 Node gate；`/tmp/zhuwei-wire-final-{node,room,typecheck}.log` 是最终增量。
- 原脚本 fetchTable 500 来自参数错传对象；传房间码字符串后本批前后均 200，不能据此认定 archive 坏了。
- 本轮只启动 localhost:3012 与 capture:4322，收尾停止它们；原有 3000/4321 进程不改动。没有外部资源修改、远端 migration 或生产操作。
