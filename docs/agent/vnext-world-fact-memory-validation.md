# vNext 新经历、NPC 记忆与同束回应验证

日期：2026-09-06。`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773` 的继承开发树；无 commit、push、部署、migration、真实 API 或生产数据修改。本报告只记录本地新经历纵切，V06 与完整 Goal 仍未完成。

## 目标与能力合同

KP可以在故事锚点、人物背景和已固化事实内创作此前未记载的经历，新内容不要求已有同内容引用。Rules验证创作授权、既有约束的版本、参与者权限及原子机械，Room保存唯一正史并按Viewer公开。实际经历、某人说过什么、谁听到了及相信程度分别处理；NPC可以误记、夸张、传播假消息或故意撒谎。依据为SPEC0001全文，特别是§§3、7、9、14、16及F/K，与SPEC0016的materialization/social和原子束合同一致，不修改产品规格。

当前接口复用`materializeObject`的`worldFact`，没有童年专用Form或人物名分派。`description`是唯一正文，`worldFact`包含subjectRefs、occurrence、initialKnowledge和consistency。事实ID由Rules从definitionRef派生，CanonicalFact和初始Knowledge只保存同一精确definition/revision/hash指针；投影经授权解析正文，不复制私有取得原因或一致性说明。历史发生时间与本次固化时间分开。

## 代表性矩阵

| 变化维度 | 本地结果 |
| --- | --- |
| NPC童年空白，没有同义旧事实 | 原子固化经历、本人记忆和同束发言；下轮取回 |
| 两名NPC曾共同听到搬运工说Q | 两名指定主体记得听闻，当前听者只取得sourceClaim，Q不成为隐藏真相 |
| 有检定的成功和失败 | 两端骰固定同一经历，改变是否愿意透露；随机待决不发布候选 |
| 多段经历与一个NPC回应 | 显式消费多个producer，仅扩充对应事实与知识，旧NPC快照不被重读替换 |
| conflict/uncertain、条件历史、未声明消费或知情者 | 随机前整体拒绝；这是判定执行证据，不是模型已识别文本矛盾 |
| 外来basis/consumes及替玩家编造既往选择 | 显式权限拒绝，不以KP全知frame授予NPC知识 |
| prepare后新增主体事实、修改因果祖先、缺失父事实或新增相关承诺 | 冻结约束与集合读锁失效，旧创作拒绝 |
| 隐藏新事实的partial感官证据 | 仅返回实际痕迹，不解锁事实全文 |
| 骰后更换正文/hash；late producer前提前完成标记 | 正式事件transition拒绝，原合法顺序及完整replay通过 |
| 普通模块正常Room Action | 保存、驱逐恢复、duplicate和下轮prepare通过，无人工NPC语义seed |
| 旧vNext1入口 | sceneFeature保持可用，未携新事实合同的worldFact明确拒绝 |

## 实现与直接消费者

- `rules/v2/world-facts.ts`统一元数据校验、版本指针、授权后正文展开与创作约束frame。frame包含冻结场景主体、主体事实及递归父事实、相关定义和relationships/promises/debts/npcPlans，missingParentRefs不为空即拒绝新事实；集合成员参与hash。`authority-bindings.ts`提供同源reader，`context/runtime-requirements.ts`传递该frame及当前地点线索锚点。
- `proposal-schema.ts`、validator、graph和lowering实现closed worldFact及`materializedKnowledge`消费。创建的basisRefs与所有existing consumes统一检查，初始知情者只能使用本人冻结依据。主KP约束frame不是NPC知识授权。
- `world-interactions.ts`同一候选/正式reducer顺序写入SemanticDefinitionMaterialized、CanonicalFactDeclared与各KnowledgeAcquired；social仅消费已声明、always且确实授予当前NPC知识的producer。成功和失败共同冻结历史，恢复复用原分支及旧NPC快照。
- `events.ts`/`campaign-events.ts`验证精确事实指针、初始知识和冻结producer。总完成标记须在新事实与全部初始知识写完后释放计划；已结算bundle不能再追加新历史。`socialSettlementIssue`从冻结前计划确定性派生允许的context扩充，保留旧记录、台词、动机与分支。
- `validation.ts`、`projector.ts`、`claims.ts`要求新隐藏事实持有完整canonicalFact及精确pointer才可解锁正文；partial证据不能凭同knowledgeRef解锁。当前发言仍保存来源主张，听者不被授予隐藏真相或强制信念。
- `semantic-definitions.ts`只为通过闭合worldFact校验的holderRef元数据解除旧机械字段误拒绝；一般机械字段禁令不放宽。semantic模板、Profile绑定和proposal指导同步。vNext1遗留materializeObject收为sceneFeature-only，删除无消费者的worldFact分支。

普通Room的下一轮prepare曾因16k artifact硬门失败。按当前Goal已批准的快速开发决定改为160,000 canonical units异常上限；独立完整请求预算仍为58,000估算输入额度，不能把字节估算当实际模型tokens。ADR0015和执行TODO已同步，不改变Provider调用次数或输出预留。

## 实际验证

最终受影响组：

```sh
npx tsx --test tests/kp-vnext-world-fact-memory.test.mjs tests/kp-vnext-proposal-bundle.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-social-plan.test.mjs tests/kp-vnext-materialization-and-feasibility-rules.test.mjs
```

**106/106，exit0**；其中新经历组11项，同时覆盖故意欺骗/误信传播的直接social消费者。输出：`/tmp/zhuwei-world-fact-final-consumers.log`。

```sh
npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'normal Room materializes'
```

**1 passed、34 skipped，exit0**，输出：`/tmp/zhuwei-world-fact-room-final.log`。新纵切共享类型完成后`npm run typecheck`已exit0，输出`/tmp/zhuwei-world-fact-types-final.log`；此后收尾只增加内部reducer检查、目标测试及文档，不改变公共签名。最终diff检查见执行日志。

补充测试首次失败来自测试本身：Form常量误从非导出模块导入，以及重新freeze未传本次rootActionId而取了fixture的next默认值；已修正后完成上述最终组。没有以放宽产品断言解决失败。早前64/64、41/41和Room首次通过属于中间源码证据，不与最终106项相加。

## 未闭合范围

`consistency.compatible`当前由同一次KP创作调用自检，尚无独立提交前语义审核。结构/hash只能防止声明引用越权、读取过期、未声明consumer和骰后改史；无法证明模型识别任意年龄或历史矛盾，也无法识别模型从authority-only frame借用秘密文字却不声明该来源。提交后旁白审核不能充当提交前正史审核，这些边界保持未通过。

初始知情者目前限已有且具有冻结NPC Context的主体。玩家既往选择创作、新建历史消息源NPC或独立历史SourceClaim、异地广域主体和完整消息源交叉验证尚未覆盖。听闻fixture证明新听闻事实与当前转述身份分离，不声称已建完整历史传播图。

没有本批真实Provider证据，不改判已停止的round26/27；schema新形状、普通NPC后续一致回应、复杂补取、双玩家20+连续链、Activity/计划/完整战斗/收束、归档及生产替换继续按总TODO推进。120金标和长期SLO保持后置。
