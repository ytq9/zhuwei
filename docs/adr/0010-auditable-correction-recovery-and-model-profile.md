# 更正、恢复与模型 Profile 均可审计

- 状态：已接受（本 Goal 授权）
- 日期：2026-08-26
- 关联规格：SPEC 0003、SPEC 0005、SPEC 0011

## 背景

静默覆写状态无法解释旧 Receipt 或骰面；仅保存快照无法从 D1 归档恢复；模型失败若触发备用结果会替玩家或 KP 作出新决定。

## 决策

未提交错误可以废弃提案重新准备；已提交错误只能用前向补偿事件或显式更正分支处理。两者都保留原事件、骰面、Receipt、原因类别、授权 principal 与受影响作用域；秘密理由继续按 Viewer 投影脱敏。

Room DO 的连续事件是活跃状态唯一来源，快照只是缓存。D1 保存带规则/模组/事件 schema/分支/哈希的不可变归档副本；重建先验证连续性和哈希，再由绑定版本的 `replay` 产生状态，不能读取 `game_states` 补洞。模型、网络、断线或重启停在最近稳定阶段：未冻结可重试提案，已冻结复用同一提案和随机，已提交只恢复 Receipt/投递，不重复世界后果。

战斗更正采用事件 fold 前的完整 `combatRuntime` 确定性快照，而不是只逆转单一实体；它覆盖遭遇、先攻、轮/回合、反应、战斗待决、结论与随机 continuation，并按因果闭包逆序恢复。Room 的 SQL 待决鉴权索引不是第二状态：live commit、归档恢复及更正后同步都从同一 Rules 权威待决枚举重建，旧待决不得在投影消失后仍可回答。

更正事件和恢复快照不迁移房间的 runtime manifest。当前 authoritative-v2 只有在首次正式发布前可以随本 Goal 冻结其待发布 hash；发布后若更正折叠语义改变 replay hash，必须新增 interpreter/manifest 并保留旧实现。

生产 KP 使用显式版本化 Profile，默认选择 Cloudflare Workers AI 免费额度可用模型；超预算或模型失败返回稳定的 `retryableFailure`/`needsKp`，不自动换成会改变语义的模型，不伪造旁白。运行日志只允许关联 ID、版本、分类、耗时/用量桶和哈希等白名单字段。

## 后果

更正和恢复都必须通过公开 Room Authority 合同并有故障注入、归档重建、多 Viewer 与日志脱敏测试。模型升级是记录在案、可回滚的 Profile 变更，而不是无痕配置漂移。

## 验收场景

1. 已提交错误只通过授权的前向补偿或显式更正分支处理，保留原事件、骰面、Receipt、原因类别和因果闭包；非授权 Viewer 只见脱敏结果。
2. DO 丢失后只凭连续且哈希有效的 D1 事件归档、绑定 manifest 与随机恢复日志重建；缺口、篡改、错根行动或错 Profile 一律 fail closed。
3. prepare、提案冻结、随机持久化、事件提交和投递任一阶段故障后均恢复到同一稳定语义，不重复掷骰、世界后果或旁白。
4. 模型失败与超预算返回稳定失败状态，不自动换模型或伪造结果；结构化日志不包含 Prompt、秘密、正文、token、cookie 或原始随机种子。

## 实现映射

- 更正与回放：`app/_runtime/lib/rules/v2/correction.ts`、`app/_runtime/lib/rules/v2-runtime.ts`
- 归档与恢复：`app/_runtime/lib/room/archive.ts`、`app/_runtime/lib/room/durable-object.ts`
- Profile 与遥测：`app/_runtime/lib/kp/provider.ts`、`app/_runtime/lib/room/telemetry.ts`
- 验收：`tests/archive-correction-v2.test.ts`、`tests/combat-archive-correction-v2.test.ts`、`tests/archive-do-resume-v2.test.ts`、`tests/randomness-recovery-v2.test.ts`、`tests/structured-telemetry-v2.test.mjs`
