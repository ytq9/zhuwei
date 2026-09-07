# vNext social 与 NPC 有限知识实施承接

日期：2026-09-06。即时口头 social Form 的本地纵切已实现并验证，完整 V06 与 Goal 仍未完成。实际证据见[社交 Form 与恢复验证](vnext-social-interaction-validation.md)，前置证据见[NPC快照](vnext-npc-context-validation.md)和[社交后果领域](vnext-social-commitments-validation.md)。主 PRD 全文已核验；直接合同为 SPEC0001 §§6、9、12、14、16 和 F/K、SPEC0006 §§4、7、SPEC0016 social 家族与原子束。本文件不修改这些规格。

## 能力合同

最新真实[round28](vnext-round28-validation.md)已停批：本人裸knowledgeRef与完整entryRef现在在同一已验证NPC快照内解析到相同记录，正式Rules继续只消费规范引用；缺本人正文及外来holder不能冒充本人知识。原响应离线引用通过，不改判真实提交或语义成功；舞台说明混入台词、新真实经历缺显式producer以及模型判断仍待。

玩家保留原始意图和实际表达。KP 根据指定 NPC 本人冻结投影、性格、目标、顾虑、所知及权限创作回应或沉默，在随机前冻结完整结果分支。KP可以根据上下文填补未记载的经历；新创作本身不要求已有同内容引用。已有事实是约束，新经历不得与其矛盾；固化之后，新经历也约束后续创作。Rules 验证主体、创作授权、一致性检查所绑定的既有状态、权限、机械和状态转换，Room 作为唯一活跃权威原子保存一次结果，按各 Viewer 提供知识及 Claims；承诺不提前执行物理效果，恢复不重采回应或骰面。任意自然语言的一致性不能以引用存在或hash匹配代替语义判断。

## 来源主张与真实历史的分别处理

SPEC0001 §9允许NPC的说法真实、错误、夸张、过时或故意欺骗。正史一致性约束新声明为真的经历，不要求每句台词符合世界真相。来源主张保存谁在何时、基于什么信息、为何说了什么；听者取得sourceClaim及传播链，full只表示完整听到，不强迫相信，不公开私有动机或真假标签。新创作的消息来源可以同步合法固化，不能要求新内容已有同义引用；与角色信息权限、已固化来源及实际行为不相容仍需处理。

已补故意说反方向与转述误信消息的Rules/project/replay用例，保持真实路线、本人原知识、听者主张身份、真实来源eventId与隐私。旁白生成及审核明确继承引语归属，审核的是“NPC确实说过Q”，不要求Q为真；没有真实Provider新证据。motive在初始分支冻结，窄correction不允许事后改motive自救。[后续本人NPC的来源记忆](vnext-npc-source-memory-validation.md)已在Rules及真实Room驱逐后prepare验证：仅原NPC说话者获得自己的ownOrigin，公开听者继续不能获得；真实模型后续维持或承认谎言尚未验证。

## 当前已闭合的本地路径

2026-09-06后续修复见[NPC引用、初始化与Activity投影验证](vnext-social-npc-initialization-validation.md)：holder引用目录统一；普通开团的NPC目标/明确未知与背景进入本人Context；Activity未来计划不再通过Rules投影泄露。用户纠正后的创作指导已同步，资料未写与明确未知分开。真实[round26](vnext-round26-validation.md)/[round27](vnext-round27-validation.md)均未提交，不用本地修复改判为成功。

- 独立 strict social Form/capability/guidance、closed parser/validator、共享检定 owner、schema-defined refs graph 与 lowering。
- Rules 所有的完整 NPC decision snapshot、holder命名空间知识绑定及共享 reader；Room 的真实 NPC Viewer 在 prepare 中被消费，缺片段不推定空知识。
- 即时 spokenConversation，两方或同场可听见者 audience 由服务器派生；原玩家表达来自冻结 intent，NPC 的 speech/silence 在随机前固定。
- SourceClaim/Knowledge、关系变化、NPC 自身有条件承诺和债务同一原子执行；身份、参与者、权限、全部分支与 readSet 校验。
- WorldInteractionResolved 的 typed social 计划与精确领域审计；外层字段、实际骰子、来源 eventId、marker 和 outcome 不可改写或省略。
- vNext conversation 持久记录、私有目标/方法投影边界、有限 retry baseline、correction；现有旧社交消费者通过类型收窄继续运作。
- 私有 social/来源/承诺 Claims；真实本地 Room 直接、成功、失败、驱逐及幂等；社交前缀后的玩家选择与恢复骰尚未完成时，所有候选发言和后果不发布，最终 provenance 使用正式事件序号。

