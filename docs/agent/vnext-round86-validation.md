# Round86：首句就倒在回应依据引了规则档案

2026-09-08 下午，源码 `373e377`（round85 之后：裁决上重复的 `basisRefs` 丢弃）。场景同 round82–85。正常注册建卡，初态核对通过。只发了第一句，**2 次调用后停批**，¥0.150444。要验的修复没有被碰到。

## 发生了什么

填写本身是一份干净的三张表：裁决 directSuccess、`duration: "5min"`，裁决上没有多余字段；步骤一行 social，`retryChange: {kind:"none"}`，`outcomeBinding: "always"`；结果一行，`consequences: []`。round84/85 的两种残留都没出现。

倒在 `responseBasis`：模型写了四个引用——`profile-context:module:black-oak-will:social-resolution-v1`、瓦罗的定义、瓦罗本人、场景。前三批过关的写法里没有第一个。社交判定的规则档案是 KP 的依据，不是瓦罗**知道**的东西；lowering 只接受该 NPC 自己的决策上下文里的引用（`social:foreign-npc-basis`，`REFERENCE_UNAVAILABLE`），并且按设计不可修订——换掉回应所依据的知识不是表示层修补。于是没有第三次调用，`PROPOSAL_REFERENCE_INVALID`。

另一处没走到校验：`addressedThreadRef` 写成了行动者的 `module-opening` 记录引用（一个字符串，不是线程）。它合不合法，本批不知道。

瓦罗这次的回答是直接拒绝（原件不离手、不当面抄），`consequences: []`——与 round85 的带条件还价不同，同一句话、同一上下文，KP 的世界选择再次不同。

## 判断

schema 里 `npcContext.ref` 是自由文本，只靠描述说「该 NPC 的决策记录或它的知识条目」；冻结上下文里其实已经列出了每个 NPC 可引用的知识（`citations.npcKnowledge`），而 round85 通过的三个引用（NPC 本人、其定义、场景）也在 NPC 的决策上下文里。抓到的请求里，这个槽位的字符串变体**已经**带着 10 个引用的 `enum`——它在数组项的 anyOf 里，DeepSeek 严格模式没有校验。这是 anyOf 分支内约束不被校验的第三个实例（round84、85 是多余属性，这次是枚举）。修复：没有选生产者时数组项就是一个平的枚举字符串，`playerExpression` 作保留成员并入；只有选了 worldFact 生产者才回到 anyOf。parser v49。跨 NPC 的精确匹配仍留在 lowering，仍不可修订。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 0，0 条事件。323 项源码起止 `allEqual=true`。[机器证据](vnext-round86-live-evidence.json)。私有证据在 `/tmp/zhuwei-round86-npc-preparation/evidence`。

## 未覆盖

裁决 `basisRefs` 丢弃的真实触发；observe 单独成根；承诺第 2/3 层正例（连续第十二批 `consequences: []`）；`module-opening` 作为 `addressedThreadRef` 的合法性。
