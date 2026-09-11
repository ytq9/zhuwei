# vNext 来源主张、知识分享与 Viewer 权限验证

日期：2026-09-06。基线为 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 的未提交工作树，保留既有修改。本轮没有真实 API 调用或生产修改。

## 症状、根因与修改

原 `projector.sourceClaims` 复制全局来源主张，持有正文的 Viewer 因而取得原全文及私有 `sourceBasis/motive`；partial 记录也会回填全文。旧分享入口复制正文却允许另选层级；历史 `spokenClaimHeard` 使用名称前缀和原创建事件，来源身份与 provenance 又可能扩大一般 Claims 引用权限。

新增 `knowledge-records.ts` 作为实际 holder 记录与来源主张投影的共同接缝：检查 own property、holder/ref 身份，投影仅采用持有正文、层级、取得时刻、实际传达关系及未证实标记。现有分享接口没有摘要正文字段，因此 exact 正文和原层级一起保持，升层与降层均拒绝；不从全局 claim 回填原 speaker、全文、动机、依据或形成时间。

`campaign-actions/events`、`events.ts` 和 `social-actions.ts` 同步分享与 fold：校验来源实际持有、content/kind/layer/provenance、重复或覆盖、唯一身份与私有 recipient，并保留实际知识 provenance。旧 Profile 的事件解释单独保留。

`observer-delta.ts` 从真实 KnowledgeAcquired 正文和 medium 生成听闻，只从安全 Viewer 投影取名字；来源身份、speaker 与 provenance 不再自动授予一般 Claims refs。`claims.ts` 支持单条和 batch 取得事件，逐项核对实际保存记录；未知来源显示“该消息来源”。新增 knowledgeAcquisition 材料保留结构化知识、推断 confidence 和转述分类；旁白指引明确“尚未证实”和“转述不是本人亲见”。纯来源/取得根已进入 Frozen Claims，旧混合 social 根仍走既有路由，不作为新 social 完成证据。

直接消费者包括本人推断、Rules 分享/fold、所有 Viewer 投影、历史观察摘要、Frozen Claims、知识表达及 vNext 旁白。`vnext-world-interaction.ts` 增加 normative 知识取得合同，当前 runtime hash 随之变化；round25 manifest 仅证明原批源码，不改写历史 hash。

## 定向证据

- Node：`npx tsx --test tests/kp-vnext-source-claims.test.mjs tests/kp-vnext-observe.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-due-claims.test.mjs tests/kp-vnext-knowledge-review.test.mjs tests/observer-projection-v2.test.mjs tests/social-resolution-v5.test.mjs`，57/57，exit0；日志 `/tmp/zhuwei-source-claims-final-node.log`。
- Room：`npx vitest run tests/kp-vnext-provider-room.test.ts -t 'observe |reviews held knowledge'`，3/3，exit0；日志 `/tmp/zhuwei-source-claims-final-room.log`。证明直接 Room 恢复消费者无回归，不是新增分享 HTTP 纵切。
- `npm run typecheck` exit0，日志 `/tmp/zhuwei-source-claims-final-types.log`；`git diff --check` exit0。

新增7例覆盖私有主张到 exact 分享的全部 Viewer channel、partial 不回填全文或原 speaker、层级升降及继承属性拒绝、接收者 Claims 与 replay、batch 结构化事实/推断/转述感官、篡改 content/kind/provenance/layer/重复项/policy 的 fold 拒绝、无公开 speaker 的文献形状单条取得事件。文献例经公共 Rules 声明 fact 后构造已有单条事件，再走公共 project/replay；vNext 文献 Form 尚未接通。

原泄漏/层级用例先红后绿。中间失败为旧 Claims 精确文案缺“尚未证实”、在无 committedRange 的基础投影误断言 Claims，以及测试误用 `projection.readModel`；均已修正。独立只读分享→投影→replay 探针 exit0，canary 不泄漏、Claims 合规。隐藏来源实体的一般 target-grants 完整运行时负例未单独执行，不冒称已测。

## 未覆盖范围

新 social Form、NPC 独立冻结知识与不同声口、文献可达入口、分享 HTTP 纵切和真实模型语义仍待。V06 不勾完成；复杂补取、双玩家20+链、A–O、部署与旧房退役继续。恢复归档合同仍待答复，120金标/SLO后置，总 Goal 保持 active。
