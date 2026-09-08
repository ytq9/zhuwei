# Round85：三张表第一次完整跑通两句；第三句倒在裁决上多抄的一行 basisRefs

2026-09-08 下午，源码 `b46b423`（parser v48：三张平表，continuation 也拆表，步骤内结果直接拒）。场景同 round82/83/84：三句小时级句子。正常注册建卡，初态核对通过。三句都发了：前两句提交并发布，第三句在解码阶段被拒，**10 次调用，¥0.499437**。

## 首句：三张表干净地过了

4 次调用（offer、submit、旁白、审核），零修订。填写只有三张表该有的东西：`decision` directSuccess、`duration: "5min"`；`steps` 一行 social，`outcomeBinding: "always"`，`retryChange` 与 `addressedThreadRef` 都是干净的 `{kind:"none"}`；`results` 一行 `{kind: social, step: 0, branch: result}`，回应摊平在 `responseKind / responseText / responseMotive / responseBasis`。步骤里没有任何 `result` 写法——round84 那份从 continuation 学来的残留，随 continuation 拆表消失了。

时钟 0 → 300000000，`FictionTimeAdvanced` 是本根首条事件。审核五项 pass。

第 2 层仍然空：瓦罗的回答是一句**带条件的还价**——原件不离手、不抄全文，「你若报得出要登记去往哪一处行署，我便只抄应抄的那一页，盖个对章，留在账台，一个钟头内你来取」，末了问「这样成不成」。`consequences: []`，没有 PromiseMade、没有计划、没有 Activity。这是 KP 的世界选择，不是格式失败；但也意味着承诺合同第 2/3 层的真实正例又没等到。

## 第二句：一个半小时的等待有了旁白

4 次调用，零修订。选择阶段要了 `passTime + observe`，填写只出 passTime 终结形（`steps: []`、`results: []`），observe 被丢弃——补选后丢弃的现象第一次在三张表下留下真实证据。`durationMicros: 5400000000`；时钟 300000000 → 5700000000；`ActivityStarted / FictionTimeAdvanced / ActivityCompleted`。

旁白是模型自己写的：「你在厅里等了一个半小时，等待结束了。」——只陈述时间过去，没有替瓦罗补出抄录或送达。审核 pass。gate2 走 `pending`（waited-without-plan）。

## 第三句：裁决上多抄了一行

2 次调用后停批。offer 选了 `observe`；填写的三张表本身又是对的：observe 步骤带 inquiry / method / focusRefs / existingFactRefs，结果行一条 `sensoryEvidence`，说账台上没有抄好的副本。但 `decision` 上多了一个 `basisRefs`，内容与 `steps[0].basisRefs` 逐项相同。

directSuccess 裁决的 schema 里没有这个字段；提示词也写着「行动的根依据由各 step 的 basisRefs 汇总」。DeepSeek 严格模式再一次没有拦下 anyOf 分支里的多余属性（round84 是 `steps[0].result`，这次是 `decision.basisRefs`）。解码器把裁决上的 `basisRefs` 当作对服务器所有字段的声明，`filling:server-owned-field`，不可修订，`PROPOSAL_FORM_INVALID`。世界里账台没有被查看。

`existingFactRefs` 里的两个引用（一个 `knowledge:` 前缀、一个 `module-opening` 引用）没有走到校验，是否合法未知。

## 修复（本批之后，未经真实验证）

裁决上的 `basisRefs` 若与服务器从各步骤推导出的列表**完全相同**（去重、排序、剔除 prospective 之后），它不携带任何信息，直接丢弃；任何其它列表仍按服务器所有字段拒绝。与 round84 的「带空字段的 none 归一」同一原则：只接受不带信息的重复，不折叠有歧义的写法。

## 收尾

`services.py shutdown` 两角色 `verifiedAbsent=true`，端口无监听。replay `exactState=true`，stateVersion 14，14 条事件。323 项源码起止 `allEqual=true`。[机器证据](vnext-round85-live-evidence.json)。私有证据在 `/tmp/zhuwei-round85-npc-preparation/evidence`。

## 未覆盖

承诺第 2/3 层真实正例（连续第十一批 `consequences: []`）；observe 单独成根的真实提交；修复后的裁决 basisRefs 丢弃只有本地测试。
