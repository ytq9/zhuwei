# round113–115：失败分支写出来了，结构和预算成为新瓶颈

2026-09-23。三批都是用例 `daily-hidden-act`，调用上限 10，真实 HTTP 路径。均未部署、未 push、未做远端 migration、未改 Secrets。承接 [round112](./vnext-round112-validation.md)。

## round113（源码 `d84978b`，拒绝空壳分支之后）

4 次调用，167,171 输入 / 1,731 输出 token，行动被拒。

- 进展：检定（巧手 DC 14）的失败分支写出来了。莉安失败时说“你手别放那儿。你在我爸脸上做什么？”，动机“她看见陌生人在亡父遗体上多停了一只手”。
- 新问题：模型只选了 `inventoryOperation + social`，没有能记录“谁察觉了什么”的表单，于是给同一 NPC 另写了一个沉默的交谈步骤（绑定 `onSuccess`）来表达“得手”。唯一一次修订用在它的空 motive 上，之后在 lowering 撞到 `bundle:state-dependency-cycle`，行动作废；页面只显示通用错误，日志里 `failureReason` 为 `unclassified`。
- 修正（`8bd2385`）：选类型阶段要求“有人在场可能察觉的举动，同时选 observe”；见证句改为“得手才发生的取物等操作绑 onSuccess”；校验每个 NPC 每次行动只允许一个交谈步骤，重复的在填写位置直接退回修订。

## round114（源码 `8bd2385`）

3 次调用，136,337 输入 / 1,655 输出 token，`PROPOSAL_REPAIR_EXHAUSTED`。

- 进展：选类型阶段选了 observe 和 worldInteraction。
- 问题：草稿设了检定，取叶绑 `onSuccess`，但交谈步骤只有成功分支，没有任何步骤同时写两个分支。修订诊断只写了 `successFailurePairs: 1`，模型把交谈也改成 `onSuccess`，额度用尽。
- 修正（`c423fc4`）：共享检定诊断写明规则、列出当前每个步骤及其绑定、失败分支是否已写，并说明被察觉的隐蔽动作该写在哪里。

## round115（源码 `c423fc4`）

1 次调用，32,864 输入 / 108 输出 token，`PROPOSAL_INPUT_BUDGET_EXCEEDED`。

选类型阶段选了 observe、worldInteraction、inventoryOperation、social 四种，并请求加载奈斯的决策视图。填写请求超出输入预算，未发出，行动被拒。

**这是 `8bd2385` 那句“同时选 observe”的代价**：表单更多、请求更大，正常游玩里也可能因此撞预算。

## 现状

- NPC 只听到说出口的话：已稳定（round109、110、112、113 都成立）。
- 隐蔽动作要检定：round111–115 每次都设了检定。
- 失败分支：拒绝空壳后能写出 NPC 的反应（round113）；但“谁察觉了什么”需要额外表单，表单一多就撞预算。尚未有一次完整走通“检定失败并被察觉”的真实批次。

私有证据分别在 `/var/folders/lc/…/zhuwei-story-room-probe-UjUaeR`、`…-odn4l5`、`…-T1Elq4`，重启即失。