## 代表性矩阵与当前证据

| 样例/变化 | 已有证据 |
| --- | --- |
| NPC 根据本人已持有消息回答 | Form→Rules→sourceClaim/knowledge→Claims；Room 莉安所见账册 |
| NPC 在权限内作出有条件承诺 | 守门人侧门/莉安签字核对；记录尚未履行，物理状态不变 |
| 有检定的成功/失败与同束物理后果 | social 唯一 owner，两分支都经过随机前预检与真实 Room |
| 同裸ref不同holder、未说出的玩家目标 | 拒绝其他holder依据，NPC无玩家隐藏goal/method，旁白无motive |
| 沉默、第三人、失聪/无法发言、魅惑者 | 正式领域事件与公共 Rules 验证 |
| 暂停、篡改、驱逐、重复、更正 | 实际正式eventId、type降格拒绝、精确replay和conversation/知识/关系恢复 |

Node 103 个相关用例及旧消费者 3 个均有通过证据（主组先102/103，更新旧 schema 清单后失败项1/1）；Room5/5、typecheck/diff-check通过。没有本批真实 API 或部署；deterministic fixture 不证明模型语义判断。

## 下一步与未闭合边界

新内容本地纵切已接通，见[新经历与记忆验证](vnext-world-fact-memory-validation.md)：通用worldFact物化→正文唯一保存→事实版本指针→初始知情关系→同束social→下轮/驱逐后取回。新经历不要求旧同内容引用，也不授予其他NPC全知权限；历史在骰前共同固定，成败仅改变透露与真实后果。当前作用域限冻结场景主体，初始知情者限已存在且有本人Context的NPC；没有玩家既往选择创作授权。父事实闭包、相关连续性集合变化、partial证据及总完成标记均有本地边界证据。

已验证无旧引用的童年经历、多知情人听闻、两端骰、显式foreign basis/consumes拒绝、准备后主体/父事实/连续性变化拒绝和恢复不改史。听闻经历记录“听到谁说Q”，尚未为历史消息源新建完整NPC或独立历史SourceClaim。冲突/不确定自检结果会整体拒绝，但任意年龄/经历矛盾识别、未声明秘密文字借用仍是模型语义边界；不能把这些边界勾为通过。同调用模型自检与独立语义审核分别报告，提交后旁白审核不能充当提交前正史审核；没有新增Provider调用或改变窄修订槽。

1. 补齐重试合同：不靠改写goal/method清空失败基线；KP 判断实质变化，Rules 核验对应具体证据。当前 fingerprint 只排除同文/标点变化，不能宣称已完成语义同一目标识别。成本/时间重试尚未实现。
2. 将社交时间、成本和真正消耗 action 的行为接入共享 Activity/资源机制；保存整束最终基线，自身这次成本或局势后果不能被下一次无变化重骰利用。
3. 补玩家主动承诺/交易、非口头通信、NPC后续行动/目标/故事生命周期。现有社交 Form 只允许 NPC 承担自己的义务。
4. 用预设预算的真实 DeepSeek 批次验证自然语言回应、有限知识、承诺权限与下一次合法行动，保留首个失败，不重采挑成功。继续正常 HTTP 复杂链、双玩家20+链与 A–O。
5. 归档合同仍待原有答复，继续独立任务；构建部署/生产核对/退役及120金标/SLO后置项按总TODO执行。

仍沿同一 Rules/Room 权威和原子恢复器推进。不会把新 Form 包成旧 npc-exchange Program，也不复用旧固定 DC/固定台词；不建立第二条裁决或活跃状态路径。
