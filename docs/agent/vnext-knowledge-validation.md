# vNext 非行动知识回顾：本地纵切与真实调用验收

日期：2026-09-06。工作树 `cloudflare`，HEAD `258caee404e0814405eb497653ee9f00d647b773`，保留全部既有未提交修改。此记录不代表完整 vNext、旁白持续可靠性、部署或生产替换完成。

最新真实证据见[round23](vnext-round23-validation.md)：一条本人开场知识经正常认证HTTP完成Proposal、私有提交、真实生成/review-v5和发布；原请求重试新增调用0且同Receipt/Delivery，实际replay一致、机械不变。正文与已有开场知识相同，多条整理/相关选择/连续旁白质量仍未验收；下文round21/22失败保留历史结果。

## 能力合同与代表性矩阵

获认证玩家可回顾自己角色已持有的知识。KP 通过原自然语言 Proposal 入口选择 `knowledgeReview`，填写 inquiry、scope、knowledgeRefs；总览 allKnown 由服务器从完整目录全选，相关回顾 relevantKnown 只选该目录内记录，空选择不证明世界中无答案。查询不新增知识、不推进虚构时间、不扣资源、不产生随机或危险、不计聚光灯决定。事件、回执与审计前沿正常更新。

| 变化维度 | 证据 |
|---|---|
| 开场总览、文本来源主张 | 同一 terminal/schema/lowering → Rules → 私有 Claims → replay，完整保留原内容 |
| 结构化前提、多关系对象 | 原主体、各 binding 的关系与获授权名称完整表达；名称输出不授予通用空间/机械引用 |
| 本人 partial、底层完整秘密 | 只取 KnowledgeRecord.content，未读完整 canonicalFact，秘密 canary 不进入 Claims |
| 来源声称/角色推断/full | full 不将声称或推断升级为确定真相；转述感官资料不改为本人亲见 |
| 空目录、缺目录、超限正文 | 空目录可回顾；未冻结完整目录/正文或关键正文超限明确失败 |
| 他人猜 ref、准备后目录改变 | 非本人引用拒绝；新增/改变本人知识导致版本冲突 |
| 事件重放攻击 | 重算 envelope 的公开 policy、篡改内容、他人记录及旧 Profile 仍被 fold 拒绝 |
| 查询文字与事实证据 | 模型 inquiry 保留为问询元数据，排除出旁白 payload 事实证据目录 |
| Room 恢复及后续动作 | 两玩家私密 canary；只有本人收到回顾，旁白失败→驱逐→Viewer capability 恢复复用 Claims，Proposal 仅一次，事件仅一次；随后正常操作可提交 |
| 真实模型总览 | round22 正常认证 HTTP 的 Proposal 合法，私有 KnowledgeReviewed 提交且 replay 精确一致；生成成功，review/v4 因破折号间隙被拒，旁白未发布 |

## 实现与直接消费者

- `rules/v2/authority-bindings.ts` 定义完整 `knowledge-catalog:<actor>` 与逐记录 hash；Context 的索引、读取、权限分类和 actor 决定性闭包使用同一含义。本人知识正文不再作为可选缺失继续冻结。
- `proposal-schema.ts`、`proposal-validator.ts`、`proposal-provider.ts`、`proposal-guidance.ts`、`proposal-bundle-lowering.ts` 提供始终可用的封闭 terminal。无关键词判断、答案正文或机械字段；root basisRefs 必须空，不能混束物化或真实操作。`room-bridge.ts` 复用现有 rulesStep 及 readSet。
- `knowledge-review.ts` 生成私有 `KnowledgeReviewed`。`actions/model/events/Profile` 完成调度、注册和 replay 校验；不写 knowledge，不查更完整的底层事实。`timeline.ts` 排除聚光灯变化。
- `knowledge-expression.ts` 解释当前注册开场、背景前提、typed assertion、活动状态与标量内容，保留完整 typed payload；未知或畸形结构、无法合法取得名称时明确技术失败，不略去记录或伪称不知道。
- `knowledge-identities.ts`、`projector/model/observer-delta/claims` 提供获独立授权的名称专用投影，未授予其他对象属性或通用 Viewer refs。分享不继承原持有者私有 definition 的权限，语义主体仍来自 content。
- `claims.ts` 将新事件加入 root/direct 家族并生成 `knowledgeReview`，复用 Room audience、Delivery 与恢复。`narration-vnext.ts` 保留知识来源与层级，问询文字不成为事实证据。

