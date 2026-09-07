# vNext 冻结选择、随机与原生待决继续

日期：2026-09-06。工作树 `cloudflare`，HEAD `258caee404e0814405eb497653ee9f00d647b773`，保留所有继承修改。完整 vNext Goal 持续执行；本记录是 V05 的实际进展，不是整个 V05 或生产替换完成声明。

## 能力合同与继承实现

重大意图歧义由 KP 提出一层完整选项，每个执行/拒绝分支在提问前经过同一 validator、lowering、Rules compiler 和预检。Room 保存完整私有计划与原始读取绑定，玩家只看到获授权的选项说明。回答只能选择原 choice ID，之后沿原 root、原机械计划执行；取消不执行后果。不得补造裁决、重复 propose、重新选择随机或重复扣资源。

本轮承接并验证的实现包括：

- `proposal-schema/provider/guidance` 的非递归 clarification continuation、全部选项 capability/ruling 检查和 parser v15；复用 `$def/proposals` 保留完整字段，未扩大 DeepSeek schema 节点门。
- `proposal-bundle-lowering` 逐分支复用普通 Bundle lowering，分支身份由外层 bundle hash 与 choiceId 派生；单项也走 atomic executor。原始外层/选项/continuation basis 进入 plan.readSet，嵌套错误保留真实 path 前缀。
- `room-bridge` 保留全部分支的原始读取集，`pending-bindings` 与 Room 三处身份绑定把回答变成原冻结命令；refusal 共用 feasibility lowering。
- `frozen-player-choice/world-interactions/events/v2-runtime` 保存私有计划、选中身份、输入 marker 和原子暂停，live 与 replay 共用执行器。合法游标前缀可重放；篡改候选、提前 settlement 和整 root 更正分别有直接证据。
- `claims` 和 Room 事件范围收集识别冻结选择的等待/取消元数据；公开 pending 不含 continuation、候选、私有依据或预留骰面。

## 本轮复现与修复

### 首次随机兑现遗漏决策依据

首次选择进入 awaitingRandomness 时还没有 atomic suspension；原 `continueFrozenPlayerChoice` 仅在已有 suspension 时核对恢复绑定，子步骤自身未引用的外层依据因此被遗漏。构造合法更新的独立语义定义后，公共 Rules 仍返回 committed；同一 event fold 也接受原输入 marker。

现 live continuation 和 `FrozenPlayerChoiceInputRecorded` fold 都复用 `frozenChoiceReadSetMatches` 核对完整 record.readSet 与 Profile；scopeProof 包含这些读取。失效时在 marker、骰子兑现和机械效果前拒绝。未把此新鲜度判断放回稳定状态 shape gate，失效状态仍可投影、取消或审计更正。

先红命令为 `node --import tsx --test --test-name-pattern='first frozen randomness|frozen input reducer' tests/kp-vnext-frozen-choice.test.mjs`，0/2、exit 1（`/tmp/zhuwei-frozen-basis-red-v2.log`）。第一次夹具错误地选了已被子步骤引用的依据，并误用了请求字段；改为独立 BASIS 与实际 randomnessRequest 后得到上述真实复现。修后 frozen/atomic/clarification 三文件 30/30、exit 0（`/tmp/zhuwei-frozen-basis-green.log`），后续新增取消与恢复验证见最终组。

### 失效方案无法取消

原 answer 在处理 cancel 前要求执行依据仍新鲜，导致合法控制者不能退出失效待决。现 cancel 只豁免执行依赖的新鲜度，保留原 pending/controller/root/choice/Profile 校验；仅提交 `PendingInputAnswered` 并清理私有计划。执行原选项仍为 causalFrontierConflict。

先红用例 `a stale frozen plan` 0/1、exit 1（`/tmp/zhuwei-frozen-cancel-red.log`），修后 1/1、exit 0（`/tmp/zhuwei-frozen-cancel-green.log`）。Room 对偶用例由另一玩家通过真实行动改变依据，原控制者继续被拒、驱逐后取消成功，无新增物品/资源/时间/骰子效果。

### 持久恢复不认识冻结回答

Room 已保存规范 `answerFrozenPlayerChoice` 与随机 journal，但 `isCanonicalAuthorityRecoveryInput` 的封闭恢复集合遗漏该输入。随机请求提交后驱逐，恢复返回 `proposalRecoveryIntegrityMismatch`。

