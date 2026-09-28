# ADR 0067：主要察觉对象的证据策略与来源随计划冻结

- 状态：已接受
- 日期：2026-09-28
- 依据：用户确认 review 共识并要求实施六项确定缺陷修复；主要对象失败时由 Rules 授予证据，保留已有失败路径的显式证据，不增加主要对象的反应调用。
- 证据：[round144 回执](../agent/receipts/vnext-round144-validation.md) 对应 QqZYus；本轮回看其权威事件发现主要对象未取得冻结的 noticedEvidence，原回执的通过不证明该项正确。该对象已有其他感知，不能据此说其完全没有知识。旧策略、重复来源及部署恢复另由 [concealed-check 门](../../tests/kp/knowledge/concealed-check.test.mjs) 和真实旧版本夹具验证，不冒充真实模型批次结论。
- 当前规则：[SPEC 0005 §6.2](../specs/0005-world-facts-and-knowledge.md)、[SPEC 0006 §7](../specs/0006-module-npc-and-faction-protocol.md)、[SPEC 0016 §9.2](../specs/0016-part-d-staging-and-supersede.md)。
- 取代范围：补足 ADR 0059 的主要对象证据执行归属；旁观察觉与反应协议不变。ADR 0038 的已冻结裁决不重问、不替换保持不变。

## 原因

此前主要对象被排除在自动授予名单外，依赖 KP 在失败分支另写证据，可能漏记。仅在掷骰时把主要对象追加进去，又会让部署前已冻结的计划获得新的结算语义；原来的证据可能在另一个 onFailure 步骤中，即使正文相同也会重复。

只读取当前知识去重不可靠：执行与 social 结算复证看到的前缀不同，过去已经知道同文内容也不等于取得了本次动作的证据。

## 决定

新 lowering 在 `FrozenConcealment.evidencePolicy` 冻结 `primary-failure-v1` 及 `primaryFailureSource`。来源是同一根行动失败执行路径中第一条观察者、主体、感官和原文均精确匹配的感知，保存 resolutionId、实际分支和条目索引；无匹配则为 null。always/onFailure 步骤参与，onSuccess 不参与；检定步骤取 failure，直接成功的兄弟步骤取 success。编译和持久化形状检查复核来源，执行和 social 复证共读这个决定。

新计划的失败事件 `noticerRefs` 包含主要对象，语义从“察觉的旁人”扩展为“本次按 Rules 判定察觉的 NPC”。有显式来源时只取消自动补授，不移动、删除或合并已有感知；没有来源时由 Rules 授予冻结的 noticedEvidence。不同正文、主体或感官不能互相抵销，同文但由其他原因产生的显式记录不在本决定中合并。

无策略字段的旧冻结计划继续原先的主要对象显式证据路径；恢复与编译不补版本。旧计划原本漏写的证据也不在恢复时追补。已提交事件照读保存的名单，不重算、不追加，不更改其历史 hash 或事实身份。策略随既有冻结计划、随机请求和 continuation 保存，不增加数据库字段或 migration。

主要对象仍不新增反应调用。检定挂在对第三人的 social 上时，若主要对象要当场回应，可另写 onFailure 的 social 冻结其 response；没有该步骤不会由 Rules 补出回应。不以这项能力禁止合法耳语，也不把加入反应调用作为本次修复。

## 同批边界修复

混合选择与填写继续专项拒绝，原稿保留和迁移诊断不承诺修订内容保全。新方案中观察或对话成功不再签发跨持有人库存授权；隐蔽检定直接目标的取得必须绑定成功，场景物与他人持有物共用该检查，合法失败损坏、消耗和掉落仍按库存规则结算。已提交库存凭据按原审计事件复验；已冻结选择、Activity 和待骰方案的库存策略由 [ADR 0068](0068-freeze-inventory-admission-policy-with-the-plan.md) 明确，不在恢复时升级。

门沿用 concealed-check、transfer、social-plan、proposal-revision 与 story-room-probe 的定向行为测试。库存嵌套、公开见证、Ability 阶段见证仍属于[待裁定草案](../agent/proposals/action-results-and-witness-coverage-proposal.md)，不由本 ADR 提前批准。
