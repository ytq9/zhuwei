# KP 补全已有对象：实现与验证

日期：2026-09-09。开发分支 `cloudflare`，基线 `bec5e28c44f3c815a341c2f1e425cfaaeb65acf9`，包含共享目录未提交修改。

## 结论

已有对象补全的表单、编译、Rules、事件、Viewer 和后续上下文路径已接通。最终 guidance 为 v19，parser v56；此前本地定向测试与类型检查通过。本轮 v19 真实 DeepSeek 单样例通过核心合同：模型主动填写 completeObject + observe，新增外观、位置及关闭状态保存到原对象，进入 Viewer 和下一轮上下文，未添加玩家操作。仍有一处文案瑕疵：状态开头多出含义不清的“活动”。历史 v17/v18 两轮失败保留；本轮不能证明统计稳定性、最终旁白或完整 HTTP/Room 链路通过。

## 症状与根因

KP 可以决定未定义的世界内容；旧文本没有同一句描写不构成错误。已有实现中，observe 的感官证据会保存为角色知识，但不更新对象定义；worldInteraction 的状态效果表示实际操作；materializeObject 则创建新身份。因此，“补全既有阀门原本是什么状态”缺少独立、明确的填写入口。只要求“固化新事实”不足以告诉模型如何落表，也不能通过虚构一次玩家开阀动作弥补。

## 修改与直接消费者

- 新增同属 materialization 的 `completeObject`。模型只填已有 `definitionRef`、完整 `description`、可选语义状态 `observableState`、依据与摘要。`none` 保留原状态；新确定的工作状态应同时写入描述和状态字段。无新身份、handle 或结果行。
- 服务器绑定原对象的 exact base/template、当前场景与冻结创作授权；合法授权引用可显式填写，也可由服务器补入。公开描述的内容依据仍须符合原对象受众，不开放其他角色秘密或未知对象。
- 只允许 description/observableState 文本补全，兼容现有根字段或 semantics 字段形状；保留身份、受众、机械引用、库存与几何。Rules 的 NPC 修订知识边界不变。
- 同束完成先于实际行动，且不依赖观察检定成败。原始 readSet 仍验证准备时版本；后续操作效果从已冻结的补全结果编译，不跳过陈旧读取检查。
- `SemanticDefinitionRevised` 的 `completion: true` 区分“KP 确定原本属性”和“实际对象变化”。Viewer 输出当前 sceneFeature，不输出“对象变为……”的修订主张。实际开关操作保留原有变更事件。骰后篡改、删除标记或提前结束事务均拒绝。
- 提示词区分世界创作与代替玩家行动；普通修饰和氛围仍允许。用于回答当前问题的新位置、朝向、构造或工作状态须保存到对象。一次观察的感官与推断放在同一结果内，证据序号不跨步骤。

直接消费者：capability/producer Registry、strict schema/codec/parser、引用槽与依赖图、Bundle lowering、Rules 修订与事务编译、Profile hash、事件回放、Claims、下一轮 RequiredContext。没有额外 Agent 或模型阶段。

## 本地验证

以下是实现轮已运行的证据；本轮 v19 真实复验没有修改运行时代码，也没有重复运行这些测试。

初始 `tests/kp-vnext-object-completion.test.mjs` 在未支持 completeObject 时为红；接通过程中保留失败记录并逐层修正。

一次定向组：

```sh
npx tsx --test tests/kp-vnext-object-completion.test.mjs tests/kp-vnext-filling-interface.test.mjs tests/kp-vnext-proposal-reference-slots.test.mjs tests/kp-vnext-prompt-contract.test.mjs tests/kp-vnext-narrative-details.test.mjs tests/kp-vnext-materialization-authority.test.mjs tests/kp-vnext-npc-decision-context.test.mjs
```

62/62，exit 0。覆盖完整模型表单编解码、既有物化/叙述承诺及 NPC 修订消费者。

最终源码上的补全与提示词组：

```sh
npx tsx --test tests/kp-vnext-object-completion.test.mjs tests/kp-vnext-prompt-contract.test.mjs
npm run typecheck
```

15/15、exit 0；typecheck exit 0。首次类型检查曾发现新增拒绝返回的联合类型过宽，已收窄返回值并重验。最终组覆盖：阀门新增位置与供气状态、仅外观补全保留状态、嵌套语义壁灯、倒序提案自动编排、检定成功/失败与恢复、骰后篡改及缺失提交拒绝、真实关闭动作单独或同束执行、机械越界/陈旧基线/缺授权/条件补全/重复补全拒绝、重复 RootAction 无新事件、Viewer 与精确回放和下轮读取。

不将分批通过的检查合称最终全量回归。`git diff --check` 与最终差量检查通过。

## 真实测试

生产 Proposal Adapter、实际 DeepSeek API、原选择阶段与所选 strict schema；使用隔离 Rules 夹具。模型 `deepseek-v4-flash`，thinking disabled，max_tokens=4000；每批最多 4 次调用、10 分钟，首个明确失败即停止。输入均为原地查看外观、阀柄位置、供气状态并听声音，区分感知与解释。没有预填模型选择或修改响应。

