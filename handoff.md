# vNext 阶段三续作交接：Claims 安全闭环后

**状态：已到本轮约定停点；这是开发检查点，不是阶段三完成，也不可生产采用。**

本轮从 Claude 的交接提交继续，完成 Claims / Viewer / Grounding 安全闭环并合入本地主线，然后按用户要求停在真实 DeepSeek Provider 门之前。没有接入 vNext-2 Room 消费端，没有推送、部署、migration 或远端资源变更。

## 1. 接手坐标

- 分支：`feature/kp-agent-vnext-stage3-continue`
- 工作目录：`/home/ubuntu/workspace/zhuwei/.claude/worktrees/stage3-cont`
- 本轮代码集成 HEAD：`cee6834ab1de17779afeb2f1d0a6e8299801a330`
- 远端同名 feature 在本轮开始时仍为 `a69bb5c`；本地代码相对它新增四个提交。交接文档提交会再前移本地 HEAD，以 `git rev-parse HEAD` 为准。
- 产品分支 `cloudflare` 与 `main` 未修改；本轮没有 Git push 权限扩张。

## 2. 本轮完成的四项任务

| 提交 | 完成内容 | 当前边界 |
|---|---|---|
| `9f74bab` | 修复 vNext strict-tool schema 中嵌套、无 `type` 的 union；本地方言校验与 schema fixture 同步收紧 | 修复后尚未用真实 DeepSeek 再握手 |
| `89697c4` | raw repair 无法证明合法时失败关闭；只有完全缺少 raw arguments 才可进入 clarification | 不再把畸形参数伪装成可澄清输入 |
| `5b25555` | 删除 Room 对旧粗粒度 vNext proposal 的直接入口，只接受现役 vNext-1 ProposalBundle | 内部 lowerer 复用不构成第二公开入口 |
| `cee6834` | Claims、Viewer grants 与 Narration grounding 防泄漏闭环 | 已经独立审计并得到“无明显 P0/P1”结论 |

Claims 安全闭环具体做了这些事：

- `FrozenRenderableClaims` 现在携带纳入 hash 的 `narrationFacts`：事实先从 committed range 派生为 Authority Claims，再用 SafeReadModel-derived grants / display names 做 Viewer 投影；叙述必须覆盖 Claim 的全部实质原子事实，不能只命中任意一个字段。
- 多句 SourceClaim / CharacterInference 被原子化，每句保留冻结的来源或角色归因。
- Unicode 规范化保留各语种字母、组合符、数字与符号；俄语、阿拉伯语和 emoji 附加内容不能再被归一化吞掉。
- 删除“你发现 / 你听见”等感官前缀剥离旁路；它们不能凭空把裸事实包装成玩家已知事实。
- 隐藏或内部 ref 形文本失败关闭；HP、死亡、资源、伤害、关系、物品、目标与故事摘要 fallback 不再输出 Authority ID。
- ability/source/inference 等展示名只使用 SafeReadModel 已授权的投影名称；semantic definition 的可见 label/summary 仍来自经过 policy 过滤的 Authority Claim 内容。opaque item 和 Authority-only ability 名称不会泄漏。
- Viewer grants 改为按 SafeReadModel 路径白名单派生，不再递归扫描整个对象、冒号文本、后缀或任意 raw JSON。
- 定向 canary 同时放入隐藏语义引用和可见 SourceClaim 自由文本，证明可见文本不能铸造隐藏引用 grant。

## 3. 已运行的定向证据

最终代码状态 `cee6834` 上：

```bash
npx tsx --test tests/authoritative-kp-adapter.test.mjs tests/kp-vnext-claims.test.mjs
# exit 0，24/24（T1）

npx tsx --test tests/kp-vnext-world-interaction-rules.test.mjs \
  tests/kp-vnext-materialization-and-feasibility-rules.test.mjs \
  tests/kp-vnext-hazard-actor-death-fold.test.mjs
# exit 0，43/43（T2）

npx vitest run tests/kp-vnext-stage3-room.test.ts
# exit 0，8/8（T2）

npm run typecheck
# exit 0

git diff --check
# exit 0
```

strict-tool / private repair 目标组此前为 38/38；Room 双入口退役由上述 8/8 和 materialization/feasibility 29/29 直接覆盖。

Claims 泄漏修复另有明确 RED 证据：在修复前代码 `89697c4` 上，测试“visible raw content cannot grant a hidden Claim payload reference”退出 1（实际错误地得到 `true`）；修复后该用例进入 43/43 绿组。

一次合并回归归属调查曾得到 664 个 Node 用例、649 通过、15 失败：其中 12 个在基线 `0b4c7ad` 上也失败，3 个仅合并态失败并已由 `89697c4` 修复。原先另一份“624/18”的被截断输出无法恢复，因此不得引用它宣称精确归属。本轮按开发期路由没有重跑全量套件。

## 4. 现在必须停住的 Provider 门

当前环境没有 `DEEPSEEK_API_KEY`，Claims prompt 又发生了模型可见变化，因此 T4 尚未完成。下一位接手者的第一项工作是让用户把 key 安全注入工作区环境（不要写进仓库，也不要粘贴到聊天），然后只运行预注册的四调用握手：

```bash
DEEPSEEK_API_KEY='由安全环境注入' \
  npx tsx tools/run-deepseek-strict-tool-handshake.mjs \
  tools/deepseek-vnext2-strict-tool-handshake-definition.mjs
```

四个调用必须分别覆盖：

1. world interaction；
2. materialize + interact；
3. correction；
4. invalid schema 必须在生成前被 Provider 拒绝。

握手未绿之前，不得把 vNext-2 接入真实 Room consumer，也不得改生产 Registry。握手失败时保存脱敏后的 provider code/path 与 schema hash，先修单一方言或合同事实源，不加 fallback、自动换模型或无界重试。

## 5. 后续已知缺口

- `highRiskConfirmed` 尚无消费者；必须继续失败关闭。后续需将私有 pending continuation 与 bundle/plan/context/ruling hashes 一起持久化，并在提交时重验。
- `fictionTime` 与 resource attempt cost 虽已有事件或 reducer 基础，但 vNext 没有完整原子消费路径；Claims 也没有 `FictionTimeAdvanced` 映射。
- `openBlank` 当前休眠；若启用，opaque authorization hash 还没有进入 submit-time read set。必须先建立权威授权事实源与提交时绑定。
- vNext-2 的 materialize + world-interaction 真实 Room T2 尚未建立；必须排在 Provider 握手之后。
- Claims prompt 的真实模型 T4 未运行；最终 `cee6834` 没有重跑完整 Node，完整 Worker、`npm test`、Lint、build、浏览器、migration、部署和 Git push 均未执行。

## 6. 接手顺序

1. 只读确认当前分支、工作树与此交接提交，保持 `cloudflare` / `main` 不变。
2. 安全取得 `DEEPSEEK_API_KEY` 后执行四调用握手，并记录每项的 provider 接受/拒绝证据。
3. 若握手全绿，才进入下一能力阶段：vNext-2 Room 最小纵切，覆盖 materialize + interact、一次 correction，以及 invalid schema 的失败关闭。
4. 对 `highRiskConfirmed`、time/resource cost、`openBlank` 分别建立能力合同与代表性矩阵；不要把它们顺带塞入同一个补丁。
5. 只有用户另行明确授权，才执行完整回归、生产冻结、push、migration 或部署。