## 检查结果

| 定向检查 | 最终结果与证据 |
|---|---|
| `npx tsx --test tests/kp-vnext-knowledge-review.test.mjs tests/kp-vnext-narration.test.mjs` | 38/38，exit 0；`/tmp/zhuwei-knowledge-final-node.log` |
| `npx vitest run tests/kp-vnext-provider-room.test.ts` | 11/11，exit 0；`/tmp/zhuwei-knowledge-final-room.log` |
| `npm run typecheck` | exit 0；`/tmp/zhuwei-knowledge-final-types.log` |
| 直接权限/重放/账本消费者审查 | 只读双审查完成，inquiry 证据边界与决定性知识闭包问题已修复 |

Node 与 Room 使用受控 Provider fixture，未产生真实外部调用。未运行全项目测试、Lint、build、部署、push、远端 migration 或生产退役。

## round21/22 真实调用与后续合成修复

round21 在 1 次真实 Proposal 后因根 basisRefs 多填一项被既有 validator 拒绝，0 事件/0 回执。补充 schema 字段描述与共用填写指导后，Proposal wire 目标组 28/28、exit 0（`/tmp/zhuwei-knowledge-wire-final.log`）。

round22 经新房正常 HTTP 完成 3 次真实调用：合法 knowledgeReview Proposal → Rules/Room 私有事件与 Claims → JSON 正文生成 → 工具审核。实际 genesis + 1 条 KnowledgeReviewed replay 精确等于存储，知识、事实、角色、资源、虚构时间和聚光灯均不变；Delivery rejected，错误为 NARRATION_BODY_INVALID。确定失败是第 6 段第 3 个断言前漏覆盖完整中文破折号，旧 reviewer 间隙规则拒绝它。

随后仅用合成样例修复完整双破折号 span 识别；单横线、长 run、漏实质字、数字范围及原有引用/权限拒绝仍保留。knowledge-review + narration 目标组先重现新增用例失败，再最终 39/39、exit 0（`/tmp/zhuwei-round22-final-node.log`）。这是新源码的合成证据，**round22 原真实审核仍记录失败**；未重判旧响应、未追加第三批真实调用，也未将前序 Room/typecheck 冒称为修复后重跑。

两批合计 4 调用、41,554 输入/6,228 输出，空闲标价 ¥0.0892434，全部计开发。见[round21/22 完整记录](vnext-round22-validation.md)与[脱敏 evidence](vnext-round22-live-evidence.json)。

## 未覆盖与后续

- 真实知识回顾已证明模型选择、Rules/Room 提交与 replay；修复后的真实完整旁白、相关记录选择及多角色连续模型表现仍待验证。[round20 完整 factCoverage 阻断](vnext-round20-validation.md)未因此解除。
- 未知知识 JSON 或缺乏合法展示身份的结构化内容会明确失败。若要跨私有角色传递尚未授权的名称，须沿知识取得/分享持久化展示授权，不能在表达时补读秘密。
- 到期 Activity、多待决继续、独立社交、动态人物/地点/通路、RootAction 累计预算、20+ 双玩家链、A–O、生产切换与旧房退役仍按[总 TODO](vnext-production-todo.md)推进。

## 后续直接回归：review/v5

上述历史调用及39/39标点证据之后，已将完整冻结facts映射为审核必填覆盖键；当前知识+旁白Node40/40、Room11/11、typecheck exit0，详见[review/v5 验收](vnext-review-v5-validation.md)。本节只补当前直接消费者的本地证据，未新增真实调用、未重判round22失败。
