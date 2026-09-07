# 持续施法 Rules / Room 接缝

2026-09-07，cloudflare 未提交工作树。完整 Goal 保持 active；此接缝不等于完整 KP 或目录法术游玩验收。

旧长施法被 vNext due 过滤，Activity 自身占用又不能靠另开等待推进；完成 frame 的 specs 为空可能未执行实际效果；开始 AbilityInvoked 被误当效果已发生。反制待决还会清掉 due 的冻结 continuation，并混淆回答者与整条施法 root 的发起者。

已注册且现有执行器支持的 Ability 现在可在 Rules 开始、持续、取消和完成。原定义、参数、目标、时间线与仪式语义冻结；普通时间和长施法共用真实 deadline 分段，战斗时间只由回合及动作投入推进。完成走原 Ability 编译与执行器，不能补目标、时长、费用、效果或重掷。

代表性证据包括注册长攻击/伤害、仪式治疗、区域 save/共享伤害、其他 Activity/NPC/世界效果 deadline、同刻完成和取消。最高风险覆盖 Counterspell 直接回答，以及拒绝反制后自动伤害骰 candidate 落盘故障、异根事件插入、DO 驱逐和原 answer 恢复：一次骰、伤害、成本，权限不混淆，replay 一致。开始、持续和时间完成的 Claims 不冒充法术效果。

17 文件按原始/结果 SHA 集成，0 冲突，见 [集成记录](vnext-sustained-casting-integration.json)。主要修改共享 Ability 准备、due 分段与重放、catalog 时长/ritual metadata、Claims，以及 Room 的 due continuation 和原施法者 Receipt/audience 绑定。回答者认证仍保留；自动骰合同未变，未增加玩家手势。

主树 Node 目标组 55/55（持续施法及直接 Rules 消费者 26、schema/filling 29），Room 持续施法 2+既有时间 9 共 11/11，typecheck exit 0。日志为 `/tmp/zhuwei-terminal-casting-root-node.log`、`/tmp/zhuwei-casting-root-room.log`、`/tmp/zhuwei-terminal-casting-root-types.log`。故障注入不是实战或真实模型成功。

隔离普通 combat 目标组 1 通过/2 失败，旧 B38 为 6 通过/2 失败；逐文件 SHA 一致的原始快照结果相同。分别涉及旧 area 几何、浓度骰预留顺序和未编译 Counterspell fixture，未修改旧断言造绿。具体命令保留在 `/tmp/zhuwei-sustained-casting-work/sustained-casting-handoff.md`，不宣称旧文件全通过。

剩余：KP invoke/continue/cancel 接线正在独立纵切；AUTHORED duration/ritual 未增加；实际目录法术仍有 sense/special/multi-target/area 执行器缺口。非战斗开始后进入遭遇会停止背景推进，但持续动作绑定尚未闭合。注册 fixture 不证明这些目录法术或真实模型稳定性。未部署、push、migration 或修改生产房间。

随后对正常建卡及实际目录作只读预检（0 API）：人类牧师自身目标的 `cure` / `healing-word` 可作为即时调用候选；尚未执行真实测试，不能称所有目标的合同已闭合。当前 `identify` 的 special、`detect-magic` / `speak-animals` 的 sense、`prayer` 的多目标在目录编译时未接入；`silence` 虽注册，长施法开始仍拒绝没有执行器的 area effect。因此当前没有已证明可正常建卡并完整执行的真实长施法/仪式目录项。

`prayer` 后续不能只放开 `max !== 1`：现有执行器已支持显式数组的非空、去重及数量上限，并用一次治疗骰分别封顶目标 HP；但目录的亡灵/构装体排除条件没有进入注册目标约束，NPC 机械实体也缺少权威 creatureType，`requiresSight` 的候选校验尚未闭合条件视线。必须先完成同源目标谓词及开始/完成重验，再作实际法术验收，不用更换 fixture 代替。
