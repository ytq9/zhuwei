# 可观察资料分组与 KP 描写边界

## 后续实现与当前验收状态

2026-09-09 已新增 `completeObject`，用于把 KP 新确定的已有场景对象描述/状态保存回原身份，并与玩家实际操作分开；当前 guidance v19、parser v56。本地路径已通过；本轮 v19 真实单样例主动填补全并保存关闭位、外观及位置，原地观察、Viewer、下轮读取和回放通过，仍有状态多写“活动”的文案瑕疵。v17/v18 两轮失败保留，尚无统计稳定性或完整 HTTP/Room/Narration 验收结论。当前结果见[已有对象补全验证](vnext-object-completion-validation.md)。下文保留此前上下文分组与 v13–v16 的历史证据，不作为新入口的验收结论。

## 2026-09-09 用户澄清后的更正

用户强调这是 KP 主导、随游玩展开的世界，允许无关紧要的小叙述、小描写，并进一步明确：尚未定义的“供气开启”“约一人高”可以由 KP 首次决定，后续世界状态应承接该叙述。此前把“没有预先写在资料里”当作语义错误，颠倒了创作与固化的顺序；只放宽小修饰词仍不足以表达 KP 的叙事权威。

当前判断以是否违背锚点、既有事实、叙述承诺、权限或机械规则为准。因果/机械影响决定何时、怎样固化，本身不是禁止创作的理由：

- 合理的修饰、语气、少量感官色彩可以补充，不要求每个词都有旧记录。新的非因果环境内容沿既有轻量叙述承诺保存，不要求首次描写就完整物化。
- 材质、尺寸、位置或“未见某物”不因所属类别就一律禁止。需要判断它在本次情境中是否改变线索、可达性、危险、资源或操作结果；成为行动依据时再按已有承诺固化，不任意改写已经说出的内容。
- KP 可以决定授权留白里尚未确定的情况，包括有意义的新事实和已有对象未确定的属性。顺序是 KP 创作并确定内容 → 对应提案记录该内容 → 规则执行和后续世界承接该内容；无需先找到证明同一句新内容的旧记录。当次产生因果/机械作用时，同束固化并使用；仅作非因果环境叙述时先保存轻量承诺，后续固化不得重新选择位置、状态或外观。
- 把 ready/barrier 等技术码直接说成角色看见的世界信息仍是用途错误。区分“KP 创作并确定新情况”与“技术码已经证明该情况”，不能仅因资料中有某个代码就认为角色已亲见其含义。

guidance v15 撤掉笼统禁止补充描写的条款；v16 进一步将“KP 先决定、固化承接创作”写入选择与填写共用说明。observe/worldInteraction 的 evidence/basisRefs 明确允许依据同束新固化内容观察；materializeObject 的 description/observableState 说明要求保存 KP 新决定的描述和状态，已有承诺保持一致。上下文用途分组、引用权限和服务端接受规则不变，没有增加语义审查 agent 或真实调用。

上轮样例也须按此标准理解：暗色锈斑、不大的金属装置等不能仅因缺逐字出处被判错；“未见明显铭牌”未必是决定性缺失事实；“约一人高”“供气开启”均可以是合法的新世界决定，后续状态应按该决定保存。应核对具体冲突及创作内容是否得到承接，不能仅由未预写或未经确认的几何解释判错；也无法仅凭 ready 与“开启”同时出现就证明错误翻译。原始响应保留，下文记录的是当时的实现、测试与旧评估，不将其旧失败理由直接作为当前标准，也不据此宣布新版真实通过。

v15 定向提示词回归修改前 exit 1。共享目录首次运行 prompt-contract/observable-context 因其他同期修改正在重命名 socialSourceArgumentDiagnostics 而在 import 阶段失败；在上一份完整冻结源码上叠加本次三个文件后，相同目标组 21/21、exit 0。随后共享目录复跑仍有 lowering 的旧名称引用，exit 1；不改写其他任务文件或把隔离检查当成整树集成通过。隔离目录为原证据目录中的 `kp-freedom-v15/`。