现 `isFrozenPlayerChoiceAnswerInput` 为实时 Rules 与 Room 恢复共享五字段形状；恢复仍核对持久 hash、prepared action、proposal hash 和当前控制者，不接受新的计划。双 checkpoint 用例准确复现于 `/tmp/zhuwei-frozen-room-check-v2.log`（exit 1），修后 `/tmp/zhuwei-frozen-room-check-v3.log` 1/1、exit 0。首次夹具未在意图中指定操作对象，正确被 RequiredContext 拒绝，修正测试意图后才复现恢复缺陷。

## 代表性矩阵与最终证据

| 变化 | 当前证据 |
| --- | --- |
| 执行、只观察、取消 | Provider→Room→冻结计划→原 choice；驱逐前后无需第二份 Proposal |
| 共享 check | afterRandomnessRequestCommit 与 afterRandomnessCandidateCommit 两处中断；各自恢复一次原掷骰、一次后果，重复提交无新增效果 |
| authored Item 的原生待决 | 首轮补取 Item/Ability，冻结攻击→驱逐→选中→knockOut 待决→驱逐→原生回答及唯一后续恢复骰；最终 ItemUsed 一次、剩余数量 1；越权回答拒绝 |
| 决策依据失效 | 首次 RNG live/fold 拒绝；另一玩家真实改变依据后执行拒绝、取消成功 |
| 预检、私有性与重放 | 所有未选分支、同形选项独立命名、私有计划/候选隔离、refusal 成本、合法前缀、篡改/重复 opening、整 root 更正 |
| 直接正常路径 | 原 observe/worldInteraction 格式修订与检定恢复继续通过 |

最终源码检查均 exit 0：

```sh
# 61/61
node --import tsx --test tests/kp-vnext-frozen-choice.test.mjs tests/kp-vnext-atomic-input.test.mjs tests/kp-vnext-clarification.test.mjs tests/kp-vnext-claims.test.mjs tests/deepseek-strict-tool-provider.test.mjs

# 7/7，26 跳过
npx vitest run tests/kp-vnext-provider-room.test.ts -t 'freezes clarification through Provider|resumes a frozen clarification check|resumes a frozen authored attack|lets the controller cancel a stale|repairs .* representation errors|keeps a repaired check'

npm run typecheck
```

日志 `/tmp/zhuwei-frozen-final-node.log`、`/tmp/zhuwei-frozen-final-room.log`、`/tmp/zhuwei-frozen-final-types.log`。Room 使用真实本地 DO/权限/持久 journal/Rules/replay，Provider 为确定性替身。原生待决用例含多次驱逐、完整 replay 与两个随机阶段，首次超过默认 5 秒；仅该用例设置 30 秒上限，实际最终组用时见日志，没有调整生产超时或全局测试配置。最终文档链接与 `git diff --check` 通过。

一名代理只读复核三项修复，无并行编辑或集成。未做真实模型对照，未改变 round30 的失败结论。没有全量回归/Lint/build、部署、push、migration、Secrets 修改或数据退役。

## 下一步与完整 Goal 缺口

V05 仍未全完成：highRisk 的 wire/provider/lowering 尚未开放；完整语义确认是否必要仍需真实 KP 证据，先例、合理失败及重检边界亦需对应游玩验收。

已定位下一条实现接缝：明确意图的 highRisk 复用共享 check/direct executor；需要确认时放入完整 clarification continuation，确认后不再次提问或 propose。额外已接受成本必须在共享执行计划中单独冻结，不能混进与 Ability 固定成本逐字相等的字段。耗时行动沿既有 startActivity/interruptActivity/completeActivity 与持久 due 队列，completion 扩为非递归 frozen atomic plan；开始/到期的 lifecycle 读取需单独绑定 owner/timeline/start/due/self ID，不能刷新所有原事实 hash，也不能把自己加入集合造成自引用。不能借 refusal 的即时 FictionTimeAdvanced 冒充 Activity。

上述为下一步设计接缝，尚未实现。真实普通/复杂主链、双玩家 20+ 意图、A–O、整桌费用、部署与生产采用、旧数据/旧路径退役继续按完整 TODO 推进；120 金标和长期认证保持后置。
