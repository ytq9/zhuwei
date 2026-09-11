# vNext 独立观察与角色推断：本地纵切

日期：2026-09-06。基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773`，保留全部既有未提交工作。本记录是 round24 知识分类缺口后的实现证据，不改判旧真实失败。

## 能力合同与实现

角色可以通过独立 `observe.vnext-1` 提问和观察，也可以只依据本人持有知识思考。问题、具体感知、解释和置信说明分别填写；新感知与解释在同一 root 提交。已持有依据必须来自本人完整冻结目录及对应记录；本次感知按选中成功/失败分支内的索引引用，禁止跨分支、未知知识、他人观察者或未持有的来源。推断不成为客观真相，也不替玩家决定信念。纯已有知识思考不制造感知、时间、物品或资源变化。

严格工具 schema、首轮能力目录、填写说明、校验、引用图、窄 summary 修订与 lowering 接通该 Form。内部复用 `resolveWorldInteraction` 的权限、共享检定和原子执行；复用共同推断 gate 提交 `CharacterInferenceFormed`。首个随机请求前核对全部分支和后续原子步骤的知识记录、目录与 hash，避免前序暂停使后续无权引用漏过预检。无 state 的 canonical-shape 检查不冒充鉴权。

新 vNext Profile 的规范 payload 明确版本化推断内容 `zhuwei.character-inference/v1`，保存 conclusion 与 confidence；按完整 extension id/hash 生效，V5 原字符串重放不变。事件 fold 复核证据实际持有、记录身份、ID 不覆盖及私有 holder policy。共享知识查询只接受自有记录，继承属性不会成为证据。`WorldInteractionResolved.observation=true` 产生 observe 类别结果；Claims 不把纯思考描述为物理环境互动。Claims、知识回顾和桌面线索保留置信说明，推断正文只给本人。

直接消费者：`kp/vnext/proposal-{schema,capabilities,guidance,validator,graph,bundle-lowering,correction}`；`rules/v2/{character-inference,world-interaction-model,world-interactions,campaign-actions,campaign-events,claims,knowledge-expression}`；`rules/profiles/vnext-world-interaction`；`table/authoritative`。Room bridge 继续使用同一 Rules kind，无新增 Room 裁决通道。

## 代表性矩阵与证据

| 维度 | 本地证据 |
| --- | --- |
| 同根新感知＋已有来源知识→解释 | 严格 wire→冻结上下文→Rules；实际感官 fact ID 成为依据，解释单独保存，confidence 进入 Claims/知识回顾，Viewer 隔离，replay 精确一致 |
| 纯已有知识思考 | 同一 observe 路径，只有推断和结果事件；无新增感官事实、虚构时间、库存、伤害或资源变化 |
| 成功／失败 | 真实 Rules 随机 continuation 分别给 1/20；仅选中分支授予感知和推断，不在等待时发布候选知识 |
| 首随机前拒绝 | 他人 observer、跨界索引、未知/他人知识、缺记录或过期 hash；前序物品随机＋后续思考仍在随机前拒绝。合法版本可完成治疗与推断且 replay 一致 |
| fold 与直接 Rules | public policy、未知依据、继承属性引用、覆盖已有知识均拒绝 |
| 真实本地 Room | 已保存 Proposal 后断线／eviction，零额外 Proposal；下一根只用上次实际感官知识思考；旁白失败后 Viewer 恢复同一份本人 Claims；ACK 后两条推断卡保留置信说明；Bob 不能看到解释或泄露私有 canary |

实际定向命令与结果：

- `npx tsx --test tests/kp-vnext-observe.test.mjs tests/kp-vnext-knowledge-review.test.mjs tests/kp-vnext-claims.test.mjs tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-narrative-details.test.mjs tests/kp-vnext-authored-runtime.test.mjs`：80/80，exit 0，`/tmp/zhuwei-observe-node-final.log`。
- `npx vitest run tests/kp-vnext-provider-room.test.ts -t 'observe |reviews held knowledge|recovers a durably saved first response|retrieves Item and Ability schemas'`：5/5，exit 0，`/tmp/zhuwei-observe-room-final.log`。
- `npm run typecheck`：exit 0，`/tmp/zhuwei-observe-types-final.log`。

保留失败记录：初 typecheck exit 2 的三项新类型错误已修；Node 原子用例先使用非法 outcomeBinding，继而违反现役单一共享检定所有者合同，改用真实已有物品随机前缀＋observe后续来验相同预检风险；旧 schema 枚举断言未包含新 Form，63/64 后同步到实际执行面。Room 先误以字符串 eventSeq 作数值断言，再误取 Bob 的旁白请求作为 Alice 恢复材料，修正测试按 BigInt 和确切 viewerKey 比较。它们不是生产行为修复，不隐去失败记录。

独立只读复核另发现同束新建对象→observe的实际拒绝：局部handle替换成正式ID后引用集合不再有序。已在同一Rules编译接缝先验证原符号计划闭合且canonical，再仅重排root和分支内的引用集合；不去重、不重排感知/推断数组、不清洗原本非法的输入。新增direct/check、真实随机、project/replay与非法原排序拒绝用例从red转green；扩展直接消费者后最终Node80/80、Room5/5、typecheck均exit0。round25仅完成0调用的本地新房准备，尚未发出真实行动时发现并修复，调用前重新锁定源码。

## 尚未覆盖

本地测试使用固定 Provider 输出，不能证明真实模型总会把自然语言正确分类，也不能证明任意中文推断被证据蕴含。随后[round25真实批次](vnext-round25-validation.md)新增1次Proposal调用：原参数JSON缺括号且有额外字段，提交前拒绝，0事件/Receipt/Claims；草稿虽选择observe并填写推断，感官文字仍混入解释，当前模型语义未通过。round24 的原非法分类保留为已发生失败。来源主张、社交、NPC 有限知识及完整 V06 仍未交付；特殊感官/职业能力、复杂补取与多人连续链继续验收。没有生产部署、push、远端 migration、Secrets 或旧房删除。120 金标/SLO 后置，私有恢复合同确认仍待答复，总 Goal 保持 active。
