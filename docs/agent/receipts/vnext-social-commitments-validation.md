# vNext 社交承诺领域与 Typed Claims 验证

日期：2026-09-06。工作树：`cloudflare/258caee404e0814405eb497653ee9f00d647b773` 加既有未提交开发修改。本文只证明社交后果的共享领域路径，不代表独立 social Form、NPC 回应或 V06 已完成。

## 合同与代表性矩阵

Rules 保存关系变化、有方向和条件的承诺/债务，并从实际参与者生成 Receipt；参与者只能读取相应事件的公开正文，不能因参与关系而取得隐藏成因。承诺或债务的建立不执行其所描述的物理行为。Room 继续消费同一 Rules 权威；replay 与 correction 保存相同领域记录语义。

| 变化维度 | 代表用例与证据 |
| --- | --- |
| 关系可更新，但不能换参与者 | 玩家与守门人形成关系；同 ID 更新并纠正后完整恢复旧值，换参与者拒绝 |
| NPC 向玩家作出有条件承诺 | 核实介绍信后打开侧门；NPC 为 promisor，玩家为 promisee；Claims 明示尚未履行，实体/地点/物品状态不变 |
| 玩家向 NPC 承担债务 | 离开地窖后归还灯；debtor/creditor 方向与条件保留，重复 ID 和无依据债务拒绝 |
| 最高风险：参与者身份不授予隐藏成因 | 关系/债务引用隐藏 fact；双方完整 Viewer JSON、Claims 和旁白事实均无其 ref/正文，同场第三人无承诺记录 |
| 恢复与拒绝 | 三类事件 replay 一致；新增记录纠正后删除；非法参与者、额外字段、错误 policy/secrecy 在 fold 拒绝 |

这些样例经过同一公共 `step → project/replay` 路径；没有 NPC 名称或示例正文分支。NPC 能否代表自己或他人承诺，仍须由尚未接通的 social 计划绑定实际行动主体与权限，不能以这里的实体存在检查代替。

## 实现与直接消费者

- `rules/v2/social-commitments.ts` 为三类 payload、状态引用、参与者与安全公开内容提供共同校验。关系至少两个唯一真实参与者；关系 ID 保留参与者集合；承诺/债务 ID 创建一次；债务至少一条真实依据。
- `campaign-actions.ts` 与 `campaign-events.ts` 共用领域校验，命令记录实体、事实、既有关系的实际读集与领域写集。vNext fold 要求各类精确 private participant policy。修正首次未验证代码中 `eventType`/`type` 变量误用。
- `events.ts:eventSubjects` 根据三类 typed 参与者生成 Receipt。首次新测试出现四个 `projectionIntegrity` 失败：原 Receipt 无参与者，合法提交无法进入公开 projection；修复同一 Receipt 事实源后通过。
- `claims.ts` 新增 `socialCommitment`，同步 material/renderable union、闭合形状、conformance、引用闭包、displayNames 和 narrationFacts。保留关系变化或有方向、条件的未履行义务，不复制 basisFactIds。可见性要求本次事件 grant，另一关系的 policy grant 不能替代。
- 纯来源/知识/社交领域根启用 Typed Claims；没有把三类事件加入全局 root 触发集合，旧 `SocialCheckResolved` 混合根保持其已有路由。
- 独立只读审查发现基础投影仍泄漏隐藏依据：`projector.ts` 的安全关系/承诺/债务记录移除内部 basisFactIds/sourceFactId，`observer-delta.ts` 删除相应 grant 提升。NPC Context 继续复用这份安全 Viewer 正文。
- `social-actions.ts` 的旧承诺发射器改用既有 `visibility:promise-participants`。三类 correction 已有完整 `restoreCampaignEntry`，本次复用并验证，无新增 correction schema。
- `vnext-world-interaction.ts` 的规范内容加入上述领域语义，Profile hash 随当前合同变化。旧真实批次 manifest 作为历史证据保留。

## 实际验证

同一最终源码状态：

1. `npx tsx --test tests/kp-vnext-social-commitments.test.mjs tests/kp-vnext-source-claims.test.mjs tests/kp-vnext-npc-decision-context.test.mjs tests/kp-vnext-claims.test.mjs`：40/40，exit 0。日志 `/tmp/zhuwei-social-commitments-node-final.log`。
2. `npx tsx --test --test-name-pattern='social boundaries|facts and knowledge drive|growth and chapter transition' tests/social-resolution-v5.test.mjs tests/world-campaign-v2.test.mjs`：3/3，exit 0。覆盖旧社交关系消费者、知识/承诺连续性及章节继承的直接路径；日志 `/tmp/zhuwei-social-commitments-legacy.log`。
3. `npm run typecheck`：exit 0；日志 `/tmp/zhuwei-social-commitments-types-final.log`。`git diff --check`：exit 0。

新组验证双方全部七个 Viewer channel、第三人隔离、物理状态不变、事件拒绝、完整回放与纠正；未运行新 Room/HTTP 纵切，不能写作 social Form 端到端证据。初次新组 4 项 `projectionIntegrity` 失败的工具回执保留；临时 `/tmp/zhuwei-social-commitments-node.log` 已被后续绿色复跑覆盖，现存文件不作为原失败证据。根因与处置已记录在本文和执行日志。

## 未覆盖与承接

仍需独立 social Form、typed 私有计划、NPC 自身冻结知识与权限制约、实际发言/知识取得、检定前全分支预检、与本子步骤真实领域事件绑定的 fold、通信感官条件、conversation/retry baseline 与恢复。下一步直接接入现有原子执行器，不复用旧固定 DC/固定回应模型，也不包装旧 NPC-exchange Program。

本批真实 API 调用 0、模型新增费用 0；无生产修改、部署、push、远端 migration、Secrets、新资源或旧房退役。归档合同仍待原有答复。V06 和完整 Goal 保持未完成，120 金标与长期 SLO 后置。
