# round29：知识来源填表错误与提前诊断

日期：2026-09-06。继承的真实批次已经停止；本报告补齐其源码修复和验证记录。本次收束按用户的 KP 诊断开发任务执行，不继续生产替换、不部署、不 push，也没有追加模型调用。

## 原失败与证据

批次从正常 Cookie 注册、开房、建卡、开团与开场 ACK 进入 NPC 对话。准备过程没有模型调用；第一行动发出一次 `deepseek-v4-flash` Proposal 后失败停批，没有执行后续行动、重复提交或旁白。原私有请求、响应和会话资料仅保留在本地，公开报告不包含 NPC 知识正文或 Cookie。

实际输入 31,358 tokens（缓存命中 0、未命中 31,358）、输出 1,534 tokens，调用 13,202ms，按当时核验的空闲价格计 ¥0.05394。预设上限为 2 行动、10 次调用、580,000 输入、81,920 输出、10 分钟及最高价格 ¥2.50；上限不代表实际用量。每个 HTTP 请求上限为 5 次调用，首个明确失败停止。

调用时 parser 和 lowering 接受，Rules 返回 `privateOrUnknownReference / social:materialized-knowledge-unavailable`，公开结果为 `needsKp / PROPOSAL_RULES_DIAGNOSTIC / notCommitted`。实际 SQLite 提取与 `replay` 核对：状态精确等于 genesis，0 事件、0 Receipt、0 Claims、无随机、资源与虚构时间无变化。没有已提交 Claims，不能据此宣称旁白验证通过。

源码清单为 [round29 manifest](vnext-round29-source-manifest.json)，hash `b0236e36cd76ae479805407d3738101fd7fdc843281e106fe494c3817c2a80e4`。调用完成后、修复前核对 301 个文件均未变化；当前修复后源码不再等于这份历史清单。预算、usage、原拒绝和 replay 摘要见 [脱敏证据](vnext-round29-live-evidence.json)。本地 server/capture 已停止，收束时复核 4320/4321 无监听。

## 根因与修改

原提案用 `materializedKnowledge.definitionRef` 填写 NPC 已持有的 knowledge 引用，却没有本束新事实 producer。该 variant 表达同束新建 worldFact 的 prospective handle；已有知识应选 `npcContext.ref`。工具字段说明未明确这一区别，原源输入校验未定位错用，错误直到 Rules 才被拒绝。

- 在原 `proposal-validator.ts` 的 social source 校验内，使用现有 `isLocalHandle`，精确报告成功/失败分支中每个错误 `definitionRef`；不新增 Rules 或状态写入路径。
- 诊断为 `REFERENCE_UNAVAILABLE`，约束 `social:materialized-knowledge-requires-bundle-producer`，预期是同束 always producer 的 prospective worldFact。`repair.allowed=false` 明确说明更换知识来源或创建事实需要决策，不能自动换 variant、加 producer 或补造经历。
- `proposal-schema.ts` 与 `proposal-guidance.ts` 同步已有知识和新建事实的字段说明；lowering 后的真实 definition ID 继续由同一 Rules 解释，没有收窄共享运行时来源类型。
- 原响应不改一字在修复后的本地 parser 中得到 3 个精确错误：success/basis 的第 0、1 项以及 failure/basis 的第 0 项。没有调用模型，也没有提交这份草稿。诊断证据为 `/tmp/zhuwei-vnext-round29-after-fix.json`。

此拒绝针对来源结构与实际 producer 不一致。KP 仍可填补不冲突的新经历；NPC 仍可撒谎、误信或夸张。新经历不需要旧同义引用，NPC 的话也不因与真相不同自动非法。格式修订不能事后添加这些语义来挽救原稿。

## 定向验证与缺口

- Node 四个目标文件：`kp-vnext-structured-diagnostics`、`kp-vnext-world-fact-memory`、`kp-vnext-social-plan`、`kp-vnext-schema-retrieval`，首次 45/46、exit 1。唯一失败是新增“已有知识”正常夹具仍保留不再使用的 prospective consumes；删除该夹具多余 consumes 后，仅失败项 1/1、exit 0。日志 `/tmp/zhuwei-round29-source-kind-node.log`、`/tmp/zhuwei-round29-source-kind-final.log`。新增矩阵覆盖两种旧引用形状、成功/失败字段位置、已有 npcContext 和同束新 worldFact 正常路径。
- `npx vitest run tests/kp-vnext-stage3-room.test.ts -t 'executes social Form'`：3/3、exit 0，32 项跳过；日志 `/tmp/zhuwei-round29-source-kind-room.log`。原社会互动直接消费者保持可提交。
- 新循环的 TypeScript 分支缩窄初次失败，复用同一 `socialBranchConform` 缩窄后 `npm run typecheck` 最终 exit 0；日志 `/tmp/zhuwei-round29-source-kind-types-final.log`。收束文档与 `git diff --check` 通过。

本批真实结果仍为失败，只有修复后的本地提前诊断证据。未执行真实模型前后对照，不能宣称修复成功率提高；完整对话、任意自然语言事实冲突和后续一致性不由本次验证保证。通用诊断、修订预算及恢复证据见 [主验证报告](vnext-proposal-diagnostics-validation.md)。
