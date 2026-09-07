# vNext round6：自然旁白、冻结表达材料与有界审核

日期：2026-09-05。基线：`cloudflare` / `258caee404e0814405eb497653ee9f00d647b773`，继续前序未提交工作树。依据用户批准的 [设计与矩阵](narration-grounding-redesign.md)、SPEC 0001 及 SPEC 0016 §8。本轮已实现 Narration 接缝重构，并完成一项正常认证 HTTP 的真实模型库存操作与自然旁白发布；**V01–V03 完整验收及生产替换尚未完成**。

## 能力合同与实现

Narration 依据已提交的完整 Typed Claims 和当前 Viewer 获授权的冻结表达材料，忠实改写结果，保持角色归属、必要后果、自然可读、人物表达与历史连续性。允许表现已提交动作的普通实现过程；不得追加独立行动、持续规则状态、机械优势或可被他人利用的新证据。恢复复用相同材料，不重跑 Proposal、随机或资源结算。

- `kp/narration-context.ts` 保存独立 hash 的 `FrozenNarrationContext`，绑定 rootActionId、Receipt、Viewer、projectionHash、claimsHash；不改 Rules 生成的 Claims 或其 hash。
- `room/narration-context.ts` 只接收已授权投影、Claims 与对话，冻结 Viewer/行动者、本人意图、公开场景基调、相关人物的公开 voice/attitude、实际听到且与本次主张相关的对话、历史叙述承诺。人物和发言按引用绑定，不从同名、排序或自由文本猜身份；未公开动机和 Story Bible 不进入材料。无关开场白不作为本次表达依据。
- `kp/narration-vnext.ts` 用“生成正文 → 一次独立审核”替代 vNext 字面全等 guard；返回原正文，不重写或拼接伪成功。模型材料保留 typed payload 与 claimIndex 分组，防止同类物品数量、同名人物身份失去对应关系。
- 服务端核验审核结构、所有句段、唯一且有效的事实引用、必要覆盖、自然可读/人物一致/连续性结果；拒绝不确定与非法输出。语义判断仍来自模型，结构通过不是语义正确的数学证明。
- `authoritative.ts`、`room/action.ts`、`room/durable-object.ts` 在首次 Delivery 与恢复路径验证、保存并复用同一冻结上下文；新增审核 purpose 和显式容量错误，调用前拒绝不伪造调用 Receipt。V5 仍走原接缝。
- `rules/v2/public-expression.ts` 及 model/events/projector/semantic-definitions/world-interactions 提供显式公开人物表达字段，沿现有 NPC 可见性边界投影。内部 NPC 稀疏修订已验证；当前真实 Provider wire 没有直接 NPC 修订消费者，未保留无消费者的 wire 对象分支，也不宣称动态 NPC 人格的完整模型入口已完成。

Narration 每次最多两次调用、共享 45 秒；输入保守估算每次最多 12k、输出最多 4k、正文最多 6000 字符，输出预留随事实/句段规模变化。必要材料不截断；超预算保留已提交/未发布并给出容量错误。策略、Prompt、schema 与预算进入 vNext workflow hash。`room/server.ts` 的原始调用捕获仅在显式本地 vNext 模式启用，限 loopback `/capture`，不写公共日志、不产生额外模型调用。

## 代表性矩阵与证据层级

| 变化维度 | 本轮证据 | 边界 |
| --- | --- | --- |
| 自然改写与普通动作表现 | Narration 目标测试；真实库存正文发布并人工核对 | 不凭“轻轻”推导潜行成功或无人察觉 |
| 同类事实的不同数量、同名 NPC 与旁观者 | typed 分组、身份/Viewer、错误角色拒绝目标测试 | 尚无多人真实连续对话证据 |
| 人物表达、来源主张与历史细节 | 授权材料筛选测试；NPC 稀疏修订经 Rules/Room 公开投影 | 模型返回人物/连续性失败时拒绝已有证据；真实人物表达质量仍待 |
| 越界、遗漏与审核失败 | 新断言/玩家能动性/角色错误/质量失败、索引遗漏重复越界、429/超时测试；真实不合法审核被拒 | 模型语义误判率未测定 |
| 恢复、库存与资源 | Item 冻结旁白经 DO 驱逐后恢复；真实重复 HTTP 和精确事件重放 | 恢复测试使用捕获提案及受控 KP；不计另一项真实模型旁白 |
| 物化、失败成本及连续环境互动 | 复用既有 materialize+interact 与捕获 Item 的 Room 用例 | 真实模型完整矩阵未过；枪械 fixture 的能力上下文缺口另列 |

## 真实链路与消耗

运行环境为 **localhost 正常 Cookie 认证 HTTP → real DeepSeek `deepseek-v4-flash` → 本地 SQLite Room DO → 玩家 Delivery**。未部署 Cloudflare 生产。脱敏逐次用量、hash、状态和遥测见 [round6-live-evidence.json](vnext-round6-live-evidence.json)。原始请求/响应仅保存在本机限制权限的 `/tmp/zhuwei-vnext-round6-private/`，未写入仓库。

批次上限：3 个根行动 / 12 次请求 / 360k 输入 / 32k 输出，每 HTTP 最多 4 次。本轮 **3 个根行动、7 次实际调用，92,593 输入 / 2,956 输出 tokens**，无未知用量；3 个根行动额度已用完，未继续采样。

