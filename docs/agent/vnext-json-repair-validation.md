# vNext 完整语义下的 JSON 与摘要窄修订

日期：2026-09-06。基线 `cloudflare/258caee404e0814405eb497653ee9f00d647b773` 未提交树。保持既有修改，无真实 API、生产修改或部署。

## 目标与合同

SPEC0015 §§6.1–6.2 与 SPEC0016 §§7.2、12 允许唯一合法工具的 JSON/schema 窄修订。此前 JSON 解析异常直接结束、摘要缺失不进入 allowlist，收窄了已批准的恢复能力。现在完整提案的全部直接顶层成员与嵌套值均已证明时，可修最外层闭合或尾逗号错误；已冻结机械语义完整时，可补注册的 presentation summary 叶字段或纠正其非法类型。修订不能选择新工具、改判、猜测缺失子提案或重发整束。

纯语法候选必须先持久化证据，调用唯一一次 correction 并显式返回 `changes:[]`，才重新完整验证原 Bundle；不会自动补括号后直接提交。存在摘要错误时，空修订仍失败，必须填写精确允许路径。普通路径最多两阶段，纯 schema 补取后最多三阶段；已保存响应恢复不增调用。

## 实现与直接消费者

- `canonical-json.ts` 复用同一递归 unique-member parser，新增仅收集完整根成员的证据接口。只接受缺根 `}`、根尾逗号（带或不带根 `}`）；子结构、字符串、数值、键或值不完整，重复/转义等价键和尾部垃圾一律拒绝。严格 parse 仍拒绝全部损坏 JSON。
- `proposal-provider.ts` 保存原始 arguments 和所选工具，重新证明 draft/hash/诊断/allowlist 后才能发起修订。纯语法仍是 locallyRejected/repairRequired。合法 JSON 不得伪装语法证据，未知字段不被删除。parser 升为 v10、私有 repair ticket 升为 vnext-2，Workflow hash 随合同变化。
- `proposal-correction.ts` 允许缺失的注册摘要叶字段；所有父结构与机械字段必须已存在，probe 修正全部摘要后须通过完整 domain 校验，其他错误不开放路径。
- `vnext-proposal-invocation.ts` 从 Room 已保存首响应重读并比对语法证据、Bundle hash、validationCode 与 issues；不能只靠调用者重签 ticketHash。Adapter、strict correction 工具说明与 guidance 同步；完整 lowering、Rules 预检和原子提交仍由现有链执行。

## 矩阵与验证证据

Node：`npx tsx --test tests/kp-vnext-proposal-schema.test.mjs tests/kp-vnext-schema-retrieval.test.mjs`，38/38，exit0，日志 `/tmp/zhuwei-json-repair-node.log`。覆盖完整根缺括号与尾逗号、缺失/错误类型摘要与复合语法错误、子提案/感官字符串截断、重复键/转义等价键、嵌套伪顶层、混合或损坏 schemaRequest、重签票据篡改、修改 Ruling/风险/意图/方法/outcomeBinding、空修订绕过摘要错误、一次耗尽与无第三阶段。

Room：`npx vitest run tests/kp-vnext-provider-room.test.ts -t 'JSON|retrieves Item|saved first response|one repair ticket|oversized returned draft'`，7/7，exit0，日志 `/tmp/zhuwei-json-repair-room.log`。两种新纵切分别为普通提案和一次schema补取：损坏原响应保存后驱逐，修订响应保存后再驱逐，再恢复完成同一个控制件变更与旁白；普通实际2调用、补取实际3调用，重复submission无新调用或世界变化。另验证截断子提案1调用后拒绝、state/events不变及已保存拒绝不重采。原有503重试用例实际3次请求，只证明同请求重试，不记为无新增调用证据。

`npm run typecheck` 首次因字面量数组 `includes` 类型不匹配 exit2，改为同义直接比较后 exit0，最终日志 `/tmp/zhuwei-json-repair-types-final.log`。该修改不改变行为，没有无理由重跑已绿Node/Room。`git diff --check` exit0。

独立只读审查无新阻断：内存探针13个Provider拒绝样例、8个parser边界样例exit0；未知键（包括原型相关名字）不清洗，篡改语义并重签票据拒绝，纯语法确认前后Bundle hash相同。未重复现有测试组或调用API。

## 未覆盖范围

本次不允许任意 JSON 修补、任意未知字段删除、缺失机械字段补猜、机械/引用诊断修订；后者仍是完整能力差量。round25 的 proposals 在3012处不完整，现有恢复仍拒绝，原真实失败不改判。不增加采样、不重放诊断清洗副本。当前真实模型合规observe/旁白、复杂补取、social/NPC、双玩家20+、A–O、归档待批、部署与旧房退役仍待；120金标/SLO后置，总Goal active。
