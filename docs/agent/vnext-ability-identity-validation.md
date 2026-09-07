# 能力身份被误判为骰式的修复回执

日期：2026-09-07，`cloudflare` 开发期。此次修复恢复 SPEC 0013 的文字/身份与机械公式边界，不修改 Compiler Profile、定义规范化、stable op id、definition hash 或 compiled hash 算法。

## 症状与根因

[round69 原始证据](vnext-round69-live-evidence.json) 保持 `setupInitializationFailure`：正常注册 201、开房/锁卡 200 后，startGame 返回 HTTP 200、`ok=false` 和“权威房间初始化失败，请稍后重试”。三句固定意图尚未发送，模型 0 次调用、0 token、¥0；这不是 KP 提案格式或模型稳定性结果。

离线沿原始初始化输入定位到 `ability-compiler.ts` 的 `validateDice`。它曾扫描定义中的所有字符串，将正常角色 UUID 派生能力 ID 内的数字/d 片段误读为超过 1,000 颗的骰式，返回 `definitionComplexityExceeded`、`/definitionId`、`a dice term exceeds 1,000 dice`。同一误判也能发生在引用和自由说明，无须特定角色、物品或法术名称。

随后原因在初始化传播中依次被汇总为 `playerAbilityDefinitionInvalid` → `buildInitialState undefined` → `invalidInitialization unknown reference or duplicate` → startGame 通用中文失败。**本修复仅改误判源，没有改这条汇总传播链，不能称初始化诊断已经端到端完善。**原始账户/锁卡正文保留在私有诊断目录，不向回执复制凭证或完整身份。

## 修改与直接影响

唯一生产修改是 `app/_runtime/lib/rules/profiles/ability-compiler.ts`：递归检查实际 `formula` 字段中的字符串，包括深层显式 resolution 节点；其他字符串不参与骰子 terms/count 统计。原 32 terms 统计方式、每 term 1,000 骰上限、错误 code/path/reason、图构造和 hash 算法保持。未新增语法兼容、备用编译器、随机调用或资源处理。

依据 [SPEC 0013 §4](../specs/0013-versioned-runtime-profiles.md#4-abilitydefinition-与受限-mechanicop-compiler-profile)，自由说明文字本身不能执行机械，骰式属于显式随机节点；将不透明 ID/引用当公式是实现偏离。本修复不新增可表达机械或修改 Profile 含义。

直接消费者核查确认：施法、武器、物品治疗、临时 HP、环境/区域伤害及显式 resolution 的能力骰式统一进入 `formula`。上游物品 `damageDice` 在能力编译前转换为 formula；`diceExpression/dice` 是后续权威随机请求的文本/结构化 terms，没有对应的能力定义执行字段被遗漏。正常角色注册仍沿原 `planPlayerAbilityCatalog` 进入同一编译器；已注册定义与 replay 仍使用冻结图/hash。

测试消费者为 `tests/ability-profile-v2.test.mjs` 和 `tests/kp-vnext-ability-operation-room.test.ts`；真实目录执行及 authored diagnostics 的直接行为测试一并验证。未修改共享类型、公共签名或 DTO，故此次未再次运行 typecheck。

## 定向验证

| 路径 | 证据 |
| --- | --- |
| 原故障的通用反例 | 合法 ID、resourceRef 和说明中包含看似骰式的文本，实际公式合法时正常注册；保留原定义和规范 hash |
| 最高风险深层公式 | healing、temporaryHitPoints、显式 resolution 的 `1001d*` 仍给原路径/原因并拒绝，无事件；超 32 terms 仍拒绝 |
| 既有正常路径 | 合法高数值、规范化 hash、冻结图/replay、物品成本权限及真实 cure 一槽一骰/治疗继续通过 |
| Room 直接影响 | 正常 native 施法、随机后驱逐恢复、重复提交及受限第三次修订通过，没有额外调用、骰子或扣槽 |
| 原初始化输入 | 私有离线诊断目录中 builder/profile 两个维度的 4 个组合全部初始化通过；这不改判原 round69 |

实际命令和结果：

1. 修复前 `npx tsx --test --test-name-pattern='identity, references|dice complexity' tests/ability-profile-v2.test.mjs`：2 项中 1 fail、1 pass，exit 1，`/tmp/zhuwei-round69-compiler-red.log`。失败确认为资源引用被误读为骰式，公式上限对照仍通过。
2. 修复后 `npx tsx --test tests/ability-profile-v2.test.mjs tests/kp-vnext-authored-diagnostics.test.mjs tests/registered-spell-execution-boundary-vnext.test.mjs`：22/22，exit 0，`/tmp/zhuwei-round69-compiler-green.log`。
3. `npx vitest run tests/kp-vnext-ability-operation-room.test.ts`：5/5，exit 0，`/tmp/zhuwei-round69-compiler-room.log`。其中 `interrupted:afterRandomnessCandidateCommit` 是预期恢复注入，最终无测试失败。
4. 在 `/tmp/zhuwei-round69-init-diagnosis` 下执行 `npx vitest run tests/round69-init.test.ts --config /tmp/zhuwei-round69-init-diagnosis/vitest.config.ts --root /tmp/zhuwei-round69-init-diagnosis`：4/4，exit 0，`/tmp/zhuwei-round69-init-diagnosis/post-fix-room-recovery.log`。
5. 根代理已运行 `git diff --check`：exit 0。文档收尾没有再跑检查。

22、5、4 是不同证据组，修复前后的同名测试不累加为新增覆盖。定向结果只支持本次误判恢复与直接影响。

## 剩余缺口与真实验证边界

round69 的失败、0 模型调用、无成功初态和原源码起止 321 项一致证据保留。后续 round71 已完成正常注册、锁卡、开始及初态自动校验；首施法结果不在本回执证据内，不据初始化恢复声称施法成功或模型修复成功率提高。

初始化错误汇总链、既有整定义累计 terms 与规格“单骰式”表述的差异、三整卡更正审计膨胀及完整多人/持续施法验收继续独立待办。当前 321 项源码冻结后的本次收尾只写文档；没有 push、部署、commit 或远端 migration，完整 Goal 保持 active。
