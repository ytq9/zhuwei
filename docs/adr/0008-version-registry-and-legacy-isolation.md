# 版本注册表固定解释器并隔离 Legacy

- 状态：已接受（本 Goal 授权）
- 日期：2026-08-26
- 关联规格：SPEC 0006、SPEC 0012、SPEC 0013

## 背景

仅用一个当前常量判断房间会让旧事件被新代码静默重算，也会让未知版本落入默认分支。模组版本、事件 schema、投影与模型恢复同样需要可审计绑定。

## 决策

每个房间在创建时固定 `rulesetVersion`、`moduleVersion`、`eventSchemaVersion`、`projectionVersion` 和模型 Profile。版本注册表必须显式解析完整组合；未知或不兼容组合拒绝启动，禁止回退到“当前版本”。

当前重构版本锁定 D&D 5e 2014 / SRD 5.1。旧 `dnd5e-2014-srd5.1-v1` 房间由只读边界清晰的 Legacy Adapter 解释；新房间使用独立版本且不读写 D1 `game_states`。新事件带完整版本清单、活动分支、连续序号与哈希；回放只使用事件写入时绑定的解释器。

Registry 采用只增的完整 manifest→interpreter 映射。default manifest 只供新 genesis 选择；部署后改变 default 不能影响既有 genesis。权威 state 缓存 genesis 的 `runtimeManifestRef`，`step/project` 同时核对调用 manifest 与该 pin，`replay` 以 genesis manifest 选择并逐事件核对相同闭包；未知、错 hash 或 state/genesis 不匹配均 fail closed。测试切换 default 时使用隔离 Registry，不修改 production default，也不把合成 Profile 注册进生产。

模型 Profile 可在动作边界按已记录恢复策略升级，但不得改变已冻结提案、随机或事件语义；每次模型输出记录非敏感的 provider/model/profile/attempt 元数据。

## 后果

任何规则、事件结构或机械目录的不兼容变化都需要新版本和迁移/适配策略。已发布 interpreter 只有在活跃房间与可恢复归档均不再引用或存在获批迁移后才能删除。Legacy 测试只能证明旧版本兼容，不能抵扣新版本验收。

## 验收场景

1. Genesis 固定完整 runtime manifest；改变新房间 default 后，旧状态与归档仍只由原 manifest 解释。
2. 未知版本、错误 hash、state/genesis pin 不一致和事件版本漂移都 fail closed，不能回落到当前解释器。
3. 只有精确旧规则集可取得 Legacy Adapter；新规则房间不能直接导入旧 engine 或读写 D1 `game_states`。

## 实现映射

- Profile 与 Registry：`app/_runtime/lib/rules/profiles/canonical.ts`、`app/_runtime/lib/rules/profiles/manifests.ts`、`app/_runtime/lib/rules/profiles/registry.ts`
- Genesis/回放绑定：`app/_runtime/lib/rules/v2-runtime.ts`
- Legacy 隔离：`app/_runtime/lib/rules/legacy-adapter.ts`、`scripts/check-modules.mjs`
- 验收：`tests/runtime-profiles-v2.test.mjs`、`tests/legacy-rules-adapter.test.mjs`、`tests/archive-do-resume-v2.test.ts`
