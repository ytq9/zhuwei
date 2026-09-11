# vNext 旁白 review/v5 固定事实覆盖键验收

日期：2026-09-06。本页记录开发期本地修复；后续[round23](vnext-round23-validation.md)已取得一项真实知识回顾的生成、review/v5与发布成功，重复调用不重跑。此窄例不证明稳定成功率；没有部署、push、migration或生产删除。

## 症状与根因

[round20](vnext-round20-validation.md) 的真实审核响应未完整保留冻结事实的覆盖行身份。此前 review/v4 让模型同时生成数组、factIndex 与 covered/omitted 判定，即使事实文案重复或仅为可省略的 actionCommitted 回执，每个 index 仍要求一行；Prompt 说明不能为遗漏的结构提供确定保证。服务端原有拒绝是正确边界，失败响应不能补行或映射为通过。

## 修改与直接消费者

`narration-vnext.ts` 将审核协议改为 `zhuwei.narration-review/v5`。工具按本次全部冻结 facts 的稳定 index 生成 `factCoverage` 对象的 `f0…fN` 必填键，输入 facts 带相同 `coverageKey`；模型只填每格的 status 和 assertionRefs。服务器以同一冻结集合逐键校验，拒绝缺键、额外键、旧数组、额外 factIndex、重复 JSON 成员。字段顺序不决定身份。同文案、同名对象、不同 claimIndex 均保留独立格。

每格仍允许 covered/omitted；required fact 的 omitted 明确拒绝，optional fact 可以显式 omitted，但不能整格缺失。covered 仍须引用完整审核通过的 worldFact 断言及该事实/同 claimIndex 的具体依据；历史、动作实现、非事实句、其他对象同名事实不能替代。正文不改写，审核失败无第三次模型调用。

动态工具在最终 DeepSeek 请求的 12,000 输入预算检查之前构造，过大明确 materialBudget，绝不截取必要事实。Policy hash 纳入工具模板、每格结构和完整冻结 index→f键映射版本，并经 `vnext/runtime-policy.ts` 进入 Workflow hash。`authoritative.ts` 的生成→审核→发布及恢复消费者复用原冻结材料，回执报告新的 review schema。

普通工具传输保持现状，没有启用 strict/beta，也不能声称供应方强制输出完整对象。新键形状有本地结构与拒绝证据，真实模型成功率和 thinking+strict 组合均未验证。

## 定向矩阵与证据

| 路径 | 本地结果 |
| --- | --- |
| 普通自然改写、完整结果、正确actor和两次调用回执 | 通过 |
| 11条重复主张含同名不同人物，另加 optional 回执 | 全部固定键保留，顺序重排通过 |
| optional 缺键、未知键、旧数组、额外 factIndex、重复JSON键 | 拒绝，不补行、不增加调用 |
| required 显式 omitted、无关证据或另一同名人物证据 | 拒绝 |
| 零事实 | 工具覆盖对象为空；不制造事实 |
| 完整动态请求过预算 | 明确失败；保留全部决定性材料 |
| 知识回顾和破折号原文对齐回归 | 通过 |
| Room 私密Claims、模型失败后的Viewer恢复、后续合法行动 | 通过 |

实际运行：

- `npx tsx --test tests/kp-vnext-narration.test.mjs`：修改测试后红灯 exit 1，私有日志 `/tmp/zhuwei-review-v5-red.log`。
- `npx tsx --test tests/kp-vnext-narration.test.mjs tests/kp-vnext-knowledge-review.test.mjs`：40/40，exit 0，`/tmp/zhuwei-review-v5-node.log`。
- `npx vitest run tests/kp-vnext-provider-room.test.ts`：11/11，exit 0，`/tmp/zhuwei-review-v5-room.log`。
- `npm run typecheck`：exit 0，`/tmp/zhuwei-review-v5-types.log`。

Room 用例覆盖直接编排与冻结/恢复消费者；其旁白为确定性替身，真实生成/审核表现只能由未来有界 API 批次证明。

## 源码绑定与未覆盖

本地源码 HEAD 仍为 `258caee404e0814405eb497653ee9f00d647b773`，分支 `cloudflare`，工作树含全部既有未提交修改。

| 文件 | SHA-256 |
| --- | --- |
| `app/_runtime/lib/kp/narration-vnext.ts` | `0510bf2663db4c5d95f65a3b82678b977d3c1e35dcf8178eab59d845156ac5b1` |
| `tests/kp-vnext-narration.test.mjs` | `b80d3066d1b03376754c9d836a48280a045f9cbb23cf1ff08a6c6fef493738ec` |

当前 Workflow hash：`sha256:1835a36cc2eb7fd721c535f9e3d72b27e81b8b8473566402a4d1de5d28a0b672`；这是本地配置绑定，不是生产部署版本。

round21/22 历史 manifest 保持原样。对其文件逐项核对，round22 之后仅 `narration-vnext.ts` 的源码发生了后续标点及本节 v5 修改（该历史manifest不包含测试）；round21 还差 root basisRefs 的 schema/guidance 修复。不能把当前 hash 或新算法套回历史调用，round22 仍是“机械提交、旁白审核拒绝”。

未覆盖：单条开场知识以外的v5真实模型表现及持续可靠性、strict传输、到期Activity完整子阶段、20+双玩家链、A–O、完整游戏成本、构建/部署/生产新房与旧房退役、120条金标和长期SLO。普通到期后续本地证据见[到期验收](vnext-due-activity-validation.md)，round23不代替这些未覆盖门。总Goal保持active。