| 根行动 | 调用与结果 | 输入 / 输出 tokens |
| --- | --- | --- |
| 释放库存并观察 | 1 次 Proposal；原工具参数把 failure 写入 success 分支，`PROPOSAL_FORM_INVALID`；无提交、随机、成本或旁白 | 28,377 / 1,170 |
| 单项释放库存对照 | Proposal + 生成 + 审核；库存提交，长正文擅加声响/材质/NPC 反应，审核 grounded 项引用为空，程序拒绝 `NARRATION_BODY_INVALID`，未发布 | 32,356 / 1,009 |
| 修正表达材料相关性后新房对照 | Proposal + 生成 + 审核；库存提交且发布下述自然正文 | 31,860 / 777 |

成功正文：

> 你俯身，将随身的一支弩矢放到脚边的地上。弩矢轻轻落地，就搁在你脚旁。

用户澄清这些普通动作细节可以接受。本轮据此明确：它们自然实现原动作，没有追加玩家决定或机械后果；“轻轻”不构成无人察觉的事实。此前长正文的新增材质、声响证据和 NPC 反应仍须有权威依据。实现不使用姿态白名单、对象名称判断或专用结果。最终 Prompt 对此作了明确说明，**该最后措辞调整未再进行真实采样**，有定向测试证据。

成功链路人工对照：持有量 **20 → 19**，地面新栈 **1**，HP **28/28**、其他职业资源不变，fictionTime 为 0、无 Pending。重复同一 HTTP 请求新增模型调用 **0**，submissionId/Receipt/机械状态/Delivery 相同。实际 genesis + 1 条 `InventoryOperationApplied` 事件重放与 DO 存储精确一致，冻结表达材料通过 conformance。成功旁白两次调用合计 **3,493 输入 / 235 输出**；Proposal 单次输入仍为 **28,367**，尚未满足简单行动的 token 采用门。

## 定向验证与失败记录

三类证据为 Node 行为测试、Worker/Room 目标用例、公开 DTO 类型检查；外部探针另按已批准批次记账，未扩展全量门。

- `npx tsx --test tests/kp-vnext-narration.test.mjs` 曾 **16/16，退出 0**，记录 `/tmp/zhuwei-vnext-round6-final-node.log`。初跑冻结 fixture 被直接修改的用例失败，改为克隆 fixture 后通过。收尾独立审查复现“生成成功、审核输入超预算被误报事实冲突”，已单独映射容量错误并保留唯一成功生成回执；新增边界用例后，`npx tsx --test tests/kp-vnext-narration.test.mjs tests/table-server-outcome-v2.test.mjs` 最终 **28/28（17+11），退出 0**，记录 `/tmp/zhuwei-vnext-round6-capacity-final.log`。
- 直接 Node 消费者 `authoritative-kp-adapter` **6/6**、`kp-vnext-claims` **20/20**、`table-server-outcome-v2` **11/11** 通过；后一组同步新容量错误的公开 allowlist。Proposal schema 目标组曾 **28/28** 通过；之后删除无真实消费者的 publicExpression wire 分支，未冒称那次结果验证最终 schema 状态。
- `npx vitest run tests/kp-vnext-stage3-room.test.ts -t <目标用例>`：NPC 稀疏修订 **1 项**、vNext-2 物化+交互与捕获 Item 回放 **2 项**、新增 Item 旁白驱逐恢复 **1 项**通过，退出 0；未运行该文件全量。NPC 用例删除无关手枪预期，改为核对已授权公开表达。恢复用例最初意图遗漏捕获提案实际依赖的场景对象而报 `CONTEXT_INSUFFICIENT`，补齐真实 fixture 意图后通过。
- 两个现有 gun/chandelier 用例在进入 Rules/Narration 前失败：`pistolAbility` 所需的冻结 `abilityRefs` 和匹配定义为空，fixture 断言被 Room 包装为 `PROPOSAL_PROVIDER_TIMEOUT`。**当前仍是能力上下文选择/fixture 验收缺口**，未证明由此次 Narration 改动引入；没有伪造能力或放松权威检查来做绿测试。
- `npm run typecheck` 在最后 Prompt/Context/公开类型改动后退出 **0**；其后的容量 catch 修复未改变公开类型。实际事件 replay 脚本退出 **0**。`git diff --check` 首次发现移除旧测试留下的 EOF 空行，清理后退出 **0**；最终 5 份相关文档的本地链接无缺失，7 次调用的逐项用量与汇总一致，目标差量审查完成。

## 剩余范围

V01 后续应先定位枪械能力上下文缺口，并验证 NPC 来源主张/不同声口、失败与真实动作资源成本、物化并交互、世界内拒绝，以及环境承诺→后续引用固化的连续真实链。全局模型合法率、审核误报/漏报、延迟与 token 采用门留在 V11。本轮一项成功不能证明模型稳定无错或其他组件全部正常；最后容量错误映射修复仅有定向证据，未增加真实采样。

两个本地测试宿主已主动停止，均退出 130；未删除本地数据。没有 commit/push、部署、远端 migration、生产 Profile 切换、旧房/归档退役或账号数据修改，`main` 与 grok.me 不变。
