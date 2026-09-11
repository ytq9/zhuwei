# vNext NPC 引用、初始化与 Activity 投影修复

日期：2026-09-06；`cloudflare/258caee` 未提交工作树，保留全部既有修改。没有部署。完整SPEC0001与直接SPEC0006已核验；用户关于开放创作的纠正符合现有规格，无需改写已裁定SPEC。

## 症状、根因与修改

1. round26的引用目录广告裸NPC knowledgeRef，social却只接受holder完整entryRef，还把后者列为nonCitable。`context/index.ts`与`required-context.ts`统一广告完整引用，proposal-context升至vnext-2并绑定Workflow hash；`world-interactions.ts`的NPC稀疏修订直接消费者通过heldKnowledgeRecord接受本人裸ID/完整ref，继续拒绝其他holder。没有自动改写模型输出或删除holder校验。
2. 尚active、虚构时间0的Activity在Rules玩家投影包含completion未来知识。`projector.ts`改为所属角色的生命周期字段白名单，保留合法restKind；不公开completion、recoveryChoice、原始interruptionCause/activityKind。Table adapter原已有白名单，未证明真实桌面显示泄漏；修复的是Rules事实源及Room原始observe直接消费者。
3. 正常开团只下传NPC name/voice/机械与knows，丢失已存的目标、行为边界和明确未知。`module/npc-semantics.ts`从固定模块创建semantic definitions与entity bindings，Room genesis一次固化，显式可信binding优先且仍经Rules校验；后续不重读模块充当第二状态源。本人NPC identity增加goals、behavioralConstraints、initialUnknowns，正常初始化无需人工vNextSeed，驱逐后精确恢复。
4. 用户明确新经历无须旧引用，审查定位到Prompt错误禁止补写历史，且本人identity还丢失已保存的publicFace年龄/背景。已纠正`proposal-guidance.ts`/`proposal-schema.ts`，并让Rules本人identity保留label/description；只取这两个身份字段，不透传私有作者备注。Profile绑定对应投影语义。明确初始未知保留，资料未写不作为禁止创作。

## 代表性矩阵与实际证据

| 验收 | 证据 |
| --- | --- |
| 复制实际广告的holder目录，经parser/lowering/Rules/project/replay；本人裸ref及外来holder拒绝 | 引用Node四目标36/36 exit0；稀疏修订单目标7/7 exit0 |
| 实际Room social三路径及NPC稀疏修订 | 初组3通过/1稀疏修订失败；修复Rules消费者后失败项1/1 exit0 |
| Activity开始、中断不泄露；虚构时间与知识不提前变化；合法休整及到期知识可用 | Node两目标15/15、Room休整驱逐1/1，均exit0 |
| 正常模块初始化的莉安与瓦罗各自身份/知识，无玩家或其他NPC秘密；驱逐精确恢复 | 初始化/schema/retrieval Node45/45；最终Room初始化+social三路径+NPC revision 5/5，均exit0 |
| 已有身份背景进入本人冻结Context，包括不同人物的年龄/经历；私有作者备注隔离 | 新断言在旧projector上exit1；修复后NPC/schema/retrieval Node45/45、正常初始化Room1/1，均exit0 |

前述日志分别是 `/tmp/zhuwei-social-citation-node.log`、`/tmp/zhuwei-social-citation-npc-final.log`、`/tmp/zhuwei-social-citation-room-revision-final.log`、`/tmp/zhuwei-activity-projection-node.log`、`/tmp/zhuwei-activity-projection-room.log`、`/tmp/zhuwei-module-npc-context-node.log`、`/tmp/zhuwei-module-npc-context-room-final.log`。最后一组执行命令是：

```sh
npx tsx --test tests/kp-vnext-npc-decision-context.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-schema-retrieval.test.mjs
npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'normal module initialization preserves'
```

其日志为 `/tmp/zhuwei-npc-background-context-node.log` 与 `/tmp/zhuwei-npc-background-context-room.log`；红证据为 `/tmp/zhuwei-npc-background-context-red.log`。这些用例组有重叠，不相加计覆盖。类型检查及diff结果随执行日志记录，不运行全量/Lint/build。

## 创作合同与未闭合能力

新增真实经历的来源是KP本次创作，旧引用只定位相关正史、角色、授权与约束；不能要求新命题已有证明。已有年龄、时间和经历用于一致性判断，创作固化后又成为下一轮的既有约束。本人回忆、二手传闻/谎言、他人秘密与机械效果分别保留事实类别和权限。

当前只修正了错误指导及缺失背景，**没有把任意自然语言矛盾检查或新经历纵切标为实现**。social仍只接收冻结前NPC依据，consumes/produces为空；发言→来源主张→听者知识不能替代新历史正史及NPC主体记忆。下一纵切复用新worldFact物化与原子Bundle，补同束创作、参与者记忆、回应及恢复，历史在掷骰前共同固定，骰子只决定透露与后果。待验收矩阵为无旧引用的童年补白、结构不同的二手传闻、与已定年龄/经历矛盾拒绝、他人秘密隔离、换轮及恢复一致性。

现有结构/hash/readSet校验不证明任意文本不矛盾，提交后的旁白审核也不等于提交前一致性验证。独立前置语义审核与现有普通2阶段/补取3阶段的一次窄修订合同须先对齐，不能偷偷多调用或用自检宣称确定性保证。真实模型批次结论见[round26](vnext-round26-validation.md)及[round27](vnext-round27-validation.md)，均未成为可用NPC主链；未新增采样。Activity完整计划、语义重试、成本/交易、NPC生命周期、双玩家20+、部署退役仍待，Goal保持active。