v16 检查时上述共享目录导入已接齐。修改前，既有叙述承诺的创建、后续固化和冲突拒绝 3/3 通过，确认底层已有承接 KP 创作的路径。修改后在当前共享目录运行 `npx tsx --test --test-name-pattern='observation|physical interaction|environment commitments|later explicit reference|immutable commitment|strict tool default sentinels' tests/kp-vnext-prompt-contract.test.mjs tests/kp-vnext-narrative-details.test.mjs tests/kp-vnext-materialization-authority.test.mjs`，6/6、exit 0；覆盖提示词与表单、无预先实例的新环境内容、显式新状态覆盖模板默认、按原描述固化、公开投影/replay，以及改写原承诺的拒绝。既有通用用例已覆盖这些直接边界，未新增同义断言。v15/v16 均零真实 API 调用；确定性通过不等于已证明模型会稳定选择正确表单和固化全部新事实。

## v13/v14 实施与测试历史

2026-09-09，用户要求优先区分世界内可观察资料与裁决所需几何、机械数据，允许忠实改述，禁止把技术状态自动解释为亲见事实。以下保留该呈现与提示词修改，以及当时按过严标准作出的两轮真实 DeepSeek 评估；当前判断以上节为准。

## 症状与边界

复用上次保存的观察请求和响应，运行 `npx tsx /tmp/zhuwei-fixed-prompt-live-20260909-u6ir3uiu/diagnose-observation.mjs`，exit 1、零外部调用：模型把输入中的 `ready`、`barrier` 与裸坐标写入感官证据。解析、lowering、Rules 提交与 exact replay 均通过，错误文字进入 Viewer 知识。

第一个已确认的违规位置是模型输出。原模型上下文把自然描述、几何和状态码混在原始 `value` 中，提示词又要求“保留记录类型与状态”；这是可修正的用途歧义，但不能证明它独自导致所有输出错误。依据 SPEC 0001 §§3.3、7、9 和 SPEC 0016 §§3.2、4，已有事实、来源主张、当前感知及新创作必须保持边界，开放创作仍可按授权固化。

## 修改与直接消费者

- `app/_runtime/lib/kp/vnext/proposal-context.ts`：模型上下文 v6。对原冻结引用目录中可观察的真实对象，将已有名称、描述和材料描述移入 `value.worldDescription`，其余原始字段移入 `value.adjudication`。按现有记录类型处理人物、场景、几何物件、语义对象和物品/组件；不按名称或某个状态码分派，不生成新的感知文案。没有自然描述的对象不会从机械数据获得一段自动补写的外观。
- 所有字段只移动一次，重新组合能恢复原始记录。服务器的 RequiredContext、五态 Availability、引用权限、版本/hash、read binding 均不改变；非物理记录保留原结构与知识归属，私人 NPC 包装不会成为感知描述。该观察夹具模型上下文从 14,528 增至 14,824 UTF-8 字节，增加 296 字节，未截断资料；这不是 token 测量或提示词缩短结果。
- `proposal-guidance.ts`：最终 policy v14，选择与填写共用用途说明并纳入 workflow hash。允许忠实改述有明确世界含义和感知依据的内容；名称只用于定位，声音不能写成视觉，未描述不能推出不存在，未知技术状态不能自行翻译。几何按单位参与空间裁决，碰撞范围不自动证明具体外形或安装位置。删除 worldInteraction 感官说明中要求保留英寸 Geometry 的歧义。
- `proposal-schema.ts`：observe/worldInteraction 共用的感官字段说明与上述边界一致；物化对象的 description 明确承载世界内描述，状态字段不自动提供外观或声音。worldFact 仍表达事实正文，不被强制改成感官描述。所有工具字段、枚举、必填规则及服务端接受约束保持不变。
- 正常 Adapter、Provider 重发、Room journal 和 NPC work 都调用同一个 `proposalModelContext`；Room 仍从原冻结上下文重构并校验精确请求。没有新增 agent、模型调用阶段、语义审核、正则清洗、自动补事实或放宽 Rules。

## 定向检查