| 批次 | 实际行为与失败 | 调用及 tokens |
| --- | --- | --- |
| v17 | 选了 completeObject/observe，只提交 observe。新写阀柄位置、朝向等，却未保存对象定义。解析、Rules、Viewer、exact replay 通过，内容固化验收失败。未确定供气状态本身不算错。 | 2 次，20,974 输入 / 782 输出 |
| v18 | 主动提交 completeObject + 两条 observe。新校验误拒绝显式引用的合法 Profile 创作授权，未进入 Rules。原稿还存在描述“半开”但状态仍为 ready、推断跨步骤引用感官序号，以及把原地看听扩写成走近和手部感知。 | 2 次，26,261 输入 / 1,938 输出 |
| v19（本轮） | 自选并提交 completeObject + observe。描述与状态均保存“关闭位、无喷流、细缝嘶鸣”，原地看听、同一步骤内推断引用正确；Rules、Viewer、下轮读取和精确回放通过。状态额外出现含义不清的“活动”，保留为文案问题。 | 2 次，21,258 输入 / 1,121 输出 |

前两批合计 4 次、47,235 输入 / 2,720 输出 tokens，未知 usage 为 0。第二批没有世界事件。各自 309 文件的源码快照终检未变。本轮另计 2 次；三批累计 6 次、68,493 输入 / 3,841 输出 tokens，未知 usage 为 0。

实现轮随后在 v19 修复授权引用误拒绝，明确状态同步、观察索引和玩家方法边界。原样离线重放 v18 Bundle，已越过 completeObject，仍被 `observation:branch-evidence-index-invalid` 拒绝；未清洗或合并模型输出，零新增 Provider 调用。当时尚无新的真实通过样例；本轮结果单独记录如下。

### 本轮 v19 真实复验

- 测试前核对 16 个最终实现文件，均与上轮 final-source 指纹一致；冻结当前运行时及测试夹具，连同配置和执行脚本共 313 文件，起止指纹一致，共享工作区对应文件也未漂移。预先保存单样例、最多 4 调用/10 分钟的计划；预检零调用、exit 0，真实执行 exit 0，实际约 9.1 秒、2 调用，均 HTTP 200 / tool_calls。没有补选、修订或重采。
- 初态只有“生锈阀门发出细微嘶鸣。”及未解释的 ready 状态，没有固化开关位置。模型自行补充黄铜/铸铁外观、竖直管道上的安装位置、圆形手轮及关闭位。description 与 observableState 都明确关闭位、无喷流、细缝嘶鸣；旧描述中的锈和嘶鸣保留。新增内容不因缺旧逐字出处而被判错。
- 对象沿原身份 revision 1 → 2；模型填写的描述和状态逐字保存，其他字段、模板、受众、其他对象定义、角色位置与战斗状态不变。11 条事件中只有一条带 completion 标记的对象修订，先于感官证据提交。观察没有物理效果；Viewer 输出当前对象，没有“玩家让阀门变为关闭”的修订主张。下一轮 RequiredContext 读取到完全一致的新定义。
- 玩家方法仍为“站在原地”用眼、耳观察。视觉与听觉分别记录；供汽被截断及残余压力作为同一 observe 结果内的推断，引用该结果的感官序号 0、1。没有新增走近、触摸、转阀、玩家移动或检定。保存事件精确回放一致；复用已保存 Proposal 响应新增调用为 0。
- 原始 observableState 为“活动；阀柄手轮处于关闭位，阀门整体不见喷流，只有细缝处漏出细微嘶鸣。”其中“活动”缺乏明确含义，Viewer 也生成“状态为 活动”。它未覆盖已明确保存的关闭位，但说明全部状态文案仍未收敛；仅凭该词不能证明模型具体误译了哪个技术字段。原稿不清洗，人工评估记录为核心合同通过、仍有文案问题。

本轮执行 `source/fixed-prompt-live.mjs` 的预检和 `--live` 各一次，随后离线核对原始响应用量、对象差量、事件顺序、Viewer、下一轮定义及源码指纹，均 exit 0。逐项结果见新目录的 `verification.json` 和人工 `assessment.json`；机器报告的 passed 仅表示脚本断言通过。

## 证据与范围

证据根目录：`/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-object-completion-live-20260909-8f17k296/`。v17 在根目录，v18 在 `followup/`；保存逐次请求、响应、上下文、Bundle、阶段日志、源码指纹、原始报告及 `assessment.json`。`followup/evidence/v19-offline-replay.json` 是未修改原稿的最终离线结果；`final-source/` 与相关日志记录最终源码。

本轮 v19 独立证据目录：`/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-object-completion-v19-live-20260909-ganysz27/`，含预设计划、313 文件源码指纹、逐次请求/响应、Bundle、11 条事件及提交后状态、下一轮上下文、机器报告、人工评估和终检。测试使用生产 Proposal Adapter 和直接 DeepSeek strict binding，固定 Beta endpoint；没有经过 `provider.ts` 的自动 endpoint 分派。

本次支持已有可见 sceneFeature 的描述与语义状态补全；新对象、Item、NPC、连接、危险机械仍用各自原有入口。不是任意字段编辑，也不会因“供气开启”一句话自动执行未声明的伤害或危险机械。

结构、权限与 hash 验证不能证明任意新自然语言内容均与旧事实一致，也不能证明模型每次都会同步状态或保留玩家方法。本轮仅证明 v19 的一个真实样例完成上述核心合同；没有统计稳定性结论。未覆盖正常 HTTP 登录、供应商自动 endpoint 分派、Room DO 持久化、最终 Narration、后续真实开关动作或完整游玩；无全量测试、build、commit、push、部署或远端 migration。