- 新回归先因夹具没有将对象放入 focusRefs 而失败；修正夹具后，修改前表现为两个呈现断言失败、一个忠实视觉/听觉改述路径通过，exit 1。没有将夹具缺引用误当作业务根因。
- `npx tsx --test tests/kp-vnext-observable-context.test.mjs tests/kp-vnext-observation-reference-surface.test.mjs tests/kp-vnext-prompt-contract.test.mjs tests/kp-vnext-selection-amendment.test.mjs tests/kp-vnext-unparsed-reemit.test.mjs`：34 通过、1 失败，exit 1。失败是旧 Provider 夹具直接传普通文本；改为生产调用方使用的模型上下文后，仅重跑 observation-reference-surface，3/3、exit 0。
- v14 感官说明修改后重跑 prompt-contract：10/10、exit 0。上述共 35 个不同 Node 用例分批得到通过结果，不声称最终同一次完整组通过。覆盖字段无损分组、未知状态不自动生成外观、视觉/听觉忠实改述提交与知识投影、隐藏/异地目标拒绝、陈旧 read binding、选择/补选/重发和 NPC 调用方。
- `npm run typecheck`：在 v6 DTO 修改后 exit 0；其后仅有提示词与测试夹具修改。
- `npx vitest run tests/kp-vnext-provider-room.test.ts -t 'recovers a durably saved expanded response after eviction'`：最终 1/1、44 项未运行，exit 0。首次失败是测试仍假定单一表单存在 `anyOf[0]`；实际 schema 已折叠为单一对象。只修正测试遍历，并将旧“模型 entries 等于原始 entries”断言更新为精确模型 DTO。覆盖保存、驱逐、恢复、篡改请求拒绝、零新增 Provider 调用和零重复世界变化。
- 由于变更对象是模型请求呈现，在 Node/类型/有界真实探针之外追加上述一项现有 Room 恢复用例，没有扩展整个 Worker 文件或全量回归。

## 真实模型结果

原场景、原玩家输入：站在原地观察阀门外观、听声音并区分解释。原自然描述是“生锈阀门发出细微嘶鸣。”，状态为 `ready`；几何记录为 `barrier`，elevation=0、height=10，场景单位 inch。两轮均使用 `deepseek-v4-flash`、thinking disabled、max_tokens=4000；每轮最多四次调用、十分钟，首次明确失败停止。没有改写模型响应。

| 轮次 | 结构与提交 | 当时认定的视觉问题（已更正标准） | 当时判定 |
| --- | --- | --- | --- |
| v13，用途分组与忠实改述说明 | 解析、lowering、Rules、Viewer、exact replay 与保存响应复用通过 | 虽未再直抄代码，却写出“约一人高的位置”；没有描述支持，几何也不符 | 语义失败，停批 |
| v14，进一步区分碰撞几何、外观与缺失信息 | 同上 | 写出“处于开启（供气开启）的位置”“未见明显铭牌或文字标记”；状态含义与局部不存在均无依据 | 语义失败，停批 |

两轮听觉均保持为细微嘶鸣，未混入视觉。当时以缺少旧描述为由否定上述视觉内容的判断已撤回；无法单独证明第二轮“开启”一定由 `ready` 翻译而来。v13 选择 observe，v14 额外选了未使用的 social/worldInteraction，表单集合不同，不能作严格成功率对照。

v13 实际 2 次调用、19,943 输入/672 输出 tokens；v14 实际 2 次、28,443 输入/721 输出。合计 **4 次、48,386 输入/1,393 输出 tokens**，未知用量 0，全部 finish_reason=tool_calls，未耗尽输出上限。没有继续开第三轮。

runner 的 `passed` 只代表机器结构与有限内容断言通过，人工语义审查结果另存 `assessment.json`，两轮总判定均失败；原始机器报告没有被覆盖成另一份结果。每轮 564 个源码/测试/配置快照终检未变化。v14 之后共享目录另有其他任务修改测试，不能把整个共享 diff 认作本任务。

证据根目录：`/var/folders/lc/5bh5fpv155qbvf0cg04z59300000gn/T/zhuwei-observation-context-20260909-glcitxrf/`。第一轮在根目录，第二轮在 `followup/`；包含逐次请求、响应、原始上下文、Bundle、Rules/Viewer 结果、journal、源码指纹及各自 assessment。`verification.json` 汇总字节与指纹，`workspace-changes.patch` 记录本任务相对开始时的改动。未保存认证请求头或复制 `.dev.vars`。

## 未覆盖与剩余问题

结构分组与先前 Room 恢复已有本地证据；v16 尚未运行新的真实模型验收。当前 Rules 验证引用、主体、权限与机械，不要求新创作或普通修饰词由旧文本逐句推出。后续验收应检查真实冲突、越权、机械执行及创作是否被一致保存，不能把“产生新事实”本身计作错误，也不能靠删改非法输出制造通过。

真实探针使用正式 Adapter 与隔离 Rules 夹具，没有正常 HTTP 登录、真实模型驱动的 Room DO/Narration 或完整游玩。旧物品拾取失败不在本次修改范围。未运行全量测试、build、部署、远端 migration、commit 或 Git push。
